import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { crawlSitePages } from "@/lib/domain/seo/SiteCrawlAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

export async function GET() {
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
    if (!projectId) return NextResponse.json({ result: null });

    const { data: row } = await db
      .from("site_crawls")
      .select("payload, checked_at")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .maybeSingle();

    if (!row) return NextResponse.json({ result: null });
    return NextResponse.json({ result: { pages: row.payload, checkedAt: row.checked_at } });
  }

  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ result: null });

  const db = getDb();
  const row = db.prepare("SELECT payload, checked_at FROM site_crawls WHERE project_id = ?").get(activeId) as
    | { payload: string; checked_at: string }
    | undefined;

  if (!row) return NextResponse.json({ result: null });
  return NextResponse.json({ result: { pages: JSON.parse(row.payload), checkedAt: row.checked_at } });
}

export async function POST() {
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

    const { data: project } = projectId
      ? await db.from("projects").select("url").eq("id", projectId).eq("owner_id", user.id).maybeSingle()
      : { data: null };

    if (!projectId || !project || !project.url) {
      return NextResponse.json(
        { error: "No project website linked yet. Add one in the project switcher first." },
        { status: 422 }
      );
    }

    const { data: auditRow } = await db
      .from("seo_audits")
      .select("payload")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .eq("url", project.url)
      .maybeSingle();
    if (!auditRow) {
      return NextResponse.json(
        { error: "No crawl data for this site yet. Try refreshing the SEO audit first." },
        { status: 422 }
      );
    }
    const audit = auditRow.payload as SEOAuditPayload;
    const seedLinks = (audit.links ?? []).filter((l) => l.internal);

    if (seedLinks.length === 0) {
      return NextResponse.json(
        {
          error:
            "No internal links discovered on the homepage yet — re-run the SEO audit first (Analytics → refresh). If this site is a single-page app, the audit's JS-render fallback should surface real links.",
        },
        { status: 422 }
      );
    }

    try {
      const { pages, summary } = await crawlSitePages(seedLinks);
      const now = new Date().toISOString();
      const { error } = await db.from("site_crawls").upsert(
        { user_id: user.id, project_id: projectId, payload: pages, checked_at: now },
        { onConflict: "project_id" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ result: { pages, checkedAt: now, summary } });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 502 });
    }
  }

  const db = getDb();

  const activeId = getActiveProjectId();
  const project = activeId
    ? (db.prepare("SELECT url FROM projects WHERE id = ?").get(activeId) as { url: string } | undefined)
    : undefined;
  if (!activeId || !project || !project.url) {
    return NextResponse.json(
      { error: "No project website linked yet. Add one in the project switcher first." },
      { status: 422 }
    );
  }

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(project.url) as
    | { payload: string }
    | undefined;
  if (!auditRow) {
    return NextResponse.json(
      { error: "No crawl data for this site yet. Try refreshing the SEO audit first." },
      { status: 422 }
    );
  }
  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);
  const seedLinks = (audit.links ?? []).filter((l) => l.internal);

  if (seedLinks.length === 0) {
    return NextResponse.json(
      {
        error:
          "No internal links discovered on the homepage yet — re-run the SEO audit first (Analytics → refresh). If this site is a single-page app, the audit's JS-render fallback should surface real links.",
      },
      { status: 422 }
    );
  }

  try {
    const { pages, summary } = await crawlSitePages(seedLinks);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO site_crawls (project_id, payload, checked_at) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload, checked_at = excluded.checked_at`
    ).run(activeId, JSON.stringify(pages), now);

    return NextResponse.json({ result: { pages, checkedAt: now, summary } });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
