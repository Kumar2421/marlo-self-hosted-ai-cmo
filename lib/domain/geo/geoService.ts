import type { Finding } from "@/lib/domain/findings/findingTypes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { fetchGA4Report, getSelectedGA4Property } from "@/lib/domain/analytics/googleAnalyticsData";
import { getSelectedGA4Property as getSelectedGA4PropertySupabase } from "@/lib/domain/integrations/integrationStoreSupabase";
import { getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase } from "@/lib/domain/search/searchSnapshotStoreSupabase";
import { brandTermsFrom } from "@/lib/domain/search/searchIntent";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { listProjectFindings as listFindingsSqlite, upsertFinding as upsertFindingSqlite } from "@/lib/domain/findings/findingStore";
import { listProjectFindings as listFindingsSupabase, upsertFinding as upsertFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { sqliteFindingRepository, supabaseFindingRepository } from "@/lib/domain/findings/findingRepositories";
import { getValidPlatformGoogleToken } from "@/lib/domain/shared/getValidPlatformGoogleToken";
import { resolvePlatformApiKey } from "@/lib/domain/shared/resolvePlatformApiKey";
import { tavilySearchRaw } from "@/lib/domain/shared/webSearchTool";
import { getDriver } from "@/lib/llm";
import { PLATFORM_DEFAULT_MODELS, platformKeyFor } from "@/lib/llm/platformKeys";
import { buildReferralReportBody, parseReferralRows, type ReferralResult } from "./aiReferral";
import { resolveGeminiDailyCap, resolveSimulatedDailyCap } from "./dailyCap";
import { createGeminiGroundedPort, createSimulatedPort, DEFAULT_GEMINI_MODEL, type AnswerPort } from "./engines";
import * as sqliteStore from "./geoStore";
import * as supabaseStore from "./geoStoreSupabase";
import { activePrompts, mergePrompts, normalizePrompt, suggestPrompts } from "./promptSet";
import { buildStarterPrompts } from "./starterPrompts";
import { evaluateReadiness, type Fetched, type ReadinessResult } from "./readiness";
import { fetchPublic, type FetchOutcome } from "./safeFetch";
import { emptySummary, runGeoPrompts, type RunStore, type RunSummary } from "./runner";
import { MAX_TRACKED_PROMPTS, type AnswerMethod, type GeoPrompt, type GeoRunRow } from "./types";
import { deriveGeoGapFindings, GEO_GAP_CATEGORY, GEO_GAP_SOURCE, geoGapEntityId } from "./geoGaps";
import { syncGeoGapFindings, toUpsertInput, type GapSyncPorts, type GapSyncSummary } from "./geoGapSync";
import { aggregateRuns, compareTrend, dayOf, ratesByDay, type Subject, type Trend } from "./visibility";

export type GeoContext =
  | { mode: "platform"; db: SupabaseClient; userId: string; projectId: string }
  | { mode: "selfhost"; projectId: string };

type ProjectInfo = { name: string; category: string; url: string; domain: string };

const HISTORY_DAYS = 90;

export async function loadProject(ctx: GeoContext): Promise<ProjectInfo | null> {
  let row: { name?: string; category?: string; url?: string } | null | undefined;
  if (ctx.mode === "platform") {
    const { data } = await ctx.db.from("projects").select("name, category, url").eq("id", ctx.projectId).eq("owner_id", ctx.userId).maybeSingle();
    row = data;
  } else {
    row = getDb().prepare("SELECT name, category, url FROM projects WHERE id = ?").get(ctx.projectId) as typeof row;
  }
  if (!row?.url) return null;
  try {
    const domain = new URL(row.url.includes("://") ? row.url : `https://${row.url}`).hostname.replace(/^www\./, "").toLowerCase();
    return { name: row.name ?? domain, category: row.category ?? "", url: row.url, domain };
  } catch {
    return null;
  }
}

async function loadCompetitorDomains(ctx: GeoContext): Promise<string[]> {
  let urls: string[];
  if (ctx.mode === "platform") {
    const { data } = await ctx.db.from("project_competitors").select("url").eq("project_id", ctx.projectId).eq("user_id", ctx.userId);
    urls = (data ?? []).map((r) => String(r.url));
  } else {
    urls = (getDb().prepare("SELECT url FROM project_competitors WHERE project_id = ?").all(ctx.projectId) as { url: string }[]).map((r) => r.url);
  }
  const out: string[] = [];
  for (const u of urls) {
    try {
      const h = new URL(u.includes("://") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
      if (!out.includes(h)) out.push(h);
    } catch {
      // skip malformed
    }
  }
  return out.slice(0, 10);
}

type Keys = { gemini?: string; tavily?: string; groq?: string };

async function resolveKeys(ctx: GeoContext): Promise<Keys> {
  if (ctx.mode === "platform") {
    return {
      gemini: await resolvePlatformApiKey(ctx.db, ctx.userId, "gemini_api_key"),
      tavily: await resolvePlatformApiKey(ctx.db, ctx.userId, "tavily_api_key"),
      groq: platformKeyFor("groq"),
    };
  }
  const db = getDb();
  const setting = (key: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value?.trim() || undefined;
  const groqRow = db.prepare("SELECT api_key FROM provider_connections WHERE provider_id = 'groq'").get() as { api_key: string } | undefined;
  return { gemini: setting("gemini_api_key"), tavily: setting("tavily_api_key"), groq: groqRow?.api_key || undefined };
}

export type GeoCapabilities = {
  geminiAvailable: boolean;
  simulatedAvailable: boolean;
  geminiDailyCap: number | null;
  geminiUsedToday: number;
  simulatedDailyCap: number | null;
  simulatedUsedToday: number;
};

function buildPorts(keys: Keys): AnswerPort[] {
  const ports: AnswerPort[] = [];
  if (keys.gemini) ports.push(createGeminiGroundedPort({ apiKey: keys.gemini, model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL }));
  if (keys.tavily && keys.groq) {
    const tavilyKey = keys.tavily;
    const groqKey = keys.groq;
    const driver = getDriver("groq");
    if (driver) {
      ports.push(
        createSimulatedPort({
          search: (q) => tavilySearchRaw(tavilyKey, q, 6),
          complete: async (system, user) => {
            const result = await driver({
              apiKey: groqKey,
              model: PLATFORM_DEFAULT_MODELS.groq,
              system,
              messages: [{ role: "user", content: user }],
            });
            return result.text ?? "";
          },
        }),
      );
    }
  }
  return ports;
}

function runStoreFor(ctx: GeoContext): RunStore {
  return ctx.mode === "platform" ? supabaseStore.supabaseRunStore(ctx.db, ctx.userId, ctx.projectId) : sqliteStore.sqliteRunStore(getDb(), ctx.projectId);
}

async function listPrompts(ctx: GeoContext): Promise<GeoPrompt[]> {
  return ctx.mode === "platform" ? supabaseStore.listPrompts(ctx.db, ctx.userId, ctx.projectId) : sqliteStore.listPrompts(getDb(), ctx.projectId);
}

export async function savePrompts(ctx: GeoContext, prompts: GeoPrompt[]): Promise<void> {
  if (ctx.mode === "platform") await supabaseStore.replacePrompts(ctx.db, ctx.userId, ctx.projectId, prompts);
  else sqliteStore.replacePrompts(getDb(), ctx.projectId, prompts);
}

async function listRuns(ctx: GeoContext, now = new Date()): Promise<GeoRunRow[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();
  return ctx.mode === "platform" ? supabaseStore.listRuns(ctx.db, ctx.userId, ctx.projectId, since) : sqliteStore.listRuns(getDb(), ctx.projectId, since);
}

/** Top Search Console queries from the latest snapshot, turned into buyer questions. Empty if GSC has no snapshot yet. */
export async function suggestFromSearchConsole(ctx: GeoContext, project: ProjectInfo): Promise<string[]> {
  const latest = ctx.mode === "platform" ? await getLatestSnapshotSupabase(ctx.db, ctx.userId, ctx.projectId) : getLatestSnapshot(getDb(), ctx.projectId);
  const fromSearch = latest ? suggestPrompts(latest.payload.windows.d28.queries, brandTermsFrom(project.name, project.url)) : [];
  // Real searches first; offer-based starters (category, competitors) only fill what is left.
  const starters = buildStarterPrompts({ brand: project.name, category: project.category, competitors: await loadCompetitorDomains(ctx) });
  const seen = new Set(fromSearch.map(normalizePrompt));
  return [...fromSearch, ...starters.filter((s) => !seen.has(normalizePrompt(s)))].slice(0, MAX_TRACKED_PROMPTS);
}

/** Seed prompts from Search Console the first time only, so user edits are never overwritten. */
export async function ensurePrompts(ctx: GeoContext, project: ProjectInfo): Promise<GeoPrompt[]> {
  const existing = await listPrompts(ctx);
  if (existing.length > 0) return existing;
  const suggestions = await suggestFromSearchConsole(ctx, project);
  if (suggestions.length === 0) return [];
  const merged = mergePrompts([], suggestions);
  await savePrompts(ctx, merged);
  return merged;
}

export async function runProjectGeo(
  ctx: GeoContext,
  opts: { budgetMs?: number; now?: Date; maxRunsPerPrompt?: number; onlyPrompts?: string[] } = {},
): Promise<RunSummary & { noEngines?: boolean; noPrompts?: boolean }> {
  const project = await loadProject(ctx);
  if (!project) throw new Error("No project website linked yet. Add one in the project switcher first.");
  const only = opts.onlyPrompts ? new Set(opts.onlyPrompts) : null;
  const prompts = activePrompts(await ensurePrompts(ctx, project)).filter((p) => !only || only.has(p));
  if (prompts.length === 0) return { ...emptySummary(), noPrompts: true };
  const ports = buildPorts(await resolveKeys(ctx));
  if (ports.length === 0) return { ...emptySummary(), noEngines: true };

  const subject: Subject = { brand: project.name, domain: project.domain, competitors: await loadCompetitorDomains(ctx) };
  const now = opts.now;
  const summary = await runGeoPrompts({
    prompts,
    ports,
    subject,
    store: runStoreFor(ctx),
    caps: {
      "gemini-grounded": resolveGeminiDailyCap(ctx.mode === "platform", process.env.GEMINI_DAILY_CAP),
      simulated: resolveSimulatedDailyCap(ctx.mode === "platform", process.env.SIMULATED_DAILY_CAP),
    },
    budgetMs: opts.budgetMs,
    maxRunsPerPrompt: opts.maxRunsPerPrompt,
    now: now ? () => now : undefined,
  });
  // New rows may open a gap or close one. A failure here must never fail the run that already saved its rows.
  if (summary.ran > 0) {
    try {
      await syncGapFindings(ctx, project, now);
    } catch {
      // gaps are re-derived on the next run
    }
  }
  return summary;
}

function gapPorts(ctx: GeoContext, project: ProjectInfo, now: Date): GapSyncPorts {
    return {
    projectId: ctx.projectId,
    runs: () => listRuns(ctx, now),
    activePrompts: async () => activePrompts(await listPrompts(ctx)),
    listFindings: async () => (ctx.mode === "platform" ? listFindingsSupabase(ctx.db, ctx.userId, ctx.projectId) : listFindingsSqlite(ctx.projectId)),
    upsert: async (input) => (ctx.mode === "platform" ? upsertFindingSupabase(ctx.db, ctx.userId, input) : upsertFindingSqlite(input)),
    repository: ctx.mode === "platform" ? supabaseFindingRepository(ctx.db, ctx.userId) : sqliteFindingRepository(),
  };
}

export function syncGapFindings(ctx: GeoContext, project: ProjectInfo, now = new Date()): Promise<GapSyncSummary> {
  return syncGeoGapFindings(gapPorts(ctx, project, now), project, now);
}

/** "Track as a fix" for one prompt: the gap is re-derived from stored runs here; the client only names the prompt. */
export async function trackGeoGap(ctx: GeoContext, prompt: string, now = new Date()) {
  const project = await loadProject(ctx);
  if (!project) return { status: "no-project" as const };
  const ports = gapPorts(ctx, project, now);
  const key = geoGapEntityId(prompt);
  const gap = deriveGeoGapFindings(await ports.runs(), [prompt], project).find((g) => g.entityId === key);
  if (!gap) return { status: "no-gap" as const };
  return { status: "tracked" as const, finding: await ports.upsert(toUpsertInput(ctx.projectId, gap)) };
}

export type PromptRow = {
  prompt: string;
  source: "gsc" | "manual";
  active: boolean;
  /** Set when recent answers miss you (open) and/or a finding already tracks it. */
  gap: { method: AnswerMethod; open: boolean; tracked: boolean; findingStatus: string | null } | null;
  methods: Array<{
    method: AnswerMethod;
    runs: number;
    mentionRate: number;
    citedRate: number;
    trend: Trend;
    previousRate: number | null;
    /** UTC day (YYYY-MM-DD) of the run day `previousRate` comes from; can be weeks before `lastRunAt`. Null when there is no earlier day. */
    previousDate: string | null;
    /** Competitors named in at least one run of the latest day. */
    competitors: string[];
    lastRunAt: string;
  }>;
};

export type GeoOverview = {
  project: { name: string; domain: string };
  prompts: PromptRow[];
  capabilities: GeoCapabilities;
  lastRunAt: string | null;
};

export async function getOverview(ctx: GeoContext, now = new Date()): Promise<GeoOverview | null> {
  const project = await loadProject(ctx);
  if (!project) return null;
  const [prompts, runs, keys, store] = await Promise.all([ensurePrompts(ctx, project), listRuns(ctx, now), resolveKeys(ctx), Promise.resolve(runStoreFor(ctx))]);
  const today = dayOf(now.toISOString());
  const usedToday = keys.gemini ? await store.countMethodRunsToday("gemini-grounded", today) : 0;
  const simulatedUsed = keys.tavily && keys.groq ? await store.countMethodRunsToday("simulated", today) : 0;

  const gaps = deriveGeoGapFindings(runs, activePrompts(prompts), project);
  let trackedGaps: Finding[] = [];
  try {
    const all = ctx.mode === "platform" ? await listFindingsSupabase(ctx.db, ctx.userId, ctx.projectId) : listFindingsSqlite(ctx.projectId);
    trackedGaps = all.filter((f) => f.source === GEO_GAP_SOURCE && f.category === GEO_GAP_CATEGORY);
  } catch {
    // the overview still shows measured data without finding links
  }

  const rows: PromptRow[] = prompts.map((p) => {
    const own = runs.filter((r) => r.prompt === p.prompt);
    const methods = (["gemini-grounded", "simulated"] as const)
      .filter((m) => own.some((r) => r.method === m))
      .map((method) => {
        const latestDay = ratesByDay(own, method)[0].date;
        const latestRuns = own.filter((r) => r.method === method && dayOf(r.runAt) === latestDay);
        const agg = aggregateRuns(latestRuns, method);
        const t = compareTrend(own, method);
        return {
          method,
          runs: agg.runs,
          mentionRate: agg.mentionRate,
          citedRate: agg.citedRate,
          trend: t.trend,
          previousRate: t.previous,
          previousDate: t.previousDate,
          competitors: Object.keys(agg.competitorRates),
          lastRunAt: latestRuns.map((r) => r.runAt).sort().reverse()[0],
        };
      });
    const gap = p.active ? gaps.find((g) => g.entityId === geoGapEntityId(p.prompt)) : undefined;
    const tracked = trackedGaps.find((f) => f.entityId === geoGapEntityId(p.prompt));
    return {
      prompt: p.prompt, source: p.source, active: p.active, methods,
      gap: gap || tracked ? { method: (gap?.evidence.method ?? tracked?.evidence.method) as AnswerMethod, open: Boolean(gap), tracked: Boolean(tracked), findingStatus: tracked?.status ?? null } : null,
    };
  });

  return {
    project: { name: project.name, domain: project.domain },
    prompts: rows,
    capabilities: {
      geminiAvailable: Boolean(keys.gemini),
      simulatedAvailable: Boolean(keys.tavily && keys.groq),
      geminiDailyCap: resolveGeminiDailyCap(ctx.mode === "platform", process.env.GEMINI_DAILY_CAP),
      geminiUsedToday: usedToday,
      simulatedDailyCap: resolveSimulatedDailyCap(ctx.mode === "platform", process.env.SIMULATED_DAILY_CAP),
      simulatedUsedToday: simulatedUsed,
    },
    lastRunAt: runs.length > 0 ? runs[0].runAt : null,
  };
}

export async function getPromptHistory(ctx: GeoContext, prompt: string): Promise<GeoRunRow[]> {
  return (await listRuns(ctx)).filter((r) => r.prompt === prompt);
}

function toFetched(outcome: FetchOutcome): Fetched {
  if (outcome.kind === "ok") return { state: "ok", body: outcome.body };
  return outcome.kind === "not-found" ? { state: "missing" } : { state: "unknown" };
}

/** Every request (and every redirect hop) goes through the public-URL guard, with capped hops and bytes. */
export function fetchForReadiness(url: string): Promise<FetchOutcome> {
  return fetchPublic(url, { assertUrl: (u) => void assertPublicHttpUrl(u) });
}

export async function checkReadiness(domain: string, fetcher: (url: string) => Promise<FetchOutcome> = fetchForReadiness): Promise<ReadinessResult> {
  const base = `https://${domain}`;
  const [robots, llms, home, sitemapXml] = await Promise.all([
    fetcher(`${base}/robots.txt`),
    fetcher(`${base}/llms.txt`),
    fetcher(`${base}/`),
    fetcher(`${base}/sitemap.xml`),
  ]);
  // A soft-404 HTML page at /llms.txt is not a real llms.txt: treat it as missing.
  const llmsFetched: Fetched = llms.kind === "ok" && /^s*<(!doctype|html)/i.test(llms.body) ? { state: "missing" } : toFetched(llms);
  return evaluateReadiness({ robots: toFetched(robots), llms: llmsFetched, sitemapXml: toFetched(sitemapXml), homepageHtml: home.kind === "ok" ? home.body : null });
}

export type ReferralView = (ReferralResult & { range: { startDate: string; endDate: string } }) | { notConnected: true };

export async function getAiReferrals(ctx: GeoContext, now = new Date()): Promise<ReferralView> {
  const property = ctx.mode === "platform" ? await getSelectedGA4PropertySupabase(ctx.db, ctx.userId, ctx.projectId) : getSelectedGA4Property(ctx.projectId);
  if (!property) return { notConnected: true };
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 27 * 86_400_000).toISOString().slice(0, 10);
  const body = buildReferralReportBody(start, end);
  let report: { rows?: unknown[] };
  if (ctx.mode === "platform") {
    const token = await getValidPlatformGoogleToken(ctx.db, ctx.userId, ctx.projectId);
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property.id}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GA4 report failed: HTTP ${res.status}`);
    report = await res.json();
  } else {
    report = await fetchGA4Report(property.id, body);
  }
  return { ...parseReferralRows(report.rows as Parameters<typeof parseReferralRows>[0]), range: { startDate: start, endDate: end } };
}

export const listSavedPrompts = listPrompts;
export { MAX_TRACKED_PROMPTS };
