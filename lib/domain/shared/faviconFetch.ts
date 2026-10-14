import { safeFetch } from "../net/safeFetch.ts";

/**
 * Fetch website favicon. Returns data: URI or null if unreachable.
 * Tries multiple strategies: favicon.ico, manifest.json, og:image meta tag.
 */
export async function fetchFavicon(urlString: string, timeoutMs: number = 3000): Promise<string | null> {
  try {
    const url = new URL(urlString);
    const baseUrl = url.origin;

    // Strategy 1: favicon.ico
    const icoUrl = `${baseUrl}/favicon.ico`;
    const icoRes = await fetchWithTimeout(icoUrl, timeoutMs);
    if (icoRes?.ok && icoRes.contentType.includes("image")) {
      return bufferToDataUri(icoRes);
    }

    // Strategy 2: Fetch HTML and look for og:image or apple-touch-icon
    const htmlRes = await fetchWithTimeout(urlString, timeoutMs);
    if (htmlRes?.ok) {
      const html = htmlRes.text;

      // Look for og:image
      const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      if (ogMatch?.[1]) {
        const ogUrl = new URL(ogMatch[1], baseUrl).href;
        const ogRes = await fetchWithTimeout(ogUrl, timeoutMs);
        if (ogRes?.ok && ogRes.contentType.includes("image")) {
          return bufferToDataUri(ogRes);
        }
      }

      // Look for apple-touch-icon
      const appleMatch = html.match(/<link\s+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i);
      if (appleMatch?.[1]) {
        const appleUrl = new URL(appleMatch[1], baseUrl).href;
        const appleRes = await fetchWithTimeout(appleUrl, timeoutMs);
        if (appleRes?.ok && appleRes.contentType.includes("image")) {
          return bufferToDataUri(appleRes);
        }
      }

      // Look for any favicon link rel
      const faviconMatch = html.match(/<link\s+rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
      if (faviconMatch?.[1]) {
        const favUrl = new URL(faviconMatch[1], baseUrl).href;
        const favRes = await fetchWithTimeout(favUrl, timeoutMs);
        if (favRes?.ok && favRes.contentType.includes("image")) {
          return bufferToDataUri(favRes);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

type Fetched = { ok: boolean; contentType: string; body: Buffer; text: string };

/** Guarded fetch (pinned DNS, per-hop checks, deadline, byte cap). Null on any failure. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Fetched | null> {
  try {
    const res = await safeFetch(url, {
      timeoutMs,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; favicon-fetcher)",
      },
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      contentType: String(res.headers["content-type"] ?? ""),
      body: res.body,
      text: res.bodyText,
    };
  } catch {
    return null;
  }
}

function bufferToDataUri(res: Fetched): string {
  return `data:${res.contentType};base64,${res.body.toString("base64")}`;
}

export type FaviconCacheOptions = {
  maxEntries?: number;
  /** Total size across all entries, in characters of the data URI. */
  maxTotalChars?: number;
  /** Larger icons are not cached at all (they are still returned to the caller). */
  maxEntryChars?: number;
  ttlMs?: number;
  now?: () => number;
};

/**
 * Bounded favicon cache: LRU by last use, capped by entry count and total size, with a TTL.
 * Entries are data URIs, so the caps are what keep a long-running server from growing without limit.
 */
export class FaviconCache {
  private readonly entries = new Map<string, { value: string | null; size: number; expiresAt: number }>();
  private totalChars = 0;
  private readonly maxEntries: number;
  private readonly maxTotalChars: number;
  private readonly maxEntryChars: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: FaviconCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 200;
    this.maxTotalChars = opts.maxTotalChars ?? 20_000_000;
    this.maxEntryChars = opts.maxEntryChars ?? 1_000_000;
    this.ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get charCount(): number {
    return this.totalChars;
  }

  /** The cached value (null means "no icon"), or undefined when absent or expired. */
  get(key: string): string | null | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.remove(key);
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: string | null): void {
    this.remove(key);
    const size = value?.length ?? 0;
    if (size > this.maxEntryChars) return;
    const t = this.now();
    for (const [k, entry] of this.entries) {
      if (entry.expiresAt <= t) this.remove(k);
    }
    this.entries.set(key, { value, size, expiresAt: t + this.ttlMs });
    this.totalChars += size;
    while (this.entries.size > this.maxEntries || this.totalChars > this.maxTotalChars) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }

  private remove(key: string): void {
    const hit = this.entries.get(key);
    if (!hit) return;
    this.totalChars -= hit.size;
    this.entries.delete(key);
  }
}

/** Cached favicon store, keyed by hostname, so the same domain is not fetched again on every request. */
const FAVICON_CACHE = new FaviconCache();

export async function getCachedFavicon(urlString: string): Promise<string | null> {
  try {
    const hostname = new URL(urlString).hostname;
    const cached = FAVICON_CACHE.get(hostname);
    if (cached !== undefined) return cached;

    const favicon = await fetchFavicon(urlString);
    FAVICON_CACHE.set(hostname, favicon);
    return favicon;
  } catch {
    return null;
  }
}
