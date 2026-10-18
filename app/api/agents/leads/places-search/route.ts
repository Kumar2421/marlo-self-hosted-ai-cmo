import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { searchLocalBusinesses } from "@/lib/domain/leads/PlacesAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES, isLocalBusinessSearchBlocked, LOCAL_BUSINESS_COMING_SOON_MESSAGE } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Hosted mode: blocked before auth, key reads, or credit charges.
  if (isLocalBusinessSearchBlocked(FEATURES.PLATFORM_MODE)) {
    return NextResponse.json({ error: LOCAL_BUSINESS_COMING_SOON_MESSAGE }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const category: string = typeof body?.category === "string" ? body.category.trim() : "";
  const location: string = typeof body?.location === "string" ? body.location.trim() : "";

  if (!category || !location) {
    return NextResponse.json({ error: "Enter both a category and a location." }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    // Same "google_cloud" provider_connections row used by leads/search for
    // the optional Google CSE fallback — one Google Cloud key, reused.
    const { data: googleConn } = await db
      .from("provider_connections")
      .select("api_key_secret_id")
      .eq("user_id", user.id)
      .eq("provider_id", "google_cloud")
      .maybeSingle();
    if (!googleConn?.api_key_secret_id) {
      return NextResponse.json(
        { error: "Connect a Google Cloud API key in Settings → API Credentials (with Places API enabled) to search local businesses." },
        { status: 422 }
      );
    }
    const { data: googleSecret } = await db.rpc("vault_get_secret", { p_id: googleConn.api_key_secret_id });
    const googleApiKey = (googleSecret as string) ?? "";

    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = setting?.value ?? null;
    if (!activeId) {
      return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
    }

    try {
      await chargeCredits(user.id, "lead_search", { projectId: activeId });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
      }
      throw err;
    }

    try {
      const businesses = await searchLocalBusinesses(googleApiKey, { category, location });

      const now = new Date().toISOString();
      const query = `${category} in ${location}`;
      const rowsToInsert = businesses.map((biz) => ({
        user_id: user.id,
        project_id: activeId,
        name: biz.name,
        location,
        phone: biz.phone,
        source_url: biz.website,
        place_id: biz.placeId,
        lead_type: "business",
        query,
        created_at: now,
      }));

      const { data: saved, error } = await db.from("leads").insert(rowsToInsert).select();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ leads: saved });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 502 });
    }
  }

  const db = getDb();

  const googleKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'google_cloud_api_key'").get() as
    | { value: string }
    | undefined;
  if (!googleKeyRow?.value) {
    return NextResponse.json(
      { error: "Connect a Google Cloud API key in Settings → API Credentials (with Places API enabled) to search local businesses." },
      { status: 422 }
    );
  }

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  }

  try {
    const businesses = await searchLocalBusinesses(googleKeyRow.value, { category, location });

    const now = new Date().toISOString();
    const query = `${category} in ${location}`;
    const insert = db.prepare(
      `INSERT INTO leads (id, project_id, name, location, phone, source_url, place_id, lead_type, query, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'business', ?, ?)`
    );
    const saved = businesses.map((biz) => {
      const id = `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      insert.run(id, activeId, biz.name, location, biz.phone, biz.website, biz.placeId, query, now);
      return {
        id,
        project_id: activeId,
        name: biz.name,
        location,
        phone: biz.phone,
        source_url: biz.website,
        place_id: biz.placeId,
        lead_type: "business",
        query,
        created_at: now,
      };
    });

    return NextResponse.json({ leads: saved });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
