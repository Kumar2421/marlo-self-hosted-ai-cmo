/** Deadline-bounded PageSpeed over many crawled pages, so the route finishes
 * (and saves) inside its 60s serverless limit instead of timing out and losing
 * every score. Pages are measured in small parallel chunks; once the budget is
 * spent the rest are left "not measured" and the caller gets partial counts. */

import { isPageSpeedTimeout, PSI_TIMEOUT_MS, type PageSpeedResult } from "./pageSpeedInsights.ts";

/** Total time the PageSpeed route spends measuring (maxDuration 60 minus save + response margin). */
export const PSI_ROUTE_BUDGET_MS = 48_000;
/** Pages measured at the same time (each page is already desktop + mobile in parallel). */
export const PSI_BATCH_CONCURRENCY = 3;
/** A page is only started when at least this much budget remains. */
export const PSI_MIN_PAGE_BUDGET_MS = 8_000;

export const PSI_TIMED_OUT_NOTE = "Not measured: PageSpeed timed out for this page.";
export const PSI_NOT_REACHED_NOTE = "Not measured yet: ran out of time this run. Run PageSpeed again to continue.";

export type PageSpeedPage = {
  url: string;
  pageSpeed?: PageSpeedResult["pageSpeed"];
  pageSpeedError?: string;
};

export type PageSpeedBatchSummary = {
  /** Pages that have PageSpeed scores after this run (this run's plus earlier ones kept). */
  measured: number;
  total: number;
  /** Pages measured by this run. */
  measuredThisRun: number;
  timedOut: number;
  failed: number;
  /** Never started because the budget ran out. */
  notReached: number;
  partial: boolean;
};

export type PageSpeedBatchOptions = {
  budgetMs?: number;
  perPageTimeoutMs?: number;
  concurrency?: number;
  minPageBudgetMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export async function measurePagesWithinBudget(
  pages: PageSpeedPage[],
  measure: (url: string, timeoutMs: number) => Promise<PageSpeedResult>,
  options: PageSpeedBatchOptions = {},
): Promise<PageSpeedBatchSummary> {
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? PSI_ROUTE_BUDGET_MS;
  const perPage = options.perPageTimeoutMs ?? PSI_TIMEOUT_MS;
  const minBudget = options.minPageBudgetMs ?? PSI_MIN_PAGE_BUDGET_MS;
  const concurrency = Math.max(1, options.concurrency ?? PSI_BATCH_CONCURRENCY);
  const deadline = now() + budgetMs;

  // Unmeasured pages first, so repeated runs finish the rest before refreshing old scores.
  const queue = [...pages].sort((a, b) => Number(Boolean(a.pageSpeed)) - Number(Boolean(b.pageSpeed)));
  let next = 0;
  let measuredThisRun = 0;
  let timedOut = 0;
  let failed = 0;
  let notReached = 0;

  async function worker() {
    for (;;) {
      const remaining = deadline - now();
      if (next >= queue.length) return;
      const page = queue[next++];
      if (remaining < minBudget) {
        // Budget spent: this page and everything after it is left alone.
        if (!page.pageSpeed) {
          page.pageSpeedError = PSI_NOT_REACHED_NOTE;
          notReached++;
        }
        continue;
      }
      try {
        const result = await measure(page.url, Math.min(perPage, remaining));
        page.pageSpeed = result.pageSpeed;
        page.pageSpeedError = undefined;
        measuredThisRun++;
      } catch (e) {
        if (isPageSpeedTimeout(e)) {
          timedOut++;
          page.pageSpeedError = PSI_TIMED_OUT_NOTE;
        } else {
          failed++;
          page.pageSpeedError = e instanceof Error ? e.message : "PageSpeed fetch failed";
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  const measured = pages.filter((p) => p.pageSpeed).length;
  return { measured, total: pages.length, measuredThisRun, timedOut, failed, notReached, partial: measured < pages.length };
}
