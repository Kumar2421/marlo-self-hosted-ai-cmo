import * as cheerio from "cheerio";
import { jinaRead } from "../shared/jinaReader.ts";
import type { PageSpeedResult } from "@/lib/domain/seo/pageSpeedInsights";
import { timedCall } from "../findings/timedAudit.ts";
import { assertPublicHostLiteral, type LookupFn } from "../net/ssrf.ts";
import { SafeFetchError, safeFetch, type TransportRequest } from "../net/safeFetch.ts";

export type CrawledPage = {
  url: string;
  title: string;
  content: string;
  source: "crawl" | "jina-fallback";
  /** Filled in only by the separate, explicit "Run PageSpeed" action (see
   * /api/agents/site-crawl/pagespeed) — real Lighthouse data per page, not
   * run automatically for every crawled page (PSI has real rate limits and
   * each call takes 10-20s). Absent until that action runs. */
  pageSpeed?: PageSpeedResult["pageSpeed"];
  pageSpeedError?: string;
  /** Real cross-page similarity check (see markDuplicateContent) — set to
   * the URL of the earlier-crawled page this one is a near-duplicate of. */
  duplicateOfUrl?: string;
};

const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Real cross-page duplicate-content check over pages already crawled — no
 * extra fetches. Word-set Jaccard similarity, not exact string match, so
 * boilerplate-with-minor-differences still counts (that's the real-world
 * duplicate-content problem, not byte-identical pages). Each page only ever
 * points at the FIRST earlier page it matches, so a family of duplicates
 * doesn't produce a many-to-many mess. */
function markDuplicateContent(pages: CrawledPage[]): CrawledPage[] {
  const sets = pages.map((p) => wordSet(p.content));
  return pages.map((page, i) => {
    for (let j = 0; j < i; j++) {
      if (jaccardSimilarity(sets[i], sets[j]) >= DUPLICATE_SIMILARITY_THRESHOLD) {
        return { ...page, duplicateOfUrl: pages[j].url };
      }
    }
    return page;
  });
}

