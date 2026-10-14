import type { Action } from "../actions/actionTypes.ts";
import type { Finding, FindingStatus } from "../findings/findingTypes.ts";
import { pathToFixed } from "../findings/pathToFixed.ts";
import {
  buildImplementation, implementationOf, MIN_DAYS, outcomeForAction, savedOutcomeOf, shouldSaveOutcome, type ImplementationRecord, type Outcome,
} from "./actionOutcome.ts";
import { pullRequestPageBeforeOf } from "../fixes/linkPullRequest.ts";
import { isPublicHttpUrl, type PageFingerprint } from "./pageFingerprint.ts";
import type { SearchSnapshotPayload } from "./searchSnapshot.ts";

type Snapshot = { snapshotDate: string; payload: SearchSnapshotPayload } | null;

/** A change reported more than this long after it went live is "late": the latest snapshot may already include its effect. */
const LATE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * What the outcome service needs from storage and the web. Self-host
 * (SQLite) and platform (Supabase) each provide one, so the rules below are
 * written, and tested, once.
 */
export type OutcomePorts = {
  getAction(id: string): Promise<Action | null>;
  getFinding(id: string): Promise<Finding | null>;
  getSnapshot(): Promise<Snapshot>;
  /** The newest snapshot captured at or before `at` (ISO timestamp). Optional: without it, the latest snapshot is used. */
  getSnapshotOnOrBefore?(at: string): Promise<Snapshot>;
  /** Move the action to completed, saving `result` with it. */
  completeAction(id: string, result: Record<string, unknown>): Promise<Action | null>;
  /** Replace an action's saved result without changing its status. */
  saveResult(id: string, result: Record<string, unknown>): Promise<void>;
  /** Back to proposed with no result (undo). */
  resetAction(id: string): Promise<Action | null>;
  moveFinding(id: string, status: FindingStatus): Promise<void>;
  fetchFingerprint(url: string): Promise<PageFingerprint | null>;
  /** The project's own site, so a page URL from the user can only point at it. */
  projectUrl: string | null;
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error });

export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

/**
 * The user (or later an integration, with `via`) reports that a tracked
 * change is live. Saves the baseline from the latest snapshot, captures the
 * page's title/description/heading as proof, completes the action and moves
 * its finding forward to "fixed".
 */
export async function implementAction(
  ports: OutcomePorts,
  args: { actionId: string; pageUrl?: string | null; via?: ImplementationRecord["via"]; change?: ImplementationRecord["change"]; now?: Date;
    /** Captured by the caller BEFORE it changed the live page (a CMS publish), so the baseline is not the already-fixed page. */
    pageBefore?: PageFingerprint | null },
): Promise<ServiceResult<Action>> {
  const now = args.now ?? new Date();
  const action = await ports.getAction(args.actionId);
  if (!action) return fail(404, "Action not found.");
  if (action.status === "completed") return fail(409, "This change is already marked as made.");
  if (action.status === "cancelled" || action.status === "failed") return fail(409, "This action was cancelled. Track a new one.");

  const finding = await ports.getFinding(action.findingId);
  if (!finding) return fail(404, "Finding not found.");

  // The page to fingerprint: what the user told us, else the action's or the finding's page.
  const requested = args.pageUrl?.trim() || null;
  if (requested) {
    if (!isPublicHttpUrl(requested) || (ports.projectUrl && !sameHost(requested, ports.projectUrl))) {
      return fail(400, "That page isn't on your website.");
    }
  }
  const pageUrl = requested ?? action.target.url ?? finding.url ?? null;
  // A merged PR's "before" page is the one recorded when the PR was opened. If none was recorded it is unknown (null):
  // a live fetch now would read the merged page and make the comparison meaningless.
  const pageBefore = args.pageBefore !== undefined
    ? args.pageBefore
    : args.via === "github_pr"
      ? (pullRequestPageBeforeOf(action.result) ?? null)
      : pageUrl ? await ports.fetchFingerprint(pageUrl) : null;

  // The baseline is the numbers as of the change's own moment. When the change is merged or reported late, the newest
  // snapshot may already be after it, so use the newest one captured on or before it, and flag it if none exists.
  const late = args.via === "github_pr" || Date.now() - now.getTime() > LATE_AFTER_MS;
  let snapshot: Snapshot = null;
  let approximateBaseline = false;
  if (late && ports.getSnapshotOnOrBefore) {
    snapshot = await ports.getSnapshotOnOrBefore(now.toISOString());
    if (!snapshot) {
      snapshot = await ports.getSnapshot();
      approximateBaseline = snapshot !== null;
    }
  } else {
    snapshot = await ports.getSnapshot();
  }

  const implementation = buildImplementation({
    finding, snapshot, via: args.via, now, change: args.change, pageUrl, pageBefore, approximateBaseline,
  });
  const result = { implementation };

  const completed = await ports.completeAction(action.id, result);
  if (!completed) return fail(404, "Action not found.");

  // Keep the finding's lifecycle in step with the change; failures here must not undo the saved action.
  try {
    for (const next of pathToFixed(finding.status)) await ports.moveFinding(finding.id, next);
  } catch {
    // The action is saved either way; the user can still move the finding by hand.
  }
  return { ok: true, value: completed };
}

