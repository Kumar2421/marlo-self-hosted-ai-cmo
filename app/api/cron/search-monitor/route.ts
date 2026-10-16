import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { isAuthorizedCron, runWithBudget } from "@/lib/jobs/jobRunner";
import { runPlatformDailyProposals } from "@/lib/domain/actions/dailyProposalPorts";
import { captureProjectSnapshotPlatform } from "@/lib/domain/search/captureForProject";
import { listProposalsDone, markProposalsDone } from "@/lib/domain/actions/automationSettingsStoreSupabase";
import { selectDueProjects } from "@/lib/domain/search/dueProjects";
import { isoDate } from "@/lib/domain/search/searchSnapshot";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { runNotificationJob, type NotificationJobSummary } from "@/lib/domain/notifications/job";
import { supabaseNotificationStore } from "@/lib/domain/notifications/notificationStoreSupabase";
import { platformNotificationSource } from "@/lib/domain/notifications/platformSource";
import { emailLinksFor, notificationConfig } from "@/lib/domain/notifications/runtime";
import { runSocialDailyJob, type SocialDailyJobSummary } from "@/lib/domain/social/dailyDraftJob";
import { socialPhaseBudgetMs } from "@/lib/domain/social/dailyDrafts";
import { runVerifyAndMonitorPlatform, type VerifyPhaseSummary } from "@/lib/domain/findings/verifyPlatform";
import { listProjectActions as listProjectActionsSupabase } from "@/lib/domain/actions/actionStoreSupabase";
import { platformOutcomePorts } from "@/lib/domain/search/outcomePorts";
import { fixDeliveryGithub } from "@/lib/domain/fixes/fixDeliveryGithub";
import { reconcileAllProjects, type LinkedProject, type ReconcileAllSummary } from "@/lib/domain/fixes/reconcileAllProjects";
import { hostedGithubToken } from "@/lib/githubAppServer";

// Hobby caps cron functions at 60s. Stop a little short of it and resume on
// the next run rather than being killed mid-project.
export const maxDuration = 60;
const BUDGET_MS = 45_000;
// Notifications run after the snapshots (they read the fresh ones) in whatever
// is left of the 60s function limit. Hobby allows only two crons, so this
// rides along instead of being a third (a separate route would need a 4th
// cron entry with the geo branch's; move it there once on a plan that allows it).
// Fairness: the job serves the user who has waited longest first, stamps each
// user when finished (notification_preferences.last_run_at), skips users
// already done today, and checks the deadline between steps, so a short
// budget delays people by a day instead of starving the same tail forever.
const NOTIFY_DEADLINE_MS = 57_000;
const NOTIFY_MIN_BUDGET_MS = 2_000;
// Daily social drafts (one per network per project) run after the proposals and before the
// notifications, so the in-app item they create is there for the notification pass. Capped.
const SOCIAL_BUDGET_MS = 15_000;
// Verify and monitor run after social drafts and before notifications, within the notification reserve.
const VERIFY_BUDGET_MS = 10_000;
// Fix PR reconciliation (merged or closed-unmerged) for every project with a GitHub App link. Runs after
// the proposals and before social, capped, so a merge is noticed even if nobody opens the finding.
const RECONCILE_BUDGET_MS = 8_000;

/**
 * Daily Search Console snapshot for every project with GSC connected -
 * platform-only, scheduled via vercel.json. Idempotent: a project that
 * already has today's snapshot is skipped, so extra invocations (or a rerun
 * after hitting the time budget) only do the remaining work.
 */
