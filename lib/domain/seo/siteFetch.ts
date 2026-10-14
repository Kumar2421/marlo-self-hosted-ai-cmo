import type { IncomingHttpHeaders } from "node:http";
import { safeFetch, type SafeFetchTiming, type TransportRequest } from "../net/safeFetch.ts";
import type { LookupFn } from "../net/ssrf.ts";

/**
 * Site fetches made by the SEO audit. Both run through the guarded fetcher: pinned DNS, per-hop
 * checks, total deadline and byte cap. Extracted from SEOAgent so they can be tested directly.
 */

/** Redirects the page crawl follows before reporting a redirect loop. */
export const SITE_MAX_REDIRECTS = 5;
export const ROBOTS_TIMEOUT_MS = 5_000;
export const ROBOTS_MAX_BYTES = 100_000;
const SITE_USER_AGENT = "OkaraAlternative/1.0";

export type FetchTiming = SafeFetchTiming;

export type SitePageFetch = {
  html: string;
  status: number;
  headers: IncomingHttpHeaders;
  timing: FetchTiming;
  /** Real hops followed to reach the final page. */
  redirectCount: number;
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
  return { html: res.bodyText, status: res.status, headers: res.headers, timing: res.timing, redirectCount: res.redirectCount };
}

/**
 * Real fetch+parse of /robots.txt, only the "User-agent: *" group. Same host only: a redirect to
 * another host is refused and reported as "no robots.txt". Never blocks the crawl itself.
 */
export async function checkRobotsTxt(
  origin: string,
  pagePath: string,
  opts: SiteFetchOptions = {}
): Promise<{ exists: boolean; disallowsThisPage: boolean }> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBytes: ROBOTS_MAX_BYTES,
      sameHostOnly: true,
      headers: { "User-Agent": SITE_USER_AGENT },
      lookup: opts.lookup,
      transport: opts.transport,
    });
    if (res.status < 200 || res.status >= 300) return { exists: false, disallowsThisPage: false };

    let inWildcardGroup = false;
    const disallowPaths: string[] = [];
    for (const rawLine of res.bodyText.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      if (!line) continue;
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        inWildcardGroup = value === "*";
      } else if (key === "disallow" && inWildcardGroup && value) {
        disallowPaths.push(value);
      }
    }

    const disallowsThisPage = disallowPaths.some((p) => pagePath.startsWith(p));
    return { exists: true, disallowsThisPage };
  } catch {
    return { exists: false, disallowsThisPage: false };
  }
}
