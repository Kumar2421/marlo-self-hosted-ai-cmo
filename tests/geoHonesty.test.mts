import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiGroundedPort, type AnswerPort } from "../lib/domain/geo/engines.ts";
import { classifyFailure, GeoProviderError } from "../lib/domain/geo/providerError.ts";
import { emptySummary, runGeoPrompts, summariseRun, type RunStore } from "../lib/domain/geo/runner.ts";
import type { AnswerMethod, GeoRunRow } from "../lib/domain/geo/types.ts";
import { analyzeAnswer, brandAliases, compareTrend } from "../lib/domain/geo/visibility.ts";

const mention = (brand: string, domain: string, answer: string, citedUrls: string[] = []) =>
  analyzeAnswer({ answer, citedUrls }, { brand, domain, competitors: [] }).mentioned;

// --- D5: mention detection (probe cases from the audit) ---

test("mention: a project name with a tagline is matched by its short name", () => {
  assert.equal(mention("Marlo - AI SEO Agent", "marlo.ai", "Marlo is a great SEO agent"), true);
  assert.equal(mention("Marlo | AI SEO Agent", "marlo.ai", "Try Marlo for audits"), true);
  assert.equal(mention("Marlo: AI SEO Agent", "marlo.ai", "Try Marlo for audits"), true);
});

test("mention: legal suffixes are not part of the name", () => {
  assert.equal(mention("Acme Inc.", "acme.com", "Acme is great"), true);
  assert.equal(mention("Acme, LLC", "acme.com", "Acme is great"), true);
  assert.equal(mention("Acme Co", "acme.com", "Acme is great"), true);
});

test("mention: the domain label is an alias", () => {
  assert.equal(mention("My Startup", "zorbly.io", "Zorbly looks like the best option"), true);
});

test("mention: a common-word brand needs a capital or its domain, not 'a linear regression tool'", () => {
  assert.equal(mention("Linear", "linear.app", "a linear regression tool"), false);
  assert.equal(mention("Apple", "apple-seo.com", "an apple a day"), false);
  assert.equal(mention("Go", "go-crm.com", "let's go with HubSpot"), false);
  assert.equal(mention("Linear", "linear.app", "Linear is a good issue tracker"), true);
  assert.equal(mention("Linear", "linear.app", "see linear.app for pricing"), true);
  assert.equal(mention("Linear", "linear.app", "linear is good", ["https://linear.app/docs"]), true, "cited on its own domain proves the lowercase name is meant");
});

test("mention: unrelated look-alikes stay false", () => {
  assert.equal(mention("Marlo", "marlo.ai", "Marlowe and Marlon are people"), false);
  assert.equal(mention("Marlo - AI SEO Agent", "marlo.ai", "Any SEO agent will do"), false);
});

test("competitors: 'On Monday...' is not monday.com, but the domain and a cited URL are", () => {
  const subject = { brand: "Marlo", domain: "marlo.ai", competitors: ["monday.com", "hubspot.com"] };
  assert.deepEqual(analyzeAnswer({ answer: "On Monday, use any tool you like.", citedUrls: [] }, subject).competitors, []);
  assert.deepEqual(analyzeAnswer({ answer: "Try monday.com for planning.", citedUrls: [] }, subject).competitors, ["monday.com"]);
  assert.deepEqual(analyzeAnswer({ answer: "Plan it.", citedUrls: ["https://monday.com/pricing"] }, subject).competitors, ["monday.com"]);
  assert.deepEqual(analyzeAnswer({ answer: "HubSpot is popular.", citedUrls: [] }, subject).competitors, ["hubspot.com"]);
});

test("citation: own domain and subdomains count, look-alikes and path mentions do not", () => {
  const cited = (u: string) => analyzeAnswer({ answer: "x", citedUrls: [u] }, { brand: "Marlo", domain: "marlo.ai", competitors: [] }).cited;
  assert.equal(cited("https://marlo.ai/blog"), true);
  assert.equal(cited("https://www.marlo.ai/"), true);
  assert.equal(cited("https://blog.marlo.ai/post"), true);
  assert.equal(cited("https://notmarlo.ai/"), false);
  assert.equal(cited("https://marlo.ai.evil.com/"), false);
  assert.equal(cited("https://evil.com/marlo.ai"), false);
  assert.equal(cited("not a url"), false);
});

test("brandAliases: separators, suffixes, domain label, deduplicated", () => {
  assert.deepEqual(brandAliases("Marlo - AI SEO Agent", "https://www.marlo.ai"), ["Marlo", "Marlo - AI SEO Agent"]);
  assert.deepEqual(brandAliases("Acme Inc.", "acme.com"), ["Acme", "Acme Inc"]);
});

// --- D13: trend dates ---

