import { normalizeHostUrl } from "./hostLike.ts";

/**
 * Client-side favicon loader: one request per host, shared by every icon instance, and a failed
 * host is remembered for the session so it is never retried (no 400 loops). Values that are not
 * host-like never produce a request. `fetchImpl` is injectable for tests.
 */

export type FaviconFetch = (input: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function createFaviconLoader(fetchImpl: FaviconFetch) {
  const settled = new Map<string, string | null>();
  const inFlight = new Map<string, Promise<string | null>>();

  async function request(host: string, url: string): Promise<string | null> {
    let favicon: string | null = null;
    try {
      const res = await fetchImpl(`/api/favicon?url=${encodeURIComponent(url)}`);
      if (res.ok) {
        const body = (await res.json()) as { favicon?: unknown } | null;
        favicon = typeof body?.favicon === "string" && body.favicon ? body.favicon : null;
      }
    } catch {
      favicon = null;
    }
    settled.set(host, favicon);
    inFlight.delete(host);
    return favicon;
  }

  return {
    /** Resolves to a data URI, or null when there is no icon (render the fallback). */
    load(input: string): Promise<string | null> {
      const parsed = normalizeHostUrl(input);
      if (!parsed) return Promise.resolve(null);
      if (settled.has(parsed.host)) return Promise.resolve(settled.get(parsed.host) ?? null);
      const pending = inFlight.get(parsed.host);
      if (pending) return pending;
      const p = request(parsed.host, parsed.url);
      inFlight.set(parsed.host, p);
      return p;
    },
    /** Synchronous peek used for the first render. undefined = not known yet. */
    peek(input: string): string | null | undefined {
      const parsed = normalizeHostUrl(input);
      if (!parsed) return null;
      return settled.get(parsed.host);
    },
  };
}
