import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import { BLOCKED_MESSAGE, assertPublicHostLiteral, isPrivateIp, type LookupFn } from "./ssrf.ts";

/**
 * The one guarded fetcher for any URL that a user (or a page a user points at) can influence.
 *
 * - DNS is resolved by the socket's own lookup hook, which validates EVERY answer and hands the
 *   connection exactly one validated address (the connection is pinned; a second DNS answer is never
 *   consulted, so DNS rebinding cannot swap in a private address between check and connect).
 * - Every hop (the first URL and each redirect) runs the same literal, scheme, credential, port and
 *   downgrade checks. Redirects are followed manually, capped, and never forward auth or cookies.
 * - One total deadline covers DNS, connect, headers and body. The body is capped in bytes and the
 *   response is never decompressed (accept-encoding is pinned to identity).
 * - Errors are a single SafeFetchError with a fixed public message. The internal code is for logs only
 *   and never contains the host, the IP or the errno.
 */

export const SAFE_FETCH_NETWORK_MESSAGE = "The site could not be reached.";
export const SAFE_FETCH_DEFAULT_PORTS: readonly number[] = [80, 443, 8080, 8443];

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_REDIRECTS = 5;
/** Caller-supplied headers that must never reach the network from this fetcher. */
const STRIPPED_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "accept-encoding", "host"]);

export type SafeFetchCode =
  | "policy:url"
  | "policy:scheme"
  | "policy:credentials"
  | "policy:port"
  | "policy:address"
  | "policy:downgrade"
  | "policy:cross-host"
  | "dns:failed"
  | "network:error"
  | "network:timeout"
  | "redirect:limit"
  | "redirect:invalid"
  | "content-type";

