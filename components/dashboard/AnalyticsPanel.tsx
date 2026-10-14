"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart2, ChevronLeft, ChevronRight, Link2, X, Lock, Search, Cpu, Globe2, Check, Loader2, RefreshCw, AlertTriangle, ExternalLink, TrendingUp, Code2 } from "lucide-react";
import CollapsedRail, { RailButton } from "./CollapsedRail";
import { useToast } from "./Toast";
import ScoreCircle from "./ScoreCircle";
import FindingsWorkspace from "./FindingsWorkspace";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import type { Finding as AnalyticsFinding } from "@/lib/domain/findings/findingTypes";
import type { GeoCitationRow } from "@/lib/domain/geo/GEOAgent";
import { useProject } from "@/lib/project-store";
import { useTerminalLog } from "@/lib/terminal-log-store";
import { FEATURES } from "@/lib/features";
import type { SearchInsights } from "@/lib/domain/search/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, fetchJson } from "@/lib/query/fetchJson";
import { SkeletonCard, SkeletonLines, SkeletonStats } from "@/components/shared/Skeleton";
import { qk } from "@/lib/query/keys";
import GoogleSourcesCard from "@/components/dashboard/search/GoogleSourcesCard";
import GoogleSummary from "@/components/dashboard/search/GoogleSummary";
import SearchHistoryBar from "@/components/dashboard/search/SearchHistoryBar";
import SearchOverviewPanel from "@/components/dashboard/search/SearchOverviewPanel";
import SearchInsightsSection from "@/components/dashboard/search/SearchInsightsSection";
import GeoVisibility from "@/components/dashboard/geo/GeoVisibility";

const TABS = ["SEO", "Links", "Technical", "GEO", "Traffic", "Findings"] as const;
type Tab = (typeof TABS)[number];

type TrafficByDate = { date: string; clicks: number; impressions: number; ctr: number; position: number };
type TrafficQuery = { query: string; clicks: number; impressions: number; ctr: number; position: number };
type TrafficRankingPage = {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
type TrafficOpportunity = TrafficQuery & { score: number; rankingPages: TrafficRankingPage[] };

type PageEvidence = {
  url: string;
  meta: { title: string; description: string; canonical?: string; robots?: string; indexable: boolean };
  headings: { h1: number; h2: number; h3: number };
  contentRelevance: { titleRelevance: number; descriptionRelevance: number; keywordRelevance: number };
  technical: { status: number; redirectCount: number };
  serverTiming: { ttfbMs?: number };
  links: { internal: number; external: number };
  pageSpeed?: {
    desktop: { performance: number; accessibility: number; bestPractices: number; seo: number };
    mobile: { performance: number; accessibility: number; bestPractices: number; seo: number };
  };
  lighthouseIssues?: { desktop: LighthouseIssue[]; mobile: LighthouseIssue[] };
};
type TrafficResult = {
  range: { startDate: string; endDate: string };
  site: string | null;
  propertyName: string | null;
  byDate: TrafficByDate[];
  topQueries: TrafficQuery[];
  opportunities: TrafficOpportunity[];
  search?: SearchInsights | null;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  gscError: string | null;
  ga4: { sessions: number; activeUsers: number; screenPageViews: number } | null;
  ga4Error: string | null;
};

type CheckedLink = { href: string; text: string; internal: boolean; reachable: boolean; status?: number };
type PageSpeedScores = { performance: number; accessibility: number; bestPractices: number; seo: number };
type LighthouseIssue = { id: string; title: string; score: number | null; displayValue?: string; mode: "opportunity" | "diagnostic" };
type CrawledPage = {
  url: string;
  title: string;
  content: string;
  source: "crawl" | "jina-fallback";
  pageSpeed?: { desktop: PageSpeedScores; mobile: PageSpeedScores };
  pageSpeedError?: string;
  duplicateOfUrl?: string;
};

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
      {subtitle ? <p className="mb-3 mt-0.5 text-[12px] text-gray-500">{subtitle}</p> : <div className="mb-3" />}
      {children}
    </div>
  );
}

function StatusDot({ status }: { status: "good" | "warn" | "bad" | "Pass" | "Warn" | "Fail" }) {
  const color = (status === "good" || status === "Pass") ? "bg-[#00ab92]" : (status === "warn" || status === "Warn") ? "bg-amber-500" : "bg-red-500";
  return <span className={`h-1.5 w-1.5 rounded-full ${color}`} />;
}

/** Green = improved, red = worse — inverted for `lowerIsBetter` metrics
 * (position: a smaller number is a better rank, so a negative change there
 * is good news, shown green). null (no real previous-period baseline)
 * renders nothing rather than a fabricated 0%. */
