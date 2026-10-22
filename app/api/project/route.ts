import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId, setActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { probeUrl } from "@/lib/domain/shared/checkUrlReachable";
import { classifyReachability } from "@/lib/domain/shared/urlReachability";
import { FEATURES } from "@/lib/features";
import { canCreateProject } from "@/lib/entitlements";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { sqliteSetupStateStore } from "@/lib/domain/project/setupStateStore";
import { supabaseSetupStateStore } from "@/lib/domain/project/setupStateStoreSupabase";
import { startSetupState, type SetupStateStore } from "@/lib/domain/project/setupStateService";

/** Records that setup began, so a tab closed mid-run can be resumed. Best effort: never fails project creation. */
async function markSetupStarted(store: SetupStateStore): Promise<void> {
  try {
    await startSetupState(store);
  } catch (e) {
    console.warn("[project] could not record setup start:", e instanceof Error ? e.message : e);
  }
}


type ProjectRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  url: string;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: projects, error } = await db
      .from("projects")
      .select("id, name, category, description, url, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = setting?.value;
    const active = activeId ? (projects ?? []).find((p) => p.id === activeId) ?? null : null;

    return NextResponse.json({ project: active, projects: projects ?? [] });
  }

  const db = getDb();
  const activeId = getActiveProjectId();

  const active = activeId
    ? (db.prepare("SELECT * FROM projects WHERE id = ?").get(activeId) as ProjectRow | undefined)
    : undefined;

  const projects = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];

  return NextResponse.json({ project: active ?? null, projects });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "name and url are required" }, { status: 400 });
  }

  let platformUserId: string | null = null;
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    platformUserId = user.id;
  }

  let url = body.url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let validated: URL;
  try {
    validated = assertPublicHttpUrl(url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid URL" }, { status: 400 });
  }

  // Lenient on purpose: bot-protected, rate-limited or briefly-down sites still get a project (the audit
  // reports what it can). Only addresses that are clearly wrong are rejected.
  const probe = await probeUrl(validated.toString());
  const reachability = classifyReachability(probe);
  if (reachability.verdict === "unreachable") {
    return NextResponse.json({ error: reachability.message }, { status: 422 });
  }
  if (reachability.verdict === "unverified") {
    console.warn("[project] URL could not be fully verified, creating anyway:", probe.status ?? probe.errorCode);
  }

  const name = body.name.trim();
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (FEATURES.PLATFORM_MODE) {
    const db = createServiceClient();
    const now = new Date().toISOString();

    // Check project creation entitlements
    const projectLimitCheck = await canCreateProject(platformUserId!);
    if (!projectLimitCheck.allowed) {
      return NextResponse.json(
        { error: projectLimitCheck.message || "Project limit reached" },
        { status: 403 }
      );
    }

    const { data: inserted, error } = await db
      .from("projects")
      .insert({ owner_id: platformUserId, name, category, description, url, created_at: now, updated_at: now })
      .select("id, name, category, description, url, created_at, updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { error: settingError } = await db.from("user_settings").upsert(
      { user_id: platformUserId, key: "active_project_id", value: inserted.id, updated_at: now },
      { onConflict: "user_id,key" }
    );
    if (settingError) return NextResponse.json({ error: settingError.message }, { status: 500 });

    await markSetupStarted(supabaseSetupStateStore(db, platformUserId!, inserted.id));
    return NextResponse.json({ project: inserted });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(
    `INSERT INTO projects (id, name, category, description, url, created_at, updated_at)
     VALUES (@id, @name, @category, @description, @url, @createdAt, @updatedAt)`
  ).run({ id, name, category, description, url, createdAt: now, updatedAt: now });

  setActiveProjectId(id);

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('project_url', @url)
     ON CONFLICT(key) DO UPDATE SET value = @url`
  ).run({ url });

  await markSetupStarted(sqliteSetupStateStore(db, id));
  return NextResponse.json({ project: { id, name, category, description, url, created_at: now, updated_at: now } });
}
