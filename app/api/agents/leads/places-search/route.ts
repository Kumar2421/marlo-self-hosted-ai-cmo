import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, getCreditState, InsufficientCreditsError } from "@/lib/credits";
import { PlacesApiError, searchPlacesPage } from "@/lib/domain/leads/local/placesSearch";
import { searchLocalLeads, type LocalLeadDraft, type LocalSearchPorts } from "@/lib/domain/leads/local/localLeadService";
import { enrichBusiness } from "@/lib/domain/leads/local/websiteContact";
import { resolveMailHost } from "@/lib/domain/leads/emailVerify";
import {
  MANAGED_DAILY_CAP,
  reserveManagedSlot,
  shouldChargeSearch,
  type SlotStore,
} from "@/lib/domain/leads/local/managedSearchPolicy";
import type { SupabaseClient } from "@supabase/supabase-js";

// Vercel: a search runs one Places call plus website enrichment (budgeted to 35s).
export const maxDuration = 60;

/** Stored as usage_events.model so managed-key searches can be counted for the daily cap. */
const PLACES_USAGE_MODEL = "places_api";
const SEARCH_AGENT_TYPE = "lead_search";
const NOT_CONFIGURED = "Local search is not set up yet";
const OWN_KEY_HINT = "Connect a Google Cloud API key in Settings → API Credentials (with Places API enabled) to search local businesses.";
const MAX_FIELD = 100;
const MAX_TOKEN = 2000;

type SearchInput = { category: string; location: string; pageToken?: string };

function readInput(body: unknown): SearchInput | { error: string } {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const category = typeof o.category === "string" ? o.category.trim() : "";
  const location = typeof o.location === "string" ? o.location.trim() : "";
  if (!category || !location) return { error: "Enter both a category and a location." };
  if (category.length > MAX_FIELD || location.length > MAX_FIELD) {
    return { error: `Keep the category and location under ${MAX_FIELD} characters.` };
  }
  const token = typeof o.pageToken === "string" ? o.pageToken.trim().slice(0, MAX_TOKEN) : "";
  return { category, location, pageToken: token || undefined };
}

async function hasMailServer(email: string): Promise<boolean> {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return (await resolveMailHost(email.slice(at + 1))) !== null;
}

/** Shared search: one Places page, dedupe, enrich, score. Charging is decided by the caller, after the save. */
async function runLocalSearch(args: {
  apiKey: string;
  projectId: string;
  input: SearchInput;
  existingPlaceIds: (projectId: string) => Promise<Set<string>>;
}) {
  const ports: LocalSearchPorts = {
    searchPage: (q) => searchPlacesPage(fetch, args.apiKey, q),
    existingPlaceIds: args.existingPlaceIds,
    enrich: (website) => enrichBusiness(website),
    emailCheck: hasMailServer,
  };
  return searchLocalLeads(ports, {
    projectId: args.projectId,
    category: args.input.category,
    location: args.input.location,
    pageToken: args.input.pageToken,
  });
}

function draftFields(draft: LocalLeadDraft) {
  return {
    place_id: draft.placeId,
    name: draft.name,
    phone: draft.phone,
    address: draft.address,
    website: draft.website,
    source_url: draft.website,
    rating: draft.rating,
    review_count: draft.reviewCount,
    maps_url: draft.mapsUrl,
    email: draft.email,
    email_quality: draft.emailQuality,
    whatsapp: draft.whatsapp,
    contact_url: draft.contactUrl,
    description: draft.description,
    fit_reason: draft.fitReason,
    fit_score: draft.score,
    enrichment_status: draft.enrichmentStatus,
  };
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof InsufficientCreditsError) {
    return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
  }
  if (err instanceof PlacesApiError) {
    return NextResponse.json({ error: err.message }, { status: err.httpStatus === 429 ? 429 : 502 });
  }
  return NextResponse.json({ error: "Local search failed. Try again." }, { status: 500 });
}

