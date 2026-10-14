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
import { socialDraftsKey, socialDraftsPausedKey } from "../notifications/caps.ts";
import { SOCIAL_PAUSED_BODY, SOCIAL_PAUSED_TITLE, socialDraftsBody, socialDraftsTitle } from "../notifications/render.ts";
import { categoryOf, type NotificationDraft } from "../notifications/types.ts";
import type { DraftGenerationResult } from "./draftGeneration.ts";
import type { PlatformId } from "./platforms.ts";

export const SOCIAL_PLATFORMS: readonly PlatformId[] = ["x", "linkedin", "reddit"];

/** With this many unreviewed drafts on one network, the user has a backlog: no new draft for it today. */
export const BACKLOG_LIMIT = 6;

/** Global safety ceiling: job drafts created per UTC day across all users. */
export const DAILY_JOB_CREATE_CAP = 60;

/**
 * Model call budget for the background job: one attempt, short timeout. The
 * job runs inside a 60s cron invocation, so a slow call must give up early.
 */
export const DAILY_CALL = { timeoutMs: 20_000, maxRetries: 0 } as const;

export const SKIP_REASONS = [
  "already_done",
  "disabled",
  "no_product_info",
  "no_model_key",
  "no_subreddit",
  "out_of_credits",
  "backlog",
  "daily_limit",
  "daily_cap",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Facts about the project and the user that decide which networks run today. */
export type DailyDraftSnapshot = {
  /** The Product Information document exists and is not empty. */
  hasProductInfo: boolean;
  /** The project's first saved subreddit, without "r/", already validated; null when none or invalid. */
  subreddit: string | null;
  /** "byok": the user's own key (no credits). "platform": the platform key (metered). "none": no key at all. */
  modelAccess: "byok" | "platform" | "none";
  /** False only when the platform key would be used and the balance cannot cover one draft. */
  creditsAffordable: boolean;
  /** The project's per-network switches for automatic drafts. */
  enabled: Record<PlatformId, boolean>;
};

export type DailyDraftPorts = {
  /** Claim the (project, day) run; false when another run holds it. */
  claimDay(day: string): Promise<boolean>;
  releaseDay(day: string): Promise<unknown>;
  /** Whether this network was already attempted today (drafted, skipped or failed). One attempt per network per day. */
  isAttempted(platform: PlatformId, day: string): Promise<boolean>;
  /** Written before any work on the network, so a failure or a timeout still counts as the day's attempt. */
  markAttempt(platform: PlatformId, day: string): Promise<unknown>;
  /** Written once a draft is saved; `created` feeds the global daily ceiling. */
  markDone(platform: PlatformId, day: string, created: number): Promise<unknown>;
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
  /** Fixed messages only (never model output, keys or payloads). */
  errors: Array<{ platform: PlatformId; error: string }>;
};

export const GENERATION_FAILED = "The model call failed or returned drafts we could not use.";
export const SAVE_FAILED = "Could not save the draft or charge credits.";
export const UNEXPECTED = "Unexpected error.";
export const RECORD_FAILED = "The draft was saved, but the run could not record it. It is not generated again today.";

export function emptyDailyDraftSummary(): DailyDraftSummary {
  return { busy: false, interrupted: false, created: { x: 0, linkedin: 0, reddit: 0 }, skipped: [], errors: [] };
}

export function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Time kept for the notification pass at the end of the cron run, so drafts never starve it. */
export const NOTIFY_RESERVE_MS = 12_000;

/**
 * Budget for the social drafts phase: at most `maxMs`, and never into the
 * notification reserve. `elapsedMs` is the time since the cron run started.
 */
export function socialPhaseBudgetMs(elapsedMs: number, notifyDeadlineMs: number, maxMs: number): number {
  return Math.max(0, Math.min(maxMs, notifyDeadlineMs - NOTIFY_RESERVE_MS - elapsedMs));
}

const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/; // the same rule the Reddit routes use

/** A saved subreddit name without "r/", or null when it is not a valid Reddit name. */
export function validSubreddit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw.replace(/^r\//, "");
  return SUBREDDIT_RE.test(name) ? name : null;
}

/**
 * Why a network gets no draft, or null when it should run. Pure. Pass
 * `pending` (unreviewed drafts) to also apply the backlog guard.
 */
export function skipReasonFor(platform: PlatformId, snap: DailyDraftSnapshot, pending?: number): SkipReason | null {
  if (!snap.enabled[platform]) return "disabled";
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

/** Record the saved draft. Retried twice; on persistent failure the error is reported and the network is not generated again. */
async function recordDone(ports: DailyDraftPorts, platform: PlatformId, day: string, created: number, summary: DailyDraftSummary): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ports.markDone(platform, day, created);
      return;
    } catch {
      // Retry below.
    }
  }
  summary.errors.push({ platform, error: RECORD_FAILED });
}

