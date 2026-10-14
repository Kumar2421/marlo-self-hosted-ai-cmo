import type { ConcurrencyGate, RateLimiter } from "./rateLimit.ts";

/**
 * Pure preamble for the public audit and audit-event routes: client identity, rate limits,
 * body size, and crawl concurrency. The route owns the business logic after this runs.
 */

export const AUDIT_MAX_BODY_BYTES = 4096;
export const AUDIT_MAX_URL_LENGTH = 2048;
export const EVENT_MAX_BODY_BYTES = 2048;
export const AUDIT_MAX_CONCURRENT_CRAWLS = 4;
export const AUDIT_CRAWL_SLOT_TTL_SEC = 90;

export type HeaderSource = { get(name: string): string | null };

/** The env keys this module reads. Pass process.env (the index signature keeps it assignable). */
export type GuardEnv = {
  VERCEL?: string;
  TRUST_PROXY_HOPS?: string;
  /** Global audit cap per minute across all clients (default 60). */
  AUDIT_GLOBAL_PER_MIN?: string;
  /** Shared audit limit per minute for requests with no client address on hosted (default 2). */
  AUDIT_UNKNOWN_PER_MIN?: string;
  [key: string]: string | undefined;
};

export type GuardSuccess = { ok: true; body: Record<string, unknown> | null; release: () => Promise<void> };
export type GuardFailure = { ok: false; status: number; headers: Record<string, string>; message: string };
export type GuardResult = GuardSuccess | GuardFailure;

const IP_PATTERN = /^[0-9A-Fa-f:.]{2,64}$/;

export const DEFAULT_GLOBAL_AUDIT_PER_MIN = 60;
export const DEFAULT_UNKNOWN_AUDIT_PER_MIN = 2;

function positiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/** Eight 16-bit groups for an IPv6 literal (handles one "::" and an embedded IPv4 tail), or null. */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (v4) {
    const octets = v4[1].split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, text.length - v4[1].length)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  let parts: string[] = head;
  if (halves.length === 2) {
    const tail = halves[1] === "" ? [] : halves[1].split(":");
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    parts = [...head, ...new Array<string>(fill).fill("0"), ...tail];
  }
  if (parts.length !== 8) return null;
  const groups: number[] = [];
  for (const part of parts) {
    if (!/^[0-9A-Fa-f]{1,4}$/.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

/**
 * The rate-limit key for a client address. IPv4 is used as is. An IPv4-mapped IPv6 address
 * (::ffff:a.b.c.d) is keyed as that IPv4 address. Any other IPv6 address is keyed by its /64
 * prefix, since one customer usually owns a whole /64 (2^64 addresses) and per-address keys
 * would let one customer bypass every limit.
 */
export function clientKey(ip: string): string | null {
  if (!ip.includes(":")) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return null;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

function validIp(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return IP_PATTERN.test(trimmed) ? clientKey(trimmed) : null;
}

/**
 * Logs at most one warning per interval while hosted requests have no client address (for
 * example x-real-ip is not forwarded). Such requests share one low bucket, so the warning
 * makes that misconfiguration visible. The message carries no client data.
 */
export function createUnknownIdentityWarner(
  log: (message: string) => void,
  intervalMs = 60_000,
): (now: number) => void {
  let lastWarnedAt: number | null = null;
  return (now) => {
    if (lastWarnedAt !== null && now - lastWarnedAt < intervalMs) return;
    lastWarnedAt = now;
    log(
      "[public-guard] hosted request has no client address (x-real-ip missing); it shares the unknown rate-limit bucket. Check proxy configuration.",
    );
  };
}

const warnUnknownIdentity = createUnknownIdentityWarner((message) => console.warn(message));

/**
 * The client address, or null when none can be trusted. The leftmost x-forwarded-for
 * hop is client-controlled and is never used.
 * - VERCEL set: x-real-ip (Vercel overwrites x-forwarded-for, so it is platform-set).
 * - TRUST_PROXY_HOPS = n (n >= 1): the hop n positions from the right. 1 is the last hop.
 */
export function trustedClientIp(headers: HeaderSource, env: GuardEnv): string | null {
  if (env.VERCEL) {
    const realIp = validIp(headers.get("x-real-ip"));
    if (realIp) return realIp;
  }
  const hops = Number.parseInt(env.TRUST_PROXY_HOPS ?? "", 10);
  if (Number.isInteger(hops) && hops >= 1) {
    const chain = (headers.get("x-forwarded-for") ?? "").split(",");
    const index = chain.length - hops;
    if (index >= 0) return validIp(chain[index]);
  }
  return null;
}

/** Runs `run`, then `release`, on success and on throw. */
export async function withRelease<T>(release: () => Promise<void>, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    await release();
  }
}

/**
 * Reads a request body as text, or returns null when it exceeds maxBytes. Checks
 * content-length first, then counts streamed bytes, so a missing or false header cannot
 * bypass the limit.
 */
export async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

type Check = { key: string; windowSec: number; limit: number };

function limited(retryAfterSec: number, message: string): GuardFailure {
  return {
    ok: false,
    status: 429,
    headers: { "Retry-After": String(Math.max(1, retryAfterSec)) },
    message,
  };
}

const UNAVAILABLE_MESSAGE = "Service temporarily unavailable. Please try again shortly.";

function unavailable(): GuardFailure {
  return { ok: false, status: 503, headers: { "Retry-After": "30" }, message: UNAVAILABLE_MESSAGE };
}

async function enforce(limiter: RateLimiter, checks: Check[], message: string): Promise<GuardFailure | null> {
  for (const check of checks) {
    const result = await limiter.hit(check.key, check.windowSec, check.limit);
    if (result.unavailable && !result.allowed) return unavailable();
    if (!result.allowed) return limited(result.retryAfterSec, message);
  }
  return null;
}

type PublicGuardBase = {
  headers: HeaderSource;
  env: GuardEnv;
  /** True on hosted (Supabase) deployments. Unknown clients are then grouped under one shared key. */
  hosted: boolean;
  limiter: RateLimiter;
  /** Reads the body as text, or returns null when it is over the size limit. */
  readBody: () => Promise<string | null>;
};

export type AuditGuardInput = PublicGuardBase & { gate: ConcurrencyGate };

const AUDIT_MESSAGE = "Too many audits. Please wait a minute and try again.";

/**
 * Guards POST /api/public/audit. Order: rate limits (no body read yet), body size,
 * JSON parse, URL length, then a crawl slot. Once a slot is taken, the caller must
 * call `release` (use withRelease). On a limiter outage the audit fails closed (503).
 */
export async function guardPublicAudit(input: AuditGuardInput): Promise<GuardResult> {
  const ip = trustedClientIp(input.headers, input.env);
  const checks: Check[] = [];
  if (ip) {
    checks.push(
      { key: `public-audit:ip:${ip}:min`, windowSec: 60, limit: 5 },
      { key: `public-audit:ip:${ip}:hour`, windowSec: 3600, limit: 30 },
    );
  } else if (input.hosted) {
    // Identity unknown on hosted: one shared, low limit for everyone in that bucket.
    warnUnknownIdentity(Date.now());
    checks.push({
      key: "public-audit:unknown:min",
      windowSec: 60,
      limit: positiveIntEnv(input.env.AUDIT_UNKNOWN_PER_MIN, DEFAULT_UNKNOWN_AUDIT_PER_MIN),
    });
  } else {
    // Self-host without a proxy is normally one user; keep the normal per-client limits.
    checks.push(
      { key: "public-audit:local:min", windowSec: 60, limit: 5 },
      { key: "public-audit:local:hour", windowSec: 3600, limit: 30 },
    );
  }

  // Per-client checks first. A client blocked here never spends the shared global cap.
  const clientFailure = await enforce(input.limiter, checks, AUDIT_MESSAGE);
  if (clientFailure) return clientFailure;

  // Global cap last, counted only for requests that passed the per-client checks. It is a
  // hard cost ceiling. Tradeoff: a large botnet of distinct clients can still saturate it and
  // block other audits until the window resets. Raise AUDIT_GLOBAL_PER_MIN if that is too tight.
  const globalFailure = await enforce(
    input.limiter,
    [
      {
        key: "public-audit:global",
        windowSec: 60,
        limit: positiveIntEnv(input.env.AUDIT_GLOBAL_PER_MIN, DEFAULT_GLOBAL_AUDIT_PER_MIN),
      },
    ],
    AUDIT_MESSAGE,
  );
  if (globalFailure) return globalFailure;

  const text = await input.readBody();
  if (text === null) return { ok: false, status: 413, headers: {}, message: "Request is too large." };

  const body = parseObject(text);
  if (typeof body?.url === "string" && body.url.length > AUDIT_MAX_URL_LENGTH) {
    return { ok: false, status: 400, headers: {}, message: "URL is too long." };
  }

  let release: (() => Promise<void>) | null;
  try {
    release = await input.gate.acquire(AUDIT_MAX_CONCURRENT_CRAWLS, AUDIT_CRAWL_SLOT_TTL_SEC);
  } catch {
    return unavailable();
  }
  if (!release) {
    return limited(15, "Too many audits are running right now. Please try again shortly.");
  }

  const releaseSlot = release;
  let released = false;
  return {
    ok: true,
    body,
    release: async () => {
      if (released) return;
      released = true;
      await releaseSlot();
    },
  };
}

export type EventGuardInput = PublicGuardBase;

const EVENT_MESSAGE = "Too many events. Please slow down.";

/**
 * Guards POST /api/public/audit/events: per-client limit (30/min, 10/min when unidentified
 * on hosted), body size (2 KB). Pass a limiter in fail-open mode so an outage only logs.
 */
export async function guardPublicEvent(input: EventGuardInput): Promise<GuardResult> {
  const ip = trustedClientIp(input.headers, input.env);
  if (!ip && input.hosted) warnUnknownIdentity(Date.now());
  const identity = ip ?? (input.hosted ? "unknown" : "local");
  const limit = ip || !input.hosted ? 30 : 10;
  const limitFailure = await enforce(
    input.limiter,
    [{ key: `public-audit-event:${identity}:min`, windowSec: 60, limit }],
    EVENT_MESSAGE,
  );
  if (limitFailure) return limitFailure;

  const text = await input.readBody();
  if (text === null) return { ok: false, status: 413, headers: {}, message: "Request is too large." };

  return { ok: true, body: parseObject(text), release: async () => undefined };
}
