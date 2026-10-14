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

/**
 * Cached favicon store — avoid re-fetching same domain.
 */
const FAVICON_CACHE = new Map<string, string | null>();

export async function getCachedFavicon(urlString: string): Promise<string | null> {
  try {
    const hostname = new URL(urlString).hostname;
    if (FAVICON_CACHE.has(hostname)) {
      return FAVICON_CACHE.get(hostname) ?? null;
    }

    const favicon = await fetchFavicon(urlString);
    FAVICON_CACHE.set(hostname, favicon);
    return favicon;
  } catch {
    return null;
  }
}