/** Undo a mistaken "I made this change", only while it is fresh, so recorded results stay trustworthy. */
export async function undoImplementation(ports: OutcomePorts, args: { actionId: string; now?: Date }): Promise<ServiceResult<Action>> {
  const now = args.now ?? new Date();
  const action = await ports.getAction(args.actionId);
  if (!action) return fail(404, "Action not found.");
  const implementation = implementationOf(action.result);
  if (action.status !== "completed" || !implementation) return fail(409, "This change hasn't been marked as made.");
  if (now.getTime() - Date.parse(implementation.implementedAt) > UNDO_WINDOW_MS) {
    return fail(409, "It's too late to undo this. Track a new action to record another change.");
  }
  const reset = await ports.resetAction(action.id);
  return reset ? { ok: true, value: reset } : fail(404, "Action not found.");
}

/** An action with its measured outcome, and whether "I made this change" can still be undone. */
export type ActionWithOutcome = Action & { outcome: Outcome | null; canUndo: boolean };

function canUndoAt(action: Action, now: Date): boolean {
  const implementation = action.status === "completed" ? implementationOf(action.result) : null;
  return Boolean(implementation && now.getTime() - Date.parse(implementation.implementedAt) <= UNDO_WINDOW_MS);
}

/**
 * Attach each implemented action's outcome. Along the way, saves what is
 * worth keeping: the page "after" fingerprint the first time we look past the
 * minimum wait, and the verdict once it is solid (so it survives snapshots
 * being pruned). Saving is best-effort and never fails the read.
 */
export async function readOutcomes(ports: OutcomePorts, actions: Action[], now: Date = new Date()): Promise<ActionWithOutcome[]> {
  const implemented = actions.filter((a) => a.status === "completed" && implementationOf(a.result));
  if (implemented.length === 0) return actions.map((action) => ({ ...action, outcome: null, canUndo: false }));

  const snapshot = await ports.getSnapshot();
  const findings = new Map<string, Finding | null>();
  const out = new Map<string, Outcome | null>();

  for (const action of implemented) {
    try {
      if (!findings.has(action.findingId)) findings.set(action.findingId, await ports.getFinding(action.findingId));
      let result = action.result ?? {};
      let implementation = implementationOf(result)!;

      const daysSince = (now.getTime() - Date.parse(implementation.implementedAt)) / 86_400_000;
      if (!savedOutcomeOf(result) && daysSince >= MIN_DAYS && implementation.pageBefore && !implementation.pageAfter && implementation.pageUrl) {
        const pageAfter = await ports.fetchFingerprint(implementation.pageUrl);
        if (pageAfter) {
          implementation = { ...implementation, pageAfter };
          result = { ...result, implementation: { ...(result.implementation as object), pageAfter } };
          await ports.saveResult(action.id, result).catch(() => undefined);
        }
      }

      const outcome = outcomeForAction({ action: { type: action.type, result }, finding: findings.get(action.findingId) ?? null, snapshot, now });
      out.set(action.id, outcome);
      if (outcome && !savedOutcomeOf(result) && shouldSaveOutcome(outcome)) {
        await ports.saveResult(action.id, { ...result, outcome: { ...outcome, evaluatedAt: now.toISOString() } }).catch(() => undefined);
      }
    } catch {
      out.set(action.id, null);
    }
  }

  return actions.map((action) => ({ ...action, outcome: out.get(action.id) ?? null, canUndo: canUndoAt(action, now) }));
}