const MIN_CONTENT_LENGTH = 200;
const PAGE_TIMEOUT_MS = 8000;
const MAX_PAGES = 8;
/** Total wall-clock budget for one crawl. The route allows 60 s; this leaves room for the DB write. */
export const CRAWL_BUDGET_MS = 40_000;
/** A page fetch only starts when at least this much of the budget is left. */
const MIN_PAGE_BUDGET_MS = 1_000;
/** A Jina render only starts with this much left (it is the slow, flaky path). */
const MIN_JINA_BUDGET_MS = 5_000;
const JINA_CALL_TIMEOUT_MS = 35_000;
const SKIP_PATH_PATTERNS = [/\/(login|signup|sign-in|sign-up|logout)\/?($|[?#])/i];
const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];
const TRACKING_PARAMS = /^(utm_.*|gclid|fbclid)$/i;

/**
 * Canonical form of a crawl candidate: no fragment, no tracking params (utm_*, gclid, fbclid), params in
 * a stable order, lowercase host, default port dropped, no trailing slash (the root included). Returns
 * null for anything that is not an http(s) URL. "www." is kept here (the site may only answer on it); use
 * crawlDedupeKey to compare.
 */
export function normalizeCrawlUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  const path = u.pathname.replace(/\/+$/, "");
  // URL already lowercases the host and drops the scheme's default port.
  return `${u.protocol}//${u.host}${path}${u.search}`;
}

/** Key for "is this the same page": the normalised URL with "www." treated as the same site. */
export function crawlDedupeKey(raw: string): string | null {
  const normalized = normalizeCrawlUrl(raw);
  return normalized === null ? null : normalized.replace(/^(https?:\/\/)www\./i, "$1");
}

export type CrawlReasonStatus = "blocked" | "non-html" | "failed" | "timeout" | "budget";
export type CrawlReason = { url: string; status: CrawlReasonStatus; detail?: string };

export type CrawlSummary = {
  /** Distinct pages attempted: unique candidates after normalisation, up to MAX_PAGES. */
  requested: number;
  crawled: number;
  /** More distinct candidates were offered than MAX_PAGES allows. */
  capped: boolean;
  skipped: { blocked: number; nonHtml: number; failed: number; budget: number };
  /** The time budget stopped the crawl before every candidate was handled. */
  partial: boolean;
  /** One entry per page that did not make it into `pages`. */
  reasons?: CrawlReason[];
};

export type CrawlResult = { pages: CrawledPage[]; summary: CrawlSummary };

export type FetchPageOutcome =
  | { kind: "ok"; title: string; content: string }
  | { kind: "non-html" }
  | { kind: "timeout" }
  | { kind: "failed"; detail: string };

export type CrawlPorts = {
  /** Cheap plain fetch. Resolves, never rejects (a throw is treated as a failed page). */
  fetchPage: (url: string, o: { timeoutMs: number }) => Promise<FetchPageOutcome>;
  /** Headless render fallback. */
  jina: (url: string, o: { timeoutMs: number }) => Promise<{ title: string; content: string } | null>;
  /** Optional robots check; the default allows everything. */
  robots?: (url: string) => Promise<"allowed" | "blocked">;
};

export type CrawlOptions = Partial<CrawlPorts> & {
  /** Total budget for the whole crawl. Default 40 s. */
  budgetMs?: number;
  /** Cap for one page fetch (also bounded by what is left of the budget). Default 8 s. */
  perPageTimeoutMs?: number;
  /** Millisecond clock. Injected in tests. */
  now?: () => number;
  minPageBudgetMs?: number;
  minJinaBudgetMs?: number;
  /** Only used by the default fetchPage: DNS resolver and transport (tests). */
  lookup?: LookupFn;
  transport?: TransportRequest;
};

function defaultFetchPage(net: { lookup?: LookupFn; transport?: TransportRequest }): CrawlPorts["fetchPage"] {
  return async (url, { timeoutMs }) => {
    try {
      // Pages are linked from the audited site, so they are untrusted targets: guarded fetch.
      const res = await safeFetch(url, {
        timeoutMs,
        headers: { "User-Agent": "OkaraAlternative/1.0" },
        allowedContentTypes: HTML_CONTENT_TYPES,
        lookup: net.lookup,
        transport: net.transport,
      });
      if (res.status < 200 || res.status >= 300) return { kind: "failed", detail: `HTTP ${res.status}` };
      const $ = cheerio.load(res.bodyText);
      $("script, style, noscript").remove();
      const content = $("body").text().replace(/\s+/g, " ").trim();
      return { kind: "ok", title: $("title").text() || "", content };
    } catch (e) {
      if (e instanceof SafeFetchError) {
        if (e.code === "content-type") return { kind: "non-html" };
        if (e.code === "network:timeout") return { kind: "timeout" };
        return { kind: "failed", detail: e.message };
      }
      return { kind: "failed", detail: "The page could not be read." };
    }
  };
}

/**
 * Real multi-page site crawl, seeded from real internal links already
 * discovered on the main SEO audit (plain-crawl <a> tags, or Jina-extracted
 * markdown links when that page needed the SPA fallback — see SEOAgent.ts).
 * Each candidate page is fetched cheaply first; only falls back to Jina's
 * real headless render if that page's plain fetch also comes back too thin
 * — same reasoning as the single-page fallback, applied per page, so a
 * normal server-rendered site stays fast and a client-rendered one still
 * gets real content instead of an empty shell.
 *
 * Tavily's /crawl and /extract endpoints were tried first (same Tavily key
 * already wired into this app) and confirmed NOT to work on a real
 * client-rendered SPA test site — /crawl found 0 pages (nothing to follow
 * in the raw HTML) and /extract returned "Failed to fetch url" for known
 * real pages. Jina is what actually renders JS, so that's what this uses.
 *
 * The whole crawl runs inside one time budget. No call starts without the
 * time for it, an in-flight call is abandoned at the deadline, and the
 * function never rejects: when time runs out it returns what it has, with
 * summary.partial set. A page whose plain fetch failed (non-2xx, timeout,
 * blocked address) is reported in summary.reasons and is NOT sent to Jina;
 * only a successful but thin page is.
 */
export async function crawlSitePages(seedLinks: { href: string }[], opts: CrawlOptions = {}): Promise<CrawlResult> {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? CRAWL_BUDGET_MS;
  const perPageMs = opts.perPageTimeoutMs ?? PAGE_TIMEOUT_MS;
  const minPageMs = opts.minPageBudgetMs ?? MIN_PAGE_BUDGET_MS;
  const minJinaMs = opts.minJinaBudgetMs ?? MIN_JINA_BUDGET_MS;
  const fetchPage = opts.fetchPage ?? defaultFetchPage({ lookup: opts.lookup, transport: opts.transport });
  const jina = opts.jina ?? (async (url, { timeoutMs }) => jinaRead(url, opts.lookup, { timeoutMs }));
  const robots = opts.robots;
  const startedAt = now();
  const remaining = () => budgetMs - (now() - startedAt);

  const seen = new Set<string>();
  const candidates: string[] = [];
  let capped = false;
  for (const link of seedLinks) {
    const url = normalizeCrawlUrl(link.href);
    const key = crawlDedupeKey(link.href);
    if (url === null || key === null || seen.has(key) || SKIP_PATH_PATTERNS.some((p) => p.test(url))) continue;
    seen.add(key);
    if (candidates.length >= MAX_PAGES) {
      capped = true;
      break;
    }
    candidates.push(url);
  }

  const pages: CrawledPage[] = [];
  const reasons: CrawlReason[] = [];
  const skipped = { blocked: 0, nonHtml: 0, failed: 0, budget: 0 };
  const skip = (url: string, status: CrawlReasonStatus, detail?: string) => {
    reasons.push(detail === undefined ? { url, status } : { url, status, detail });
    if (status === "blocked") skipped.blocked++;
    else if (status === "non-html") skipped.nonHtml++;
    else if (status === "budget") skipped.budget++;
    else skipped.failed++;
  };

  for (const url of candidates) {
    if (remaining() < minPageMs) {
      skip(url, "budget");
      continue;
    }
    try {
      assertPublicHostLiteral(new URL(url).hostname);
    } catch {
      skip(url, "failed", "That address can't be used.");
      continue;
    }

    if (robots) {
      const verdict = await timedCall(() => robots(url), Math.min(perPageMs, remaining()));
      if (verdict.ok && verdict.value === "blocked") {
        skip(url, "blocked");
        continue;
      }
    }

    const pageLimit = Math.min(perPageMs, remaining());
    if (pageLimit < minPageMs) {
      skip(url, "budget");
      continue;
    }
    const fetched = await timedCall(() => fetchPage(url, { timeoutMs: pageLimit }), pageLimit);
    const outcome: FetchPageOutcome = fetched.ok
      ? fetched.value
      : fetched.reason === "timeout"
        ? { kind: "timeout" }
        : { kind: "failed", detail: "The page could not be read." };

    if (outcome.kind === "timeout") {
      // A call cut short by the remaining budget (not just a slow page) counts against the budget.
      if (pageLimit < perPageMs) skip(url, "budget", "Abandoned at the time limit.");
      else skip(url, "timeout", "The page took too long to answer.");
      continue;
    }
    if (outcome.kind === "non-html") {
      skip(url, "non-html");
      continue;
    }
    if (outcome.kind === "failed") {
      skip(url, "failed", outcome.detail);
      continue;
    }
    if (outcome.content.length >= MIN_CONTENT_LENGTH) {
      pages.push({ url, title: outcome.title, content: outcome.content.slice(0, 3000), source: "crawl" });
      continue;
    }

    // Jina's free-tier render is genuinely flaky on heavy SPAs — confirmed
    // for real: the same page succeeded on one run and returned empty on the
    // next, with no error, no pattern. One retry meaningfully improves yield
    // without much extra cost; still an honest partial result if both fail,
    // not a fabricated one. Each attempt needs its own time in the budget.
    let rendered: { title: string; content: string } | null = null;
    let jinaTimedOut = false;
    let jinaBudgetHit = false;
    for (let attempt = 0; attempt < 2 && !(rendered && rendered.content.trim().length > 0); attempt++) {
      const left = remaining();
      if (left < minJinaMs) {
        jinaBudgetHit = true;
        break;
      }
      const limit = Math.min(JINA_CALL_TIMEOUT_MS, left);
      const result = await timedCall(() => jina(url, { timeoutMs: limit }), limit);
      if (result.ok) rendered = result.value;
      else if (result.reason === "timeout") {
        if (limit < JINA_CALL_TIMEOUT_MS) jinaBudgetHit = true;
        else jinaTimedOut = true;
        break;
      }
    }
    if (rendered && rendered.content.trim().length > 0) {
      pages.push({ url, title: rendered.title, content: rendered.content.slice(0, 3000), source: "jina-fallback" });
    } else if (jinaBudgetHit) {
      skip(url, "budget", "Too little time left to render this page.");
    } else if (jinaTimedOut) {
      skip(url, "timeout", "The render took too long.");
    } else {
      skip(url, "failed", "The page had too little readable content.");
    }
  }

  const summary: CrawlSummary = {
    requested: candidates.length,
    crawled: pages.length,
    capped,
    skipped,
    partial: skipped.budget > 0,
  };
  if (reasons.length > 0) summary.reasons = reasons;
  return { pages: markDuplicateContent(pages), summary };
}
