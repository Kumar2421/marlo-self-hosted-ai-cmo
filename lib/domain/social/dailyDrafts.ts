/**
 * Daily social drafts: one draft per network (X, LinkedIn, Reddit) for each
 * project, for review only. Nothing is posted anywhere.
 *
 * Pure planner and runner. Storage, the model and the clock come in through
 * ports, so the rules are unit-tested with fakes. The platform adapter lives
 * in dailyDraftJob.ts.
 */
import { inAppEnabled } from "../notifications/preferences.ts";
import type { NotificationStore } from "../notifications/ports.ts";
import { socialDraftsKey } from "../notifications/caps.ts";
import { socialDraftsBody, socialDraftsTitle } from "../notifications/render.ts";
import { categoryOf, type NotificationDraft } from "../notifications/types.ts";
import type { DraftGenerationResult } from "./draftGeneration.ts";
import type { PlatformId } from "./platforms.ts";

export const SOCIAL_PLATFORMS: readonly PlatformId[] = ["x", "linkedin", "reddit"];

/** With this many unreviewed drafts on one network, the user has a backlog: no new draft for it today. */
export const BACKLOG_LIMIT = 6;

export const SKIP_REASONS = [
  "already_done",
  "no_product_info",
  "no_model_key",
  "no_subreddit",
  "out_of_credits",
  "backlog",
  "daily_limit",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Facts about the project and the user that decide which networks run today. */
export type DailyDraftSnapshot = {
  /** The Product Information document exists and is not empty. */
  hasProductInfo: boolean;
  /** The project's first saved subreddit, without "r/"; null when none. */
  subreddit: string | null;
  /** "byok": the user's own key (no credits). "platform": the platform key (metered). "none": no key at all. */
  modelAccess: "byok" | "platform" | "none";
  /** False only when the platform key would be used and the balance cannot cover one batch. */
  creditsAffordable: boolean;
};

export type DailyDraftPorts = {
  /** Claim the (project, day) run; false when another run holds it. */
  claimDay(day: string): Promise<boolean>;
  releaseDay(day: string): Promise<unknown>;
  /** Whether this network already finished (drafted or legitimately skipped) on this day. */
  isDone(platform: PlatformId, day: string): Promise<boolean>;
  markDone(platform: PlatformId, day: string): Promise<unknown>;
  snapshot(): Promise<DailyDraftSnapshot>;
  /** Unreviewed (status draft) drafts currently waiting on this network. */
  pendingCount(platform: PlatformId): Promise<number>;
  /** Generate one draft for the network. Same result shape as generateDraftBatch. */
  generate(platform: PlatformId): Promise<DraftGenerationResult>;
};

export type DailyDraftSummary = {
  /** Another run held the claim; nothing was done. */
  busy: boolean;
  /** The time budget ran out before every network was looked at; the rest run on the next pass. */
  interrupted: boolean;
  created: Record<PlatformId, number>;
  skipped: Array<{ platform: PlatformId; reason: SkipReason }>;
  /** Fixed messages only (never model output, keys or payloads). Not marked done, so they retry. */
  errors: Array<{ platform: PlatformId; error: string }>;
};

export const GENERATION_FAILED = "The model call failed or returned drafts we could not use.";
export const SAVE_FAILED = "Could not save the draft or charge credits.";
export const UNEXPECTED = "Unexpected error.";

export function emptyDailyDraftSummary(): DailyDraftSummary {
  return { busy: false, interrupted: false, created: { x: 0, linkedin: 0, reddit: 0 }, skipped: [], errors: [] };
}

export function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Why a network gets no draft, or null when it should run. Pure. Pass
 * `pending` (unreviewed drafts) to also apply the backlog guard.
 */
export function skipReasonFor(platform: PlatformId, snap: DailyDraftSnapshot, pending?: number): SkipReason | null {
  if (!snap.hasProductInfo) return "no_product_info";
  if (snap.modelAccess === "none") return "no_model_key";
  if (platform === "reddit" && !snap.subreddit) return "no_subreddit";
  if (snap.modelAccess === "platform" && !snap.creditsAffordable) return "out_of_credits";
  if (pending !== undefined && pending >= BACKLOG_LIMIT) return "backlog";
  return null;
}

function draftCount(body: unknown): number {
  const drafts = (body as { drafts?: unknown } | null)?.drafts;
  return Array.isArray(drafts) ? drafts.length : 0;
}

function errorMessageFor(status: number): string {
  if (status === 502) return GENERATION_FAILED;
  if (status === 500) return SAVE_FAILED;
  return UNEXPECTED;
}

/**
 * Generate today's drafts for one project. Each network is independent: a
 * failure on one never stops the others. A network is marked done after a
 * draft is saved or after a legitimate skip; a transient failure is not marked,
 * so it is retried. Per-network errors are caught here; errors from the claim,
 * the marker reads or the snapshot propagate, and the job isolates each project.
 */
export async function runDailyDrafts(
  ports: DailyDraftPorts,
  now: Date,
  opts: { timeUp?: () => boolean } = {},
): Promise<DailyDraftSummary> {
  const day = isoDay(now);
  const summary = emptyDailyDraftSummary();

  // One run per project and day, so overlapping invocations cannot double a batch.
  if (!(await ports.claimDay(day))) {
    summary.busy = true;
    return summary;
  }
  try {
    const todo: PlatformId[] = [];
    for (const platform of SOCIAL_PLATFORMS) {
      if (await ports.isDone(platform, day)) summary.skipped.push({ platform, reason: "already_done" });
      else todo.push(platform);
    }
    if (todo.length === 0) return summary;

    const snap = await ports.snapshot();
    for (const platform of todo) {
      if (opts.timeUp?.()) {
        summary.interrupted = true;
        break;
      }
      try {
        let reason = skipReasonFor(platform, snap);
        if (!reason) reason = skipReasonFor(platform, snap, await ports.pendingCount(platform));
        if (reason) {
          summary.skipped.push({ platform, reason });
          await ports.markDone(platform, day);
          continue;
        }

        const result = await ports.generate(platform);
        if (result.status === 201) {
          summary.created[platform] += draftCount(result.body);
          await ports.markDone(platform, day);
        } else if (result.status === 402) {
          summary.skipped.push({ platform, reason: "out_of_credits" });
          await ports.markDone(platform, day);
        } else if (result.status === 429) {
          summary.skipped.push({ platform, reason: "daily_limit" });
          await ports.markDone(platform, day);
        } else {
          summary.errors.push({ platform, error: errorMessageFor(result.status) });
        }
      } catch {
        summary.errors.push({ platform, error: UNEXPECTED });
      }
    }
    return summary;
  } finally {
    await Promise.resolve(ports.releaseDay(day)).catch(() => undefined);
  }
}

export type ProjectTarget = { projectId: string; userId: string };

/**
 * Fair rotation: the project waiting longest goes first (never finished first).
 * `lastDone` maps project id to the ISO time its most recent marker was written.
 * Duplicate projects are dropped.
 */
export function rotationOrder(targets: ProjectTarget[], lastDone: Map<string, string>): ProjectTarget[] {
  const seen = new Set<string>();
  const unique = targets.filter((t) => {
    if (seen.has(t.projectId)) return false;
    seen.add(t.projectId);
    return true;
  });
  return unique.sort(
    (a, b) => (lastDone.get(a.projectId) ?? "").localeCompare(lastDone.get(b.projectId) ?? "") || a.projectId.localeCompare(b.projectId),
  );
}

export type SocialDraftCounts = Partial<Record<PlatformId, number>>;

/** The in-app item for one user and day, or null when no draft was created. */
export function socialDraftsNotice(input: { userId: string; projectId: string; day: string; created: SocialDraftCounts }): NotificationDraft | null {
  const created: Record<PlatformId, number> = { x: input.created.x ?? 0, linkedin: input.created.linkedin ?? 0, reddit: input.created.reddit ?? 0 };
  const total = created.x + created.linkedin + created.reddit;
  if (total <= 0) return null;
  const networks = SOCIAL_PLATFORMS.filter((p) => created[p] > 0);
  return {
    kind: "social_drafts_ready",
    projectId: input.projectId,
    dedupeKey: socialDraftsKey(input.userId, input.day),
    title: socialDraftsTitle(total),
    body: socialDraftsBody(networks),
    payload: { open: "social", platform: networks[0], created, projectId: input.projectId },
  };
}

/**
 * Store the in-app item, only when drafts were created and the user's
 * preferences keep the content category in the app. The dedupe key makes a
 * second run the same day a no-op.
 */
export async function notifySocialDrafts(
  store: Pick<NotificationStore, "getPreferences" | "record">,
  userId: string,
  input: { projectId: string; day: string; created: SocialDraftCounts },
  now: Date,
): Promise<{ notified: boolean }> {
  const draft = socialDraftsNotice({ userId, ...input });
  if (!draft) return { notified: false };
  const { prefs } = await store.getPreferences(userId);
  if (!inAppEnabled(prefs, categoryOf(draft.kind))) return { notified: false };
  const result = await store.record(userId, draft, now);
  return { notified: result.created };
}