export async function GET(req: NextRequest) {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ error: "Not available in self-host mode." }, { status: 404 });
  }
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const db = createServiceClient();
  const today = isoDate(new Date());

  try {
    const { data: connections, error } = await db
      .from("integration_connections")
      .select("project_id, user_id")
      .eq("provider", "gsc")
      .not("project_id", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: done } = await db.from("search_snapshots").select("project_id").eq("snapshot_date", today);

    const due = selectDueProjects(
      (connections ?? []).map((c) => ({ projectId: String(c.project_id), userId: String(c.user_id) })),
      new Set((done ?? []).map((row) => String(row.project_id))),
    );

    // Phase 1: snapshots for due projects only (resumes where the last run stopped).
    const captured = new Set<string>();
    const summary = await runWithBudget(
      due,
      async ({ projectId, userId }) => {
        await captureProjectSnapshotPlatform(db, userId, projectId);
        captured.add(projectId);
      },
      { budgetMs: BUDGET_MS },
    );

    // Phase 2: daily proposals for projects captured in this run, plus projects snapshotted earlier today
    // whose proposals have not finished today. Time-budgeted; the rest wait for the next run.
    const snapshottedToday = new Set((done ?? []).map((row) => String(row.project_id)));
    const proposalsDone = await listProposalsDone(db, today).catch(() => new Set<string>());
    const proposalTargets = selectDueProjects(
      (connections ?? []).map((c) => ({ projectId: String(c.project_id), userId: String(c.user_id) })),
      proposalsDone,
    ).filter(({ projectId }) => captured.has(projectId) || snapshottedToday.has(projectId));
    // Freshly captured projects first, then the older backlog.
    proposalTargets.sort((a, b) => Number(captured.has(b.projectId)) - Number(captured.has(a.projectId)) || a.projectId.localeCompare(b.projectId));

    const proposalSummary = { proposed: 0, approved: 0 };
    const proposalFailures: Array<{ projectId: string; error: string }> = [];
    const proposalRun = await runWithBudget(
      proposalTargets,
      async ({ projectId, userId }) => {
        const result = await runPlatformDailyProposals(db, userId, projectId);
        if ("error" in result) {
          proposalFailures.push({ projectId, error: result.error });
          return;
        }
        proposalSummary.proposed += result.proposed;
        proposalSummary.approved += result.approved;
        if (result.errors.length > 0) proposalFailures.push({ projectId, error: result.errors[0] });
        else await markProposalsDone(db, userId, projectId, today);
      },
      { budgetMs: Math.max(0, BUDGET_MS - (Date.now() - startedAt)) },
    );

    // Phase 2b: fix PRs. Each project with a GitHub App link is checked for merged or closed-unmerged PRs.
    // Failures are isolated per project; the summary carries counts and project ids only, never a token.
    let reconcile: ReconcileAllSummary | { error: string };
    const reconcileBudget = Math.min(RECONCILE_BUDGET_MS, NOTIFY_DEADLINE_MS - (Date.now() - startedAt));
    if (reconcileBudget < NOTIFY_MIN_BUDGET_MS) {
      reconcile = { error: "No time left; will run tomorrow." };
    } else {
      try {
        reconcile = await reconcileAllProjects(
          {
            linkedProjects: () => linkedGithubProjects(db),
            actionsFor: ({ projectId, userId }) => listProjectActionsSupabase(db, userId, projectId),
            inputsFor: async ({ projectId, userId }) => {
              // GitHub App installation token when connected (short-lived, never stored), else the legacy token.
              const token = await hostedGithubToken(db, userId, projectId);
              if (!token) return null;
              const { data: project } = await db.from("projects").select("url").eq("id", projectId).eq("owner_id", userId).maybeSingle();
              return { ports: platformOutcomePorts(db, userId, projectId, project?.url ?? null), fixDelivery: fixDeliveryGithub(token) };
            },
          },
          { budgetMs: reconcileBudget },
        );
      } catch {
        console.warn("[reconcile] pull request check failed.");
        reconcile = { error: "Pull request check failed." };
      }
    }

    // Phase 3: one draft per network per project for review (nothing is posted). Failures are
    // isolated per project inside the job; this only guards the whole phase.
    // The phase stops before the notification deadline, so the notification pass always keeps its reserved time.
    let social: SocialDailyJobSummary | { error: string };
    const socialBudget = socialPhaseBudgetMs(Date.now() - startedAt, NOTIFY_DEADLINE_MS, SOCIAL_BUDGET_MS);
    if (socialBudget < NOTIFY_MIN_BUDGET_MS) {
      social = { error: "No time left; will run tomorrow." };
    } else {
      try {
        social = await runSocialDailyJob(db, supabaseNotificationStore(db), { now: new Date(), budgetMs: socialBudget });
      } catch {
        console.warn("[social] daily drafts job failed.");
        social = { error: "Social drafts job failed." };
      }
    }


    // Phase 4: verify fixes one day after they went live, then the weekly regression watch.
    // Same budget helper as the social phase, so it never runs into the notification reserve.
    // Only counts leave this block; a failure here never fails the run.
    let verify: VerifyPhaseSummary | { error: string };
    const verifyBudget = socialPhaseBudgetMs(Date.now() - startedAt, NOTIFY_DEADLINE_MS, VERIFY_BUDGET_MS);
    if (verifyBudget < NOTIFY_MIN_BUDGET_MS) {
      verify = { error: "No time left; will run tomorrow." };
    } else {
      try {
        verify = await runVerifyAndMonitorPlatform(db, new Date(), verifyBudget);
      } catch {
        console.warn("[verify] verify and monitor job failed.");
        verify = { error: "Verify and monitor job failed." };
      }
    }

    // Failures here never fail the snapshot run, and never carry secrets into the response.
    let notifications: Pick<NotificationJobSummary, "users" | "skipped" | "created" | "emailed" | "emailFailed" | "interrupted"> & { failed: number } | { error: string };
    const notifyBudget = NOTIFY_DEADLINE_MS - (Date.now() - startedAt);
    if (notifyBudget < NOTIFY_MIN_BUDGET_MS) {
      notifications = { error: "No time left; will run tomorrow." };
    } else {
      try {
        const config = notificationConfig();
        const result = await runNotificationJob({
          source: platformNotificationSource(db),
          store: supabaseNotificationStore(db),
          sender: config.sender,
          linksFor: (userId) => emailLinksFor(userId, config),
          budgetMs: notifyBudget,
          oncePerDay: true,
          log: (message) => console.warn(`[notifications] ${message}`),
        });
        notifications = { users: result.users, skipped: result.skipped, created: result.created, emailed: result.emailed, emailFailed: result.emailFailed, interrupted: result.interrupted, failed: result.failed.length };
      } catch (err) {
        console.warn("[notifications] job failed:", err instanceof Error ? err.message : "unknown error");
        notifications = { error: "Notification job failed." };
      }
    }

    return NextResponse.json({
      notifications,
      due: due.length,
      processed: summary.processed,
      skipped: summary.skipped,
      failed: summary.failed.map(({ item, error: message }) => ({ projectId: item.projectId, error: message })),
      proposals: { ...proposalSummary, processed: proposalRun.processed, skipped: proposalRun.skipped, failed: proposalFailures },
      reconcile,
      social,
      verify,
    });
  } finally {
    await cleanupRateLimitCounters(db);
  }
}

/** Projects with a GitHub App link. The link is stored per project in user_settings as `github_app:<projectId>`. */
async function linkedGithubProjects(db: ReturnType<typeof createServiceClient>): Promise<LinkedProject[]> {
  const PREFIX = "github_app:";
  const { data, error } = await db.from("user_settings").select("user_id, key").like("key", `${PREFIX}%`);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => ({ userId: String(row.user_id), projectId: String(row.key).slice(PREFIX.length) }))
    .filter((project) => project.projectId !== "");
}

/** Housekeeping for the public audit rate limiter. Never throws: a failure only logs and never changes the response. */
async function cleanupRateLimitCounters(db: ReturnType<typeof createServiceClient>): Promise<void> {
  try {
    const { error: cleanupError } = await db.rpc("rate_limits_cleanup");
    if (cleanupError) console.warn("[rate-limits] cleanup failed:", cleanupError.message);
  } catch {
    console.warn("[rate-limits] cleanup failed");
  }
}