async function hostedSearch(input: SearchInput): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = createServiceClient();

  // The user's own google_cloud key (same provider_connections row the leads search uses) wins.
  let ownKey = "";
  const { data: googleConn } = await db
    .from("provider_connections")
    .select("api_key_secret_id")
    .eq("user_id", user.id)
    .eq("provider_id", "google_cloud")
    .maybeSingle();
  if (googleConn?.api_key_secret_id) {
    const { data: secret } = await db.rpc("vault_get_secret", { p_id: googleConn.api_key_secret_id });
    ownKey = (secret as string) ?? "";
  }
  const managedKey = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? "";
  if (!ownKey && !managedKey) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }
  const usingManaged = !ownKey;

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

  // Managed searches reserve a daily slot before the Google call. The reservation is a usage_events
  // row, released in `finally` on every path, so a failed or empty search gives its slot back.
  let reservation: string | null = null;
  try {
    if (usingManaged) {
      const slot = await reserveManagedSlot(managedSlotStore(db, user.id, activeId));
      if (!slot.allowed) {
        return NextResponse.json(
          { error: `You've used today's ${MANAGED_DAILY_CAP} local searches. Connect your own Google Cloud key to keep searching.` },
          { status: 429 }
        );
      }
      reservation = slot.handle;
      const state = await getCreditState(user.id, SEARCH_AGENT_TYPE);
      if (state.billingEnabled && state.balance < state.cost) {
        return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
      }
    }

    const result = await runLocalSearch({
      apiKey: ownKey || managedKey,
      projectId: activeId,
      input,
      existingPlaceIds: async (projectId) => {
        const { data } = await db
          .from("leads")
          .select("place_id")
          .eq("user_id", user.id)
          .eq("project_id", projectId)
          .not("place_id", "is", null);
        return new Set((data ?? []).map((r) => r.place_id as string));
      },
    });

    const saved: Record<string, unknown>[] = [];
    let raced = 0;
    let saveFailed = false;
    const now = new Date().toISOString();
    for (const draft of result.leads) {
      const { data, error } = await db
        .from("leads")
        .insert({
          user_id: user.id,
          project_id: activeId,
          location: input.location,
          lead_type: "business",
          query: `${input.category} in ${input.location}`,
          email_verified: false,
          created_at: now,
          ...draftFields(draft),
        })
        .select()
        .maybeSingle();
      if (error) {
        // 23505 = the unique (user, project, place) index caught a row saved in a parallel request.
        if (error.code === "23505") {
          raced += 1;
          continue;
        }
        saveFailed = true;
        break;
      }
      if (data) saved.push(data);
    }
    if (saveFailed) {
      // The user gets an error, so the search is not charged.
      return NextResponse.json({ error: "Couldn't save the leads. Try again." }, { status: 500 });
    }

    // Charged once, after the save, and only when at least one new lead was kept.
    if (shouldChargeSearch({ usingManaged, savedCount: saved.length, failed: saveFailed })) {
      await chargeCredits(user.id, SEARCH_AGENT_TYPE, { projectId: activeId, model: PLACES_USAGE_MODEL });
    }

    return NextResponse.json({
      leads: saved,
      nextPageToken: result.nextPageToken,
      duplicates: result.duplicates + raced,
      skipped: result.skipped,
    });
  } catch (err) {
    return errorResponse(err);
  } finally {
    if (reservation) await releaseReservation(db, reservation);
  }
}

/** usage_events rows for this user's managed searches today, used as the daily-cap slots. */
function managedSlotStore(db: SupabaseClient, userId: string, projectId: string): SlotStore<string> {
  return {
    reserve: async () => {
      const { data, error } = await db
        .from("usage_events")
        .insert({
          user_id: userId,
          project_id: projectId,
          agent_type: SEARCH_AGENT_TYPE,
          model: PLACES_USAGE_MODEL,
          credits_charged: 0,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("Could not reserve a local search slot");
      return data.id as string;
    },
    count: async () => {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { count, error } = await db
        .from("usage_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("agent_type", SEARCH_AGENT_TYPE)
        .eq("model", PLACES_USAGE_MODEL)
        .gte("created_at", startOfDay.toISOString());
      if (error) throw new Error("Could not count local searches");
      return count ?? 0;
    },
    release: (id) => releaseReservation(db, id),
  };
}

async function releaseReservation(db: SupabaseClient, id: string): Promise<void> {
  try {
    await db.from("usage_events").delete().eq("id", id);
  } catch {
    // A row left behind only counts against today's cap, which fails safe.
  }
}

async function selfHostSearch(input: SearchInput): Promise<NextResponse> {
  const db = getDb();

  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'google_cloud_api_key'").get() as
    | { value: string }
    | undefined;
  if (!keyRow?.value) {
    return NextResponse.json({ error: OWN_KEY_HINT }, { status: 422 });
  }

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  }

  try {
    const result = await runLocalSearch({
      apiKey: keyRow.value,
      projectId: activeId,
      input,
      existingPlaceIds: async (projectId) => {
        const rows = db
          .prepare("SELECT place_id FROM leads WHERE project_id = ? AND place_id IS NOT NULL")
          .all(projectId) as { place_id: string }[];
        return new Set(rows.map((r) => r.place_id));
      },
    });

    const now = new Date().toISOString();
    const query = `${input.category} in ${input.location}`;
    const columns = [
      "id", "project_id", "name", "location", "phone", "source_url", "place_id", "lead_type", "query", "created_at",
      "address", "website", "rating", "review_count", "whatsapp", "contact_url", "description", "maps_url",
      "fit_reason", "fit_score", "enrichment_status", "email", "email_quality",
    ];
    // The unique (project_id, place_id) index makes a repeated place a no-op instead of a second row.
    const insert = db.prepare(
      `INSERT OR IGNORE INTO leads (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    );
    const saved: Record<string, unknown>[] = [];
    let raced = 0;
    for (const draft of result.leads) {
      const id = `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const fields = draftFields(draft);
      const info = insert.run(
        id, activeId, fields.name, input.location, fields.phone, fields.source_url, fields.place_id,
        "business", query, now,
        fields.address, fields.website, fields.rating, fields.review_count, fields.whatsapp,
        fields.contact_url, fields.description, fields.maps_url, fields.fit_reason, fields.fit_score,
        fields.enrichment_status, fields.email, fields.email_quality
      );
      if (info.changes === 0) {
        raced += 1;
        continue;
      }
      saved.push({ id, project_id: activeId, location: input.location, query, lead_type: "business", created_at: now, ...fields });
    }

    return NextResponse.json({
      leads: saved,
      nextPageToken: result.nextPageToken,
      duplicates: result.duplicates + raced,
      skipped: result.skipped,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const parsed = readInput(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) return hostedSearch(parsed);
  return selfHostSearch(parsed);
}
