import assert from "node:assert/strict";
import test from "node:test";
import {
  guardAuthedCrawl,
  memoryKeyedGate,
  supabaseKeyedGate,
  withAuthedGuard,
  type AuthedGuardDeps,
  type AuthedGuardInput,
} from "../lib/domain/net/authedGuard.ts";
import {
  memoryRateLimiter,
  supabaseRateLimiter,
  type ConcurrencyGate,
  type RateLimiter,
  type RpcClient,
} from "../lib/domain/net/rateLimit.ts";

const silent = () => undefined;

// Fake Postgres shared by every "instance". Mirrors rate_limit_hit (counter per key, fixed
// window) and authed_crawl_slot_* (bounded set per key). The SQL itself is not run here.
function fakeDb(options: { fail?: boolean } = {}) {
  const counts = new Map<string, number>();
  const slots = new Map<string, string>();
  const keys: string[] = [];
  const db: RpcClient = {
    async rpc(fn, args) {
      if (options.fail) return { data: null, error: { message: "connection refused" } };
      if (fn === "rate_limit_hit") {
        const key = String(args.p_key);
        keys.push(key);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        const limit = Number(args.p_limit);
        return { data: [{ allowed: count <= limit, remaining: Math.max(limit - count, 0), retry_after: 1500 }], error: null };
      }
      if (fn === "authed_crawl_slot_acquire") {
        const key = String(args.p_key);
        keys.push(key);
        const used = [...slots.values()].filter((k) => k === key).length;
        if (used >= Number(args.p_max)) return { data: null, error: null };
        const id = crypto.randomUUID();
        slots.set(id, key);
        return { data: id, error: null };
      }
      if (fn === "authed_crawl_slot_release") {
        slots.delete(String(args.p_id));
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
  };
  return { db, counts, slots, keys };
}

function selfHost(env: AuthedGuardDeps["env"] = {}, clock: { now: number } = { now: 1_000_000 }) {
  const now = () => clock.now;
  const deps: AuthedGuardDeps = { limiter: memoryRateLimiter(now), gateFor: memoryKeyedGate(now), env };
  return { deps, clock };
}

function hosted(store: ReturnType<typeof fakeDb>, env: AuthedGuardDeps["env"] = {}) {
  const deps: AuthedGuardDeps = {
    limiter: supabaseRateLimiter(store.db, "closed", silent),
    gateFor: supabaseKeyedGate(store.db, silent),
    env,
  };
  return deps;
}

const input = (overrides: Partial<AuthedGuardInput> = {}): AuthedGuardInput => ({
  userId: "u1",
  projectId: "p1",
  action: "crawl",
  ...overrides,
});

function assertOk(result: Awaited<ReturnType<typeof guardAuthedCrawl>>): () => Promise<void> {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.release;
}

test("a second concurrent request for the same project is refused; another project is independent", async () => {
  const { deps } = selfHost();
  const first = assertOk(await guardAuthedCrawl(input(), deps));
  const second = await guardAuthedCrawl(input({ action: "audit" }), deps);
  assert.deepEqual(second.ok ? null : [second.status, second.error], [
    429,
    "A crawl is already running for this project. Wait for it to finish.",
  ]);
  const other = assertOk(await guardAuthedCrawl(input({ projectId: "p2" }), deps));
  await first();
  await other();
});

test("a start refused for a busy project does not spend the user's hourly budget", async () => {
  const { deps } = selfHost({ CRAWL_STARTS_PER_HOUR: "2" });
  const first = assertOk(await guardAuthedCrawl(input(), deps));
  for (let i = 0; i < 5; i += 1) assert.equal((await guardAuthedCrawl(input(), deps)).ok, false);
  await first();
  assertOk(await guardAuthedCrawl(input(), deps));
});

test("release frees the slot, also after a throw and after a double release", async () => {
  const { deps } = selfHost({ CRAWL_STARTS_PER_HOUR: "50" });

  const first = assertOk(await guardAuthedCrawl(input(), deps));
  await first();
  const second = assertOk(await guardAuthedCrawl(input(), deps));

  // A second release of the first (stale) handle must not free the slot the second holds.
  await first();
  assert.equal((await guardAuthedCrawl(input(), deps)).ok, false);
  await second();

  await assert.rejects(
    withAuthedGuard(await guardAuthedCrawl(input(), deps), async () => {
      throw new Error("crawl blew up");
    }),
    /crawl blew up/,
  );
  assertOk(await guardAuthedCrawl(input(), deps));
});

test("withAuthedGuard runs fn and releases, and returns a refusal without running fn", async () => {
  const { deps } = selfHost({ CRAWL_STARTS_PER_HOUR: "50" });
  assert.equal(await withAuthedGuard(await guardAuthedCrawl(input(), deps), async () => "done"), "done");

  const held = assertOk(await guardAuthedCrawl(input(), deps));
  let ran = false;
  const refused = await withAuthedGuard(await guardAuthedCrawl(input(), deps), async () => {
    ran = true;
    return "done";
  });
  assert.equal(ran, false);
  assert.equal(typeof refused === "object" && refused !== null && "status" in refused ? refused.status : null, 429);
  await held();
});

test("the 7th start in an hour is refused with retryAfterSec; a window reset allows it again", async () => {
  const { deps, clock } = selfHost();
  for (let i = 0; i < 6; i += 1) {
    const release = assertOk(await guardAuthedCrawl(input(), deps));
    await release();
  }
  const seventh = await guardAuthedCrawl(input(), deps);
  assert.equal(seventh.ok, false);
  if (seventh.ok) return;
  assert.equal(seventh.status, 429);
  assert.equal(seventh.retryAfterSec, 3600);
  assert.equal(seventh.error, "You've started a lot of crawls. Try again in about 60 minutes.");

  // The refused start released its project slot, so the project is not wedged.
  clock.now += 3600 * 1000;
  assertOk(await guardAuthedCrawl(input(), deps));
});

test("the hourly budget is per user, not per project", async () => {
  const { deps } = selfHost({ CRAWL_STARTS_PER_HOUR: "2" });
  for (const projectId of ["a", "b"]) {
    const release = assertOk(await guardAuthedCrawl(input({ projectId }), deps));
    await release();
  }
  assert.equal((await guardAuthedCrawl(input({ projectId: "c" }), deps)).ok, false);
  assertOk(await guardAuthedCrawl(input({ userId: "u2", projectId: "c" }), deps));
});

test("retry text rounds up to whole minutes and uses the singular for one", async () => {
  const limiter: RateLimiter = {
    hit: async () => ({ allowed: false, retryAfterSec: 45, unavailable: false }),
  };
  const { deps } = selfHost();
  const result = await guardAuthedCrawl(input(), { ...deps, limiter });
  assert.deepEqual(result.ok ? null : [result.error, result.retryAfterSec], [
    "You've started a lot of crawls. Try again in about 1 minute.",
    45,
  ]);
  const longer = await guardAuthedCrawl(input(), {
    ...deps,
    limiter: { hit: async () => ({ allowed: false, retryAfterSec: 125, unavailable: false }) },
  });
  assert.equal(longer.ok ? null : longer.error, "You've started a lot of crawls. Try again in about 3 minutes.");
});

test("hosted: concurrency and rate limits are shared across instances", async () => {
  const store = fakeDb();
  const instanceA = hosted(store, { CRAWL_STARTS_PER_HOUR: "3" });
  const instanceB = hosted(store, { CRAWL_STARTS_PER_HOUR: "3" });
  const first = assertOk(await guardAuthedCrawl(input(), instanceA));
  const busy = await guardAuthedCrawl(input(), instanceB);
  assert.equal(busy.ok ? null : busy.status, 429);
  assertOk(await guardAuthedCrawl(input({ projectId: "p2" }), instanceB));
  await first();
  assert.equal(store.slots.size, 1);
  assertOk(await guardAuthedCrawl(input(), instanceB));
});

test("hosted: a store outage fails closed with 503", async () => {
  const store = fakeDb({ fail: true });
  const result = await guardAuthedCrawl(input(), hosted(store));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 503);
  assert.equal(result.retryAfterSec, 30);
});

test("hosted: a missing service client fails closed with 503", async () => {
  const deps: AuthedGuardDeps = {
    limiter: supabaseRateLimiter(null, "closed", silent),
    gateFor: supabaseKeyedGate(null, silent),
    env: {},
  };
  const result = await guardAuthedCrawl(input(), deps);
  assert.equal(result.ok ? null : result.status, 503);
});

test("hosted: a limiter outage after the slot was taken releases the slot and returns 503", async () => {
  const store = fakeDb();
  const deps: AuthedGuardDeps = {
    limiter: { hit: async () => ({ allowed: false, retryAfterSec: 30, unavailable: true }) },
    gateFor: supabaseKeyedGate(store.db, silent),
    env: {},
  };
  const result = await guardAuthedCrawl(input(), deps);
  assert.equal(result.ok ? null : result.status, 503);
  assert.equal(store.slots.size, 0);

  const throwing: AuthedGuardDeps = { ...deps, limiter: { hit: async () => { throw new Error("boom"); } } };
  assert.equal((await guardAuthedCrawl(input(), throwing)).ok, false);
  assert.equal(store.slots.size, 0);
});

test("a gate that rejects fails closed with 503", async () => {
  const gate: ConcurrencyGate = { acquire: async () => { throw new Error("down"); } };
  const { deps } = selfHost();
  const result = await guardAuthedCrawl(input(), { ...deps, gateFor: () => gate });
  assert.equal(result.ok ? null : result.status, 503);
});

test("self-host: the memory path drops idle project entries and slots expire after the ttl", async () => {
  const clock = { now: 5_000 };
  const gateFor = memoryKeyedGate(() => clock.now);
  const gate = gateFor("authed-crawl:p1");
  const release = await gate.acquire(1, 90);
  assert.ok(release);
  assert.equal(await gateFor("authed-crawl:p1").acquire(1, 90), null);
  clock.now += 91_000;
  const reacquired = await gateFor("authed-crawl:p1").acquire(1, 90);
  assert.ok(reacquired);
  await reacquired();
  await release();
  assert.ok(await gateFor("authed-crawl:p1").acquire(1, 90));
});

test("keys are built from user and project ids and never contain an address", async () => {
  const store = fakeDb();
  const deps = hosted(store);
  const release = assertOk(await guardAuthedCrawl(input({ userId: "user-9", projectId: "proj-3" }), deps));
  await release();
  assert.deepEqual([...new Set(store.keys)].sort(), ["authed-crawl-start:user-9", "authed-crawl:proj-3"]);
  for (const key of store.keys) assert.doesNotMatch(key, /\d+\.\d+\.\d+\.\d+|::/);
});

test("env overrides change the limits, and invalid values fall back to the defaults", async () => {
  const { deps } = selfHost({ CRAWL_STARTS_PER_HOUR: "2", CRAWL_CONCURRENT_PER_PROJECT: "2" });
  const a = assertOk(await guardAuthedCrawl(input(), deps));
  const b = assertOk(await guardAuthedCrawl(input(), deps));
  // Third start: the hourly budget (2) is spent, and the project is also at its 2-job cap.
  assert.equal((await guardAuthedCrawl(input(), deps)).ok, false);
  await a();
  const third = await guardAuthedCrawl(input(), deps);
  assert.equal(third.ok ? null : third.status, 429);
  await b();

  for (const bad of ["0", "-3", "abc", ""]) {
    const { deps: fallback } = selfHost({ CRAWL_STARTS_PER_HOUR: bad });
    for (let i = 0; i < 6; i += 1) {
      const release = assertOk(await guardAuthedCrawl(input(), fallback));
      await release();
    }
    assert.equal((await guardAuthedCrawl(input(), fallback)).ok, false);
  }
});
