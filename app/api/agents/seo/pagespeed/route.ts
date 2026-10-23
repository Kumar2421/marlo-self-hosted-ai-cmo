import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { resolvePlatformApiKey } from "@/lib/domain/shared/resolvePlatformApiKey";
import { memoryRateLimiter } from "@/lib/domain/net/rateLimit";
import { fetchPageSpeedStrategy, type PageSpeedStrategy } from "@/lib/domain/seo/pageSpeedInsights";
import { mergeStrategyMeasure, type PageSpeedCarrier, type StrategyMeasure } from "@/lib/domain/seo/pageSpeedFallback";
import { PSI_RATE_LIMIT, psiStatusForError, type PsiStatus } from "@/lib/domain/seo/pageSpeedAuto";

// One PageSpeed (Lighthouse) strategy can need 20-60s on a heavy page: this route does only that, with the
// largest budget the platform allows (52s of the 60s; auth, lookups and the row write fit in the rest).
export const maxDuration = 60;

// Per process. Hosted instances each keep their own count, which only makes the cap looser, never stricter.
const limiter = memoryRateLimiter();

const MAX_MERGE_ATTEMPTS = 5;

type Reply = { status: PsiStatus; strategy: PageSpeedStrategy; reason?: string };

function reply(body: Reply, httpStatus = 200) {
  return NextResponse.json(body, { status: httpStatus });
}

/** Folds the measurement into the stored audit row. Re-reads and retries when another merge got there first. */
async function saveSupabase(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  projectId: string,
  url: string,
  strategy: PageSpeedStrategy,
  measure: StrategyMeasure,
): Promise<"saved" | "no_audit"> {
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    const { data: row, error } = await db
      .from("seo_audits")
      .select("id, payload, created_at")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("url", url)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return "no_audit";

    const current = (row.payload ?? {}) as PageSpeedCarrier;
    const { payload, changed } = mergeStrategyMeasure(current, strategy, measure);
    if (!changed) return "saved";

    const rev = typeof current.pageSpeedRev === "number" ? current.pageSpeedRev : null;
    const next = { ...payload, pageSpeedRev: (rev ?? 0) + 1 };
    // Conditional on the revision (and the audit not having been re-run) we read: a parallel merge or a new
    // audit changes one of them, so this UPDATE then matches no row and we merge again on top of the winner.
    let query = db.from("seo_audits").update({ payload: next }).eq("id", row.id).eq("created_at", row.created_at);
    query = rev === null ? query.is("payload->>pageSpeedRev", null) : query.eq("payload->>pageSpeedRev", String(rev));
    const { data: updated, error: updateError } = await query.select("id");
    if (updateError) throw new Error(updateError.message);
    if (updated && updated.length > 0) return "saved";
  }
  throw new Error("Could not save the PageSpeed result (concurrent updates)");
}

/** better-sqlite3 is synchronous and a transaction holds the write lock, so read-merge-write is atomic. */
function saveSqlite(url: string, strategy: PageSpeedStrategy, measure: StrategyMeasure): "saved" | "no_audit" {
  const db = getDb();
  return db.transaction((): "saved" | "no_audit" => {
    const row = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(url) as { payload: string } | undefined;
    if (!row) return "no_audit";
    let current: PageSpeedCarrier = {};
    try {
      current = JSON.parse(row.payload) as PageSpeedCarrier;
    } catch {
      return "no_audit";
    }
    const { payload, changed } = mergeStrategyMeasure(current, strategy, measure);
    if (changed) {
      db.prepare("UPDATE seo_audits SET payload = ? WHERE url = ?").run(JSON.stringify({ ...payload, pageSpeedRev: (current.pageSpeedRev ?? 0) + 1 }), url);
    }
    return "saved";
  })();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { strategy?: unknown } | null;
  const strategy = body?.strategy;
  if (strategy !== "mobile" && strategy !== "desktop") {
    return NextResponse.json({ error: "strategy must be 'mobile' or 'desktop'" }, { status: 400 });
  }

  let userId = "local";
  let projectId: string;
  let projectUrl: string;
  let apiKey: string | undefined;
  let platformDb: ReturnType<typeof createServiceClient> | null = null;

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    userId = user.id;

    const db = createServiceClient();
    platformDb = db;
    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    if (!projectSetting?.value) return NextResponse.json({ error: "No active project." }, { status: 422 });
    projectId = projectSetting.value;

    const { data: project } = await db.from("projects").select("url").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
    if (!project?.url) return NextResponse.json({ error: "Active project not found." }, { status: 404 });
    projectUrl = project.url;

    apiKey = (await resolvePlatformApiKey(db, user.id, "pagespeed_api_key")) || process.env.PAGESPEED_API_KEY?.trim() || undefined;
  } else {
    const activeId = getActiveProjectId();
    if (!activeId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    projectId = activeId;
    const db = getDb();
    const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string } | undefined;
    if (!project?.url) return NextResponse.json({ error: "Active project not found." }, { status: 404 });
    projectUrl = project.url;
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as { value: string } | undefined;
    apiKey = stored?.value || process.env.PAGESPEED_API_KEY || undefined;
  }

  // No key is not a failure to count against the caller's quota.
  if (!apiKey) return reply({ status: "no_key", strategy });

  const hit = await limiter.hit(`psi:${userId}:${projectId}`, PSI_RATE_LIMIT.windowSec, PSI_RATE_LIMIT.limit);
  if (!hit.allowed) {
    return NextResponse.json({ status: "error", strategy, reason: "rate_limited", retryAfterSec: hit.retryAfterSec }, {
      status: 429,
      headers: { "Retry-After": String(hit.retryAfterSec) },
    });
  }

  try {
    // Never log the key or the request URL (it carries the key as a query parameter).
    const result = await fetchPageSpeedStrategy(projectUrl, apiKey, strategy);
    const measure: StrategyMeasure = { scores: result.scores, cwv: result.cwv, issues: result.lighthouseIssues, measuredAt: new Date().toISOString() };
    const saved = platformDb ? await saveSupabase(platformDb, userId, projectId, projectUrl, strategy, measure) : saveSqlite(projectUrl, strategy, measure);
    if (saved === "no_audit") return reply({ status: "error", strategy, reason: "no_audit" });
    return reply({ status: "measured", strategy });
  } catch (err) {
    const status = psiStatusForError(err);
    if (status === "error") console.warn(`PageSpeed (${strategy}) failed: ${err instanceof Error ? err.message.replace(/key=[^&\s]+/g, "key=***") : "unknown error"}`);
    return reply({ status, strategy });
  }
}
