import { runWithBudget } from "../../jobs/jobRunner.ts";
import {
  approvalsKey, creditsKey, creditsThreshold, dailyDigestKey, digestKey, integrationKey, isBigWin, outcomeKey, withinEmailCap,
} from "./caps.ts";
import { buildDigest, type Digest, type ProjectActivity, type SnapshotLike } from "./digest.ts";
import { emailDecision, inAppEnabled, localParts, type NotificationPrefs } from "./preferences.ts";
import type { EmailSender, NotificationStore } from "./ports.ts";
import { renderDigestEmail, renderNotificationEmail, type EmailLinks, type RenderedEmail } from "./render.ts";
import { categoryOf, type Notification, type NotificationDraft } from "./types.ts";

const DAY_MS = 86_400_000;
/** Outcomes saved longer ago than this are history, not news (stops a first deploy from announcing old results). */
const FRESH_OUTCOME_DAYS = 8;
/** Emails that could not be sent (and are worth retrying) are retried for this long. */
const RETRY_WINDOW_DAYS = 3;
const MAX_EMAILS_PER_USER_RUN = 5;
/** A retryable send failure is tried again no sooner than this, and given up on after this many attempts. */
const RETRY_DELAY_MS = 30 * 60_000;
const MAX_EMAIL_ATTEMPTS = 4;
const INCLUDED_IN_DIGEST = "included in digest";

export type MeasuredOutcome = {
  actionId: string;
  actionTitle: string;
  status: "improved" | "unchanged" | "regressed" | string;
  confidence: "early" | "solid" | null;
  headline: string;
  /** When the verdict became final. */
  evaluatedAt: string;
};

export type ProjectFacts = {
  projectId: string;
  projectName: string;
  measured: MeasuredOutcome[];
  /** Changes marked as made, with when. */
  fixesMade: Array<{ title: string; implementedAt: string }>;
  latest: SnapshotLike | null;
  weekAgo: SnapshotLike | null;
  /** Fixes with an open pull request waiting for the user to review. */
  approvalsWaiting: number;
};

export type UserFacts = {
  /** Where emails go. Null: in-app only. */
  email: string | null;
  projects: ProjectFacts[];
  /** Null in self-host (nothing is metered). `billingEnabled` false (beta) means no warnings. */
  credits: { balance: number; granted: number; billingEnabled: boolean } | null;
  integrations: Array<{ id: string; label: string; disconnected: boolean }>;
};

export type UserRef = { userId: string };

/** Where the job learns about users. Platform reads Supabase; self-host reads the local database. */
export interface NotificationSource {
  listUsers(): Promise<UserRef[]>;
  loadFacts(userId: string, now: Date): Promise<UserFacts>;
}

export type NotificationJobDeps = {
  source: NotificationSource;
  store: NotificationStore;
  /** Null when email is not configured: everything stays in-app. */
  sender: EmailSender | null;
  /** Null when links cannot be signed (no secret / no app URL): no non-transactional email is sent. */
  linksFor: (userId: string) => EmailLinks | null;
  now?: Date;
  budgetMs: number;
  /** Skip users the job already finished today (UTC). For a scheduled once-a-day caller; self-host reruns every few hours. */
  oncePerDay?: boolean;
  /** Milliseconds clock; tests inject one. */
  clock?: () => number;
  log?: (message: string) => void;
};

