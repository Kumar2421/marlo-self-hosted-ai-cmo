import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { assertSafeUserUrl, INVALID_USER_URL_MESSAGE } from "@/lib/domain/net/publicUrl";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = setting?.value;
    if (!activeId) return NextResponse.json({ competitors: [] });

    const { data: rows, error } = await db
      .from("project_competitors")
      .select("id, url, created_at")
      .eq("project_id", activeId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ competitors: rows ?? [] });
  }

  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ competitors: [] });

  const db = getDb();
  const rows = db
    .prepare("SELECT id, url, created_at FROM project_competitors WHERE project_id = ? ORDER BY created_at ASC")
    .all(activeId);

  return NextResponse.json({ competitors: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  let url: string | undefined = body?.url;
  if (!url || !url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  // Rejects private, loopback and unresolvable targets at insert time (400, generic text). The
  // competitor is later fetched with the guarded fetcher too, so this is the early, user-facing check.
  try {
    await assertSafeUserUrl(url);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : INVALID_USER_URL_MESSAGE }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = setting?.value;
    if (!activeId) {
      return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
    }

    const { data: inserted, error } = await db
      .from("project_competitors")
      .insert({ user_id: user.id, project_id: activeId, url, created_at: new Date().toISOString() })
      .select("id, url")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ competitor: inserted });
  }

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  }

  const db = getDb();
  const id = `comp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    "INSERT INTO project_competitors (id, project_id, url, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, activeId, url, new Date().toISOString());

  return NextResponse.json({ competitor: { id, url } });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { error } = await db.from("project_competitors").delete().eq("id", id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  const db = getDb();
  db.prepare("DELETE FROM project_competitors WHERE id = ?").run(id);

  return NextResponse.json({ success: true });
}
