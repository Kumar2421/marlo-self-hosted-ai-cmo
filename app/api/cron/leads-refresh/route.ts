import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { generateAutoLeads, type AutoLeadResult } from "@/lib/domain/leads/autoGenerateLeads";
import { isAuthorizedCron, runWithBudget } from "@/lib/jobs/jobRunner";
import { claimDueLeadRefresh } from "@/lib/jobs/leadRefreshClaim";

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
 * helper the creation-time route uses, then stamps leads_auto_last_at so
 * the next run (if Vercel fires more than once/day, or after downtime)
 * doesn't double up same-day.
 */
export async function GET(req: NextRequest) {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ error: "Not available in self-host mode." }, { status: 404 });
  }

  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const cutoff = new Date(Date.now() - REFRESH_INTERVAL_MS).toISOString();

  const { data: dueProjects, error } = await db
    .from("projects")
    .select("id, owner_id, name, category, leads_auto_last_at")
    .or(`leads_auto_last_at.is.null,leads_auto_last_at.lt.${cutoff}`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let totalAdded = 0;
  let claimedElsewhere = 0;
  const results: { projectId: string; added: number; reason: string | null; message: string | null }[] = [];

  const summary = await runWithBudget(
    dueProjects ?? [],
    async (project) => {
      // Claim first: a project another run already stamped is skipped, so
      // overlapping invocations never generate twice for the same project.
      const claimed = await claimDueLeadRefresh(db, project.id, cutoff, new Date().toISOString());
      if (!claimed) {
        claimedElsewhere += 1;
        return;
      }
      const outcome: AutoLeadResult = await generateAutoLeads(db, project.owner_id, project, DAILY_LIMIT).catch(
        (err): AutoLeadResult => ({
          added: 0,
          reason: "search_failed",
          message: err instanceof Error ? err.message.slice(0, 200) : "Unexpected error.",
          target: null,
        })
      );
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