export type DailyDraftRunOptions = {
  /** True when the time budget is spent; checked between networks. */
  timeUp?: () => boolean;
  /** False when the global daily ceiling is reached; the network is skipped as daily_cap. */
  canCreate?: () => boolean;
  /** Called with the number of drafts each time a draft is saved. */
  onCreated?: (count: number) => void;
};

/**
 * Generate today's drafts for one project. Each network is independent: a
 * failure on one never stops the others. Every network looked at gets one
 * attempt per day, written before the work starts, so a failed network is not
 * retried until tomorrow and the project rotates to the back of the queue.
 * Errors from the claim, the marker reads or the snapshot propagate, and the
 * job isolates each project.
 */
export async function runDailyDrafts(ports: DailyDraftPorts, now: Date, opts: DailyDraftRunOptions = {}): Promise<DailyDraftSummary> {
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
      if (await ports.isAttempted(platform, day)) summary.skipped.push({ platform, reason: "already_done" });
      else todo.push(platform);
    }
    if (todo.length === 0) return summary;

    let snap: DailyDraftSnapshot;
    try {
      snap = await ports.snapshot();
    } catch (err) {
      // Count the attempt even when the snapshot fails, so the project rotates to the back of the queue.
      await Promise.all(todo.map((platform) => ports.markAttempt(platform, day).catch(() => undefined)));
      throw err;
    }
    for (const platform of todo) {
      if (opts.timeUp?.()) {
        summary.interrupted = true;
        break;
      }
      try {
        await ports.markAttempt(platform, day);
        const reason = skipReasonFor(platform, snap) ?? skipReasonFor(platform, snap, await ports.pendingCount(platform));
        if (reason) {
          summary.skipped.push({ platform, reason });
          continue;
        }
        if (opts.canCreate && !opts.canCreate()) {
          summary.skipped.push({ platform, reason: "daily_cap" });
          continue;
        }

        const result = await ports.generate(platform);
        if (result.status === 201) {
          const count = draftCount(result.body);
          summary.created[platform] += count;
          opts.onCreated?.(count);
          await recordDone(ports, platform, day, count, summary);
        } else if (result.status === 402) {
          summary.skipped.push({ platform, reason: "out_of_credits" });
        } else if (result.status === 429) {
          summary.skipped.push({ platform, reason: "daily_limit" });
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
 * Fair rotation: the project whose last attempt is oldest goes first (never
 * attempted first). `lastAttempt` maps project id to the ISO time of its most
 * recent attempt marker. Duplicate projects are dropped.
 */
export function rotationOrder(targets: ProjectTarget[], lastAttempt: Map<string, string>): ProjectTarget[] {
  const seen = new Set<string>();
  const unique = targets.filter((t) => {
    if (seen.has(t.projectId)) return false;
    seen.add(t.projectId);
    return true;
  });
  return unique.sort(
    (a, b) => (lastAttempt.get(a.projectId) ?? "").localeCompare(lastAttempt.get(b.projectId) ?? "") || a.projectId.localeCompare(b.projectId),
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

/** The in-app item saying the daily drafts paused for lack of credits. One per user per day. */
export function socialDraftsPausedNotice(input: { userId: string; day: string }): NotificationDraft {
  return {
    kind: "social_drafts_paused",
    projectId: null,
    dedupeKey: socialDraftsPausedKey(input.userId, input.day),
    title: SOCIAL_PAUSED_TITLE,
    body: SOCIAL_PAUSED_BODY,
    payload: { open: "social" },
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

/** Store the paused item for a user (once per day), unless the content category is off. */
export async function notifySocialPaused(
  store: Pick<NotificationStore, "getPreferences" | "record">,
  userId: string,
  day: string,
  now: Date,
): Promise<{ notified: boolean }> {
  const draft = socialDraftsPausedNotice({ userId, day });
  const { prefs } = await store.getPreferences(userId);
  if (!inAppEnabled(prefs, categoryOf(draft.kind))) return { notified: false };
  const result = await store.record(userId, draft, now);
  return { notified: result.created };
}
