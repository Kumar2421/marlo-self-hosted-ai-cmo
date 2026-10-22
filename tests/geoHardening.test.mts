import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { promptsThatFit, resolveSimulatedDailyCap, runsPerPromptFor } from "../lib/domain/geo/dailyCap.ts";
import { runPool, selectDueGeoWork, utcWeekStart } from "../lib/domain/geo/dueProjects.ts";
import type { AnswerPort } from "../lib/domain/geo/engines.ts";
import { sqliteRunStore } from "../lib/domain/geo/geoStore.ts";
import { crawlerBlocked, evaluateReadiness, type Fetched } from "../lib/domain/geo/readiness.ts";
import { rotateByDay, runGeoPrompts } from "../lib/domain/geo/runner.ts";
import { fetchPublic } from "../lib/domain/geo/safeFetch.ts";

const subject = { brand: "Marlo", domain: "marlo.app", competitors: [] };
const NOW = () => new Date("2026-10-07T10:00:00Z");

function sqliteDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE geo_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, prompt TEXT NOT NULL, engine TEXT NOT NULL, method TEXT NOT NULL, run_at TEXT NOT NULL, mentioned INTEGER NOT NULL DEFAULT 0, cited INTEGER NOT NULL DEFAULT 0, competitors TEXT NOT NULL DEFAULT '[]', sources TEXT NOT NULL DEFAULT '[]', answer_excerpt TEXT NOT NULL DEFAULT '');
    CREATE TABLE geo_usage (method TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (method, day));
    CREATE TABLE geo_locks (project_id TEXT PRIMARY KEY, locked_until INTEGER NOT NULL);`);
  return db;
}

function port(method: "gemini-grounded" | "simulated", behavior: () => Promise<void> | void = () => {}): AnswerPort & { calls: number } {
  const p = {
    method,
    engine: method,
    calls: 0,
    async ask() {
      p.calls += 1;
      await behavior();
      return { answer: "Marlo", citedUrls: [] };
    },
  };
  return p;
}

// --- 1. SSRF: guard on every hop, hop cap, byte cap ---

const guard = (u: string) => {
  if (new URL(u).hostname === "127.0.0.1") throw new Error("private");
};

test("safeFetch: blocks a redirect hop to a private address and never requests it", async () => {
  const requested: string[] = [];
  const fetchImpl = (async (u: string) => {
    requested.push(u);
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  }) as unknown as typeof fetch;
  const out = await fetchPublic("https://example.com/robots.txt", { assertUrl: guard, fetchImpl });
  assert.equal(out.kind, "unavailable");
  assert.deepEqual(requested, ["https://example.com/robots.txt"]);
});

test("safeFetch: guards the base URL itself", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("x");
  }) as unknown as typeof fetch;
  const out = await fetchPublic("http://127.0.0.1/", { assertUrl: guard, fetchImpl });
  assert.equal(out.kind, "unavailable");
  assert.equal(called, false);
});

test("safeFetch: at most 3 redirect hops", async () => {
  let n = 0;
  const fetchImpl = (async () => {
    n += 1;
    return new Response(null, { status: 301, headers: { location: `https://example.com/${n}` } });
  }) as unknown as typeof fetch;
  const out = await fetchPublic("https://example.com/", { assertUrl: guard, fetchImpl });
  assert.equal(out.kind, "unavailable");
  assert.equal(n, 4); // the first request plus 3 followed hops
});

test("safeFetch: follows a safe redirect and caps the bytes read", async () => {
  const fetchImpl = (async (u: string) =>
    u.endsWith("/a") ? new Response(null, { status: 301, headers: { location: "/b" } }) : new Response("x".repeat(5000))) as unknown as typeof fetch;
  const out = await fetchPublic("https://example.com/a", { assertUrl: guard, fetchImpl, maxBytes: 100 });
  assert.equal(out.kind, "ok");
  assert.ok(out.kind === "ok" && out.body.length <= 100);
});