export type NotificationJobSummary = {
  users: number;
  skipped: number;
  created: number;
  emailed: number;
  emailFailed: number;
  /** Users stopped part-way by the time budget (retried first next run). */
  interrupted: number;
  failed: Array<{ error: string }>;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Which drafts the facts call for. Pure; storage dedupe makes repeats harmless. */
export function draftsFor(args: {
  facts: UserFacts;
  prefs: NotificationPrefs;
  now: Date;
  /** A digest for the current week (the user's own Monday-to-Sunday) is already stored. */
  digestAlreadySent: boolean;
  /** Outcomes already emailed on their own: kept out of the digest so nothing is reported twice. */
  excludeOutcomeIds?: Set<string>;
}): { drafts: NotificationDraft[]; digest: Digest | null; digestDraft: NotificationDraft | null; digestOutcomeIds: string[] } {
  const { facts, prefs, now } = args;
  const exclude = args.excludeOutcomeIds ?? new Set<string>();
  const local = localParts(now, prefs.timezone);
  const drafts: NotificationDraft[] = [];

  // Fixes that just got a final verdict.
  for (const project of facts.projects) {
    for (const m of project.measured) {
      if (m.status !== "improved" && m.status !== "unchanged" && m.status !== "regressed") continue;
      if (m.confidence !== "solid" || now.getTime() - Date.parse(m.evaluatedAt) > FRESH_OUTCOME_DAYS * DAY_MS) continue;
      const bigWin = isBigWin(m);
      // Which big win gets its own email is decided at send time (one a day, and only if it really goes out);
      // the digest then covers every outcome that was not emailed.
      drafts.push({
        kind: "outcome_measured",
        projectId: project.projectId,
        dedupeKey: outcomeKey(m.actionId),
        title: bigWin ? `A fix looks like it worked: ${m.actionTitle}` : `A fix was measured: ${m.actionTitle}`,
        body: m.headline,
        payload: { actionId: m.actionId, status: m.status, bigWin },
      });
    }
  }

  if (facts.credits?.billingEnabled) {
    const threshold = creditsThreshold(facts.credits.balance, facts.credits.granted);
    if (threshold !== null) {
      drafts.push({
        kind: "credits_low",
        projectId: null,
        dedupeKey: creditsKey(threshold, now),
        title: threshold === 0 ? "You are out of credits" : "Your credits are running low",
        body: threshold === 0 ? "Agents that use credits are paused until you add more." : `You have ${facts.credits.balance} credits left, about a fifth of what you started with.`,
        payload: { threshold, balance: facts.credits.balance },
      });
    }
  }

  const waiting = facts.projects.reduce((n, p) => n + p.approvalsWaiting, 0);
  if (waiting > 0) {
    drafts.push({
      kind: "approval_needed",
      projectId: null,
      dedupeKey: approvalsKey(local.isoDate),
      title: `${plural(waiting, "fix is", "fixes are")} waiting for your review`,
      body: "Open the pull request to review and merge it. Nothing changes on your site until you do.",
      payload: { waiting },
    });
  }

  for (const integration of facts.integrations) {
    if (!integration.disconnected) continue;
    drafts.push({
      kind: "integration_disconnected",
      projectId: null,
      dedupeKey: integrationKey(integration.id, now),
      title: `${integration.label} needs to be reconnected`,
      body: `Marlo lost access to ${integration.label}, so related data may go stale until you reconnect it in Settings.`,
      payload: { integration: integration.id },
    });
  }

  // The digest, on the user's own Monday (weekly) or every day (daily).
  let digest: Digest | null = null;
  let digestDraft: NotificationDraft | null = null;
  const digestOutcomeIds: string[] = [];
  const cadence = prefs.categories.digest;
  if (cadence === "weekly" || cadence === "daily" || cadence === "instant") {
    const weekly = cadence !== "daily";
    // Weekly: on the user's Monday, or on the first run after it if that week's digest was missed (nobody opened the app, a failed run).
    if (!weekly || local.weekday === 1 || !args.digestAlreadySent) {
      const windowMs = (weekly ? 7 : 1) * DAY_MS;
      const since = now.getTime() - windowMs;
      const activity: ProjectActivity[] = facts.projects.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        newOutcomes: p.measured
          .filter((m) => (m.status === "improved" || m.status === "unchanged" || m.status === "regressed") && m.confidence === "solid")
          .filter((m) => Date.parse(m.evaluatedAt) >= since && !exclude.has(m.actionId))
          .map((m) => (digestOutcomeIds.push(m.actionId), m))
          .map((m) => ({ actionTitle: m.actionTitle, status: m.status as "improved" | "unchanged" | "regressed", confidence: m.confidence, headline: m.headline })),
        fixesMade: p.fixesMade.filter((f) => Date.parse(f.implementedAt) >= since),
        latest: weekly ? p.latest : null,
        weekAgo: weekly ? p.weekAgo : null,
        approvalsWaiting: p.approvalsWaiting,
      }));
      digest = buildDigest(activity);
      if (digest) {
        digestDraft = {
          kind: "weekly_digest",
          projectId: null,
          dedupeKey: weekly ? digestKey(local.isoDate) : dailyDigestKey(local.isoDate),
          title: weekly ? "Your week in Marlo" : "Your day in Marlo",
          body: digest.summary,
          payload: { digest, cadence: weekly ? "weekly" : "daily" },
        };
      }
    }
  }
  return { drafts, digest, digestDraft, digestOutcomeIds: digest ? digestOutcomeIds : [] };
}

