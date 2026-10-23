import test from "node:test";
import assert from "node:assert/strict";
import { describeAge, lastGoodFromPrevious, withLastGoodPageSpeed } from "../lib/domain/seo/pageSpeedFallback.ts";
import { fetchPageSpeed, isPageSpeedTimeout, PSI_AUDIT_TIMEOUT_MS, PSI_TIMEOUT_MS } from "../lib/domain/seo/pageSpeedInsights.ts";

const scores = { performance: 71, accessibility: 90, bestPractices: 100, seo: 95 };
const goodPrev = { pageSpeed: { desktop: scores, mobile: scores }, pageSpeedMeasuredAt: "2026-10-18T10:00:00.000Z" };

test("a timed-out run gets the previous scores, dated, under lastGoodPageSpeed only", () => {
  const next = { pageSpeedUnavailable: "timeout" as const };
  const out = withLastGoodPageSpeed(next, goodPrev, "2026-10-19T00:00:00.000Z");
  assert.equal(out.pageSpeed, undefined, "stale scores must never become the fresh pageSpeed");
  assert.equal(out.lastGoodPageSpeed?.measuredAt, "2026-10-18T10:00:00.000Z");
  assert.equal(out.lastGoodPageSpeed?.pageSpeed.desktop.performance, 71);
});

test("falls back to the stored row date when the old payload has no measuredAt", () => {
  const out = lastGoodFromPrevious({ pageSpeed: goodPrev.pageSpeed }, "2026-10-01T08:00:00.000Z");
  assert.equal(out?.measuredAt, "2026-10-01T08:00:00.000Z");
  assert.equal(lastGoodFromPrevious({ pageSpeed: goodPrev.pageSpeed }, null), null, "no date, no claim");
});

test("repeated timeouts keep the original measurement date", () => {
  const prev = { lastGoodPageSpeed: { measuredAt: "2026-10-10T00:00:00.000Z", pageSpeed: goodPrev.pageSpeed } };
  const out = withLastGoodPageSpeed({ pageSpeedUnavailable: "error" as const }, prev, "2026-10-20T00:00:00.000Z");
  assert.equal(out.lastGoodPageSpeed?.measuredAt, "2026-10-10T00:00:00.000Z");
});

test("a fresh result or a run without a key is left untouched", () => {
  const fresh = { pageSpeed: { desktop: scores, mobile: scores } };
  assert.equal(withLastGoodPageSpeed(fresh, goodPrev, "2026-10-19T00:00:00.000Z"), fresh);
  const noKey = {};
  assert.equal(withLastGoodPageSpeed(noKey, goodPrev, "2026-10-19T00:00:00.000Z"), noKey);
});

test("nothing to carry when there was no earlier good run", () => {
  const next = { pageSpeedUnavailable: "timeout" as const };
  assert.equal(withLastGoodPageSpeed(next, null, null), next);
  assert.equal(withLastGoodPageSpeed(next, { pageSpeedUnavailable: "timeout" } as never, "2026-10-19T00:00:00.000Z"), next);
});

test("age label", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");
  assert.equal(describeAge("2026-10-23T01:00:00.000Z", now), "earlier today (2026-10-23)");
  assert.equal(describeAge("2026-10-22T01:00:00.000Z", now), "1 day ago (2026-10-22)");
  assert.equal(describeAge("2026-10-18T10:00:00.000Z", now), "5 days ago (2026-10-18)");
});

const body = { lighthouseResult: { categories: { performance: { score: 0.5 }, accessibility: { score: 1 }, "best-practices": { score: 1 }, seo: { score: 1 } }, audits: {} } };

test("the audit budget is larger than the batch budget and fits the 60s route", () => {
  assert.ok(PSI_AUDIT_TIMEOUT_MS > PSI_TIMEOUT_MS);
  assert.ok(PSI_AUDIT_TIMEOUT_MS + 10_000 < 60_000);
});

test("with retryAfterTimeout a slow first try is followed by one more inside the same budget", async () => {
  const calls: string[] = [];
  const slowThenFast: typeof fetch = (input, init) => {
    const strategy = new URL(String(input)).searchParams.get("strategy") ?? "";
    const first = !calls.includes(strategy);
    calls.push(strategy);
    if (first) {
      return new Promise((_res, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  // desktop and mobile each stall once, then answer.
  const result = await fetchPageSpeed("https://example.com", "k", { timeoutMs: 200, fetchImpl: slowThenFast, retryAfterTimeout: true });
  assert.equal(result.pageSpeed.desktop.performance, 50);
  assert.equal(calls.length, 4);
});

test("without retryAfterTimeout a timeout is final", async () => {
  const hanging: typeof fetch = (_input, init) =>
    new Promise((_res, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  await assert.rejects(fetchPageSpeed("https://example.com", "k", { timeoutMs: 50, fetchImpl: hanging }), (e) => isPageSpeedTimeout(e));
});

test("with retryAfterTimeout a persistent stall still ends as one timeout", async () => {
  const hanging: typeof fetch = (_input, init) =>
    new Promise((_res, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  await assert.rejects(fetchPageSpeed("https://example.com", "k", { timeoutMs: 80, fetchImpl: hanging, retryAfterTimeout: true }), (e) => isPageSpeedTimeout(e));
});
