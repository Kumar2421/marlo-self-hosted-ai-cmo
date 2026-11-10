import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { canFetchLeadsToday } from "@/lib/entitlements";
import { chargeCredits, getCreditState, InsufficientCreditsError } from "@/lib/credits";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { isConfirmed } from "@/lib/domain/leads/leadProfile";
import { getLeadProfile as getLeadProfileSqlite } from "@/lib/domain/leads/leadProfileStore";
import { getLeadProfile as getLeadProfileSupabase } from "@/lib/domain/leads/leadProfileStoreSupabase";
import { runPaidLeadSearch } from "@/lib/domain/leads/paidLeadSearch";
import { searchCompanyLeads, type CompanyLeadDraft, type CompanySearchResult } from "@/lib/domain/leads/company/companyLeads";
import { insertCompanyLeads } from "@/lib/domain/leads/company/companyStoreSqlite";
import { companyLeadFields } from "@/lib/domain/leads/company/companyRow";
import { hostOf } from "@/lib/domain/leads/company/companySites";
import { enrichBusiness } from "@/lib/domain/leads/local/websiteContact";
import { tavilyProvider } from "@/lib/domain/websearch/searchProvider";

// Web search plus reading up to a dozen company sites: use the platform maximum (Hobby caps at 60s).
// The site-reading budget is 30s (companyLeads.ts), the web searches run in parallel before it.
export const maxDuration = 60;

const SEARCH_AGENT_TYPE = "lead_search";

function summary(result: CompanySearchResult, saved: number) {
  return {
    dropped: { noContact: result.droppedNoContact, noFit: result.droppedNoFit },
    duplicates: result.duplicates,
    message:
      saved > 0
        ? null
        : result.droppedNoContact > 0
          ? `Found ${result.droppedNoContact} matching ${result.droppedNoContact === 1 ? "company" : "companies"}, but none showed an email or WhatsApp number on their site, so none were saved.`
          : "No new companies matched your profile this time.",
  };
}

export async function POST() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();

    const tavilyKey = process.env.TAVILY_API_KEY?.trim() || "";
    if (!tavilyKey) return NextResponse.json({ error: "Web search isn't configured on this deployment." }, { status: 422 });

    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId: string | null = setting?.value ?? null;
    if (!projectId) return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
    const { data: project } = await db.from("projects").select("id, url").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
    if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

    const profile = await getLeadProfileSupabase(db, user.id, projectId);
    if (!isConfirmed(profile)) return NextResponse.json({ error: "Set up your lead profile first." }, { status: 422 });
    if (profile.industries.length === 0) return NextResponse.json({ error: "Add the kinds of companies you sell to in your lead profile first." }, { status: 422 });

    return runSearch({
      saveRows: async (rows) => saveSupabase(db, user.id, projectId, rows),
      knownHosts: async () => {
        const { data } = await db.from("leads").select("website").eq("user_id", user.id).eq("project_id", projectId).not("website", "is", null);
        return new Set((data ?? []).map((r) => hostOf(String(r.website ?? ""))).filter((h): h is string => Boolean(h)));
      },
      tavilyKey,
      profile,
      ownHost: hostOf(String(project.url ?? "")) ?? undefined,
      paid: {
        checkDailyLimit: () => canFetchLeadsToday(user.id),
        hasCredits: async () => {
          const state = await getCreditState(user.id, SEARCH_AGENT_TYPE);
          return !state.billingEnabled || state.balance >= state.cost;
        },
        charge: async () => {
          try {
            await chargeCredits(user.id, SEARCH_AGENT_TYPE, { projectId, model: "company_search" });
            return true;
          } catch (err) {
            const reason = err instanceof InsufficientCreditsError ? "insufficient_credits" : "charge_error";
            console.warn(`[leads] company search saved leads but charge was refused (${reason}) for user ${user.id}`);
            return false;
          }
        },
      },
    });
  }

  const db = getDb();
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as { value: string } | undefined;
  if (!keyRow?.value) return NextResponse.json({ error: "No Tavily API key. Add one in Settings to search the web." }, { status: 422 });
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  const project = db.prepare("SELECT id, url FROM projects WHERE id = ?").get(projectId) as { id: string; url: string } | undefined;
  if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

  const profile = getLeadProfileSqlite(db, projectId);
  if (!isConfirmed(profile)) return NextResponse.json({ error: "Set up your lead profile first." }, { status: 422 });
  if (profile.industries.length === 0) return NextResponse.json({ error: "Add the kinds of companies you sell to in your lead profile first." }, { status: 422 });

  return runSearch({
    saveRows: async (rows) => saveSqlite(db, projectId, rows),
    knownHosts: async () => {
      const rows = db.prepare("SELECT website FROM leads WHERE project_id = ? AND website IS NOT NULL").all(projectId) as { website: string }[];
      return new Set(rows.map((r) => hostOf(r.website)).filter((h): h is string => Boolean(h)));
    },
    tavilyKey: keyRow.value,
    profile,
    ownHost: hostOf(project.url) ?? undefined,
    paid: null,
  });
}

type Row = Record<string, unknown>;

async function runSearch(opts: {
  saveRows: (rows: Row[]) => Promise<{ ok: true; rows: Row[] } | { ok: false; status: 500; error: string }>;
  knownHosts: () => Promise<Set<string>>;
  tavilyKey: string;
  profile: Parameters<typeof searchCompanyLeads>[1]["profile"];
  ownHost?: string;
  paid: {
    checkDailyLimit: () => Promise<{ allowed: boolean; message?: string }>;
    hasCredits: () => Promise<boolean>;
    charge: () => Promise<boolean>;
  } | null;
}) {
  let last: CompanySearchResult = { leads: [], droppedNoContact: 0, droppedNoFit: 0, duplicates: 0 };
  const query = `${opts.profile.industries.join(", ")} ${opts.profile.locations.join(", ")}`.trim();
  const now = new Date().toISOString();

  const outcome = await runPaidLeadSearch<CompanyLeadDraft, Row>({
    checkDailyLimit: opts.paid?.checkDailyLimit ?? (async () => ({ allowed: true })),
    hasCredits: opts.paid?.hasCredits,
    search: async () => {
      last = await searchCompanyLeads(
        { provider: tavilyProvider(opts.tavilyKey), knownHosts: opts.knownHosts, enrich: (site) => enrichBusiness(site) },
        { profile: opts.profile, ownHost: opts.ownHost },
      );
      return last.leads;
    },
    save: (drafts) => opts.saveRows(drafts.map((d) => companyLeadFields(d, query, now))),
    charge: opts.paid?.charge ?? (async () => true),
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ leads: outcome.leads, ...summary(last, outcome.leads.length) });
}

async function saveSupabase(db: SupabaseClient, userId: string, projectId: string, rows: Row[]) {
  const { data, error } = await db.from("leads").insert(rows.map((r) => ({ ...r, user_id: userId, project_id: projectId, auto_generated: false }))).select();
  if (error) return { ok: false as const, status: 500 as const, error: error.message };
  return { ok: true as const, rows: (data ?? []) as Row[] };
}

async function saveSqlite(db: ReturnType<typeof getDb>, projectId: string, rows: Row[]) {
  try {
    return { ok: true as const, rows: insertCompanyLeads(db, projectId, rows) };
  } catch (err) {
    return { ok: false as const, status: 500 as const, error: err instanceof Error ? err.message : "Could not save the leads." };
  }
}