function DeltaBadge({ change, lowerIsBetter = false }: { change: number | null; lowerIsBetter?: boolean }) {
  if (change === null) return null;
  const improved = lowerIsBetter ? change < 0 : change > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${improved ? "text-[#00ab92]" : "text-red-500"}`}>
      {change > 0 ? "↑" : change < 0 ? "↓" : "•"} {Math.abs(change).toFixed(1)}%
    </span>
  );
}

export default function AnalyticsPanel({ open, onToggle }: { open: boolean; onToggle: () => void; }) {
  const [tab, setTab] = useState<Tab>("SEO");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(false);
  const [linksChecking, setLinksChecking] = useState(false);
  const [geoChecking, setGeoChecking] = useState(false);
  const [siteCrawling, setSiteCrawling] = useState(false);
  const [pageSpeedRunning, setPageSpeedRunning] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [pageEvidence, setPageEvidence] = useState<Record<string, PageEvidence | { error: string }>>({});
  const [findings, setFindings] = useState<AnalyticsFinding[]>([]);
  const [findingCreating, setFindingCreating] = useState<Record<string, boolean>>({});
  const { show } = useToast();
  const { project, auditVersion } = useProject();
  const { log, logDone } = useTerminalLog();
  const searchParams = useSearchParams();

  const queryClient = useQueryClient();
  const pid = project?.id;

  // Server data lives in one shared cache keyed by project: switching project can never show
  // another project's data, a failed load is an error (not "never run"), and mutations below
  // write straight into the cache.
  const auditKey = qk.audit(pid, project?.url, auditVersion);
  const auditQuery = useQuery({
    queryKey: auditKey,
    enabled: open && Boolean(project?.url),
    queryFn: async (): Promise<SEOAuditPayload | null> => {
      const data = await fetchJson<{ payload?: SEOAuditPayload | string | null }>(
        `/api/agents/seo/audit?url=${encodeURIComponent(project?.url ?? "")}`,
      );
      // Platform mode: `payload` is a Postgres jsonb column, already parsed. Self-host: SQLite
      // stores TEXT that needs JSON.parse(). Parsing unconditionally broke every platform audit load.
      if (!data.payload) return null;
      return typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
    },
  });
  const auditData = auditQuery.data ?? null;
  const auditLoading = auditQuery.isPending && open && Boolean(project?.url);
  const setAuditData = (value: SEOAuditPayload | null) => queryClient.setQueryData(auditKey, value);

  type LinksResult = { links: CheckedLink[]; checkedAt: string };
  type GeoResult = { rows: GeoCitationRow[]; checkedAt: string };
  type CrawlResult = { pages: CrawledPage[]; checkedAt: string };
  const savedResult = <T,>(key: readonly string[], url: string, enabled: boolean) => ({
    queryKey: key,
    enabled,
    queryFn: async (): Promise<T | null> => (await fetchJson<{ result?: T | null }>(url)).result ?? null,
  });
  const linksKey = qk.links(pid);
  const geoKey = qk.geo(pid);
  const crawlKey = qk.siteCrawl(pid);
  const linksResult = useQuery(savedResult<LinksResult>(linksKey, "/api/agents/links/check", open && Boolean(project) && tab === "Links")).data ?? null;
  const geoResult = useQuery(savedResult<GeoResult>(geoKey, "/api/agents/geo/check", open && Boolean(project) && tab === "GEO")).data ?? null;
  const siteCrawlResult = useQuery(savedResult<CrawlResult>(crawlKey, "/api/agents/site-crawl/run", open && Boolean(project) && tab === "Links")).data ?? null;
  const setLinksResult = (value: LinksResult | null) => queryClient.setQueryData(linksKey, value);
  const setGeoResult = (value: GeoResult | null) => queryClient.setQueryData(geoKey, value);
  const setSiteCrawlResult = (value: CrawlResult | null) => queryClient.setQueryData(crawlKey, value);

  // Real Search Console + Analytics numbers: on the Traffic tab, and on SEO once a site is chosen.
  const trafficQuery = useQuery({
    queryKey: qk.traffic(pid),
    enabled: open && Boolean(project) && (tab === "Traffic" || (tab === "SEO" && googleReady)),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      log("Fetching real Search Console + Analytics data...");
      try {
        const data = await fetchJson<TrafficResult>("/api/agents/analytics/traffic");
        logDone(`Traffic data loaded — ${data.totals.clicks} clicks over the last 28 days.`);
        return data;
      } catch (err) {
        logDone(`⚠ ${err instanceof Error ? err.message : "Failed to load Traffic data."}`);
        throw err;
      }
    },
  });
  const trafficResult = trafficQuery.data ?? null;
  const trafficLoading = trafficQuery.isFetching && !trafficQuery.data;
  const trafficError = trafficQuery.error instanceof Error ? trafficQuery.error.message : null;
  const trafficNeedsSetup = trafficQuery.error instanceof ApiError && trafficQuery.error.status >= 400 && trafficQuery.error.status < 500;
  const retryTraffic = () => void trafficQuery.refetch();

  useEffect(() => {
    const error = searchParams.get("ga_error");
    const connected = searchParams.get("ga_connected");
    if (error) show(`Google Analytics connect failed: ${error}`);
    if (connected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab("SEO");
      show("Google connected — choose your site below.");
      void queryClient.invalidateQueries({ queryKey: qk.googleResources(pid) });
      void queryClient.invalidateQueries({ queryKey: qk.traffic(pid) });
    }
    if (error || connected) {
      const clean = new URLSearchParams(window.location.search);
      ["ga_error", "ga_connected", "ga_project", "ga_gsc_count", "ga_ga4_count"].forEach((key) => clean.delete(key));
      const query = clean.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Returning from the GitHub App install lands on the finding that started it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (searchParams.get("finding")) setTab("Findings");
  }, [searchParams]);

  const handleInspectRankingPage = async (url: string) => {
    if (pageEvidence[url]) return;

    setPageEvidence((prev) => ({ ...prev, [url]: { error: "" } }));
    log(`Inspecting ranking page: ${url}`);
    try {
      const res = await fetch("/api/agents/analytics/page-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPageEvidence((prev) => ({ ...prev, [url]: { error: data.error ?? "Failed to inspect page." } }));
        logDone(`⚠ Failed to inspect ranking page.`);
        return;
      }
      setPageEvidence((prev) => ({ ...prev, [url]: data }));
      logDone(`Ranking page inspected — ${url}`);
    } catch {
      setPageEvidence((prev) => ({ ...prev, [url]: { error: "Failed to inspect ranking page." } }));
      logDone("⚠ Failed to inspect ranking page.");
    }
  };

  const handleCreateFinding = async (q: TrafficOpportunity, url: string) => {
    const key = `${q.query}|${url}`;
    if (findingCreating[key]) return;
    setFindingCreating((prev) => ({ ...prev, [key]: true }));
    log(`Creating finding for query: ${q.query}`);
    try {
      const res = await fetch("/api/agents/analytics/findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q.query,
          url,
          clicks: q.clicks,
          impressions: q.impressions,
          ctr: q.ctr,
          position: q.position,
          score: q.score,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.error || "Failed to create finding.");
        log(`⚠ ${data.error || "Failed to create finding."}`);
        return;
      }
      if (!data.finding) {
        show(data.message || "No actionable issue found on this page.");
        logDone(data.message || "No actionable issue found on this page.");
        return;
      }
      setFindings((prev) => [data.finding, ...prev.filter((f) => f.id !== data.finding.id)]);
      window.dispatchEvent(new CustomEvent("marlo:findings-updated"));
      logDone(`Finding created — ${data.finding.severity} ${data.finding.category}`);
    } catch {
      show("Failed to create finding.");
      log("⚠ Failed to create finding.");
    } finally {
      setFindingCreating((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleCheckLinks = async () => {
    setLinksChecking(true);
    log("Checking link reachability...");
    try {
      const res = await fetch("/api/agents/links/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to check links"}`);
        show(data.error || "Failed to check links.");
        return;
      }
      setLinksResult(data.result);
      const broken = data.result.links.filter((l: CheckedLink) => !l.reachable).length;
      logDone(broken > 0 ? `Checked ${data.result.links.length} links — ${broken} broken.` : `Checked ${data.result.links.length} links — all reachable.`);
    } catch {
      log("⚠ Failed to check links.");
      show("Failed to check links.");
    } finally {
      setLinksChecking(false);
    }
  };

  const handleCrawlSite = async () => {
    setSiteCrawling(true);
    log("Crawling the rest of the site (checking each page, JS-rendering fallback if needed)...");
    try {
      const res = await fetch("/api/agents/site-crawl/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to crawl site"}`);
        show(data.error || "Failed to crawl site.");
        return;
      }
      setSiteCrawlResult(data.result);
      const viaJina = data.result.pages.filter((p: CrawledPage) => p.source === "jina-fallback").length;
      logDone(
        `Crawled ${data.result.pages.length} page${data.result.pages.length === 1 ? "" : "s"}${viaJina > 0 ? ` (${viaJina} via JS-render fallback)` : ""}.`
      );
    } catch {
      log("⚠ Failed to crawl site.");
      show("Failed to crawl site.");
    } finally {
      setSiteCrawling(false);
    }
  };

  const handleRunPageSpeedForCrawledPages = async () => {
    setPageSpeedRunning(true);
    log(`Running real PageSpeed for ${siteCrawlResult?.pages.length ?? 0} crawled page(s) — this can take a minute...`);
    try {
      const res = await fetch("/api/agents/site-crawl/pagespeed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to run PageSpeed"}`);
        show(data.error || "Failed to run PageSpeed.");
        return;
      }
      setSiteCrawlResult(data.result);
      const scored = data.result.pages.filter((p: CrawledPage) => p.pageSpeed).length;
      logDone(`Real PageSpeed scores fetched for ${scored} of ${data.result.pages.length} pages.`);
    } catch {
      log("⚠ Failed to run PageSpeed.");
      show("Failed to run PageSpeed.");
    } finally {
      setPageSpeedRunning(false);
    }
  };

  const handleRunGeoCheck = async () => {
    setGeoChecking(true);
    log("Checking AI search citations...");
    try {
      const res = await fetch("/api/agents/geo/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to run GEO check"}`);
        show(data.error || "Failed to run GEO check.");
        return;
      }
      setGeoResult(data.result);
      const gaps = data.result.rows.filter((r: GeoCitationRow) => !r.found).length;
      logDone(gaps > 0 ? `GEO check done — ${gaps} citation gap${gaps === 1 ? "" : "s"} found.` : "GEO check done — cited in every query checked.");
    } catch {
      log("⚠ Failed to run GEO check.");
      show("Failed to run GEO check.");
    } finally {
      setGeoChecking(false);
    }
  };

  const handleRunAudit = async () => {
    if (!project?.url) {
      show("Add a website in the project switcher at the top first.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/agents/seo/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: project.url }),
      });
      if (res.ok) {
        const data = await res.json();
        setAuditData(data);
        window.dispatchEvent(new CustomEvent("marlo:findings-updated"));
        show("SEO Audit completed!");
      } else {
        const err = await res.json();
        show(`Error: ${err.error}`);
      }
    } catch {
      show("Failed to run SEO audit.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <CollapsedRail onExpand={onToggle}>
        <RailButton icon={<Search size={15} />} label="SEO" active={tab === "SEO"} onClick={() => { setTab("SEO"); onToggle(); }} />
        <RailButton icon={<Link2 size={15} />} label="Links" active={tab === "Links"} onClick={() => { setTab("Links"); onToggle(); }} />
        <RailButton icon={<Cpu size={15} />} label="Technical" active={tab === "Technical"} onClick={() => { setTab("Technical"); onToggle(); }} />
        <RailButton icon={<Globe2 size={15} />} label="GEO" active={tab === "GEO"} onClick={() => { setTab("GEO"); onToggle(); }} />
        <RailButton icon={<TrendingUp size={15} />} label="Traffic" active={tab === "Traffic"} onClick={() => { setTab("Traffic"); onToggle(); }} />
        <RailButton icon={<Check size={15} />} label="Findings" active={tab === "Findings"} onClick={() => { setTab("Findings"); onToggle(); }} />
      </CollapsedRail>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
          <BarChart2 size={15} className="text-gray-500" /> Analytics
        </div>
        <div className="flex items-center gap-3 text-gray-400">
          <button onClick={onToggle} title="Collapse" className="hidden hover:text-gray-700 md:block">
            <ChevronLeft size={15} />
          </button>
        </div>
      </div>

      {project?.url && (
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[12px] text-gray-600 hover:underline"
          >
            {project.url.replace(/^https?:\/\//, "")}
          </a>
          <button
            onClick={handleRunAudit}
            disabled={loading}
            title="Re-run audit"
            className="flex shrink-0 items-center justify-center rounded-md bg-[#111111] px-2.5 py-1.5 text-white hover:bg-black disabled:opacity-70"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      )}

      <div className="okara-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 p-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${tab === t ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="okara-scroll flex-1 overflow-y-auto p-4">
        {tab === "Findings" ? (
          <FindingsWorkspace />
        ) : tab === "Traffic" ? (
          <Section
            title="Traffic"
            subtitle={
              trafficResult
                ? `Real Search Console data, ${trafficResult.range.startDate} → ${trafficResult.range.endDate}${trafficResult.site ? ` — ${trafficResult.site}` : ""}`
                : "Real search clicks, rankings and top queries from Search Console"
            }
          >
            {trafficLoading ? (
              <div className="space-y-4" aria-busy="true">
                <SkeletonStats count={3} />
                <SkeletonCard rows={4} />
                <SkeletonCard rows={3} />
              </div>
            ) : trafficError ? (
              <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-[13px] text-gray-500">
                <TrendingUp className="mx-auto mb-2 text-gray-300" size={28} />
                {trafficError}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  {trafficNeedsSetup ? (
                    <button
                      type="button"
                      onClick={() => setTab("SEO")}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
                    >
                      Connect Google or choose your site
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={retryTraffic}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            ) : trafficResult ? (
              <>
                {trafficResult.gscError && (
                  <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Search Console: {trafficResult.gscError}</span>
                  </div>
                )}
                {!trafficResult.site && !trafficResult.gscError && (
                  <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>No verified Search Console site found on this Google account.</span>
                  </div>
                )}

                {trafficResult.byDate.length > 0 && (
                  <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-3 flex h-24 items-end gap-1">
                      {trafficResult.byDate.map((d, i) => {
                        const max = Math.max(...trafficResult.byDate.map((r) => r.clicks), 1);
                        return (
                          <div
                            key={i}
                            title={`${d.date}: ${d.clicks} clicks`}
                            className="flex-1 rounded-t bg-[#00ab92]"
                            style={{ height: `${Math.max(2, (d.clicks / max) * 100)}%` }}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[11px] text-gray-400">
                      <span>{trafficResult.byDate[0]?.date}</span>
                      <span>{trafficResult.byDate[trafficResult.byDate.length - 1]?.date}</span>
                    </div>
                  </div>
                )}

                <SearchHistoryBar />

                <div className="mb-5 grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-1 text-[11px] uppercase text-gray-500">Total Clicks</div>
                    <div className="text-lg font-semibold text-gray-900">{trafficResult.totals.clicks.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-1 text-[11px] uppercase text-gray-500">Click Rate</div>
                    <div className="text-lg font-semibold text-gray-900">{(trafficResult.totals.ctr * 100).toFixed(1)}%</div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-1 text-[11px] uppercase text-gray-500">Avg. Position</div>
                    <div className="text-lg font-semibold text-gray-900">{trafficResult.totals.position.toFixed(1)}</div>
                  </div>
                </div>

                {trafficResult.ga4 && (
                  <div className="mb-5 grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-1 text-[11px] uppercase text-gray-500">Sessions (GA4)</div>
                      <div className="text-lg font-semibold text-gray-900">{trafficResult.ga4.sessions.toLocaleString()}</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-1 text-[11px] uppercase text-gray-500">Users</div>
                      <div className="text-lg font-semibold text-gray-900">{trafficResult.ga4.activeUsers.toLocaleString()}</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-1 text-[11px] uppercase text-gray-500">Pageviews</div>
                      <div className="text-lg font-semibold text-gray-900">{trafficResult.ga4.screenPageViews.toLocaleString()}</div>
                    </div>
                  </div>
                )}
                {trafficResult.ga4Error && (
                  <div className="mb-5 text-[11px] text-amber-600">⚠ Google Analytics: {trafficResult.ga4Error}</div>
                )}

                {project && <SearchOverviewPanel projectId={project.id} />}

                <SearchInsightsSection search={trafficResult.search ?? null} topQueries={trafficResult.topQueries} />

                <h4 className="mb-2 text-[12px] font-semibold text-gray-700">Top Queries</h4>
                <div className="mt-6">
                  <h4 className="mb-0.5 text-[12px] font-semibold text-gray-700">Search Opportunities</h4>
                  <p className="mb-2 text-[11px] text-gray-500">
                    Queries ranking 4–15 with at least 100 impressions. Score is a prioritization heuristic, not a click forecast.
                  </p>
                  {trafficResult.opportunities.length === 0 ? (
                    <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500">
                      No search opportunities matched the current criteria.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      <div className="grid grid-cols-[1fr_48px_64px_52px_68px] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
                        <span>Query</span><span className="text-right">Pos.</span><span className="text-right">Impr.</span><span className="text-right">CTR</span><span className="text-right">Score</span>
                      </div>
                      {trafficResult.opportunities.map((q, i) => {
                        const rankingPage = q.rankingPages[0];
                        const evidence = rankingPage ? pageEvidence[rankingPage.url] : undefined;
                        const evidenceData = evidence && !("error" in evidence) ? evidence : null;
                        const evidenceError = evidence && "error" in evidence && evidence.error ? evidence.error : null;

                        return (
                          <div key={i} className="border-t border-gray-100 px-3 py-2.5 first:border-t-0">
                            <div className="grid grid-cols-[1fr_48px_64px_52px_68px] gap-2 text-[13px]">
                              <div className="min-w-0">
                                <div className="truncate text-gray-800" title={q.query}>{q.query}</div>
                                {rankingPage ? (
                                  <a
                                    href={rankingPage.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[11px] text-gray-400 hover:text-gray-600 hover:underline"
                                    title={rankingPage.url}
                                  >
                                    <ExternalLink size={9} className="shrink-0" />
                                    <span className="truncate">{rankingPage.url}</span>
                                    {q.rankingPages.length > 1 && <span className="shrink-0">+{q.rankingPages.length - 1}</span>}
                                  </a>
                                ) : (
                                  <span className="mt-0.5 block text-[11px] text-gray-400">No ranking page data</span>
                                )}
                              </div>
                              <span className="text-right text-gray-500">{q.position.toFixed(1)}</span>
                              <span className="text-right text-gray-700">{q.impressions.toLocaleString()}</span>
                              <span className="text-right text-gray-500">{(q.ctr * 100).toFixed(1)}%</span>
                              <span className="text-right font-medium text-gray-900">{q.score.toFixed(0)}</span>
                            </div>

                            {rankingPage && (
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  onClick={() => handleInspectRankingPage(rankingPage.url)}
                                  disabled={!!evidenceData || (!!evidence && !evidenceError)}
                                  className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                                >
                                  {evidence && !evidenceData && !evidenceError ? (
                                    <Loader2 size={11} className="inline animate-spin" />
                                  ) : evidenceData ? "Inspected" : "Inspect page"}
                                </button>
                                {evidenceError && <span className="truncate text-[11px] text-amber-600">{evidenceError}</span>}
                              </div>
                            )}

                            {evidenceData && (
                              <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-600">
                                <div>
                                  <span className="text-gray-400">Title</span>
                                  <div className="truncate font-medium text-gray-800" title={evidenceData.meta.title}>
                                    {evidenceData.meta.title || "Missing"}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-gray-400">H1</span>
                                  <div className="font-medium text-gray-800">{evidenceData.headings.h1}</div>
                                </div>
                                <div>
                                  <span className="text-gray-400">Canonical</span>
                                  <div className="truncate font-medium text-gray-800" title={evidenceData.meta.canonical}>
                                    {evidenceData.meta.canonical || "Missing"}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-gray-400">Indexability</span>
                                  <div className="font-medium text-gray-800">
                                    {evidenceData.meta.indexable ? "Indexable" : "Noindex"}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-gray-400">Content relevance</span>
                                  <div className="font-medium text-gray-800">{evidenceData.contentRelevance.keywordRelevance}%</div>
                                </div>
                                <div>
                                  <span className="text-gray-400">Internal links</span>
                                  <div className="font-medium text-gray-800">{evidenceData.links.internal}</div>
                                </div>
                                <div>
                                  <span className="text-gray-400">TTFB</span>
                                  <div className="font-medium text-gray-800">
                                    {typeof evidenceData.serverTiming.ttfbMs === "number" ? `${Math.round(evidenceData.serverTiming.ttfbMs)} ms` : "Unavailable"}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-gray-400">HTTP</span>
                                  <div className="font-medium text-gray-800">{evidenceData.technical.status}</div>
                                </div>
                                <div>
                                  <span className="text-gray-400">PageSpeed</span>
                                  <div className="font-medium text-gray-800">
                                    {evidenceData.pageSpeed ? `${evidenceData.pageSpeed.desktop.performance} desktop` : "Not connected"}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {trafficResult.topQueries.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500">No query data for this range yet.</div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-gray-200">
                    <div className="grid grid-cols-[1fr_60px_60px_50px] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
                      <span>Query</span>
                      <span className="text-right">Clicks</span>
                      <span className="text-right">CTR</span>
                      <span className="text-right">Pos.</span>
                    </div>
                    {trafficResult.topQueries.map((q, i) => (
                      <div key={i} className="grid grid-cols-[1fr_60px_60px_50px] gap-2 border-t border-gray-100 px-3 py-2 text-[13px] first:border-t-0">
                        <span className="truncate text-gray-800">{q.query}</span>
                        <span className="text-right font-medium text-gray-900">{q.clicks}</span>
                        <span className="text-right text-gray-500">{(q.ctr * 100).toFixed(1)}%</span>
                        <span className="text-right text-gray-500">{q.position.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4" aria-busy="true">
                <SkeletonStats count={3} />
                <SkeletonCard rows={4} />
              </div>
            )}
          </Section>
        ) : !auditData ? (
          <>
          {tab === "SEO" && (
            <>
              <GoogleSourcesCard onReadyChange={setGoogleReady} />
              {googleReady && (
                <GoogleSummary
                  totals={trafficResult?.totals ?? null}
                  ga4={trafficResult?.ga4 ?? null}
                  loading={trafficLoading}
                  error={trafficError}
                  onViewTraffic={() => setTab("Traffic")}
                  onRetry={retryTraffic}
                />
              )}
            </>
          )}
          {auditLoading && !loading ? (
            <div className="space-y-4 py-2" aria-busy="true">
              <SkeletonCard rows={3} />
              <SkeletonLines rows={5} />
            </div>
          ) : (
          <div className={`flex flex-col items-center justify-center text-center text-gray-500 ${tab === "SEO" ? "py-10" : "h-full"}`}>
             {loading ? <Loader2 className="animate-spin text-gray-400 mb-2" size={24} /> : <Search className="text-gray-300 mb-2" size={24} />}
             <p className="text-sm">
               {loading
                 ? "Auditing your website..."
                 : project?.url
                   ? "No audit yet — click refresh above to run one."
                   : "Add a website in the project switcher at the top to see insights."}
             </p>
          </div>
          )}
          </>
        ) : (
          <>
            {tab === "SEO" && (
              <>
                <GoogleSourcesCard onReadyChange={setGoogleReady} />
                {googleReady && (
                  <GoogleSummary
                    totals={trafficResult?.totals ?? null}
                    ga4={trafficResult?.ga4 ?? null}
                    loading={trafficLoading}
                    error={trafficError}
                    onViewTraffic={() => setTab("Traffic")}
                    onRetry={retryTraffic}
                  />
                )}

                {!auditData.pageSpeed && (
                  <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      No PageSpeed API key connected, so Performance/Accessibility/Best Practices/SEO scores and
                      Core Web Vitals aren&apos;t available — below is real data from our own crawl instead, not a
                      substitute score. Connect a key in{" "}
                      <span className="font-medium">Settings → API Credentials</span> for real
                      Lighthouse scores.
                    </span>
                  </div>
                )}

                <Section
                  title="Audit overview"
                  subtitle="A simple view of what the audit found and where to start."
                >
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setTab("Findings")} className="rounded-xl border border-gray-200 bg-white p-3 text-left hover:bg-gray-50">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">Findings</div>
                      <div className="mt-1 text-lg font-semibold text-gray-900">{auditData.findings?.length ?? 0}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">Needs review</div>
                    </button>
                    <button onClick={() => setTab("Findings")} className="rounded-xl border border-gray-200 bg-white p-3 text-left hover:bg-gray-50">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">Lighthouse</div>
                      <div className="mt-1 text-lg font-semibold text-gray-900">{auditData.lighthouseIssues ? auditData.lighthouseIssues.desktop.length + auditData.lighthouseIssues.mobile.length : 0}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">Measured issues</div>
                    </button>
                    <button onClick={() => setTab("Findings")} className="rounded-xl border border-gray-200 bg-white p-3 text-left hover:bg-gray-50">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">Audit issues</div>
                      <div className="mt-1 text-lg font-semibold text-gray-900">{auditData.issues.length}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">Detected on page</div>
                    </button>
                  </div>
                  {(auditData.findings?.length ?? 0) > 0 && (
                    <button onClick={() => setTab("Findings")} className="mt-3 flex w-full items-center justify-between rounded-xl bg-[#111111] px-3 py-2.5 text-[12px] font-medium text-white hover:bg-black">
                      <span>See findings and recommended next steps</span>
                      <ChevronRight size={14} />
                    </button>
                  )}
                </Section>

                <Section title="PageSpeed Scores">
                  {auditData.pageSpeed ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-2 text-[11px] font-semibold tracking-wide text-gray-500">DESKTOP</div>
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        <ScoreCircle value={auditData.pageSpeed.desktop.performance} label="Performance" />
                        <ScoreCircle value={auditData.pageSpeed.desktop.accessibility} label="Accessibility" />
                        <ScoreCircle value={auditData.pageSpeed.desktop.bestPractices} label="Best Practices" />
                        <ScoreCircle value={auditData.pageSpeed.desktop.seo} label="SEO" />
                      </div>
                      <div className="mb-2 text-[11px] font-semibold tracking-wide text-gray-500">MOBILE</div>
                      <div className="grid grid-cols-4 gap-2">
                        <ScoreCircle value={auditData.pageSpeed.mobile.performance} label="Performance" />
                        <ScoreCircle value={auditData.pageSpeed.mobile.accessibility} label="Accessibility" />
                        <ScoreCircle value={auditData.pageSpeed.mobile.bestPractices} label="Best Practices" />
                        <ScoreCircle value={auditData.pageSpeed.mobile.seo} label="SEO" />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 flex items-center gap-4">
                        <ScoreCircle value={auditData.technical.onPageScore} label="On-Page" size={56} />
                        <p className="text-[12px] text-gray-500">
                          Real on-page checks passed, from our own crawl — not a Lighthouse Performance score.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="mb-1 text-[11px] uppercase text-gray-500">Page Size</div>
                          <div className="text-lg font-semibold text-gray-900">{(auditData.technical.pageSizeBytes / 1024).toFixed(1)} KB</div>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="mb-1 text-[11px] uppercase text-gray-500">DOM Size</div>
                          <div className="text-lg font-semibold text-gray-900">{auditData.technical.domSize} elements</div>
                        </div>
                      </div>
                    </div>
                  )}
                </Section>

                {auditData.lighthouseIssues && (
                  <Section title="Lighthouse Diagnostics" subtitle="Real Lighthouse audits behind the scores — not just the four category numbers">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 flex rounded-lg bg-gray-200/70 p-1 text-[13px]">
                        <button
                          onClick={() => setDevice("desktop")}
                          className={`flex-1 rounded-md py-1.5 font-medium ${device === "desktop" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                        >
                          Desktop
                        </button>
                        <button
                          onClick={() => setDevice("mobile")}
                          className={`flex-1 rounded-md py-1.5 font-medium ${device === "mobile" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                        >
                          Mobile
                        </button>
                      </div>
                      {auditData.lighthouseIssues[device].length === 0 ? (
                        <div className="text-[12px] text-emerald-700">No Lighthouse audits below the 90% threshold.</div>
                      ) : (
                        <div className="space-y-2">
                          {auditData.lighthouseIssues[device].map((issue) => (
                            <div key={issue.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-2.5">
                              <div className="min-w-0">
                                <div className="text-[12px] font-medium text-gray-800">{issue.title}</div>
                                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{issue.mode}</div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[12px] font-semibold text-gray-900">{issue.score === null ? "N/A" : `${Math.round(issue.score * 100)}`}</div>
                                {issue.displayValue && <div className="text-[10px] text-gray-500">{issue.displayValue}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                <Section title="Core Web Vitals">
                  {auditData.coreWebVitals ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 flex rounded-lg bg-gray-200/70 p-1 text-[13px]">
                        <button
                          onClick={() => setDevice("desktop")}
                          className={`flex-1 rounded-md py-1.5 font-medium ${device === "desktop" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                        >
                          Desktop
                        </button>
                        <button
                          onClick={() => setDevice("mobile")}
                          className={`flex-1 rounded-md py-1.5 font-medium ${device === "mobile" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                        >
                          Mobile
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {Object.entries(auditData.coreWebVitals[device]).map(([key, v]) => (
                          <div key={key} className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase text-gray-500">
                              <StatusDot status={v.status} /> {key}
                            </div>
                            <div className={`text-lg font-semibold ${v.status === "Pass" ? "text-[#00ab92]" : v.status === "Warn" ? "text-amber-600" : "text-red-600"}`}>
                              {v.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <p className="mb-3 text-[12px] text-gray-500">
                        Not LCP/FCP/CLS (that needs a real browser render) — real connection-phase timing from our
                        own crawl instead.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          ["TTFB", auditData.serverTiming.ttfbMs],
                          ["Download", auditData.serverTiming.downloadMs],
                          ["Connection", auditData.serverTiming.connectMs],
                          ["TLS Handshake", auditData.serverTiming.tlsHandshakeMs],
                        ].map(([label, ms]) => (
                          <div key={label as string} className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-1 text-[11px] uppercase text-gray-500">{label}</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {typeof ms === "number" ? `${Math.round(ms)}ms` : "N/A"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>

                <Section
                  title="Audit issues"
                  subtitle="Every issue below is based on data collected during this audit. Open Findings for the explanation and recommended next steps."
                >
                  <div className="overflow-hidden rounded-xl border border-gray-200">
                    {auditData.issues.length === 0 ? (
                      <div className="p-3 text-sm text-emerald-700">No on-page issues detected.</div>
                    ) : (
                      auditData.issues.map((issue, i) => (
                        <div key={i} className="flex items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                          <span className={issue.level === "Error" ? "text-red-500" : "text-amber-500"}>⚠</span>
                          <span className="text-gray-700">{issue.label}</span>
                        </div>
                      ))
                    )}
                  </div>
                </Section>
              </>
            )}

            {tab === "Links" && (
              <Section
                title="Links"
                subtitle={`${auditData.links.length} link${auditData.links.length === 1 ? "" : "s"} found on this page${auditData.links.length >= 50 ? " (capped at 50)" : ""}`}
              >
                {auditData.links.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500">
                    No links found on this page.
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleCheckLinks}
                      disabled={linksChecking}
                      className="mb-3 flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-60"
                    >
                      {linksChecking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      {linksChecking ? "Checking..." : linksResult ? "Re-check reachability" : "Check reachability"}
                    </button>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {auditData.links.map((link, i) => {
                        const checked = linksResult?.links.find((l) => l.href === link.href);
                        return (
                          <div key={i} className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${link.internal ? "bg-gray-100 text-gray-600" : "bg-blue-50 text-blue-600"}`}>
                                  {link.internal ? "Internal" : "External"}
                                </span>
                                <a href={link.href} target="_blank" rel="noreferrer" className="truncate text-gray-800 hover:underline">
                                  {link.text || link.href}
                                </a>
                              </div>
                              <div className="truncate text-[11px] text-gray-400">{link.href}</div>
                            </div>
                            {checked && (
                              <span className={`shrink-0 flex items-center gap-1 text-[11px] font-medium ${checked.reachable ? "text-[#00ab92]" : "text-red-600"}`}>
                                {checked.reachable ? <Check size={11} /> : "⚠"}
                                {checked.status ?? (checked.reachable ? "OK" : "Failed")}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </Section>
            )}

            {tab === "Links" && (
              <Section
                title="Site Pages"
                subtitle="Crawls beyond the homepage — real content per page, with a JS-render fallback for pages that come back empty (client-rendered apps)"
              >
                <button
                  onClick={handleCrawlSite}
                  disabled={siteCrawling || auditData.links.filter((l) => l.internal).length === 0}
                  className="mb-3 flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-60"
                >
                  {siteCrawling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {siteCrawling ? "Crawling..." : siteCrawlResult ? "Re-crawl site" : "Crawl full site"}
                </button>

                {!siteCrawlResult ? (
                  auditData.links.filter((l) => l.internal).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-4 text-[13px] text-gray-500">
                      No internal links discovered yet to crawl from.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 p-4 text-[13px] text-gray-500">
                      Follows the internal links found above, fetching each page&apos;s real content — no key required.
                    </div>
                  )
                ) : siteCrawlResult.pages.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500">No pages could be crawled.</div>
                ) : (
                  <>
                    <button
                      onClick={handleRunPageSpeedForCrawledPages}
                      disabled={pageSpeedRunning}
                      className="mb-3 flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {pageSpeedRunning ? <Loader2 size={12} className="animate-spin" /> : <BarChart2 size={12} />}
                      {pageSpeedRunning ? "Running PageSpeed..." : "Run PageSpeed for crawled pages"}
                    </button>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {siteCrawlResult.pages.map((page, i) => (
                        <div key={i} className="border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                          <div className="flex items-center gap-1.5">
                            <a href={page.url} target="_blank" rel="noreferrer" className="truncate font-medium text-gray-800 hover:underline">
                              {page.title || page.url}
                            </a>
                            {page.source === "jina-fallback" && (
                              <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                JS-rendered
                              </span>
                            )}
                            {page.duplicateOfUrl && (
                              <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                                Duplicate content
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-gray-400">{page.url}</div>
                          {page.duplicateOfUrl && (
                            <div className="truncate text-[11px] text-red-600">
                              Near-duplicate of{" "}
                              <a href={page.duplicateOfUrl} target="_blank" rel="noreferrer" className="hover:underline">
                                {page.duplicateOfUrl}
                              </a>
                            </div>
                          )}
                          <p className="mt-1 line-clamp-2 text-[12px] text-gray-500">{page.content.slice(0, 200)}</p>
                          {page.pageSpeed && (
                            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                              {(["performance", "accessibility", "bestPractices", "seo"] as const).map((k) => (
                                <span key={k} className="text-gray-600">
                                  <span className="font-semibold text-gray-900">{page.pageSpeed!.desktop[k]}</span>{" "}
                                  {k === "bestPractices" ? "Best Practices" : k[0].toUpperCase() + k.slice(1)}
                                </span>
                              ))}
                            </div>
                          )}
                          {page.pageSpeedError && (
                            <div className="mt-1 text-[11px] text-amber-600">⚠ PageSpeed: {page.pageSpeedError}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Section>
            )}

            {tab === "Technical" && (
              <>
                <Section title="On-Page Overview" subtitle="Server configuration and page characteristics">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-4 flex items-center gap-4">
                      <ScoreCircle value={auditData.technical.onPageScore} label="On-Page" size={64} />
                      <p className="text-[12px] text-gray-500">
                        Real checks passed — meta length, single H1, OG/Twitter tags, cacheable response. Not a
                        Lighthouse score.
                      </p>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                      {[
                        ["Server", auditData.technical.server ?? "Not disclosed"],
                        ["Status", String(auditData.technical.status)],
                        ["Encoding", auditData.technical.encoding ?? "None"],
                        ["Page Size", `${(auditData.technical.pageSizeBytes / 1024).toFixed(1)} KB`],
                        ["DOM Size", `${auditData.technical.domSize} elements`],
                        ["Cacheable", auditData.technical.cacheable ? "Yes" : "No"],
                        ["Redirects", auditData.technical.redirectCount === 0 ? "None" : `${auditData.technical.redirectCount} hop${auditData.technical.redirectCount === 1 ? "" : "s"}`],
                        [
                          "robots.txt",
                          !auditData.technical.robotsTxt.exists
                            ? "Not found"
                            : auditData.technical.robotsTxt.disallowsThisPage
                              ? "Disallows this page"
                              : "Allows this page",
                        ],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                          <span className="font-medium text-gray-500">{label}</span>
                          <span className="font-medium text-gray-800">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section title="Server Timing" subtitle="Real connection-phase timing from this crawl, not Lighthouse">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ["Connection", auditData.serverTiming.connectMs],
                      ["TLS Handshake", auditData.serverTiming.tlsHandshakeMs],
                      ["TTFB", auditData.serverTiming.ttfbMs],
                      ["Download", auditData.serverTiming.downloadMs],
                    ].map(([label, ms]) => (
                      <div key={label as string} className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="mb-1 text-[11px] uppercase text-gray-500">{label}</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {typeof ms === "number" ? `${Math.round(ms)}ms` : "N/A"}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Render Blocking" subtitle="Scripts and stylesheets blocking page render">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-1 text-[11px] uppercase text-gray-500">Blocking Scripts</div>
                      <div className="text-lg font-semibold text-gray-900">{auditData.renderBlocking.blockingScripts}</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-1 text-[11px] uppercase text-gray-500">Blocking Stylesheets</div>
                      <div className="text-lg font-semibold text-gray-900">{auditData.renderBlocking.blockingStylesheets}</div>
                    </div>
                  </div>
                </Section>

                <Section title="Content Relevance" subtitle="How well your metadata matches page content">
                  <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    {[
                      ["Title Relevance", auditData.contentRelevance.titleRelevance],
                      ["Description Relevance", auditData.contentRelevance.descriptionRelevance],
                      ["Keyword Relevance", auditData.contentRelevance.keywordRelevance],
                    ].map(([label, pct]) => (
                      <div key={label as string}>
                        <div className="mb-1 flex items-center justify-between text-[13px]">
                          <span className="text-gray-700">{label}</span>
                          <span className="font-medium text-gray-900">{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                          <div className="h-full rounded-full bg-[#00ab92]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Distribution of heading tags across the page">
                  <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    {Object.entries(auditData.headings).map(([tag, count]) => (
                      <div key={tag} className="flex justify-between text-sm">
                        <span className="uppercase text-gray-500 font-medium">{tag}</span>
                        <span>{count}</span>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Social Media Tags" subtitle="Open Graph and Twitter card metadata">
                  <div className="mb-3">
                    <h4 className="mb-2 text-[12px] font-semibold text-gray-700">Open Graph</h4>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {auditData.openGraph.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500">No Open Graph tags detected on this page.</div>
                      ) : (
                        auditData.openGraph.map((tag, i) => (
                          <div key={i} className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                            <span className="flex items-center gap-2 text-[#00ab92]">✓ {tag.key}</span>
                            <span className="max-w-[55%] truncate text-gray-500">{tag.value}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-[12px] font-semibold text-gray-700">Twitter</h4>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {auditData.twitter.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500">No Twitter card tags detected on this page.</div>
                      ) : (
                        auditData.twitter.map((tag, i) => (
                          <div key={i} className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                            <span className="flex items-center gap-2 text-[#00ab92]">✓ {tag.key}</span>
                            <span className="max-w-[55%] truncate text-gray-500">{tag.value}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </Section>
              </>
            )}

            {tab === "GEO" && (
              <>
              <GeoVisibility />
              <Section
                title="Quick citation check (search results only)"
                subtitle="Real search-grounded check for whether your site is surfaced when people search around your product"
              >
                <button
                  onClick={handleRunGeoCheck}
                  disabled={geoChecking}
                  className="mb-3 flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-60"
                >
                  {geoChecking ? <Loader2 size={12} className="animate-spin" /> : <Globe2 size={12} />}
                  {geoChecking ? "Checking..." : geoResult ? "Re-check" : "Run GEO Check"}
                </button>

                {!geoResult ? (
                  <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-[13px] text-gray-500">
                    <Globe2 className="mx-auto mb-2 text-gray-300" size={28} />
                    Searches the live web for real queries around your product and checks whether your own
                    domain actually shows up — a real citation gap, not a guess.
                    {FEATURES.PLATFORM_MODE ? (
                      " Included in your plan — just click Run GEO Check."
                    ) : (
                      <>
                        {" "}Requires a Tavily API key.
                        <div className="mt-3">
                          <a
                            href="/settings/api-credentials"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
                          >
                            Connect Tavily API key
                          </a>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-gray-200">
                    <div className="border-b border-gray-100 bg-gray-50 px-3 py-2.5 text-[12px] leading-5 text-gray-600">
                      <span className="font-semibold text-gray-800">
                        {geoResult.rows.filter((r) => r.found).length} of {geoResult.rows.length} searches find you.
                      </span>{" "}
                      Each row below is a real search phrase someone around your product might type. &ldquo;Cited&rdquo;
                      means your site showed up in the results for it — &ldquo;Gap&rdquo; means it didn&apos;t, which is a
                      real opportunity to create content that answers that search.
                    </div>
                    {geoResult.rows.map((row, i) => (
                      <div key={i} className="flex items-start justify-between gap-2 border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                        <div className="min-w-0">
                          <div className="text-gray-700">&ldquo;{row.query}&rdquo;</div>
                          {!row.found && (
                            <div className="mt-0.5 text-[11px] text-gray-400">
                              Not showing up for this search — consider writing a page that targets it.
                            </div>
                          )}
                        </div>
                        {row.found ? (
                          <a
                            href={row.matchedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#00ab92] hover:underline"
                          >
                            <Check size={12} /> Cited <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-amber-600">⚠ Gap</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