test("safeFetch: only 404/410 is not-found; 403, 5xx and network errors are unavailable", async () => {
  const code = (c: number) => (async () => new Response("no", { status: c })) as unknown as typeof fetch;
  assert.equal((await fetchPublic("https://e.com/", { assertUrl: guard, fetchImpl: code(404) })).kind, "not-found");
  assert.equal((await fetchPublic("https://e.com/", { assertUrl: guard, fetchImpl: code(410) })).kind, "not-found");
  assert.equal((await fetchPublic("https://e.com/", { assertUrl: guard, fetchImpl: code(403) })).kind, "unavailable");
  assert.equal((await fetchPublic("https://e.com/", { assertUrl: guard, fetchImpl: code(503) })).kind, "unavailable");
  const boom = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  assert.equal((await fetchPublic("https://e.com/", { assertUrl: guard, fetchImpl: boom })).kind, "unavailable");
});

// --- 5. readiness honesty ---

const ok = (body: string): Fetched => ({ state: "ok", body });
const status = (r: ReturnType<typeof evaluateReadiness>, id: string) => r.checks.find((c) => c.id === id)?.status;

test("readiness: unreadable robots.txt is unknown, only a real 404 passes", () => {
  const base = { llms: ok("x"), sitemapXml: ok("<urlset/>"), homepageHtml: null };
  const unknown = evaluateReadiness({ ...base, robots: { state: "unknown" } });
  assert.equal(status(unknown, "crawler-gptbot"), "unknown");
  const missing = evaluateReadiness({ ...base, robots: { state: "missing" } });
  assert.equal(status(missing, "crawler-gptbot"), "pass");
});

test("readiness: llms.txt and sitemap fetch errors are unknown, 404 is fail", () => {
  const base = { robots: ok("User-agent: *\nAllow: /"), homepageHtml: null };
  const errored = evaluateReadiness({ ...base, llms: { state: "unknown" }, sitemapXml: { state: "unknown" } });
  assert.equal(status(errored, "llms-txt"), "unknown");
  assert.equal(status(errored, "sitemap"), "unknown");
  const missing = evaluateReadiness({ ...base, llms: { state: "missing" }, sitemapXml: { state: "missing" } });
  assert.equal(status(missing, "llms-txt"), "fail");
  assert.equal(status(missing, "sitemap"), "fail");
});

test("readiness: unknown checks stay out of the score", () => {
  const r = evaluateReadiness({ robots: { state: "unknown" }, llms: { state: "unknown" }, sitemapXml: { state: "unknown" }, homepageHtml: null });
  assert.equal(r.score, 0);
  assert.ok(r.checks.every((c) => c.status === "unknown"));
});

// --- 6. robots.txt parser ---

test("robots: Disallow /, /* and /*? block everything", () => {
  for (const rule of ["/", "/*", "/*?"]) {
    assert.equal(crawlerBlocked(`User-agent: *\nDisallow: ${rule}`, "GPTBot"), true, rule);
  }
});

test("robots: longest match between Allow and Disallow wins, tie goes to Allow", () => {
  assert.equal(crawlerBlocked("User-agent: *\nDisallow: /*\nAllow: /", "GPTBot"), true); // /* is longer than /
  assert.equal(crawlerBlocked("User-agent: *\nDisallow: /\nAllow: /", "GPTBot"), false); // tie
  assert.equal(crawlerBlocked("User-agent: *\nAllow: /\nDisallow: /", "GPTBot"), false); // order does not matter
  assert.equal(crawlerBlocked("User-agent: *\nDisallow: /\nAllow: /blog", "GPTBot"), true); // partial allow does not unblock the site
  assert.equal(crawlerBlocked("User-agent: *\nDisallow:", "GPTBot"), false); // empty Disallow allows all
  assert.equal(crawlerBlocked("User-agent: GPTBot\nDisallow: /\nUser-agent: *\nAllow: /", "GPTBot"), true);
});

// --- 2. atomic reservation and in-flight guard ---

test("sqlite store: reserve is capped and counts across calls", async () => {
  const store = sqliteRunStore(sqliteDb(), "p1");
  const results = [];
  for (let i = 0; i < 5; i += 1) results.push(await store.reserve("gemini-grounded", "2026-10-07", 3));
  assert.deepEqual(results, [true, true, true, false, false]);
  assert.equal(await store.countMethodRunsToday("gemini-grounded", "2026-10-07"), 3);
  assert.equal(await store.reserve("simulated", "2026-10-07", 1), true); // separate method bucket
});

