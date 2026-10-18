import type { IncomingHttpHeaders } from "node:http";
import { safeFetch, type SafeFetchTiming, type TransportRequest } from "../net/safeFetch.ts";
import { getCrawlDelay, isAllowed, parseRobots, ROBOTS_MAX_BYTES } from "../net/robotsPolicy.ts";
import type { LookupFn } from "../net/ssrf.ts";

/**
 * Site fetches made by the SEO audit. Both run through the guarded fetcher: pinned DNS, per-hop
 * checks, total deadline and byte cap. Extracted from SEOAgent so they can be tested directly.
 */

/** Redirects the page crawl follows before reporting a redirect loop. */
export const SITE_MAX_REDIRECTS = 5;
export const ROBOTS_TIMEOUT_MS = 5_000;
const SITE_USER_AGENT = "OkaraAlternative/1.0";

export type FetchTiming = SafeFetchTiming;

export type SitePageFetch = {
  html: string;
  status: number;
  headers: IncomingHttpHeaders;
  timing: FetchTiming;
  /** Real hops followed to reach the final page. */
  redirectCount: number;
  /** The URL of the page that answered, after any redirects. */
  finalUrl?: string;
};

export type SiteFetchOptions = {
  lookup?: LookupFn;
  transport?: TransportRequest;
};

/**
 * The one crawl request for the page (not a second call just for timing). A redirect that exhausts
 * the budget comes back as the last 3xx, so the caller can report a loop.
 */
export async function fetchSitePage(url: URL, timeoutMs: number, opts: SiteFetchOptions = {}): Promise<SitePageFetch> {
  const res = await safeFetch(url, {
    timeoutMs,
    maxRedirects: SITE_MAX_REDIRECTS,
    returnOnRedirectLimit: true,
    headers: { "User-Agent": SITE_USER_AGENT },
    lookup: opts.lookup,
    transport: opts.transport,
  });
  return { html: res.bodyText, status: res.status, headers: res.headers, timing: res.timing, redirectCount: res.redirectCount, finalUrl: res.finalUrl };
}

export type RobotsStatus = "allowed" | "blocked" | "unreachable" | "missing";
export type RobotsDecision = {
  status: RobotsStatus;
  /** Crawl-delay for this crawler in seconds, as written (cap it with capCrawlDelay). Set when a file was read. */
  crawlDelaySec?: number;
};

export type RobotsOptions = SiteFetchOptions & { userAgent?: string };

/**
 * Real fetch of /robots.txt and a verdict for one path (query string included), by RFC 9309.
 * Same host only: a redirect to another host is refused. Only the first 500 KiB is read; a cut
 * mid-line is dropped so a half-written rule can never block more than the file says.
 *
 * Failure policy: 2xx is parsed ("allowed" or "blocked"); a 4xx other than 429 means there is no
 * file ("missing", everything allowed). 429, 5xx, network errors, timeouts, off-host redirects and
 * anything else are "unreachable": a crawler should skip the host, the audit reports "not found".
 */
export async function robotsDecision(origin: string, path: string, opts: RobotsOptions = {}): Promise<RobotsDecision> {
  const userAgent = opts.userAgent ?? SITE_USER_AGENT;
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBytes: ROBOTS_MAX_BYTES,
      sameHostOnly: true,
      headers: { "User-Agent": userAgent },
      lookup: opts.lookup,
      transport: opts.transport,
    });
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return { status: "missing" };
    if (res.status < 200 || res.status >= 300) return { status: "unreachable" };

    const text = res.truncated ? res.bodyText.slice(0, res.bodyText.lastIndexOf("\n") + 1) : res.bodyText;
    const parsed = parseRobots(text);
    const crawlDelaySec = getCrawlDelay(parsed, userAgent);
    return {
      status: isAllowed(parsed, userAgent, path) ? "allowed" : "blocked",
      ...(crawlDelaySec !== null ? { crawlDelaySec } : {}),
    };
  } catch {
    return { status: "unreachable" };
  }
}

/**
 * The audit's view of robots.txt. Never blocks the crawl itself; a file we cannot read counts as
 * "no robots.txt".
 */
export async function checkRobotsTxt(
  origin: string,
  pagePath: string,
  opts: SiteFetchOptions = {}
): Promise<{ exists: boolean; disallowsThisPage: boolean }> {
  const { status } = await robotsDecision(origin, pagePath, opts);
  if (status === "missing" || status === "unreachable") return { exists: false, disallowsThisPage: false };
  return { exists: true, disallowsThisPage: status === "blocked" };
}
