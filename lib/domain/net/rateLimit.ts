/**
 * Rate limiting and concurrency ports for public, anonymous endpoints.
 *
 * Adapters:
 * - supabaseRateLimiter / supabaseConcurrencyGate: hosted deployments. State lives in
 *   Postgres (see supabase/migrations/20261020000000_rate_limits.sql), so every
 *   instance shares one count.
 * - memoryRateLimiter / memoryConcurrencyGate: self-host (no Supabase). Per process,
 *   bounded: expired entries are evicted on every call and the key map is capped.
 *
 * Nothing here reads the environment. The Supabase client is injected.
 */

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSec: number;
  /** True when the store could not answer. `allowed` then follows the adapter's fail mode. */
  unavailable: boolean;
};

export type RateLimiter = {
  hit(key: string, windowSec: number, limit: number): Promise<RateLimitResult>;
};

export type ConcurrencyGate = {
  /**
   * Returns a release function when a slot was taken, or null when every slot is busy.
   * Rejects when the store cannot be reached, so callers can fail closed.
   */
  acquire(max: number, ttlSec: number): Promise<(() => Promise<void>) | null>;
};

/** The slice of the Supabase client used here. Structurally matches SupabaseClient.rpc. */
export type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type FailMode = "closed" | "open";

const UNAVAILABLE_RETRY_SEC = 30;
export const MEMORY_KEY_CAP = 10_000;

type Warn = (message: string) => void;
const defaultWarn: Warn = (message) => console.warn(message);

function describe(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

function parseRateLimitRow(data: unknown): { allowed: boolean; retryAfter: number } {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("unexpected rate_limit_hit response");
  const { allowed, retry_after: retryAfter } = row as { allowed?: unknown; retry_after?: unknown };
  if (typeof allowed !== "boolean" || typeof retryAfter !== "number") {
    throw new Error("unexpected rate_limit_hit response");
  }
  return { allowed, retryAfter };
}

/**
 * Hosted rate limiter backed by the rate_limit_hit RPC. `db` may be null when the
 * service client cannot be built; that counts as an outage, never as "no limit".
 * On outage: fail "closed" denies with unavailable=true, fail "open" allows with unavailable=true.
 */
export function supabaseRateLimiter(
  db: RpcClient | null,
  failMode: FailMode,
  warn: Warn = defaultWarn,
): RateLimiter {
  return {
    async hit(key, windowSec, limit) {
      try {
        if (!db) throw new Error("no database client");
        const { data, error } = await db.rpc("rate_limit_hit", {
          p_key: key,
          p_window_seconds: windowSec,
          p_limit: limit,
        });
        if (error) throw new Error(error.message);
        const row = parseRateLimitRow(data);
        return { allowed: row.allowed, retryAfterSec: Math.max(0, row.retryAfter), unavailable: false };
      } catch (err) {
        warn(`[rate-limit] store unavailable (fail ${failMode}): ${describe(err)}`);
        return { allowed: failMode === "open", retryAfterSec: UNAVAILABLE_RETRY_SEC, unavailable: true };
      }
    },
  };
}

/**
 * In-process fixed-window limiter for self-host. Each key's window starts at its first hit.
 * Expired windows are dropped on every call; when the map is full the oldest key is evicted.
 */
export function memoryRateLimiter(now: () => number = Date.now, cap: number = MEMORY_KEY_CAP): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, windowSec, limit) {
      const t = now();
      for (const [k, w] of windows) {
        if (w.resetAt <= t) windows.delete(k);
      }
      let current = windows.get(key);
      if (!current) {
        while (windows.size >= cap) {
          const oldest = windows.keys().next();
          if (oldest.done) break;
          windows.delete(oldest.value);
        }
        current = { count: 0, resetAt: t + windowSec * 1000 };
        windows.set(key, current);
      }
      current.count += 1;
      const allowed = current.count <= limit;
      return {
        allowed,
        retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((current.resetAt - t) / 1000)),
        unavailable: false,
      };
    },
  };
}

/** Hosted concurrency gate backed by crawl_slot_acquire / crawl_slot_release. */
export function supabaseConcurrencyGate(db: RpcClient | null, warn: Warn = defaultWarn): ConcurrencyGate {
  return {
    async acquire(max, ttlSec) {
      if (!db) throw new Error("no database client");
      const { data, error } = await db.rpc("crawl_slot_acquire", { p_max: max, p_ttl_seconds: ttlSec });
      if (error) throw new Error(error.message);
      if (data === null || data === undefined) return null;
      if (typeof data !== "string") throw new Error("unexpected crawl_slot_acquire response");
      const id = data;
      return async () => {
        try {
          const { error: releaseError } = await db.rpc("crawl_slot_release", { p_id: id });
          if (releaseError) warn(`[crawl-slot] release failed: ${releaseError.message}`);
        } catch (err) {
          warn(`[crawl-slot] release failed: ${describe(err)}`);
        }
      };
    },
  };
}

/** In-process concurrency gate for self-host. Slots expire after their ttl. */
export function memoryConcurrencyGate(now: () => number = Date.now): ConcurrencyGate {
  const slots = new Map<number, number>();
  let nextId = 0;
  return {
    async acquire(max, ttlSec) {
      const t = now();
      for (const [id, expiresAt] of slots) {
        if (expiresAt <= t) slots.delete(id);
      }
      if (slots.size >= max) return null;
      nextId += 1;
      const id = nextId;
      slots.set(id, t + ttlSec * 1000);
      return async () => {
        slots.delete(id);
      };
    },
  };
}
