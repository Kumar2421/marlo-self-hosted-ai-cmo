import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { canFetchLeadsToday } from "@/lib/entitlements";
import { chargeCredits, getCreditState, InsufficientCreditsError } from "@/lib/credits";
import { PLATFORM_DEFAULT_MODELS, platformKeyFor } from "@/lib/llm/platformKeys";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getLeadProfile as getLeadProfileSqlite } from "@/lib/domain/leads/leadProfileStore";
import { getLeadProfile as getLeadProfileSupabase } from "@/lib/domain/leads/leadProfileStoreSupabase";
import { getOfferModel as getOfferModelSqlite } from "@/lib/domain/offer/offerModelStore";
import { getOfferModel as getOfferModelSupabase } from "@/lib/domain/offer/offerModelStoreSupabase";
import { runPaidLeadSearch } from "@/lib/domain/leads/paidLeadSearch";
import { insertCompanyLeads } from "@/lib/domain/leads/company/companyStoreSqlite";
import { classifyRequests } from "@/lib/domain/leads/intent/IntentClassifier";
import { searchIntentLeads, type IntentFocus, type IntentLeadDraft, type IntentResult } from "@/lib/domain/leads/intent/intentSearch";
import { draftReplies } from "@/lib/domain/leads/intent/replyDrafter";
import { getRedditSettings as getRedditSettingsSqlite } from "@/lib/domain/reddit/redditSettingsStore";
import { getRedditSettings as getRedditSettingsSupabase } from "@/lib/domain/reddit/redditSettingsStoreSupabase";
import { canonicalPostUrl } from "@/lib/domain/leads/intent/redditPosts";
import { tavilyProvider } from "@/lib/domain/websearch/searchProvider";

// One web search round, then one model call over at most 20 posts. Well inside the 60s Hobby limit.
export const maxDuration = 60;

const SEARCH_AGENT_TYPE = "lead_search";
const PLATFORM_PROVIDER = "groq";
const MODEL_TIMEOUT_MS = 20_000;

type Row = Record<string, unknown>;
type Llm = { driver: NonNullable<ReturnType<typeof getDriver>>; apiKey: string; model: string; baseUrl?: string };

function leadFields(d: IntentLeadDraft, query: string, now: string): Row {
  return {
    name: d.name,
    title: "",
    company: `r/${d.subreddit}`,
    lead_type: "intent",
    email: null,
    email_verified: false,
    website: null,
    description: d.reply,
    source_url: d.url,
    fit_reason: d.reason,
    query,
    created_at: now,
  };
}

function summary(r: IntentResult, saved: number) {
  const base = { considered: r.considered, droppedSellers: r.droppedSellers, duplicates: r.duplicates };
  if (saved > 0) return { ...base, message: null };
  if (r.classifierFailed) return { ...base, message: "Found posts but couldn't judge them this time. Try again in a minute." };
  if (r.considered === 0) return { ...base, message: "No new public posts matched what you sell this month." };
  return { ...base, message: `Looked at ${r.considered} public posts and none was someone asking for what you sell. That is normal: most posts are not requests.` };
}