/** Returns false when the time budget ran out part-way (nothing is lost: every step is idempotent and resumes next run). */
async function processUser(userId: string, deps: NotificationJobDeps, now: Date, tally: NotificationJobSummary, timeUp: () => boolean): Promise<boolean> {
  const { store } = deps;
  const stored = await store.getPreferences(userId);
  const { prefs } = stored;
  const facts = await deps.source.loadFacts(userId, now);
  if (timeUp()) return false;

  const local = localParts(now, prefs.timezone);
  const digestAlreadySent = await store.hasKey(userId, digestKey(local.isoDate));

  // Step 1: everything except the digest, emailed straight away (big win, credits, integrations).
  const planned = draftsFor({ facts, prefs, now, digestAlreadySent });
  for (const draft of planned.drafts) {
    if (timeUp()) return false;
    if (!inAppEnabled(prefs, categoryOf(draft.kind))) continue;
    const result = await store.record(userId, draft, now);
    if (result.created) tally.created += 1;
  }
  await flushEmails(userId, facts.email, stored, deps, now, tally, timeUp);
  if (timeUp()) return false;

  // Step 2: the digest, now that we know which outcomes already went out on their own.
  const outcomeRows = (await store.list(userId, { limit: 200 })).filter((n) => n.kind === "outcome_measured");
  const emailed = new Set(outcomeRows.filter((n) => n.emailedAt).map((n) => String(n.payload.actionId)));
  const withDigest = draftsFor({ facts, prefs, now, digestAlreadySent, excludeOutcomeIds: emailed });
  if (withDigest.digestDraft && inAppEnabled(prefs, categoryOf(withDigest.digestDraft.kind))) {
    const result = await store.record(userId, withDigest.digestDraft, now);
    if (result.created) {
      tally.created += 1;
      // What the digest reports must not also be emailed alone later.
      const inDigest = new Set(withDigest.digestOutcomeIds);
      for (const n of outcomeRows) {
        if (!n.emailedAt && !n.emailError && inDigest.has(String(n.payload.actionId))) await store.markEmailed(userId, n.id, now, INCLUDED_IN_DIGEST);
      }
    }
  }
  await flushEmails(userId, facts.email, stored, deps, now, tally, timeUp);
  return !timeUp();
}

function renderFor(n: Notification, links: EmailLinks): RenderedEmail {
  const digest = n.kind === "weekly_digest" ? (n.payload.digest as Digest | undefined) : undefined;
  return digest ? renderDigestEmail(digest, links, n.payload.cadence === "daily" ? "daily" : "weekly") : renderNotificationEmail(n, links);
}

