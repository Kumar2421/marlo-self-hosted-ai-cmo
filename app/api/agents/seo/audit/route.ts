import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { upsertFinding as upsertFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { upsertFinding } from "@/lib/domain/findings/findingStore";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { takeCachedPublicAudit } from "@/lib/domain/seo/publicAuditCache";
import { auditFindingInputs, saveAuditFindings } from "@/lib/domain/findings/auditFindings";
import { resolvePlatformApiKey } from "@/lib/domain/shared/resolvePlatformApiKey";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || !body.url) {
    return NextResponse.json({ error: "Missing URL in request body" }, { status: 400 });
  }

  const { url } = body as { url: string };

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projectSetting?.value ?? null;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const { data: project } = await db
      .from("projects")
      .select("url")
      .eq("id", projectId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!project?.url) return NextResponse.json({ error: "Active project not found." }, { status: 404 });

    // Credit-metered — charge before running the crawl so a user out of
    // credits doesn't pay for the (potentially slow) real crawl work.
    try {
      await chargeCredits(user.id, "seo_audit", { projectId });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: "Out of credits. Upgrade to run another SEO audit." }, { status: 402 });
      }
      throw err;
    }

    try {
      const pageSpeedApiKey = (await resolvePlatformApiKey(db, user.id, "pagespeed_api_key")) || process.env.PAGESPEED_API_KEY || undefined;

      // No PageSpeed key means this audit would produce the exact same
      // result as the public /audit crawl for this URL — reuse it instead
      // of crawling again if the user just came through that funnel.
      const auditResult = (!pageSpeedApiKey && takeCachedPublicAudit(url))
        || await new SEOAgent(pageSpeedApiKey).audit(url);

      const createdAt = new Date().toISOString();
      const { error } = await db.from("seo_audits").upsert(
        { user_id: user.id, project_id: projectId, url, payload: auditResult, created_at: createdAt },
        { onConflict: "project_id,url" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await saveAuditFindings((input) => upsertFindingSupabase(db, user.id, input), auditFindingInputs(projectId, auditResult));

      return NextResponse.json(auditResult);
    } catch (err) {
      // Note: credits already charged — no refund path yet on audit
      // failure. Follow-up, not blocking for this slice (same tradeoff as
      // the articles/generate route).
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 500 });
    }
  }

  try {
    const db = getDb();

    // Settings table (user-entered, via Settings → API Credentials)
    // takes priority; env var is a fallback for anyone running this outside the UI.
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as
      | { value: string }
      | undefined;
    const pageSpeedApiKey = stored?.value || process.env.PAGESPEED_API_KEY || undefined;

    const auditResult = (!pageSpeedApiKey && takeCachedPublicAudit(url))
      || await new SEOAgent(pageSpeedApiKey).audit(url);

    const createdAt = new Date().toISOString();

    await saveAuditFindings(async (input) => upsertFinding(input), auditFindingInputs(getActiveProjectId()!, auditResult));

    db.prepare(`
      INSERT INTO seo_audits (url, payload, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        payload = excluded.payload,
        created_at = excluded.created_at
    `).run(url, JSON.stringify(auditResult), createdAt);

    return NextResponse.json(auditResult);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projectSetting?.value ?? null;

    try {
      if (url) {
        if (!projectId) return NextResponse.json({ error: "No audit found for this URL" }, { status: 404 });
        const { data: audit } = await db
          .from("seo_audits")
          .select("*")
          .eq("user_id", user.id)
          .eq("project_id", projectId)
          .eq("url", url)
          .maybeSingle();
        if (!audit) return NextResponse.json({ error: "No audit found for this URL" }, { status: 404 });
        return NextResponse.json(audit);
      } else {
        if (!projectId) return NextResponse.json({ audits: [] });
        const { data: audits, error } = await db
          .from("seo_audits")
          .select("*")
          .eq("user_id", user.id)
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ audits: audits ?? [] });
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 500 });
    }
  }

  try {
    const db = getDb();

    if (url) {
      const audit = db.prepare("SELECT * FROM seo_audits WHERE url = ?").get(url);
      if (!audit) return NextResponse.json({ error: "No audit found for this URL" }, { status: 404 });
      return NextResponse.json(audit);
    } else {
      const audits = db.prepare("SELECT * FROM seo_audits ORDER BY created_at DESC").all();
      return NextResponse.json({ audits });
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
