import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_MAX_BODY_BYTES,
  EVENT_MAX_BODY_BYTES,
  clientKey,
  createUnknownIdentityWarner,
  guardPublicAudit,
  guardPublicEvent,
  readLimitedText,
  trustedClientIp,
  withRelease,
  type HeaderSource,
} from "../lib/domain/net/publicGuard.ts";
import {
  memoryConcurrencyGate,
  memoryRateLimiter,
  supabaseConcurrencyGate,
  supabaseRateLimiter,
  type RpcClient,
} from "../lib/domain/net/rateLimit.ts";

// Fake Postgres: one store shared by every "instance" built on it. Mirrors the semantics of
// rate_limit_hit (counter per key) and crawl_slot_* (bounded set). The SQL itself is not run here.
function fakeDb(options: { fail?: boolean } = {}) {
  const counts = new Map<string, number>();
  const slots = new Set<string>();
  let acquires = 0;
  const db: RpcClient = {
    async rpc(fn, args) {
      if (options.fail) return { data: null, error: { message: "connection refused" } };
      if (fn === "rate_limit_hit") {
        const key = String(args.p_key);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        const limit = Number(args.p_limit);
        return { data: [{ allowed: count <= limit, remaining: Math.max(limit - count, 0), retry_after: 60 }], error: null };
      }
      if (fn === "crawl_slot_acquire") {
        acquires += 1;
        if (slots.size >= Number(args.p_max)) return { data: null, error: null };
        const id = crypto.randomUUID();
        slots.add(id);
        return { data: id, error: null };
      }
      if (fn === "crawl_slot_release") {
        slots.delete(String(args.p_id));
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
  };
  return { db, counts, slots, acquires: () => acquires };
}

function headers(values: Record<string, string>): HeaderSource {
  const map = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

const silent = () => undefined;
const AUDIT_BODY = JSON.stringify({ url: "https://example.com" });

function auditInput(overrides: Partial<Parameters<typeof guardPublicAudit>[0]> & { gate: Parameters<typeof guardPublicAudit>[0]["gate"]; limiter: Parameters<typeof guardPublicAudit>[0]["limiter"] }) {
  return {
    headers: headers({ "x-real-ip": "203.0.113.7" }),
    env: { VERCEL: "1" },
    hosted: true,
    readBody: async () => AUDIT_BODY,
    ...overrides,
  };
}

test("independent instances sharing one store are limited together", async () => {
  const store = fakeDb();
  const instanceA = supabaseRateLimiter(store.db, "closed", silent);
  const instanceB = supabaseRateLimiter(store.db, "closed", silent);
  const gate = memoryConcurrencyGate();
  const results: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const limiter = i % 2 === 0 ? instanceA : instanceB;
    const guard = await guardPublicAudit(auditInput({ limiter, gate }));
    results.push(guard.ok ? 200 : guard.status);
    if (guard.ok) await guard.release();
  }
  assert.deepEqual(results, [200, 200, 200, 200, 200, 429]);
});

test("trusted IP ignores a spoofed leftmost x-forwarded-for when VERCEL is set", async () => {
  const env = { VERCEL: "1" };
  const spoofed = headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "1.2.3.4" });
  assert.equal(trustedClientIp(spoofed, env), "1.2.3.4");
  assert.equal(trustedClientIp(headers({ "x-forwarded-for": "6.6.6.6" }), env), null);

  // Rotating the spoofed XFF on every request must not create new buckets.
  const store = fakeDb();
  const limiter = supabaseRateLimiter(store.db, "closed", silent);
  const gate = memoryConcurrencyGate();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const guard = await guardPublicAudit(
      auditInput({ headers: headers({ "x-forwarded-for": `10.0.0.${i}`, "x-real-ip": "1.2.3.4" }), env, limiter, gate }),
    );
    statuses.push(guard.ok ? 200 : guard.status);
    if (guard.ok) await guard.release();
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("TRUST_PROXY_HOPS uses the hop from the right and never the leftmost", () => {
  const chain = headers({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" });
  assert.equal(trustedClientIp(chain, { TRUST_PROXY_HOPS: "1" }), "9.9.9.9");
  assert.equal(trustedClientIp(chain, { TRUST_PROXY_HOPS: "2" }), "6.6.6.6");
  assert.equal(trustedClientIp(chain, { TRUST_PROXY_HOPS: "3" }), null);
  assert.equal(trustedClientIp(chain, {}), null);
  assert.equal(trustedClientIp(headers({ "x-forwarded-for": "not an ip" }), { TRUST_PROXY_HOPS: "1" }), null);
});

test("missing identity on hosted shares one low 'unknown' limit", async () => {
  const store = fakeDb();
  const limiter = supabaseRateLimiter(store.db, "closed", silent);
  const gate = memoryConcurrencyGate();
  const statuses: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const guard = await guardPublicAudit(auditInput({ headers: headers({}), env: {}, limiter, gate }));
    statuses.push(guard.ok ? 200 : guard.status);
    if (guard.ok) await guard.release();
  }
  assert.deepEqual(statuses, [200, 200, 429]);
  assert.ok(store.counts.has("public-audit:unknown:min"));
});

test("audit fails closed (503) when the limiter store is down", async () => {
  const limiter = supabaseRateLimiter(fakeDb({ fail: true }).db, "closed", silent);
  const guard = await guardPublicAudit(auditInput({ limiter, gate: memoryConcurrencyGate() }));
  assert.equal(guard.ok, false);
  if (!guard.ok) {
    assert.equal(guard.status, 503);
    assert.ok(!/refused/.test(guard.message), "error text must stay generic");
  }
});

test("events fail open (allowed) when the limiter store is down", async () => {
  const warnings: string[] = [];
  const limiter = supabaseRateLimiter(fakeDb({ fail: true }).db, "open", (m) => warnings.push(m));
  const guard = await guardPublicEvent({
    headers: headers({ "x-real-ip": "203.0.113.7" }),
    env: { VERCEL: "1" },
    hosted: true,
    limiter,
    readBody: async () => '{"event":"audit_started"}',
  });
  assert.equal(guard.ok, true);
  assert.equal(warnings.length, 1, "outage must be logged");
});

test("hosted with no database client fails closed for audit", async () => {
  const limiter = supabaseRateLimiter(null, "closed", silent);
  const gate = supabaseConcurrencyGate(null, silent);
  const guard = await guardPublicAudit(auditInput({ limiter, gate }));
  assert.equal(guard.ok, false);
  if (!guard.ok) assert.equal(guard.status, 503);
});

test("an unreachable slot store is a 503 for audit, never an unlimited crawl", async () => {
  const gate = supabaseConcurrencyGate(fakeDb({ fail: true }).db, silent);
  const guard = await guardPublicAudit(auditInput({ limiter: memoryRateLimiter(), gate }));
  assert.equal(guard.ok, false);
  if (!guard.ok) assert.equal(guard.status, 503);
});

test("concurrency gate keeps max slots under 20 parallel acquires (memory and Supabase)", async () => {
  const memory = memoryConcurrencyGate();
  const memoryWins = await Promise.all(Array.from({ length: 20 }, () => memory.acquire(4, 90)));
  assert.equal(memoryWins.filter(Boolean).length, 4);

  const store = fakeDb();
  const hosted = supabaseConcurrencyGate(store.db, silent);
  const hostedWins = await Promise.all(Array.from({ length: 20 }, () => hosted.acquire(4, 90)));
  assert.equal(hostedWins.filter(Boolean).length, 4);
});

test("audit guard admits at most 4 concurrent crawls across 20 parallel requests", async () => {
  const store = fakeDb();
  const limiter = supabaseRateLimiter(store.db, "closed", silent);
  const gate = supabaseConcurrencyGate(store.db, silent);
  const guards = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      guardPublicAudit(auditInput({ headers: headers({ "x-real-ip": `198.51.100.${i + 1}` }), limiter, gate })),
    ),
  );
  const admitted = guards.filter((g) => g.ok);
  assert.equal(admitted.length, 4);
  assert.equal(store.slots.size, 4);
  await Promise.all(admitted.map((g) => (g.ok ? g.release() : undefined)));
  assert.equal(store.slots.size, 0);
});

test("oversized audit body is rejected with 413 before any slot is taken", async () => {
  const store = fakeDb();
  const gate = supabaseConcurrencyGate(store.db, silent);
  const big = new Request("https://app.test/api/public/audit", {
    method: "POST",
    body: "x".repeat(AUDIT_MAX_BODY_BYTES + 1),
  });
  const guard = await guardPublicAudit(
    auditInput({
      limiter: memoryRateLimiter(),
      gate,
      readBody: () => readLimitedText(big, AUDIT_MAX_BODY_BYTES),
    }),
  );
  assert.equal(guard.ok, false);
  if (!guard.ok) assert.equal(guard.status, 413);
  assert.equal(store.acquires(), 0);
});

test("oversized event body is rejected with 413", async () => {
  const big = new Request("https://app.test/api/public/audit/events", {
    method: "POST",
    body: "x".repeat(EVENT_MAX_BODY_BYTES + 1),
  });
  const guard = await guardPublicEvent({
    headers: headers({ "x-real-ip": "203.0.113.9" }),
    env: { VERCEL: "1" },
    hosted: true,
    limiter: memoryRateLimiter(),
    readBody: () => readLimitedText(big, EVENT_MAX_BODY_BYTES),
  });
  assert.equal(guard.ok, false);
  if (!guard.ok) assert.equal(guard.status, 413);
});

test("streamed body without a content-length header is still capped", async () => {
  const chunk = new TextEncoder().encode("y".repeat(3000));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const request = new Request("https://app.test/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.equal(await readLimitedText(request, 4096), null);
  const small = new Request("https://app.test/x", { method: "POST", body: '{"a":1}' });
  assert.equal(await readLimitedText(small, 4096), '{"a":1}');
});

test("over-long url is rejected before a slot is taken", async () => {
  const store = fakeDb();
  const guard = await guardPublicAudit(
    auditInput({
      limiter: memoryRateLimiter(),
      gate: supabaseConcurrencyGate(store.db, silent),
      readBody: async () => JSON.stringify({ url: `https://a.test/${"p".repeat(2100)}` }),
    }),
  );
  assert.equal(guard.ok, false);
  if (!guard.ok) assert.equal(guard.status, 400);
  assert.equal(store.acquires(), 0);
});

test("release runs once on success, on throw, and when the guard is released twice", async () => {
  const store = fakeDb();
  const gate = supabaseConcurrencyGate(store.db, silent);
  const guard = await guardPublicAudit(auditInput({ limiter: memoryRateLimiter(), gate }));
  assert.equal(guard.ok, true);
  if (!guard.ok) return;

  const ok = await withRelease(guard.release, async () => "done");
  assert.equal(ok, "done");
  assert.equal(store.slots.size, 0, "slot freed after success");

  const second = await guardPublicAudit(auditInput({ limiter: memoryRateLimiter(), gate }));
  assert.equal(second.ok, true);
  if (!second.ok) return;
  await assert.rejects(
    withRelease(second.release, async () => {
      throw new Error("audit failed");
    }),
    /audit failed/,
  );
  assert.equal(store.slots.size, 0, "slot freed after failure");
  await second.release();
  assert.equal(store.slots.size, 0, "second release is a no-op");
});

test("memory limiter evicts expired windows and caps the key map", async () => {
  let now = 0;
  const limiter = memoryRateLimiter(() => now, 2);
  assert.equal((await limiter.hit("a", 60, 1)).allowed, true);
  assert.equal((await limiter.hit("a", 60, 1)).allowed, false);

  // Two more keys fill the cap of 2, so "a" (oldest) is evicted and gets a fresh window.
  await limiter.hit("b", 60, 1);
  await limiter.hit("c", 60, 1);
  assert.equal((await limiter.hit("a", 60, 1)).allowed, true, "oldest key evicted at the cap");

  // After the window passes, expired keys are dropped on the next call.
  now = 61_000;
  const fresh = await limiter.hit("d", 60, 1);
  assert.equal(fresh.allowed, true);
  assert.equal((await limiter.hit("b", 60, 1)).allowed, true, "expired key reset");
});

test("memory limiter reports a retry-after within the window", async () => {
  let now = 10_000;
  const limiter = memoryRateLimiter(() => now);
  await limiter.hit("k", 60, 1);
  now = 20_000;
  const denied = await limiter.hit("k", 60, 1);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSec, 50);
});

test("events are limited per client at 30 per minute", async () => {
  const limiter = memoryRateLimiter();
  const headersFor = () => headers({ "x-real-ip": "203.0.113.20" });
  let blocked = 0;
  for (let i = 0; i < 31; i += 1) {
    const guard = await guardPublicEvent({
      headers: headersFor(),
      env: { VERCEL: "1" },
      hosted: true,
      limiter,
      readBody: async () => '{"event":"audit_started"}',
    });
    if (!guard.ok) blocked += 1;
  }
  assert.equal(blocked, 1);
});

test("IPv6 clients are keyed by /64: addresses in one /64 share a bucket", async () => {
  assert.equal(trustedClientIp(headers({ "x-real-ip": "2001:db8:1:2::1" }), { VERCEL: "1" }), "2001:db8:1:2::/64");
  assert.equal(trustedClientIp(headers({ "x-real-ip": "2001:db8:1:2:ffff:ffff:ffff:ffff" }), { VERCEL: "1" }), "2001:db8:1:2::/64");
  assert.equal(trustedClientIp(headers({ "x-real-ip": "2001:DB8:1:2:0:0:0:9" }), { VERCEL: "1" }), "2001:db8:1:2::/64");
  assert.equal(trustedClientIp(headers({ "x-real-ip": "2001:db8::1" }), { VERCEL: "1" }), "2001:db8:0:0::/64");

  // Ten different addresses in one /64 still hit the 5/min per-client limit together.
  const store = fakeDb();
  const limiter = supabaseRateLimiter(store.db, "closed", silent);
  const gate = memoryConcurrencyGate();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const guard = await guardPublicAudit(
      auditInput({ headers: headers({ "x-real-ip": `2001:db8:1:2::${i + 1}` }), limiter, gate }),
    );
    statuses.push(guard.ok ? 200 : guard.status);
    if (guard.ok) await guard.release();
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("IPv6 clients in different /64 prefixes do not share a bucket", () => {
  const env = { VERCEL: "1" };
  const a = trustedClientIp(headers({ "x-real-ip": "2001:db8:1:2::1" }), env);
  const b = trustedClientIp(headers({ "x-real-ip": "2001:db8:1:3::1" }), env);
  assert.notEqual(a, b);
  assert.notEqual(trustedClientIp(headers({ "x-real-ip": "2001:db8::1" }), env), trustedClientIp(headers({ "x-real-ip": "2001:db9::1" }), env));
});

test("IPv4 client keys are unchanged", () => {
  assert.equal(trustedClientIp(headers({ "x-real-ip": "203.0.113.7" }), { VERCEL: "1" }), "203.0.113.7");
  assert.equal(trustedClientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.8" }), { TRUST_PROXY_HOPS: "1" }), "203.0.113.8");
});

test("IPv4-mapped IPv6 maps to the IPv4 key", () => {
  assert.equal(clientKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(clientKey("::FFFF:203.0.113.7"), "203.0.113.7");
  assert.equal(clientKey("0:0:0:0:0:ffff:cb00:7107"), "203.0.113.7");
  assert.equal(trustedClientIp(headers({ "x-real-ip": "::ffff:203.0.113.7" }), { VERCEL: "1" }), "203.0.113.7");
});

test("malformed IPv6 is not trusted as a client identity", () => {
  assert.equal(clientKey("2001:db8:::1"), null);
  assert.equal(clientKey("2001:db8:1:2:3:4:5:6:7"), null);
  assert.equal(clientKey("2001:zz8::1"), null);
  assert.equal(trustedClientIp(headers({ "x-real-ip": "2001:db8:::1" }), { VERCEL: "1" }), null);
});

test("global cap counts only requests that passed their per-client checks", async () => {
  const store = fakeDb();
  const limiter = supabaseRateLimiter(store.db, "closed", silent);
  const gate = memoryConcurrencyGate();
  const env = { VERCEL: "1", AUDIT_GLOBAL_PER_MIN: "100" };
  const statuses: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const guard = await guardPublicAudit(auditInput({ env, limiter, gate }));
    statuses.push(guard.ok ? 200 : guard.status);
    if (guard.ok) await guard.release();
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  // The sixth request was stopped by its own limit, so it must not have spent a global hit.
  assert.equal(store.counts.get("public-audit:global"), 5);
});

test("global cap is configurable and blocks other clients when exhausted", async () => {
  const store = fakeDb();
  const limiter = supabaseRateLimiter(store.db, "closed", silent);
  const gate = memoryConcurrencyGate();
  const env = { VERCEL: "1", AUDIT_GLOBAL_PER_MIN: "2" };
  const statuses: number[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const guard = await guardPublicAudit(auditInput({ headers: headers({ "x-real-ip": `198.51.100.${i}` }), env, limiter, gate }));
    statuses.push(guard.ok ? 200 : guard.status);
    if (guard.ok) await guard.release();
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});

test("unknown-identity limit is configurable with AUDIT_UNKNOWN_PER_MIN, invalid values fall back to 2", async () => {
  const run = async (value: string | undefined) => {
    const store = fakeDb();
    const limiter = supabaseRateLimiter(store.db, "closed", silent);
    const gate = memoryConcurrencyGate();
    const env = value === undefined ? {} : { AUDIT_UNKNOWN_PER_MIN: value };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const guard = await guardPublicAudit(auditInput({ headers: headers({}), env, limiter, gate }));
      statuses.push(guard.ok ? 200 : guard.status);
      if (guard.ok) await guard.release();
    }
    return statuses;
  };
  assert.deepEqual(await run("4"), [200, 200, 200, 200, 429]);
  assert.deepEqual(await run("abc"), [200, 200, 429, 429, 429]);
  assert.deepEqual(await run("0"), [200, 200, 429, 429, 429]);
  assert.deepEqual(await run(undefined), [200, 200, 429, 429, 429]);
});

test("unknown-identity warning is throttled to one per minute", () => {
  const lines: string[] = [];
  const warn = createUnknownIdentityWarner((message) => lines.push(message));
  warn(0);
  warn(1_000);
  warn(59_999);
  assert.equal(lines.length, 1);
  warn(60_000);
  warn(61_000);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => !/\d+\.\d+\.\d+\.\d+|:[0-9a-f]{1,4}:/i.test(line)), "warning carries no client data");
});