test("sqlite store: lock excludes a second holder until unlocked or expired", async () => {
  const db = sqliteDb();
  const a = sqliteRunStore(db, "p1");
  const b = sqliteRunStore(db, "p1");
  assert.equal(await a.tryLock(60_000), true);
  assert.equal(await b.tryLock(60_000), false);
  assert.equal(await sqliteRunStore(db, "p2").tryLock(60_000), true); // other project unaffected
  await a.unlock();
  assert.equal(await b.tryLock(60_000), true);
  await b.unlock();
  assert.equal(await a.tryLock(-1), true); // expires immediately
  assert.equal(await b.tryLock(60_000), true);
});

test("runner: concurrent runs for one project never double-run or overshoot the cap", async () => {
  const db = sqliteDb();
  const slow = port("gemini-grounded", () => new Promise((r) => setTimeout(r, 15)));
  const args = { prompts: ["q1", "q2"], ports: [slow], subject, caps: { "gemini-grounded": 4 }, now: NOW };
  const [x, y] = await Promise.all([
    runGeoPrompts({ ...args, store: sqliteRunStore(db, "p1") }),
    runGeoPrompts({ ...args, store: sqliteRunStore(db, "p1") }),
  ]);
  assert.equal([x, y].filter((s) => s.inFlight).length, 1);
  assert.equal(slow.calls, 4);
});

test("runner: concurrent runs across projects of one user never exceed the daily cap", async () => {
  const db = sqliteDb(); // one DB = one user's usage bucket
  const p = port("gemini-grounded", () => new Promise((r) => setTimeout(r, 5)));
  const mk = (project: string) =>
    runGeoPrompts({ prompts: ["a", "b", "c"], ports: [p], subject, store: sqliteRunStore(db, project), caps: { "gemini-grounded": 5 }, now: NOW });
  await Promise.all([mk("p1"), mk("p2"), mk("p3")]);
  assert.equal(p.calls, 5);
});

test("runner: failed calls still count toward the cap and the lock is released", async () => {
  const db = sqliteDb();
  const failing = port("gemini-grounded", () => {
    throw new Error("quota");
  });
  const store = sqliteRunStore(db, "p1");
  const s = await runGeoPrompts({ prompts: ["a", "b", "c", "d"], ports: [failing], subject, store, caps: { "gemini-grounded": 3 }, now: NOW });
  assert.equal(s.failed.length, 3);
  assert.equal(await store.countMethodRunsToday("gemini-grounded", "2026-10-07"), 3);
  assert.equal(await store.tryLock(1000), true, "lock released after the run");
});

// --- 4. cap vs prompts ---

test("cap planning: lowers runs per prompt, never below 1", () => {
  assert.equal(runsPerPromptFor(null, 10, 3), 3);
  assert.equal(runsPerPromptFor(30, 10, 3), 3);
  assert.equal(runsPerPromptFor(20, 10, 3), 2);
  assert.equal(runsPerPromptFor(5, 10, 3), 1);
  assert.equal(promptsThatFit(5, 10, 1), 5);
  assert.equal(promptsThatFit(null, 10, 3), 10);
});

test("runner: cap below prompt count rotates the start by day and reports skipped prompts", async () => {
  const prompts = ["a", "b", "c", "d"];
  const day1 = await runGeoPrompts({ prompts, ports: [port("gemini-grounded")], subject, store: sqliteRunStore(sqliteDb(), "p1"), caps: { "gemini-grounded": 2 }, now: NOW });
  const day2 = await runGeoPrompts({
    prompts,
    ports: [port("gemini-grounded")],
    subject,
    store: sqliteRunStore(sqliteDb(), "p1"),
    caps: { "gemini-grounded": 2 },
    now: () => new Date("2026-10-08T10:00:00Z"),
  });
  assert.equal(day1.ran, 2);
  assert.equal(day1.runsPerPrompt["gemini-grounded"], 1);
  assert.equal(day1.skipped.filter((s) => s.reason === "rotation").length, 2);
  assert.notEqual(
    day1.skipped.map((s) => s.prompt).sort().join(),
    day2.skipped.map((s) => s.prompt).sort().join(),
  );
  assert.deepEqual([...rotateByDay(prompts, "2026-10-07")].sort(), prompts);
  assert.notEqual(rotateByDay(prompts, "2026-10-07")[0], rotateByDay(prompts, "2026-10-08")[0]);
});

