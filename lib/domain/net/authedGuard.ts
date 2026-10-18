import {
  memoryConcurrencyGate,
  type ConcurrencyGate,
  type RateLimiter,
  type RpcClient,
} from "./rateLimit.ts";

/**
 * Rate limit and concurrency guard for signed-in crawl-type work (crawl, audit, pagespeed).
 * Keys use the user and project ids, never the client address. The module is not wired into
 * any route yet: a route calls guardAuthedCrawl, then runs its job inside withAuthedGuard.
 *
 * Rules: one running crawl-type job per project, and CRAWL_STARTS_PER_HOUR starts per user
 * per hour. Hosted deployments use the shared Supabase store and fail closed (503) when it
 * cannot answer; self-host uses bounded in-process stores.
 */

export type AuthedAction = "crawl" | "audit" | "pagespeed";

export type AuthedGuardInput = { userId: string; projectId: string; action: AuthedAction };

export type AuthedGuardFailure = { ok: false; status: 429 | 503; error: string; retryAfterSec?: number };
export type AuthedGuardResult = { ok: true; release: () => Promise<void> } | AuthedGuardFailure;

/** The env keys this module reads. Pass process.env (the index signature keeps it assignable). */
export type AuthedGuardEnv = {
  /** Crawl-type starts allowed per user per hour (default 6). */
  CRAWL_STARTS_PER_HOUR?: string;
  /** Crawl-type jobs allowed to run at once per project (default 1). */
  CRAWL_CONCURRENT_PER_PROJECT?: string;
  [key: string]: string | undefined;
};

/** Resolves the concurrency gate for one key. Each key has its own slots. */
export type KeyedGate = (key: string) => ConcurrencyGate;

export type AuthedGuardDeps = {
  limiter: RateLimiter;
  gateFor: KeyedGate;
  env: AuthedGuardEnv;
};

export const DEFAULT_CRAWL_STARTS_PER_HOUR = 6;
export const DEFAULT_CRAWL_CONCURRENT_PER_PROJECT = 1;
export const AUTHED_CRAWL_SLOT_TTL_SEC = 90;
export const AUTHED_START_WINDOW_SEC = 3600;

const BUSY_MESSAGE = "A crawl is already running for this project. Wait for it to finish.";
const UNAVAILABLE_MESSAGE = "Service temporarily unavailable. Please try again shortly.";
const UNAVAILABLE_RETRY_SEC = 30;
const BUSY_RETRY_SEC = 15;

function positiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function unavailable(): AuthedGuardFailure {
  return { ok: false, status: 503, error: UNAVAILABLE_MESSAGE, retryAfterSec: UNAVAILABLE_RETRY_SEC };
}

