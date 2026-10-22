import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { isAuthorizedCron } from "@/lib/jobs/jobRunner";
import { runProjectGeo } from "@/lib/domain/geo/geoService";
import { runPool, selectDueGeoWork, utcWeekStart, type GeoWork } from "@/lib/domain/geo/dueProjects";
import { lastRunByProject, listAllActivePrompts, promptsRunSince } from "@/lib/domain/geo/geoStoreSupabase";
import { summariseRun } from "@/lib/domain/geo/runner";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;
const BUDGET_MS = 50_000;
const CONCURRENCY = 3;

/**
 * Weekly AI-visibility runs for every project with at least one active tracked prompt (Search Console or
 * manual), platform only, scheduled via vercel.json. A project is due while any active prompt has no run this
 * week, and only those prompts run, once each (the user's manual "Run now" does the 3x). Up to 3 projects run
 * at a time, oldest-last-run first, so a time-boxed run cannot starve the same projects every week. Idempotent
 * per day and capped per user (slots are reserved before each call), so a rerun never double-spends.
 */
export async function GET(req: NextRequest) {
  if (!FEATURES.PLATFORM_MODE) return NextResponse.json({ error: "Not available in self-host mode." }, { status: 404 });
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  let due: GeoWork[];
  try {
    const active = await listAllActivePrompts(db);
    const projectIds = [...new Set(active.map((a) => a.projectId))];
    const [ran, last] = await Promise.all([promptsRunSince(db, projectIds, utcWeekStart(new Date())), lastRunByProject(db, projectIds)]);
    due = selectDueGeoWork(active, ran, last);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  const deadline = Date.now() + BUDGET_MS;

  const summary = await runPool(
    due,
    CONCURRENCY,
    async ({ projectId, userId, prompts }) => {
      // Never let one project run past the overall deadline; the runner re-checks it before every prompt and call.
      const budgetMs = Math.min(20_000, deadline - Date.now());
      if (budgetMs <= 0) throw new Error("Out of time budget");
      const result = await runProjectGeo({ mode: "platform", db, userId, projectId }, { budgetMs, maxRunsPerPrompt: 1, onlyPrompts: prompts });
      if (result.failed.length > 0 && result.ran === 0) throw new Error(summariseRun(result).message);
    },
    { budgetMs: BUDGET_MS },
  );

  return NextResponse.json({
    due: due.length,
    processed: summary.processed,
    skipped: summary.skipped,
    failed: summary.failed.map(({ item, error: message }) => ({ projectId: item.projectId, error: message })),
  });
}
