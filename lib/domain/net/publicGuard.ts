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
export type GuardEnv = { VERCEL?: string; TRUST_PROXY_HOPS?: string; [key: string]: string | undefined };

export type GuardSuccess = { ok: true; body: Record<string, unknown> | null; release: () => Promise<void> };
export type GuardFailure = { ok: false; status: number; headers: Record<string, string>; message: string };
export type GuardResult = GuardSuccess | GuardFailure;

const IP_PATTERN = /^[0-9A-Fa-f:.]{2,64}$/;

function validIp(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return IP_PATTERN.test(trimmed) ? trimmed : null;
}

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
    checks.push({ key: "public-audit:unknown:min", windowSec: 60, limit: 2 });
  } else {
    // Self-host without a proxy is normally one user; keep the normal per-client limits.
    checks.push(
      { key: "public-audit:local:min", windowSec: 60, limit: 5 },
      { key: "public-audit:local:hour", windowSec: 3600, limit: 30 },
    );
  }
  checks.push({ key: "public-audit:global", windowSec: 60, limit: 60 });

  const limitFailure = await enforce(input.limiter, checks, AUDIT_MESSAGE);
  if (limitFailure) return limitFailure;

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