test("trend: reports which two run days were compared", () => {
  const row = (runAt: string, mentioned: boolean): GeoRunRow => ({ prompt: "p", engine: "e", method: "gemini-grounded", runAt, mentioned, cited: false, competitors: [], sources: [], answerExcerpt: "" });
  const t = compareTrend([row("2026-08-01T10:00:00Z", false), row("2026-10-20T10:00:00Z", true)], "gemini-grounded");
  assert.equal(t.trend, "up");
  assert.equal(t.latestDate, "2026-10-20");
  assert.equal(t.previousDate, "2026-08-01");
  assert.equal(compareTrend([row("2026-10-20T10:00:00Z", true)], "gemini-grounded").previousDate, null);
});

// --- D1 / D3: provider failure honesty, timeouts, per-row saves ---

function memoryStore() {
  const rows: GeoRunRow[] = [];
  let reserved = 0;
  const store: RunStore = {
    async countRuns(prompt, method) {
      return rows.filter((r) => r.prompt === prompt && r.method === method).length;
    },
    async countMethodRunsToday() {
      return reserved;
    },
    async reserve() {
      reserved += 1;
      return true;
    },
    async tryLock() {
      return true;
    },
    async unlock() {},
    async saveRuns(r) {
      rows.push(...r);
    },
  };
  return { rows, store, reserved: () => reserved };
}

const NOW = () => new Date("2026-10-07T10:00:00Z");
const subject = { brand: "Marlo", domain: "marlo.ai", competitors: [] };

function failingPort(method: AnswerMethod, error: unknown): AnswerPort & { calls: number } {
  const p = {
    method,
    engine: method,
    calls: 0,
    async ask(): Promise<never> {
      p.calls += 1;
      throw error;
    },
  };
  return p;
}

test("runner: a rejected key stops the method after 2 failures and burns only 2 slots", async () => {
  const m = memoryStore();
  const gemini = failingPort("gemini-grounded", new GeoProviderError("auth", "Gemini request failed: HTTP 403", 403));
  const s = await runGeoPrompts({ prompts: ["a", "b", "c", "d", "e"], ports: [gemini], subject, store: m.store, caps: { "gemini-grounded": 20 }, now: NOW });
  assert.equal(gemini.calls, 2);
  assert.equal(m.reserved(), 2);
  assert.equal(s.ran, 0);
  assert.deepEqual(s.failed.map((f) => f.code), ["auth", "auth"]);
  assert.equal(s.skipped.filter((x) => x.reason === "provider").length, 3);
  assert.equal(summariseRun(s).message, "No checks ran. Gemini key rejected: check Settings.");
  assert.equal(summariseRun(s).level, "failed");
});

test("runner: other methods keep running when one is stopped, and a success resets the streak", async () => {
  const m = memoryStore();
  const gemini = failingPort("gemini-grounded", new GeoProviderError("auth", "HTTP 401", 401));
  const sim: AnswerPort = { method: "simulated", engine: "sim", async ask() { return { answer: "Marlo", citedUrls: [] }; } };
  const s = await runGeoPrompts({ prompts: ["a", "b", "c"], ports: [gemini, sim], subject, store: m.store, maxRunsPerPrompt: 1, now: NOW });
  assert.equal(s.ran, 3);
  assert.equal(gemini.calls, 2);
  assert.equal(s.target, 6);
  assert.equal(s.completed, 3);
  assert.equal(summariseRun(s).message, "3 of 6 checked. Gemini key rejected: check Settings; stopped early to save your daily checks.");
  let n = 0;
  const alternating: AnswerPort = {
    method: "gemini-grounded",
    engine: "g",
    async ask() {
      n += 1;
      if (n % 2 === 1) throw new GeoProviderError("auth", "HTTP 401", 401);
      return { answer: "Marlo", citedUrls: [] };
    },
  };
  const s2 = await runGeoPrompts({ prompts: ["a", "b", "c", "d"], ports: [alternating], subject, store: memoryStore().store, maxRunsPerPrompt: 1, now: NOW });
  assert.equal(n >= 4, true, "never two failures in a row, so never stopped");
  assert.equal(s2.skipped.filter((x) => x.reason === "provider").length, 0);
});

test("runner: unknown errors (not auth/4xx) do not trigger the stop", async () => {
  const gemini = failingPort("gemini-grounded", new Error("boom"));
  const s = await runGeoPrompts({ prompts: ["a", "b", "c"], ports: [gemini], subject, store: memoryStore().store, now: NOW });
  assert.equal(gemini.calls, 3);
  assert.equal(s.failed[0].code, "unknown");
  assert.equal(s.failed[0].error, "boom");
});

