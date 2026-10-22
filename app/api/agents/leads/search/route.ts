import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { LeadsAgent, type ExtractedLead } from "@/lib/domain/leads/LeadsAgent";
import { runPaidLeadSearch } from "@/lib/domain/leads/paidLeadSearch";
import { getLeadProfile } from "@/lib/domain/leads/leadProfileStore";
import { getLeadProfile as getLeadProfileSupabase } from "@/lib/domain/leads/leadProfileStoreSupabase";
import { verifyMissingEmails } from "@/lib/domain/leads/verifyMissingEmails";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { canFetchLeadsToday } from "@/lib/entitlements";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, getCreditState, InsufficientCreditsError } from "@/lib/credits";
import { resolveLlmCredential } from "@/lib/llm/platformKeys";
import type { SupabaseClient } from "@supabase/supabase-js";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/** Platform-mode equivalent of getActiveProjectId() — reads the same
 * "active_project_id" key, just scoped to user_settings (per-user) instead
 * of the shared local SQLite settings table. */
async function getActiveProjectIdSupabase(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "active_project_id")
    .maybeSingle();
  return data?.value ?? null;
}

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const activeId = await getActiveProjectIdSupabase(db, user.id);
    if (!activeId) return NextResponse.json({ leads: [] });

    const { data: rows, error } = await db
      .from("leads")
      .select("*")
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ leads: rows ?? [] });
  }

  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ leads: [] });

  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM leads WHERE project_id = ? ORDER BY created_at DESC")
    .all(activeId);

  return NextResponse.json({ leads: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const role: string = typeof body?.role === "string" ? body.role.trim() : "";
  const companyOrIndustry: string = typeof body?.companyOrIndustry === "string" ? body.companyOrIndustry.trim() : "";
  const location: string = typeof body?.location === "string" ? body.location.trim() : "";
  const providerId: string | undefined = body?.providerId;
  const model: string | undefined = body?.model;

  if (!role && !companyOrIndustry) {
    return NextResponse.json({ error: "Enter at least a role or a company/industry to search for." }, { status: 400 });
  }
  if (!model || !providerId) {
    return NextResponse.json(
      { error: "No model selected. Connect a provider in Settings → LLM Providers." },
      { status: 422 }
    );
  }

  const driver = getDriver(providerId);
  if (!driver) {
    return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const tavilyKey = process.env.TAVILY_API_KEY?.trim() || "";

    // LLM provider key — BYOK first, falling back to the operator's own
    // platform-managed key (same pattern every other agent route uses).
    // Previously BYOK-only here; lifted now that it's confirmed this route
    // already meters cost via chargeCredits("lead_search") below, same
    // protection the other platform-fallback routes rely on.
    const { data: providerConn } = await db
      .from("provider_connections")
      .select("api_key_secret_id, base_url")
      .eq("user_id", user.id)
      .eq("provider_id", providerId)
      .maybeSingle();

    let byokKey = "";
    if (providerConn?.api_key_secret_id) {
      const { data: providerSecret } = await db.rpc("vault_get_secret", { p_id: providerConn.api_key_secret_id });
      byokKey = (providerSecret as string) ?? "";
    }
    const { apiKey: providerApiKey, baseUrl: providerBaseUrl } = resolveLlmCredential({
      providerId,
      byokKey,
      byokBaseUrl: providerConn?.base_url,
    });
    if (!providerApiKey) {
      return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
    }

    const googleApiKey = process.env.GOOGLE_CLOUD_API_KEY?.trim();
    const googleCx = process.env.GOOGLE_CSE_ID?.trim();
    const google = googleApiKey && googleCx ? { apiKey: googleApiKey, cx: googleCx } : undefined;

    const activeId = await getActiveProjectIdSupabase(db, user.id);
    if (!activeId) {
      return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
    }

    // Limit check and credit pre-check first (nothing spent yet), then search,
    // then save, and only then charge: a failed save is never billed, and a
    // charge refused after the save keeps the saved leads (see runPaidLeadSearch).
    const query = `${role} ${companyOrIndustry} ${location}`.trim();
    const outcome = await runPaidLeadSearch<ExtractedLead, Record<string, unknown>>({
      checkDailyLimit: () => canFetchLeadsToday(user.id),
      hasCredits: async () => {
        const state = await getCreditState(user.id, "lead_search");
        return !state.billingEnabled || state.balance >= state.cost;
      },
      search: async () => {
        const agent = new LeadsAgent(driver, providerApiKey, providerBaseUrl);
        const profile = body?.useProfile === true ? await getLeadProfileSupabase(db, user.id, activeId) : null;
        return agent.search({ role, companyOrIndustry, location }, tavilyKey, model, google, profile ?? undefined);
      },
      save: async (leads) => {
        try {
          const verifiedEmails = await verifyMissingEmails(leads);

          const now = new Date().toISOString();
          const rowsToInsert = leads.map((lead, index) => {
            const verifiedEmail = verifiedEmails.get(index);
            const email = lead.email ?? verifiedEmail ?? null;
            const emailVerified = !lead.email && !!verifiedEmail;
            return {
              user_id: user.id,
              project_id: activeId,
              name: lead.name,
              title: lead.title,
              company: lead.company,
              location: lead.location,
              email,
              email_verified: emailVerified,
              source_url: lead.sourceUrl,
              query,
              created_at: now,
            };
          });

          const { data: saved, error } = await db.from("leads").insert(rowsToInsert).select();
          if (error) return { ok: false, status: 500, error: error.message };
          return { ok: true, rows: (saved ?? []) as Record<string, unknown>[] };
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          return { ok: false, status: 502, error: raw };
        }
      },
      charge: async () => {
        try {
          await chargeCredits(user.id, "lead_search", { projectId: activeId, model });
          return true;
        } catch (err) {
          // The leads are already saved, so they stay and are returned. Log a
          // fixed reason only: no message text, no keys.
          const reason = err instanceof InsufficientCreditsError ? "insufficient_credits" : "charge_error";
          console.warn(`[leads] lead_search saved leads but charge was refused (${reason}) for user ${user.id}`);
          return false;
        }
      },
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ leads: outcome.leads });
  }

  const db = getDb();

  const tavilyKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as
    | { value: string }
    | undefined;
  if (!tavilyKeyRow?.value) {
    return NextResponse.json(
      { error: "Connect a Tavily API key in Settings → API Credentials to search for real leads." },
      { status: 422 }
    );
  }

  const keyRow = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;
  if (!keyRow) {
    return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
  }

  const googleKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'google_cloud_api_key'").get() as
    | { value: string }
    | undefined;
  const googleCxRow = db.prepare("SELECT value FROM settings WHERE key = 'google_cse_id'").get() as
    | { value: string }
    | undefined;
  const google = googleKeyRow?.value && googleCxRow?.value ? { apiKey: googleKeyRow.value, cx: googleCxRow.value } : undefined;

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  }

  try {
    const agent = new LeadsAgent(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const query = `${role} ${companyOrIndustry} ${location}`.trim();
    const profile = body?.useProfile === true ? getLeadProfile(db, activeId) : null;
    const leads = await agent.search({ role, companyOrIndustry, location }, tavilyKeyRow.value, model, google, profile ?? undefined);

    // Tier 1: for leads search left with no email, try a real SMTP-verified
    // guess (see emailVerify.ts) — never overrides an email search already
    // found, only upgrades a null.
    const verifiedEmails = await verifyMissingEmails(leads);

    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO leads (id, project_id, name, title, company, location, email, email_verified, source_url, query, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const saved = leads.map((lead, index) => {
      const id = `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const verifiedEmail = verifiedEmails.get(index);
      const email = lead.email ?? verifiedEmail ?? null;
      const emailVerified = !lead.email && !!verifiedEmail;
      insert.run(id, activeId, lead.name, lead.title, lead.company, lead.location, email, emailVerified ? 1 : 0, lead.sourceUrl, query, now);
      return { id, project_id: activeId, ...lead, email, email_verified: emailVerified, query, created_at: now };
    });

    return NextResponse.json({ leads: saved });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });

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
    const activeId = setting?.value ?? null;
    if (!activeId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const { error } = await db
      .from("leads")
      .delete()
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  const db = getDb();
  db.prepare("DELETE FROM leads WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
