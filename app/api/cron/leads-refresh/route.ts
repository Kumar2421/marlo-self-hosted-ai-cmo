import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { selectDueLeadProjects } from "@/lib/domain/leads/dueLeadProjects";
import { generateAutoLeads, type AutoLeadResult } from "@/lib/domain/leads/autoGenerateLeads";
import { isAuthorizedCron, runWithBudget } from "@/lib/jobs/jobRunner";
import { runClaimedLeadRefresh, supabaseLeadStampStore } from "@/lib/jobs/leadRefreshClaim";

// Vercel Cron's own function timeout, not the per-request default — this
// loops every eligible project in one invocation, so it needs real headroom
// (Hobby caps at 60s; a Pro plan can raise this further if the project count
// grows past what 60s covers).
export const maxDuration = 60;

const DAILY_LIMIT = 5;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Stop starting new projects well before the 60s function timeout; the rest
// are picked up on the next run (runWithBudget reports them as skipped).
const TIME_BUDGET_MS = 45_000;
// A project still generating at this point is abandoned: its stamp is restored
// so it is retried on the next run instead of being locked for 24h.
const ABORT_AT_MS = 55_000;

/**
 * Daily free lead-refresh — platform-only, scheduled via vercel.json's
 * `crons` entry (Vercel signs the request with a bearer token matching the
 * CRON_SECRET env var; see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Requires CRON_SECRET to be set in the Vercel project's environment
 * variables — without it every call 401s, which is the safe failure mode
 * (never run unauthenticated).
 *
 * Loops every project whose leads_auto_last_at is missing or more than 24h
 * old, adds up to DAILY_LIMIT new leads via the same autoGenerateLeads()
 * helper the creation-time route uses. Each project is claimed (stamped)
 * before generation; a failed or abandoned run restores the previous stamp
 * (see lib/jobs/leadRefreshClaim.ts).
 */
export async function GET(req: NextRequest) {
  const runStartedAt = Date.now();
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ error: "Not available in self-host mode." }, { status: 404 });
  }

  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const stamps = supabaseLeadStampStore(db);
  const cutoff = new Date(Date.now() - REFRESH_INTERVAL_MS).toISOString();

  // Paged, oldest stamp first (never-refreshed first), only projects with a confirmed lead profile.
  const due = await selectDueLeadProjects(db, cutoff);
  if ("error" in due) return NextResponse.json({ error: due.error }, { status: 500 });
  const dueProjects = due.projects;

  let totalAdded = 0;
  let claimedElsewhere = 0;
  const results: { projectId: string; added: number; reason: string | null; message: string | null }[] = [];

  const summary = await runWithBudget(
    dueProjects,
    async (project) => {
      // Claim first: a project another run already stamped is skipped, so
      // overlapping invocations never generate twice for the same project.
      // A throw from generation restores the stamp and is counted as failed.
      const run = await runClaimedLeadRefresh(
        stamps,
        {
          projectId: project.id,
          cutoffIso: cutoff,
          nowIso: new Date().toISOString(),
          previousIso: project.leads_auto_last_at,
          timeoutMs: Math.max(1, ABORT_AT_MS - (Date.now() - runStartedAt)),
        },
        (): Promise<AutoLeadResult> => generateAutoLeads(db, project.owner_id, project, DAILY_LIMIT),
      );
      if (run.status === "refused") {
        claimedElsewhere += 1;
        return;
      }
      const outcome = run.value;
      totalAdded += outcome.added;
      results.push({ projectId: project.id, added: outcome.added, reason: outcome.reason, message: outcome.message });
    },
    { budgetMs: TIME_BUDGET_MS },
  );

  return NextResponse.json({
    projectsProcessed: results.length,
    projectsSkipped: summary.skipped,
    projectsClaimedElsewhere: claimedElsewhere,
    projectsFailed: summary.failed.length,
    totalAdded,
    results,
  });
}