async function flushEmails(
  userId: string,
  to: string | null,
  stored: { prefs: NotificationPrefs; unsubscribedAll: boolean },
  deps: NotificationJobDeps,
  now: Date,
  tally: NotificationJobSummary,
  timeUp: () => boolean,
): Promise<void> {
  const links = deps.linksFor(userId);
  if (!deps.sender || !to || !links) return;

  const pending = await deps.store.listEmailPending(userId, new Date(now.getTime() - RETRY_WINDOW_DAYS * DAY_MS).toISOString());
  const sentThisRun = new Map<string, number>();
  let budget = MAX_EMAILS_PER_USER_RUN;

  for (const n of pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (budget <= 0 || timeUp()) break;
    if (emailDecision(n, stored) !== "send") continue;
    // A recent failed attempt waits before the next one.
    if (n.lastEmailAttemptAt && now.getTime() - Date.parse(n.lastEmailAttemptAt) < RETRY_DELAY_MS) continue;

    const recent = await deps.store.countEmailedSince(userId, n.kind, new Date(now.getTime() - DAY_MS).toISOString());
    if (!withinEmailCap(n.kind, recent + (sentThisRun.get(n.kind) ?? 0))) continue;

    const email = renderFor(n, links);
    const result = await deps.sender.send({ to, ...email, idempotencyKey: `marlo-notification-${n.id}` });
    if (result.ok) {
      await deps.store.markEmailed(userId, n.id, now, null);
      sentThisRun.set(n.kind, (sentThisRun.get(n.kind) ?? 0) + 1);
      tally.emailed += 1;
      budget -= 1;
    } else {
      tally.emailFailed += 1;
      deps.log?.(`notification email failed (${n.kind}): ${result.error}`);
      if (result.configError) {
        // Our setup is wrong (key, domain), not this email: keep it pending and stop; it sends once fixed.
        return;
      }
      if (!result.retryable) {
        await deps.store.markEmailed(userId, n.id, now, result.error.slice(0, 300));
      } else if (n.emailAttempts + 1 >= MAX_EMAIL_ATTEMPTS) {
        await deps.store.markEmailed(userId, n.id, now, `Gave up after ${MAX_EMAIL_ATTEMPTS} attempts: ${result.error}`.slice(0, 300));
      } else {
        await deps.store.noteEmailAttempt(userId, n.id, now);
      }
    }
  }
}

/**
 * The daily notification pass: detect, store (idempotent by dedupe key), then
 * email what the user's preferences allow. One user failing never stops the
 * others; the time budget stops cleanly and the rest resume next run.
 */
export async function runNotificationJob(deps: NotificationJobDeps): Promise<NotificationJobSummary> {
  const now = deps.now ?? new Date();
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + deps.budgetMs;
  const timeUp = () => clock() >= deadline;
  const tally: NotificationJobSummary = { users: 0, skipped: 0, created: 0, emailed: 0, emailFailed: 0, interrupted: 0, failed: [] };

  // Fair rotation: the user waiting longest goes first (never-run first), so a short budget
  // cannot starve the same tail of users every day. A user is stamped only once fully done.
  const listed = await deps.source.listUsers();
  const lastRuns = await deps.store.lastRuns(listed.map((u) => u.userId));
  const today = now.toISOString().slice(0, 10);
  const users = listed
    .filter((u) => !(deps.oncePerDay && lastRuns.get(u.userId)?.slice(0, 10) === today))
    .sort((a, b) => (lastRuns.get(a.userId) ?? "").localeCompare(lastRuns.get(b.userId) ?? "") || a.userId.localeCompare(b.userId));

  const summary = await runWithBudget(
    users,
    async (u) => {
      if (await processUser(u.userId, deps, now, tally, timeUp)) await deps.store.stampRun(u.userId, now);
      else tally.interrupted += 1;
    },
    { budgetMs: deps.budgetMs, now: clock },
  );
  tally.users = summary.processed - tally.interrupted;
  tally.skipped = summary.skipped + tally.interrupted;
  tally.failed = summary.failed.map((f) => ({ error: f.error }));
  for (const f of tally.failed) deps.log?.(`notification job user failed: ${f.error}`);
  return tally;
}