/** The only error a caller sees. `message` is public and generic; `code` is for server logs only. */
export class SafeFetchError extends Error {
  readonly code: SafeFetchCode;
  constructor(code: SafeFetchCode) {
    super(code.startsWith("policy:") ? BLOCKED_MESSAGE : SAFE_FETCH_NETWORK_MESSAGE);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export type SafeFetchTiming = {
  connectMs?: number;
  tlsHandshakeMs?: number;
  ttfbMs?: number;
  downloadMs?: number;
};

/** Test seam and production hook: performs one request. Production uses node http/https. */
export type TransportRequest = (
  options: RequestOptions & { protocol: string },
  onResponse: (res: IncomingMessage) => void
) => ClientRequest;

export type SafeFetchOptions = {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** Request body (text). Content-Length is set from it. */
  body?: string;
  /**
   * Sent as the Authorization header, but ONLY to the origin of the first URL. Caller-supplied
   * Authorization in `headers` is still stripped. Any redirect to another origin never receives it.
   */
  authorization?: string;
  /** Total deadline for the whole call, all hops included. Default 15 s. */
  timeoutMs?: number;
  /** Body byte cap. Excess is dropped and `truncated` is set. Default 2 MB. */
  maxBytes?: number;
  /** Redirects followed before giving up. Default 5. */
  maxRedirects?: number;
  /** When the redirect budget runs out, return the last 3xx instead of throwing. */
  returnOnRedirectLimit?: boolean;
  /** Explicit port allowlist. Default 80, 443, 8080, 8443. */
  allowedPorts?: readonly number[];
  /** Media-type prefixes (e.g. "text/html"). When set, 2xx responses with other types are refused. */
  allowedContentTypes?: readonly string[];
  /** Redirects may only stay on the original hostname (scheme upgrades on the same host are allowed). */
  sameHostOnly?: boolean;
  /** DNS resolver. Injected in tests. Every answer is checked; any non-public answer blocks the hop. */
  lookup?: LookupFn;
  transport?: TransportRequest;
};

export type SafeFetchResult = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  bodyText: string;
  truncated: boolean;
  finalUrl: string;
  redirectCount: number;
  timing: SafeFetchTiming;
};

const defaultResolve: LookupFn = (host) => dns.lookup(host, { all: true, verbatim: true });

const defaultTransport: TransportRequest = (options, onResponse) =>
  options.protocol === "https:" ? httpsRequest(options, onResponse) : httpRequest(options, onResponse);

/** Scheme, credentials, port and literal checks for one URL. Throws SafeFetchError. */
export function parseSafeUrl(input: string | URL, allowedPorts: readonly number[] = SAFE_FETCH_DEFAULT_PORTS): URL {
  let u: URL;
  try {
    u = new URL(typeof input === "string" ? input : input.href);
  } catch {
    throw new SafeFetchError("policy:url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("policy:scheme");
  if (u.username || u.password) throw new SafeFetchError("policy:credentials");
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (!allowedPorts.includes(port)) throw new SafeFetchError("policy:port");
  try {
    assertPublicHostLiteral(u.hostname);
  } catch {
    throw new SafeFetchError("policy:address");
  }
  return u;
}

/**
 * Lookup hook handed to the socket. It resolves once, validates every address, and returns one of
 * them. Failures are reported through onFailure and then as a socket error, so the caller can map them.
 */
function pinnedLookup(resolve: LookupFn, onFailure: (code: SafeFetchCode) => void) {
  return (
    hostname: string,
    options: { all?: boolean } | number,
    callback: (err: Error | null, address?: string | { address: string; family: number }[], family?: number) => void
  ): void => {
    const fail = (code: SafeFetchCode) => {
      onFailure(code);
      callback(new Error(code));
    };
    const wantAll = typeof options === "object" && options !== null && options.all === true;
    resolve(hostname).then(
      (addrs) => {
        if (!Array.isArray(addrs) || addrs.length === 0) return fail("dns:failed");
        if (addrs.some((a) => isPrivateIp(a.address))) return fail("policy:address");
        const picked = addrs[0].address;
        const family = net.isIP(picked);
        if (family !== 4 && family !== 6) return fail("dns:failed");
        if (wantAll) callback(null, [{ address: picked, family }]);
        else callback(null, picked, family);
      },
      () => fail("dns:failed")
    );
  };
}

type HopOutcome =
  | { kind: "response"; status: number; headers: IncomingHttpHeaders; body: Buffer; truncated: boolean; timing: SafeFetchTiming }
  | { kind: "redirect"; status: number; headers: IncomingHttpHeaders; location: string; timing: SafeFetchTiming };

type HopConfig = {
  method: NonNullable<SafeFetchOptions["method"]>;
  headers: Record<string, string>;
  body?: string;
  authorization?: { origin: string; value: string };
  maxBytes: number;
  resolve: LookupFn;
  transport: TransportRequest;
};

/** One request to one URL. Settles exactly once; the shared deadline signal aborts it. */
function runHop(url: URL, cfg: HopConfig, signal: AbortSignal): Promise<HopOutcome> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new SafeFetchError("network:timeout"));
      return;
    }
    const isHttps = url.protocol === "https:";
    const headers: Record<string, string> = { ...cfg.headers };
    if (cfg.authorization && url.origin === cfg.authorization.origin) headers.Authorization = cfg.authorization.value;
    const start = process.hrtime.bigint();
    let failure: SafeFetchCode | undefined;
    let settled = false;
    let lookupStart: bigint | undefined;
    let tlsStart: bigint | undefined;
    let connectMs: number | undefined;
    let tlsHandshakeMs: number | undefined;