function tooManyStarts(retryAfterSec: number): AuthedGuardFailure {
  const seconds = Math.max(1, retryAfterSec);
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return {
    ok: false,
    status: 429,
    error: `You've started a lot of crawls. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    retryAfterSec: seconds,
  };
}

/**
 * Per-key gates for self-host. Each key gets a memory gate that is dropped once its last
 * slot is released, so the map only holds keys with a job running.
 */
export function memoryKeyedGate(now: () => number = Date.now): KeyedGate {
  const gates = new Map<string, { gate: ConcurrencyGate; active: number }>();
  return (key) => ({
    async acquire(max, ttlSec) {
      let entry = gates.get(key);
      if (!entry) {
        entry = { gate: memoryConcurrencyGate(now), active: 0 };
        gates.set(key, entry);
      }
      const held = entry;
      const release = await held.gate.acquire(max, ttlSec);
      if (!release) return null;
      held.active += 1;
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await release();
        held.active -= 1;
        if (held.active === 0 && gates.get(key) === held) gates.delete(key);
      };
    },
  });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

/**
 * Hosted per-key gate backed by authed_crawl_slot_acquire / authed_crawl_slot_release
 * (supabase/migrations/20261021000000_authed_crawl_slots.sql). Rejects when the store cannot
 * be reached, so the guard fails closed. `db` may be null when the service client cannot be built.
 */
export function supabaseKeyedGate(
  db: RpcClient | null,
  warn: (message: string) => void = (message) => console.warn(message),
): KeyedGate {
  return (key) => ({
    async acquire(max, ttlSec) {
      if (!db) throw new Error("no database client");
      const { data, error } = await db.rpc("authed_crawl_slot_acquire", {
        p_key: key,
        p_max: max,
        p_ttl_seconds: ttlSec,
      });
      if (error) throw new Error(error.message);
      if (data === null || data === undefined) return null;
      if (typeof data !== "string") throw new Error("unexpected authed_crawl_slot_acquire response");
      const id = data;
      return async () => {
        try {
          const { error: releaseError } = await db.rpc("authed_crawl_slot_release", { p_id: id });
          if (releaseError) warn(`[crawl-slot] release failed: ${releaseError.message}`);
        } catch (err) {
          warn(`[crawl-slot] release failed: ${describe(err)}`);
        }
      };
    },
  });
}

/** Deployment-appropriate deps. Loaded lazily so tests that inject deps never touch Supabase or FEATURES. */
async function defaultDeps(): Promise<AuthedGuardDeps> {
  const runtime = await import("./publicRuntime.ts");
  return {
    limiter: runtime.publicRateLimiter("closed"),
    gateFor: runtime.authedCrawlGate(),
    env: process.env,
  };
}

/**
 * Guards one signed-in crawl-type start. Takes the project's slot first, then counts the
 * start against the user's hourly budget, so a start refused for a busy project does not
 * spend the budget. Once ok, the caller must call `release` (use withAuthedGuard).
 * A store outage on hosted returns 503 and never lets the job run unmetered.
 */
export async function guardAuthedCrawl(
  input: AuthedGuardInput,
  deps?: AuthedGuardDeps,
): Promise<AuthedGuardResult> {
  let resolved: AuthedGuardDeps;
  try {
    resolved = deps ?? (await defaultDeps());
  } catch {
    return unavailable();
  }
  const { limiter, gateFor, env } = resolved;
  const maxConcurrent = positiveIntEnv(env.CRAWL_CONCURRENT_PER_PROJECT, DEFAULT_CRAWL_CONCURRENT_PER_PROJECT);
  const startsPerHour = positiveIntEnv(env.CRAWL_STARTS_PER_HOUR, DEFAULT_CRAWL_STARTS_PER_HOUR);

  let releaseSlot: (() => Promise<void>) | null;
  try {
    releaseSlot = await gateFor(`authed-crawl:${input.projectId}`).acquire(maxConcurrent, AUTHED_CRAWL_SLOT_TTL_SEC);
  } catch {
    return unavailable();
  }
  if (!releaseSlot) {
    return { ok: false, status: 429, error: BUSY_MESSAGE, retryAfterSec: BUSY_RETRY_SEC };
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await releaseSlot();
  };

  try {
    const start = await limiter.hit(`authed-crawl-start:${input.userId}`, AUTHED_START_WINDOW_SEC, startsPerHour);
    if (start.unavailable && !start.allowed) {
      await release();
      return unavailable();
    }
    if (!start.allowed) {
      await release();
      return tooManyStarts(start.retryAfterSec);
    }
  } catch {
    await release();
    return unavailable();
  }

  return { ok: true, release };
}

/**
 * Runs `fn` when the guard passed and always releases the slot afterwards, on success and on
 * throw. A refused guard result is returned as is and `fn` does not run.
 */
export async function withAuthedGuard<T>(guard: AuthedGuardResult, fn: () => Promise<T>): Promise<T | AuthedGuardFailure> {
  if (!guard.ok) return guard;
  try {
    return await fn();
  } finally {
    await guard.release();
  }
}
