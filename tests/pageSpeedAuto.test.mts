import test from "node:test";
import assert from "node:assert/strict";
import {
  combineStatuses, createStartGuard, guardKey, nextRetryDelayMs, psiStatusForError, shouldAutoStart, strategiesToMeasure,
  type AutoStartInput,
} from "../lib/domain/seo/pageSpeedAuto.ts";
import { mergeStrategyMeasure, type PageSpeedCarrier, type StrategyMeasure } from "../lib/domain/seo/pageSpeedFallback.ts";
import { fetchPageSpeedStrategy, PageSpeedTimeoutError, PSI_DEDICATED_TIMEOUT_MS } from "../lib/domain/seo/pageSpeedInsights.ts";

const cwv = { lcp: { value: "1 s", status: "Pass" as const }, fcp: { value: "1 s", status: "Pass" as const }, cls: { value: "0", status: "Pass" as const } };
const scoresOf = (n: number) => ({ performance: n, accessibility: 90, bestPractices: 90, seo: 90 });
const measure = (n: number, at: string): StrategyMeasure => ({ scores: scoresOf(n), cwv, issues: [], measuredAt: at });

const timedOutAudit: PageSpeedCarrier = { pageSpeedUnavailable: "timeout", issues: [
  { label: "PageSpeed Insights was too slow to answer — Performance/CWV not measured this run", level: "Warning" },
  { label: "Missing canonical", level: "Warning" },
] };

const base = (over: Partial<AutoStartInput> = {}): AutoStartInput => ({
  hasProjectUrl: true, audit: timedOutAudit, auditStamp: "2026-10-22T12:49:00Z", alreadyStarted: false, running: false, noKey: false, ...over,
});

test("auto-start: a timed-out or errored audit starts once", () => {
  assert.equal(shouldAutoStart(base()), true);
  assert.equal(shouldAutoStart(base({ audit: { pageSpeedUnavailable: "error" } })), true);
});

test("auto-start: blocked by guard, running, no key, no url, no audit, fresh scores, or no PSI attempt", () => {
  assert.equal(shouldAutoStart(base({ alreadyStarted: true })), false);
  assert.equal(shouldAutoStart(base({ running: true })), false);
  assert.equal(shouldAutoStart(base({ noKey: true })), false);
  assert.equal(shouldAutoStart(base({ hasProjectUrl: false })), false);
  assert.equal(shouldAutoStart(base({ audit: null })), false);
  assert.equal(shouldAutoStart(base({ auditStamp: null })), false);
  assert.equal(shouldAutoStart(base({ audit: { pageSpeedUnavailable: "timeout", pageSpeed: { desktop: scoresOf(1), mobile: scoresOf(1) } } })), false);
  // No key at audit time: pageSpeedUnavailable is absent, so nothing to re-measure.
  assert.equal(shouldAutoStart(base({ audit: {} })), false);
});

test("only the strategies without a stored result are measured", () => {
  assert.deepEqual(strategiesToMeasure(timedOutAudit), ["mobile", "desktop"]);
  assert.deepEqual(strategiesToMeasure({ pageSpeedPartial: { mobile: measure(50, "2026-10-23T00:00:00Z") } }), ["desktop"]);
  assert.deepEqual(strategiesToMeasure({ pageSpeed: { desktop: scoresOf(1), mobile: scoresOf(1) } }), []);
});

test("retry schedule: 2 then 5 minutes, then stop", () => {
  assert.equal(nextRetryDelayMs(0), 120_000);
  assert.equal(nextRetryDelayMs(1), 300_000);
  assert.equal(nextRetryDelayMs(2), null);
});

test("status mapping: timeout vs error, and combining strategy answers", () => {
  assert.equal(psiStatusForError(new PageSpeedTimeoutError(52_000)), "timeout");
  assert.equal(psiStatusForError(new Error("PSI fetch failed: HTTP 500")), "error");
  assert.equal(combineStatuses(["measured", "measured"]), "measured");
  assert.equal(combineStatuses(["measured", "timeout"]), "timeout");
  assert.equal(combineStatuses(["error", "timeout"]), "timeout");
  assert.equal(combineStatuses(["measured", "error"]), "error");
  assert.equal(combineStatuses(["no_key", "no_key"]), "no_key");
  assert.equal(combineStatuses([]), "error");
});