const NO_OFFER = "Marlo hasn't read what you sell yet. Finish setup so it can, then try again.";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const bodyModel: string | undefined = typeof body?.model === "string" ? body.model : undefined;
  const bodyProvider: string | undefined = typeof body?.providerId === "string" ? body.providerId : undefined;

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();

    const tavilyKey = process.env.TAVILY_API_KEY?.trim() || "";
    if (!tavilyKey) return NextResponse.json({ error: "Web search isn't configured on this deployment." }, { status: 422 });
    const apiKey = platformKeyFor(PLATFORM_PROVIDER);
    const model = PLATFORM_DEFAULT_MODELS[PLATFORM_PROVIDER];
    const driver = getDriver(PLATFORM_PROVIDER);
    if (!apiKey || !model || !driver) return NextResponse.json({ error: "Finding requests isn't configured on this deployment." }, { status: 422 });

    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId: string | null = setting?.value ?? null;
    if (!projectId) return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
    const { data: project } = await db.from("projects").select("id, name").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
    if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

    const offer = await getOfferModelSupabase(db, user.id, projectId);
    if (!offer?.sells) return NextResponse.json({ error: NO_OFFER }, { status: 422 });
    const profile = await getLeadProfileSupabase(db, user.id, projectId);
    const reddit = await getRedditSettingsSupabase(db, user.id, projectId).catch(() => null);

    return run({
      productName: String(project.name ?? ""),
      focus: { keywords: reddit?.keywords ?? [], subreddits: reddit?.subreddits ?? [] },
      llm: { driver, apiKey, model },
      tavilyKey,
      offer: { sells: offer.sells, whoPays: offer.whoPays || undefined },
      locations: profile?.locations ?? [],
      knownUrls: async () => {
        const { data } = await db.from("leads").select("source_url").eq("user_id", user.id).eq("project_id", projectId).not("source_url", "is", null);
        return new Set((data ?? []).map((r) => canonicalPostUrl(String(r.source_url ?? ""))).filter((u): u is string => Boolean(u)));
      },
      saveRows: async (rows) => {
        const { data, error } = await db.from("leads").insert(rows.map((r) => ({ ...r, user_id: user.id, project_id: projectId, auto_generated: false }))).select();
        return error ? { ok: false as const, status: 500 as const, error: error.message } : { ok: true as const, rows: (data ?? []) as Row[] };
      },
      paid: {
        checkDailyLimit: () => canFetchLeadsToday(user.id),
        hasCredits: async () => {
          const state = await getCreditState(user.id, SEARCH_AGENT_TYPE);
          return !state.billingEnabled || state.balance >= state.cost;
        },
        charge: async () => {
          try {
            await chargeCredits(user.id, SEARCH_AGENT_TYPE, { projectId, model: "intent_search" });
            return true;
          } catch (err) {
            const reason = err instanceof InsufficientCreditsError ? "insufficient_credits" : "charge_error";
            console.warn(`[leads] intent search saved leads but charge was refused (${reason}) for user ${user.id}`);
            return false;
          }
        },
      },
    });
  }

  // Self-host: the user's own connected model and search key.
  const db = getDb();
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as { value: string } | undefined;
  if (!keyRow?.value) return NextResponse.json({ error: "No Tavily API key. Add one in Settings to search the web." }, { status: 422 });
  if (!bodyModel || !bodyProvider) return NextResponse.json({ error: "No model selected. Connect a provider in Settings → LLM Providers." }, { status: 422 });
  const driver = getDriver(bodyProvider);
  if (!driver) return NextResponse.json({ error: `${bodyProvider} isn't wired to a real model yet.` }, { status: 501 });
  const conn = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(bodyProvider) as { api_key: string; base_url: string | null } | undefined;
  if (!conn) return NextResponse.json({ error: `${bodyProvider} isn't connected yet.` }, { status: 422 });

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  const offer = getOfferModelSqlite(db, projectId);
  if (!offer?.sells) return NextResponse.json({ error: NO_OFFER }, { status: 422 });
  const profile = getLeadProfileSqlite(db, projectId);
  const reddit = (() => {
    try {
      return getRedditSettingsSqlite(db, projectId);
    } catch {
      return null;
    }
  })();
  const projectRow = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;

  return run({
    productName: projectRow?.name ?? "",
    focus: { keywords: reddit?.keywords ?? [], subreddits: reddit?.subreddits ?? [] },
    llm: { driver, apiKey: conn.api_key, model: bodyModel, baseUrl: conn.base_url ?? undefined },
    tavilyKey: keyRow.value,
    offer: { sells: offer.sells, whoPays: offer.whoPays || undefined },
    locations: profile?.locations ?? [],
    knownUrls: async () => {
      const rows = db.prepare("SELECT source_url FROM leads WHERE project_id = ? AND source_url IS NOT NULL").all(projectId) as { source_url: string }[];
      return new Set(rows.map((r) => canonicalPostUrl(r.source_url)).filter((u): u is string => Boolean(u)));
    },
    saveRows: async (rows) => {
      try {
        return { ok: true as const, rows: insertCompanyLeads(db, projectId, rows) };
      } catch (err) {
        return { ok: false as const, status: 500 as const, error: err instanceof Error ? err.message : "Could not save the leads." };
      }
    },
    paid: null,
  });
}

async function run(opts: {
  productName: string;
  focus: IntentFocus;
  llm: Llm;
  tavilyKey: string;
  offer: { sells: string; whoPays?: string };
  locations: readonly string[];
  knownUrls: () => Promise<Set<string>>;
  saveRows: (rows: Row[]) => Promise<{ ok: true; rows: Row[] } | { ok: false; status: 500; error: string }>;
  paid: { checkDailyLimit: () => Promise<{ allowed: boolean; message?: string }>; hasCredits: () => Promise<boolean>; charge: () => Promise<boolean> } | null;
}) {
  let last: IntentResult = { leads: [], considered: 0, droppedSellers: 0, duplicates: 0, classifierFailed: false };
  const query = `requests for ${opts.offer.sells}`.slice(0, 120);
  const now = new Date().toISOString();

  const outcome = await runPaidLeadSearch<IntentLeadDraft, Row>({
    checkDailyLimit: opts.paid?.checkDailyLimit ?? (async () => ({ allowed: true })),
    hasCredits: opts.paid?.hasCredits,
    search: async () => {
      last = await searchIntentLeads(
        {
          provider: tavilyProvider(opts.tavilyKey),
          knownUrls: opts.knownUrls,
          classify: (posts) => classifyRequests({ ...opts.llm, offer: opts.offer, posts, timeoutMs: MODEL_TIMEOUT_MS }),
          draft: (requests) => draftReplies({ ...opts.llm, product: { name: opts.productName, sells: opts.offer.sells, whoPays: opts.offer.whoPays }, requests, timeoutMs: MODEL_TIMEOUT_MS }),
        },
        { offer: opts.offer, locations: opts.locations, focus: opts.focus },
      );
      return last.leads;
    },
    save: (drafts) => opts.saveRows(drafts.map((d) => leadFields(d, query, now))),
    charge: opts.paid?.charge ?? (async () => true),
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ leads: outcome.leads, ...summary(last, outcome.leads.length) });
}
