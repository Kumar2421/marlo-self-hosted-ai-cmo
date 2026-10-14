import * as cheerio from "cheerio";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { jinaRead } from "@/lib/domain/shared/jinaReader";
import type { PageSpeedResult } from "@/lib/domain/seo/pageSpeedInsights";
import { safeFetch } from "../net/safeFetch.ts";

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
const SKIP_PATH_PATTERNS = [/\/(login|signup|sign-in|sign-up|logout)\/?($|[?#])/i];

async function cheapFetchPage(url: string): Promise<{ title: string; content: string } | null> {
  try {
    // Pages are linked from the audited site, so they are untrusted targets: guarded fetch.
    const res = await safeFetch(url, { timeoutMs: PAGE_TIMEOUT_MS, headers: { "User-Agent": "OkaraAlternative/1.0" } });
    if (res.status < 200 || res.status >= 300) return null;
    const $ = cheerio.load(res.bodyText);
    $("script, style, noscript").remove();
    const content = $("body").text().replace(/\s+/g, " ").trim();
    return { title: $("title").text() || "", content };
  } catch {
    return null;
  }
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
 */
export async function crawlSitePages(seedLinks: { href: string }[]): Promise<CrawledPage[]> {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const link of seedLinks) {
    if (candidates.length >= MAX_PAGES) break;
    if (seen.has(link.href) || SKIP_PATH_PATTERNS.some((p) => p.test(link.href))) continue;
    seen.add(link.href);
    candidates.push(link.href);
  }

  const pages: CrawledPage[] = [];
  for (const url of candidates) {
    try {
      assertPublicHttpUrl(url);
    } catch {
      continue;
    }

    const cheap = await cheapFetchPage(url);
    if (cheap && cheap.content.length >= MIN_CONTENT_LENGTH) {
      pages.push({ url, title: cheap.title, content: cheap.content.slice(0, 3000), source: "crawl" });
      continue;
    }

    // Jina's free-tier render is genuinely flaky on heavy SPAs — confirmed
    // for real: the same page succeeded on one run and returned empty on the
    // next, with no error, no pattern. One retry meaningfully improves yield
    // without much extra cost; still an honest partial result if both fail,
    // not a fabricated one.
    let jina = await jinaRead(url);
    if (!jina || jina.content.trim().length === 0) {
      jina = await jinaRead(url);
    }
    if (jina && jina.content.trim().length > 0) {
      pages.push({ url, title: jina.title, content: jina.content.slice(0, 3000), source: "jina-fallback" });
    }
  }
  return markDuplicateContent(pages);
}
