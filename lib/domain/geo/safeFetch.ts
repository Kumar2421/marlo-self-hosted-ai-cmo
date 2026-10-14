// Fetches a public URL for the readiness check without following redirects
// blindly: the URL guard runs on the first URL and on EVERY redirect hop, hops
// are capped, and the body is read with a byte cap. Production delegates to the
// shared guarded fetcher (pinned DNS); see fetchPinned below.

import { safeFetch } from "../net/safeFetch.ts";

export const MAX_REDIRECT_HOPS = 3;
export const MAX_BODY_BYTES = 500_000;

/**
 * ok          - 2xx with a body
 * not-found   - the server really said 404/410
 * unavailable - blocked URL, network error, timeout, 403, 5xx, too many redirects, etc.
 */
export type FetchOutcome =
  | { kind: "ok"; body: string }
  | { kind: "not-found" }
  | { kind: "unavailable"; reason: string };

type Options = {
  /** Throws when the URL must not be fetched (SSRF guard). */
  assertUrl: (url: string) => void;
  fetchImpl?: typeof fetch;
  maxHops?: number;
  maxBytes?: number;
  timeoutMs?: number;
};

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // already closed
  }
  const all = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const piece = c.subarray(0, Math.max(0, all.length - offset));
    all.set(piece, offset);
    offset += piece.length;
  }
  return new TextDecoder("utf-8").decode(all);
}

/**
 * Production path: the shared guarded fetcher (pinned DNS, per-hop checks, total deadline, byte cap).
 * The fetchImpl seam below is for tests only; geoService never passes it.
 */
async function fetchPinned(url: string, opts: Options): Promise<FetchOutcome> {
  try {
    opts.assertUrl(url);
    const res = await safeFetch(url, {
      timeoutMs: opts.timeoutMs ?? 8000,
      maxBytes: opts.maxBytes ?? MAX_BODY_BYTES,
      maxRedirects: opts.maxHops ?? MAX_REDIRECT_HOPS,
      headers: { "User-Agent": "MarloBot/1.0 (+readiness check)" },
    });
    if (res.status === 404 || res.status === 410) return { kind: "not-found" };
    if (res.status < 200 || res.status >= 300) return { kind: "unavailable", reason: `HTTP ${res.status}` };
    return { kind: "ok", body: res.bodyText };
  } catch (err) {
    return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchPublic(url: string, opts: Options): Promise<FetchOutcome> {
  if (!opts.fetchImpl) return fetchPinned(url, opts);
  const doFetch = opts.fetchImpl;
  const maxHops = opts.maxHops ?? MAX_REDIRECT_HOPS;
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  let current = url;
  try {
    for (let hop = 0; hop <= maxHops; hop += 1) {
      opts.assertUrl(current);
      const res = await doFetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        headers: { "User-Agent": "MarloBot/1.0 (+readiness check)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        if (!location) return { kind: "unavailable", reason: `Redirect without a location (HTTP ${res.status})` };
        current = new URL(location, current).toString();
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        return { kind: "not-found" };
      }
      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        return { kind: "unavailable", reason: `HTTP ${res.status}` };
      }
      return { kind: "ok", body: await readCapped(res, maxBytes) };
    }
    return { kind: "unavailable", reason: "Too many redirects" };
  } catch (err) {
    return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  }
}