test("merge: the first strategy waits in pageSpeedPartial, scores appear only with both", () => {
  const first = mergeStrategyMeasure(timedOutAudit, "mobile", measure(40, "2026-10-23T10:00:00Z"));
  assert.equal(first.changed, true);
  assert.equal(first.payload.pageSpeed, undefined, "one strategy must not pose as the full result");
  assert.equal(first.payload.pageSpeedUnavailable, "timeout");
  assert.equal(first.payload.pageSpeedPartial?.mobile?.scores.performance, 40);

  const both = mergeStrategyMeasure(first.payload, "desktop", measure(80, "2026-10-23T10:00:30Z"));
  assert.equal(both.payload.pageSpeed?.mobile.performance, 40);
  assert.equal(both.payload.pageSpeed?.desktop.performance, 80);
  assert.equal(both.payload.coreWebVitals?.desktop.lcp.status, "Pass");
  assert.equal(both.payload.pageSpeedMeasuredAt, "2026-10-23T10:00:30Z");
  assert.equal(both.payload.pageSpeedUnavailable, undefined);
  assert.equal(both.payload.pageSpeedPartial, undefined);
  assert.deepEqual(both.payload.issues?.map((i) => i.label), ["Missing canonical"], "the stale PageSpeed notice is dropped");
});

test("merge: parallel calls in either order end identical and never clobber each other", () => {
  const m = measure(40, "2026-10-23T10:00:00Z");
  const d = measure(80, "2026-10-23T10:00:30Z");
  const a = mergeStrategyMeasure(mergeStrategyMeasure(timedOutAudit, "mobile", m).payload, "desktop", d).payload;
  const b = mergeStrategyMeasure(mergeStrategyMeasure(timedOutAudit, "desktop", d).payload, "mobile", m).payload;
  assert.deepEqual(a, b);
  // Two writers that both read the original row: the loser re-reads the winner's row and merges on top of it.
  const winner = mergeStrategyMeasure(timedOutAudit, "mobile", m).payload;
  const loserRetry = mergeStrategyMeasure(winner, "desktop", d).payload;
  assert.ok(loserRetry.pageSpeed?.mobile && loserRetry.pageSpeed?.desktop);
});

test("merge: idempotent, and a payload that already has fresh scores is left alone", () => {
  const m = measure(40, "2026-10-23T10:00:00Z");
  const once = mergeStrategyMeasure(timedOutAudit, "mobile", m).payload;
  assert.deepEqual(mergeStrategyMeasure(once, "mobile", m).payload, once);
  const fresh: PageSpeedCarrier = { pageSpeed: { desktop: scoresOf(1), mobile: scoresOf(2) } };
  const out = mergeStrategyMeasure(fresh, "mobile", m);
  assert.equal(out.changed, false);
  assert.equal(out.payload, fresh);
});

test("start guard: sessionStorage first, in-memory fallback when storage throws", () => {
  const key = guardKey("p1", "2026-10-22T12:49:00Z");
  const store = new Map<string, string>();
  const ok = createStartGuard(() => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }), new Set());
  assert.equal(ok.has(key), false);
  ok.mark(key);
  assert.equal(ok.has(key), true);
  // A second guard sharing the storage (a reload) sees it.
  assert.equal(createStartGuard(() => ({ getItem: (k) => store.get(k) ?? null, setItem: () => {} }), new Set()).has(key), true);

  const broken = createStartGuard(() => ({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }), new Set());
  assert.equal(broken.has(key), false);
  broken.mark(key);
  assert.equal(broken.has(key), true);
  assert.equal(createStartGuard(() => null, new Set()).has(key), false);
  assert.notEqual(guardKey("p1", "a"), guardKey("p2", "a"));
  assert.notEqual(guardKey("p1", "a"), guardKey("p1", "b"));
});

const okBody = { lighthouseResult: { categories: { performance: { score: 0.5 }, accessibility: { score: 0.9 }, "best-practices": { score: 1 }, seo: { score: 1 } }, audits: {} } };

test("dedicated fetch: one strategy, one call, scores parsed (fake fetch)", async () => {
  const seen: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    seen.push(String(input));
    return new Response(JSON.stringify(okBody), { status: 200 });
  };
  const out = await fetchPageSpeedStrategy("https://example.com", "secret", "mobile", { fetchImpl: fakeFetch });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /strategy=mobile/);
  assert.equal(out.scores.performance, 50);
  assert.ok(PSI_DEDICATED_TIMEOUT_MS <= 55_000 && PSI_DEDICATED_TIMEOUT_MS > 35_000);
});

test("dedicated fetch: a timeout is not retried; a 500 is repeated once (fake fetch)", async () => {
  let calls = 0;
  const hang: typeof fetch = (_i, init) => {
    calls++;
    return new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
  };
  await assert.rejects(fetchPageSpeedStrategy("https://example.com", "k", "desktop", { fetchImpl: hang, timeoutMs: 40 }), (e) => e instanceof PageSpeedTimeoutError);
  assert.equal(calls, 1);

  let n = 0;
  const flaky: typeof fetch = async () => (++n === 1 ? new Response("boom", { status: 500 }) : new Response(JSON.stringify(okBody), { status: 200 }));
  const out = await fetchPageSpeedStrategy("https://example.com", "k", "desktop", { fetchImpl: flaky, timeoutMs: 1000 });
  assert.equal(n, 2);
  assert.equal(out.scores.seo, 100);
});
