import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchPageSpeed, isPageSpeedTimeout, PSI_TIMEOUT_MS, PSI_ONBOARDING_TIMEOUT_MS, PageSpeedTimeoutError,
} from "../lib/domain/seo/pageSpeedInsights.ts";
import {
  measurePagesWithinBudget, PSI_NOT_REACHED_NOTE, PSI_ROUTE_BUDGET_MS, PSI_TIMED_OUT_NOTE, type PageSpeedPage,
} from "../lib/domain/seo/pageSpeedBatch.ts";
import { JINA_TIMEOUT_MS } from "../lib/domain/shared/jinaReader.ts";

/** A fetch that never answers on its own and only ends when its signal aborts, like a stalled PSI. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

const okBody = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.91 }, accessibility: { score: 0.8 }, "best-practices": { score: 1 }, seo: { score: 0.7 },
    },
    audits: {},
  },
};
const okFetch: typeof fetch = async () => new Response(JSON.stringify(okBody), { status: 200 });

test("constants are bounded", () => {
  assert.equal(PSI_TIMEOUT_MS, 20_000);
  assert.ok(PSI_ONBOARDING_TIMEOUT_MS < PSI_TIMEOUT_MS);
  assert.ok(JINA_TIMEOUT_MS <= 15_000);
  assert.ok(PSI_ROUTE_BUDGET_MS < 60_000);
});

test("a hanging PSI fetch aborts into a timeout, never a score", async () => {
  const started = Date.now();
  await assert.rejects(
    fetchPageSpeed("https://example.com", "k", { timeoutMs: 60, fetchImpl: hangingFetch }),
    (e) => isPageSpeedTimeout(e) && e instanceof PageSpeedTimeoutError,
  );
  assert.ok(Date.now() - started < 1000, "must not wait on the hung request");
});

test("a 500 retries within the same deadline and a hang on the retry still times out", async () => {
  let calls = 0;
  const flaky: typeof fetch = (input, init) => {
    calls++;
    return calls <= 2 ? Promise.resolve(new Response("boom", { status: 500 })) : hangingFetch(input, init);
  };
  await assert.rejects(
    fetchPageSpeed("https://example.com", "k", { timeoutMs: 80, fetchImpl: flaky }),
    (e) => isPageSpeedTimeout(e),
  );
  assert.ok(calls >= 3);
});

test("a plain HTTP failure is not reported as a timeout", async () => {
  const bad: typeof fetch = async () => new Response("no", { status: 429 });
  await assert.rejects(
    fetchPageSpeed("https://example.com", "k", { timeoutMs: 500, fetchImpl: bad }),
    (e) => !isPageSpeedTimeout(e) && /HTTP 429/.test((e as Error).message),
  );
});

test("a normal response still parses to real scores", async () => {
  const r = await fetchPageSpeed("https://example.com", "k", { timeoutMs: 500, fetchImpl: okFetch });
  assert.equal(r.pageSpeed.desktop.performance, 91);
  assert.equal(r.pageSpeed.mobile.seo, 70);
});

test("a PSI response with no categories stays undefined, not 0", async () => {
  const empty: typeof fetch = async () => new Response(JSON.stringify({ lighthouseResult: { categories: {}, audits: {} } }));
  const r = await fetchPageSpeed("https://example.com", "k", { timeoutMs: 500, fetchImpl: empty });
  assert.equal(r.pageSpeed.desktop.performance, undefined);
});

const fakeResult = (await fetchPageSpeed("https://x.test", "k", { fetchImpl: okFetch }));
const pagesOf = (n: number): PageSpeedPage[] => Array.from({ length: n }, (_, i) => ({ url: `https://x.test/${i}` }));

test("batch: hung pages are marked not measured with no scores and the run still returns", async () => {
  const pages = pagesOf(3);
  const summary = await measurePagesWithinBudget(
    pages,
    (url) => fetchPageSpeed(url, "k", { timeoutMs: 30, fetchImpl: hangingFetch }),
    { budgetMs: 10_000, minPageBudgetMs: 1 },
  );
  assert.equal(summary.timedOut, 3);
  assert.equal(summary.measured, 0);
  assert.equal(summary.partial, true);
  for (const p of pages) {
    assert.equal(p.pageSpeed, undefined);
    assert.equal(p.pageSpeedError, PSI_TIMED_OUT_NOTE);
  }
});

test("batch: deadline stops starting new pages and reports measured N of M", async () => {
  let clock = 0;
  const pages = pagesOf(8);
  const seen: number[] = [];
  const summary = await measurePagesWithinBudget(
    pages,
    async (_url, timeoutMs) => { seen.push(timeoutMs); clock += 15_000; return fakeResult; },
    { budgetMs: 48_000, perPageTimeoutMs: 20_000, minPageBudgetMs: 8_000, concurrency: 1, now: () => clock },
  );
  // 15s per page against 48s: starts at 0, 15, 30, 45 (remaining 3 < 8 stops the 4th? 48-45=3) -> 3 measured
  assert.equal(summary.measuredThisRun, 3);
  assert.equal(summary.measured, 3);
  assert.equal(summary.total, 8);
  assert.equal(summary.notReached, 5);
  assert.equal(summary.partial, true);
  assert.ok(seen.every((t) => t <= 20_000));
  assert.equal(pages.filter((p) => p.pageSpeedError === PSI_NOT_REACHED_NOTE).length, 5);
});

test("batch: the per-page timeout never exceeds what is left of the budget", async () => {
  let clock = 0;
  const seen: number[] = [];
  await measurePagesWithinBudget(
    pagesOf(2),
    async (_u, timeoutMs) => { seen.push(timeoutMs); clock += 10_000; return fakeResult; },
    { budgetMs: 25_000, perPageTimeoutMs: 20_000, minPageBudgetMs: 8_000, concurrency: 1, now: () => clock },
  );
  assert.deepEqual(seen, [20_000, 15_000]);
});

test("batch: unmeasured pages go first so a second run finishes the rest", async () => {
  let clock = 0;
  const pages = pagesOf(4);
  const run = () => measurePagesWithinBudget(
    pages,
    async () => { clock += 20_000; return fakeResult; },
    { budgetMs: 48_000, minPageBudgetMs: 8_000, concurrency: 1, now: () => clock },
  );
  clock = 0;
  const first = await run();
  assert.equal(first.measured, 3);
  assert.equal(first.partial, true);
  const second = await run();
  assert.equal(pages.filter((p) => p.pageSpeed).length, 4);
  assert.equal(second.measured, 4);
  assert.equal(second.partial, false);
  assert.ok(pages.every((p) => p.pageSpeedError === undefined));
});

test("batch: a non-timeout failure keeps its message and counts as failed", async () => {
  const pages = pagesOf(1);
  const summary = await measurePagesWithinBudget(pages, async () => { throw new Error("PSI fetch failed: HTTP 429"); });
  assert.equal(summary.failed, 1);
  assert.equal(pages[0].pageSpeedError, "PSI fetch failed: HTTP 429");
  assert.equal(pages[0].pageSpeed, undefined);
});

test("batch: a failed refresh keeps the earlier real scores", async () => {
  const pages: PageSpeedPage[] = [{ url: "https://x.test/a", pageSpeed: fakeResult.pageSpeed }];
  const summary = await measurePagesWithinBudget(pages, async () => { throw new PageSpeedTimeoutError(1); });
  assert.ok(pages[0].pageSpeed);
  assert.equal(summary.measured, 1);
  assert.equal(summary.partial, false);
});
