import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId, setActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { checkUrlReachable } from "@/lib/domain/shared/checkUrlReachable";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

type ProjectRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  url: string;
  created_at: string;
  updated_at: string;
};

/**
 * Real project deletion — this is the only place a project's data actually
 * goes away. Wipes every table that's project-scoped (documents,
 * competitors, cached link/GEO/crawl checks, leads) plus the seo_audits row
 * keyed by its URL, all in one transaction. If the deleted project was the
 * active one, the most-recently-updated remaining project becomes active
 * automatically; if none are left, the active pointer is cleared honestly
 * rather than left pointing at a project that no longer exists.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: project, error: fetchError } = await db
      .from("projects")
      .select("id, name, category, description, url, created_at, updated_at")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
    if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const wasActive = setting?.value === id;

    // Wipes every project-scoped table, mirroring the self-host transaction
    // below. link_checks/geo_checks/site_crawls are project_id-keyed cache
    // tables in Postgres (project_id is the primary key there), leads and
    // seo_audits carry a project_id column — all filtered by user_id too
    // since the service-role client bypasses RLS.
    const { error: docsError } = await db.from("project_documents").delete().eq("project_id", id);
    if (docsError) return NextResponse.json({ error: docsError.message }, { status: 500 });
    const { error: compError } = await db
      .from("project_competitors")
      .delete()
      .eq("project_id", id)
      .eq("user_id", user.id);
    if (compError) return NextResponse.json({ error: compError.message }, { status: 500 });
    const { error: linkError } = await db
      .from("link_checks")
      .delete()
      .eq("project_id", id)
      .eq("user_id", user.id);
    if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
    const { error: geoError } = await db
      .from("geo_checks")
      .delete()
      .eq("project_id", id)
      .eq("user_id", user.id);
    if (geoError) return NextResponse.json({ error: geoError.message }, { status: 500 });
    const { error: crawlError } = await db
      .from("site_crawls")
      .delete()
      .eq("project_id", id)
      .eq("user_id", user.id);
    if (crawlError) return NextResponse.json({ error: crawlError.message }, { status: 500 });
    const { error: leadsError } = await db
      .from("leads")
      .delete()
      .eq("project_id", id)
      .eq("user_id", user.id);
    if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 });
    const { error: auditsError } = await db
      .from("seo_audits")
      .delete()
      .eq("project_id", id)
      .eq("user_id", user.id);
    if (auditsError) return NextResponse.json({ error: auditsError.message }, { status: 500 });
    const { error: deleteError } = await db.from("projects").delete().eq("id", id).eq("owner_id", user.id);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

    let newActive: { id: string; name: string; category: string; description: string; url: string; created_at: string; updated_at: string } | null = null;
    if (wasActive) {
      const { data: remaining } = await db
        .from("projects")
        .select("id, name, category, description, url, created_at, updated_at")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      newActive = remaining ?? null;

      if (newActive) {
        await db.from("user_settings").upsert(
          { user_id: user.id, key: "active_project_id", value: newActive.id, updated_at: new Date().toISOString() },
          { onConflict: "user_id,key" }
        );
      } else {
        await db.from("user_settings").delete().eq("user_id", user.id).eq("key", "active_project_id");
      }
    }

    return NextResponse.json({ success: true, newActiveProject: newActive });
  }

  const db = getDb();

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!project) {
    return NextResponse.json({ error: "No project with that id" }, { status: 404 });
  }

  const wasActive = getActiveProjectId() === id;

  const wipe = db.transaction(() => {
    db.prepare("DELETE FROM project_documents WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM project_competitors WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM project_setup_state WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM link_checks WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM geo_checks WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM site_crawls WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM leads WHERE project_id = ?").run(id);
    const integrations = db.prepare("SELECT id FROM project_integrations WHERE project_id = ?").all(id) as { id: string }[];
    for (const integration of integrations) {
      db.prepare("DELETE FROM integration_secrets WHERE integration_id = ?").run(integration.id);
      db.prepare("DELETE FROM integration_resources WHERE integration_id = ?").run(integration.id);
    }
    db.prepare("DELETE FROM project_integrations WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM seo_audits WHERE url = ?").run(project.url);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  wipe();

  let newActive: ProjectRow | null = null;
  if (wasActive) {
    newActive = (db.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1").get() as ProjectRow | undefined) ?? null;
    if (newActive) {
      setActiveProjectId(newActive.id);
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('project_url', @url)
         ON CONFLICT(key) DO UPDATE SET value = @url`
      ).run({ url: newActive.url });
    } else {
      db.prepare("DELETE FROM settings WHERE key IN ('active_project_id', 'project_url')").run();
    }
  }

  return NextResponse.json({ success: true, newActiveProject: newActive });
}

/** Real edit — lets the Websites settings page double as the source of
 * truth for a project's name/category/description/url, not just a
 * read-only list. A URL change is re-validated the same way project
 * creation is (public, reachable) before it's saved. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: project, error: fetchError } = await db
      .from("projects")
      .select("id, name, category, description, url, created_at, updated_at")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
    if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : project.name;
    const category = typeof body.category === "string" ? body.category.trim() : project.category;
    const description = typeof body.description === "string" ? body.description.trim() : project.description;

    let url = project.url;
    if (typeof body.url === "string" && body.url.trim() && body.url.trim() !== project.url) {
      let candidate = body.url.trim();
      if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

      let validated: URL;
      try {
        validated = assertPublicHttpUrl(candidate);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid URL" }, { status: 400 });
      }

      const { reachable, status } = await checkUrlReachable(validated.toString());
      if (!reachable) {
        return NextResponse.json(
          {
            error: status
              ? `This URL responded with HTTP ${status} — check it's correct and publicly accessible before saving.`
              : "Couldn't reach this URL — check it's correct, publicly accessible, and not behind a login.",
          },
          { status: 422 }
        );
      }
      url = validated.toString();
    }

    const now = new Date().toISOString();
    const { error: updateError } = await db
      .from("projects")
      .update({ name, category, description, url, updated_at: now })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ project: { ...project, name, category, description, url, updated_at: now } });
  }

  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!project) {
    return NextResponse.json({ error: "No project with that id" }, { status: 404 });
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : project.name;
  const category = typeof body.category === "string" ? body.category.trim() : project.category;
  const description = typeof body.description === "string" ? body.description.trim() : project.description;

  let url = project.url;
  if (typeof body.url === "string" && body.url.trim() && body.url.trim() !== project.url) {
    let candidate = body.url.trim();
    if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

    let validated: URL;
    try {
      validated = assertPublicHttpUrl(candidate);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid URL" }, { status: 400 });
    }

    const { reachable, status } = await checkUrlReachable(validated.toString());
    if (!reachable) {
      return NextResponse.json(
        {
          error: status
            ? `This URL responded with HTTP ${status} — check it's correct and publicly accessible before saving.`
            : "Couldn't reach this URL — check it's correct, publicly accessible, and not behind a login.",
        },
        { status: 422 }
      );
    }
    url = validated.toString();
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE projects SET name = @name, category = @category, description = @description, url = @url, updated_at = @updatedAt WHERE id = @id`
  ).run({ id, name, category, description, url, updatedAt: now });

  if (getActiveProjectId() === id && url !== project.url) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('project_url', @url)
       ON CONFLICT(key) DO UPDATE SET value = @url`
    ).run({ url });
  }

  return NextResponse.json({ project: { ...project, name, category, description, url, updated_at: now } });
}