test("runner: a hung ask times out, costs one slot and loses nothing already saved", async () => {
  const m = memoryStore();
  let calls = 0;
  const hangs: AnswerPort = {
    method: "simulated",
    engine: "sim",
    ask() {
      calls += 1;
      if (calls === 2) return new Promise(() => {}); // never settles
      return Promise.resolve({ answer: "Marlo", citedUrls: [] });
    },
  };
  const s = await runGeoPrompts({ prompts: ["a"], ports: [hangs], subject, store: m.store, askTimeoutMs: 20, now: NOW });
  assert.equal(s.ran, 1);
  assert.equal(m.rows.length, 1, "the finished row was saved before the hang");
  assert.equal(s.failed[0].code, "timeout");
  assert.equal(summariseRun(s).message, "1 of 3 checked. The simulated check (Tavily + Groq) did not answer in time.");
});

test("runner: every successful row is saved as it completes", async () => {
  const saves: number[] = [];
  const m = memoryStore();
  const store: RunStore = { ...m.store, async saveRuns(r) { saves.push(r.length); await m.store.saveRuns(r); } };
  const p: AnswerPort = { method: "simulated", engine: "sim", async ask() { return { answer: "Marlo", citedUrls: [] }; } };
  await runGeoPrompts({ prompts: ["a"], ports: [p], subject, store, now: NOW });
  assert.deepEqual(saves, [1, 1, 1]);
});

test("runner: maxRunsPerPrompt=1 does one run per prompt (cron)", async () => {
  const m = memoryStore();
  const p: AnswerPort = { method: "simulated", engine: "sim", async ask() { return { answer: "Marlo", citedUrls: [] }; } };
  const s = await runGeoPrompts({ prompts: ["a", "b"], ports: [p], subject, store: m.store, maxRunsPerPrompt: 1, now: NOW });
  assert.equal(s.ran, 2);
  assert.equal(s.runsPerPrompt.simulated, 1);
});

test("summariseRun: complete, budget, cap, busy and empty runs", () => {
  const full = { ...emptySummary(), target: 6, completed: 6, ran: 6 };
  assert.deepEqual(summariseRun(full), { level: "ok", message: "6 of 6 checked" });
  const timed = { ...emptySummary(), target: 6, completed: 4, ran: 4, budget: { limitMs: 45000, exhausted: true } };
  assert.equal(summariseRun(timed).message, "4 of 6 checked. Stopped at the time limit; run again to finish.");
  assert.equal(summariseRun({ ...emptySummary(), target: 6, completed: 2, ran: 2, skippedCap: 1 }).message, "2 of 6 checked. Daily limit reached.");
  assert.equal(summariseRun({ ...emptySummary(), inFlight: true }).level, "busy");
  assert.deepEqual(summariseRun(emptySummary()), { level: "nothing", message: "Nothing to run." });
});

test("summariseRun: a partial failure says what failed, not just 'Ran N checks'", () => {
  const s = {
    ...emptySummary(),
    target: 6,
    completed: 5,
    ran: 5,
    failed: [{ prompt: "a", method: "gemini-grounded" as const, code: "rate_limit" as const, message: "HTTP 429", error: "HTTP 429" }],
  };
  assert.equal(summariseRun(s).message, "5 of 6 checked. Gemini rate limit or quota reached: try again later.");
});

test("failure classification: statuses, timeouts and plain messages", () => {
  assert.equal(classifyFailure(new Error("Tavily search failed: HTTP 401")).code, "auth");
  assert.equal(classifyFailure(new Error("Tavily search failed: HTTP 429")).code, "rate_limit");
  assert.equal(classifyFailure(new Error("x: HTTP 400")).code, "client");
  assert.equal(classifyFailure(new Error("x: HTTP 503")).code, "server");
  const timeout = new Error("aborted");
  timeout.name = "TimeoutError";
  assert.equal(classifyFailure(timeout).code, "timeout");
  assert.equal(classifyFailure(new Error("Invalid API key")).code, "auth");
  assert.equal(classifyFailure("weird").code, "unknown");
});

test("gemini port: HTTP 403 is an auth failure; a hung fetch is a timeout that carries an abort signal", async () => {
  const rejected = createGeminiGroundedPort({ apiKey: "k", fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
  await assert.rejects(rejected.ask("q"), (e: unknown) => e instanceof GeoProviderError && e.code === "auth" && e.status === 403);

  let signal: AbortSignal | undefined;
  const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout timers are unref'd; keep the test loop alive
  const hung = createGeminiGroundedPort({
    apiKey: "k",
    timeoutMs: 20,
    fetchImpl: (_url, init) => {
      signal = init.signal;
      return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    },
  });
  await assert.rejects(hung.ask("q"), (e: unknown) => e instanceof GeoProviderError && e.code === "timeout");
  clearTimeout(keepAlive);
  assert.ok(signal);
});
