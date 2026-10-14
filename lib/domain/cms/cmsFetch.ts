import { CmsError } from "./cmsFixCatalog.ts";
import { BLOCKED_MESSAGE, assertPublicHostLiteral, type LookupFn } from "../net/ssrf.ts";
import { SafeFetchError, safeFetch, type SafeFetchOptions, type SafeFetchResult, type TransportRequest } from "../net/safeFetch.ts";

/**
 * Fetch for talking to a user-supplied CMS origin. Built on the same pinned fetcher as every other
 * user-influenced fetch (lib/domain/net/safeFetch.ts): the socket is handed one validated address,
 * so DNS cannot be rebound between the check and the connect. This wrapper adds the CMS rules:
 * the URL guard runs on the first URL and on every redirect hop, redirects are followed by hand and
 * capped, a redirect may never leave the original host (the only exception is a same-host
 * http -> https upgrade on default ports), Authorization is only ever sent to that host, an
 * https -> http downgrade is refused, a write is never silently turned into a GET, and bodies are
 * read with a byte cap. Error text is generic (no network error details are echoed).
 */

export const CMS_MAX_REDIRECTS = 3;
export const CMS_MAX_BODY_BYTES = 2_000_000;
const CMS_DEFAULT_TIMEOUT_MS = 12_000;
const UNREACHABLE = "Couldn't reach the site.";
const METHODS: readonly string[] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

export type CmsFetchOptions = {
  /** Throws when the URL must not be fetched (use assertPublicCmsUrl). Runs on every hop. */
  assertUrl: (url: string) => void;
  /** DNS resolver for the pinned connection. Default: the system resolver; every answer is checked. */
  lookup?: LookupFn;
  /** Test seam for the single-request transport. Production uses node http/https. */
  transport?: TransportRequest;
  /** Total deadline for the whole call, all hops included. Default 12 s. */
  timeoutMs?: number;
};

/** Base guard plus the shared name and IP-literal checks (trailing dot, *.internal, IPv6, CGNAT...). */
export function assertPublicCmsUrl(raw: string, base: (url: string) => unknown): URL {
  base(raw);
  const u = new URL(raw);
  assertPublicHostLiteral(u.hostname);
  return u;
}

export type CmsResponse = { status: number; ok: boolean; text: string; json: () => unknown };

function splitAuthorization(all?: Record<string, string>): { authorization?: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  let authorization: string | undefined;
  for (const [key, value] of Object.entries(all ?? {})) {
    if (key.toLowerCase() === "authorization") authorization = value;
    else headers[key] = value;
  }
  return { authorization, headers };
}

/** Maps a fetcher failure to the CMS error text. Policy and DNS failures are the generic block message. */
function cmsErrorFor(err: unknown): CmsError {
  if (err instanceof SafeFetchError) {
    if (err.code.startsWith("policy:") || err.code === "dns:failed") return new CmsError(BLOCKED_MESSAGE, 400);
    if (err.code === "redirect:limit") return new CmsError("The site redirected too many times.", 502);
  }
  return new CmsError(UNREACHABLE, 502);
}

export async function cmsFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }, opts: CmsFetchOptions): Promise<CmsResponse> {
  const method = (init.method ?? "GET").toUpperCase();
  if (!METHODS.includes(method)) throw new CmsError("Unsupported request.", 400);
  const { authorization, headers } = splitAuthorization(init.headers);
  const deadline = Date.now() + (opts.timeoutMs ?? CMS_DEFAULT_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= CMS_MAX_REDIRECTS; hop += 1) {
    try {
      opts.assertUrl(current);
    } catch {
      throw new CmsError(BLOCKED_MESSAGE, 400);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new CmsError(UNREACHABLE, 502);
    let res: SafeFetchResult;
    try {
      // One hop per call: redirects are returned, not followed, so every hop is checked here.
      res = await safeFetch(current, {
        method: method as SafeFetchOptions["method"],
        headers,
        body: init.body,
        authorization,
        timeoutMs: remaining,
        maxBytes: CMS_MAX_BODY_BYTES,
        maxRedirects: 0,
        returnOnRedirectLimit: true,
        lookup: opts.lookup,
        transport: opts.transport,
      });
    } catch (err) {
      throw cmsErrorFor(err);
    }
    if (res.status >= 300 && res.status < 400) {
      const rawLocation = res.headers.location;
      const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
      if (!location) throw new CmsError(`The site redirected without a destination (HTTP ${res.status}).`, 502);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new CmsError("The site redirected to an invalid address.", 502);
      }
      const from = new URL(current);
      const DIFFERENT = "The site redirected to a different host, so Marlo stopped.";
      if (next.hostname.toLowerCase() !== from.hostname.toLowerCase()) throw new CmsError(DIFFERENT, 502);
      if (from.protocol === "https:" && next.protocol === "http:") throw new CmsError("The site redirected from https to http, so Marlo stopped.", 502);
      const sameOrigin = next.origin === from.origin;
      const upgrade = from.protocol === "http:" && next.protocol === "https:" && next.hostname.toLowerCase() === from.hostname.toLowerCase() && !from.port && !next.port;
      // A cross-origin hop is refused outright, so Authorization is never sent to another origin.
      if (!sameOrigin && !upgrade) throw new CmsError(DIFFERENT, 502);
      // A 301/302 on a write would silently turn into a GET; refuse rather than guess.
      if (method !== "GET" && method !== "HEAD" && res.status !== 307 && res.status !== 308) throw new CmsError("The site redirected a write request. Reconnect with the site's final address.", 502);
      current = next.toString();
      continue;
    }
    const text = res.bodyText;
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      text,
      json: () => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new CmsError("The site returned something that isn't JSON.", 502);
        }
      },
    };
  }
  throw new CmsError("The site redirected too many times.", 502);
}