    const onAbort = () => {
      req.destroy();
      fail(failure ?? "network:timeout");
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const fail = (code: SafeFetchCode) => settle(() => reject(new SafeFetchError(code)));
    signal.addEventListener("abort", onAbort);

    const req: ClientRequest = cfg.transport(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: cfg.method,
        headers,
        lookup: pinnedLookup(cfg.resolve, (code) => {
          failure ??= code;
        }) as unknown as RequestOptions["lookup"],
      },
      (res) => {
        const ttfbMs = Number(process.hrtime.bigint() - start) / 1e6;
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          settle(() => resolve({ kind: "redirect", status, headers: res.headers, location, timing: { connectMs, tlsHandshakeMs, ttfbMs } }));
          req.destroy();
          return;
        }
        const downloadStart = process.hrtime.bigint();
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        const complete = () => {
          settle(() =>
            resolve({
              kind: "response",
              status,
              headers: res.headers,
              body: Buffer.concat(chunks),
              truncated,
              timing: { connectMs, tlsHandshakeMs, ttfbMs, downloadMs: Number(process.hrtime.bigint() - downloadStart) / 1e6 },
            })
          );
          req.destroy();
        };
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          const room = cfg.maxBytes - total;
          if (chunk.length > room) {
            if (room > 0) chunks.push(chunk.subarray(0, room));
            total = cfg.maxBytes;
            truncated = true;
            complete();
            return;
          }
          chunks.push(chunk);
          total += chunk.length;
        });
        res.on("end", complete);
        res.on("error", () => fail("network:error"));
      }
    );

    req.on("socket", (socket) => {
      socket.once("lookup", () => {
        lookupStart = process.hrtime.bigint();
      });
      socket.once("connect", () => {
        connectMs = Number(process.hrtime.bigint() - (lookupStart ?? start)) / 1e6;
        tlsStart = process.hrtime.bigint();
      });
      socket.once("secureConnect", () => {
        if (tlsStart) tlsHandshakeMs = Number(process.hrtime.bigint() - tlsStart) / 1e6;
      });
    });
    req.on("error", () => fail(failure ?? "network:error"));
    req.end(cfg.body);
  });
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  // Identity encoding: we never decompress, so the byte cap is also the real size bound.
  const out: Record<string, string> = { "accept-encoding": "identity" };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

/**
 * Fetches a user-influenced URL with SSRF protection, pinned DNS, per-hop checks, a redirect cap, a
 * total deadline and a byte cap. Throws SafeFetchError only.
 */
export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const ports = options.allowedPorts ?? SAFE_FETCH_DEFAULT_PORTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = parseSafeUrl(input, ports);
    const firstHost = current.hostname.toLowerCase();
    const headers = buildHeaders(options.headers);
    if (options.body !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === "content-length")) {
      headers["content-length"] = String(Buffer.byteLength(options.body));
    }
    const cfg: HopConfig = {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      authorization: options.authorization === undefined ? undefined : { origin: current.origin, value: options.authorization },
      maxBytes,
      resolve: options.lookup ?? defaultResolve,
      transport: options.transport ?? defaultTransport,
    };
    let redirectCount = 0;
    let carried: SafeFetchTiming = {};
    for (;;) {
      const hop = await runHop(current, cfg, controller.signal);
      carried = {
        connectMs: hop.timing.connectMs ?? carried.connectMs,
        tlsHandshakeMs: hop.timing.tlsHandshakeMs ?? carried.tlsHandshakeMs,
      };
      const finalUrl = current.toString();
      if (hop.kind === "response") {
        const allowed = options.allowedContentTypes;
        if (allowed && hop.status >= 200 && hop.status < 300) {
          const type = String(hop.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
          if (!allowed.some((prefix) => type.startsWith(prefix))) throw new SafeFetchError("content-type");
        }
        return {
          status: hop.status,
          headers: hop.headers,
          body: hop.body,
          bodyText: hop.body.toString("utf8"),
          truncated: hop.truncated,
          finalUrl,
          redirectCount,
          timing: { ...hop.timing, ...carried },
        };
      }
      if (redirectCount >= maxRedirects) {
        if (options.returnOnRedirectLimit) {
          return {
            status: hop.status,
            headers: hop.headers,
            body: Buffer.alloc(0),
            bodyText: "",
            truncated: false,
            finalUrl,
            redirectCount,
            timing: carried,
          };
        }
        throw new SafeFetchError("redirect:limit");
      }
      let next: URL;
      try {
        next = new URL(hop.location, current);
      } catch {
        throw new SafeFetchError("redirect:invalid");
      }
      if (current.protocol === "https:" && next.protocol === "http:") throw new SafeFetchError("policy:downgrade");
      if (options.sameHostOnly && next.hostname.toLowerCase() !== firstHost) throw new SafeFetchError("policy:cross-host");
      // 301/302/303 turn a write into a GET with no body, as browsers do. 307/308 keep both.
      if ((hop.status === 301 || hop.status === 302 || hop.status === 303) && cfg.method !== "GET" && cfg.method !== "HEAD") {
        cfg.method = "GET";
        cfg.body = undefined;
        delete cfg.headers["content-length"];
      }
      current = parseSafeUrl(next, ports);
      redirectCount += 1;
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    throw new SafeFetchError("network:error");
  } finally {
    clearTimeout(timer);
  }
}