// --- 7. simulated cap ---

test("simulated engine has its own per-user daily cap on hosted only", async () => {
  assert.equal(resolveSimulatedDailyCap(true, undefined), 60);
  assert.equal(resolveSimulatedDailyCap(true, "9"), 9);
  assert.equal(resolveSimulatedDailyCap(false, "9"), null);
  const sim = port("simulated");
  const gem = port("gemini-grounded");
  const store = sqliteRunStore(sqliteDb(), "p1");
  const s = await runGeoPrompts({ prompts: ["a", "b"], ports: [sim, gem], subject, store, caps: { simulated: 2, "gemini-grounded": null }, now: NOW });
  assert.equal(sim.calls, 2);
  assert.equal(gem.calls, 6);
  assert.ok(s.skipped.every((x) => x.method === "simulated"), "skips are labelled with the simulated method, never merged");
});

// --- 3. weekly cron ordering ---

test("cron: only prompts without a run this week are due, oldest last run first", () => {
  const weekStart = utcWeekStart(new Date("2026-10-07T10:00:00Z"));
  assert.equal(weekStart, "2026-10-05T00:00:00.000Z");
  const active = [
    { projectId: "a", userId: "u", prompt: "a1" }, // fully run this week: not due
    { projectId: "b", userId: "u", prompt: "b1" },
    { projectId: "b", userId: "u", prompt: "b2" },
    { projectId: "c", userId: "u", prompt: "c1" },
    { projectId: "d", userId: "u", prompt: "d1" }, // never run
  ];
  const ranThisWeek = [{ projectId: "a", prompt: "a1" }, { projectId: "b", prompt: "b1" }];
  const last = new Map([
    ["a", "2026-10-06T00:00:00.000Z"],
    ["b", "2026-10-06T00:00:00.000Z"],
    ["c", "2026-09-28T00:00:00.000Z"],
  ]);
  const due = selectDueGeoWork(active, ranThisWeek, last);
  assert.deepEqual(due.map((w) => w.projectId), ["d", "c", "b"]);
  assert.deepEqual(due.find((w) => w.projectId === "b")?.prompts, ["b2"], "b is due for its one unrun prompt only");
});

test("cron: a project without Search Console is due as soon as it has an active manual prompt", () => {
  const due = selectDueGeoWork([{ projectId: "manual", userId: "u", prompt: "best crm?" }], [], new Map());
  assert.deepEqual(due, [{ projectId: "manual", userId: "u", prompts: ["best crm?"] }]);
});

test("cron: pool runs 3 at a time, isolates failures and skips what the budget cannot start", async () => {
  let live = 0;
  let peak = 0;
  const seen: number[] = [];
  const r = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((res) => setTimeout(res, 5));
    live -= 1;
    seen.push(n);
    if (n === 2) throw new Error("boom");
  }, { budgetMs: 10_000 });
  assert.equal(peak, 3);
  assert.equal(r.processed, 6);
  assert.deepEqual(r.failed.map((f) => f.error), ["boom"]);
  assert.equal(r.skipped, 0);
  let t = 0;
  const cut = await runPool([1, 2, 3, 4], 2, async () => {}, { budgetMs: 10, now: () => (t += 4) });
  assert.equal(cut.processed + cut.skipped, 4);
  assert.ok(cut.skipped > 0);
});

test("cron: week boundaries are Monday 00:00 UTC", () => {
  assert.equal(utcWeekStart(new Date("2026-10-11T23:00:00Z")), "2026-10-05T00:00:00.000Z");
  assert.equal(utcWeekStart(new Date("2026-10-12T00:00:00Z")), "2026-10-12T00:00:00.000Z");
});

test("runner: stops mid-prompt when the deadline passes", async () => {
  let t = 0;
  const p = port("simulated");
  const s = await runGeoPrompts({ prompts: ["a"], ports: [p], subject, store: sqliteRunStore(sqliteDb(), "p1"), budgetMs: 10, clock: () => (t += 4), now: NOW });
  assert.ok(p.calls < 3);
  assert.ok(s.skipped.some((x) => x.reason === "budget"));
});
