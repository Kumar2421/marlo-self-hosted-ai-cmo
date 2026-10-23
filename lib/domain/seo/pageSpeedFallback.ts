/** Last good PageSpeed scores per URL. The audit row already stored for a URL (seo_audits, one row per
 * project+url) is the cache: when a new run gets no PageSpeed answer, the previous scores are carried
 * over under their own key with the date they were measured. They are never written into `pageSpeed`,
 * so a stale score cannot pass as a fresh one (findings and `checksRan` keep reading `pageSpeed` only). */

import type { PageSpeedResult } from "./pageSpeedInsights.ts";

export type LastGoodPageSpeed = {
  /** ISO time the scores were measured. */
  measuredAt: string;
  pageSpeed: PageSpeedResult["pageSpeed"];
  coreWebVitals?: PageSpeedResult["coreWebVitals"];
};

/** The slice of an audit payload this module reads (a stored payload may be old or partial). */
export type PageSpeedCarrier = {
  pageSpeed?: PageSpeedResult["pageSpeed"];
  pageSpeedMeasuredAt?: string;
  coreWebVitals?: PageSpeedResult["coreWebVitals"];
  lastGoodPageSpeed?: LastGoodPageSpeed;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * The last good scores found in a previously stored audit, or null. A previous run that itself had
 * fresh scores wins (dated by `pageSpeedMeasuredAt`, else the row's `created_at`); otherwise its own
 * carried-over scores are passed along with their original date.
 */
export function lastGoodFromPrevious(previous: PageSpeedCarrier | null | undefined, previousCreatedAt: string | null | undefined): LastGoodPageSpeed | null {
  if (!previous) return null;
  if (previous.pageSpeed) {
    const measuredAt = validIso(previous.pageSpeedMeasuredAt) ? previous.pageSpeedMeasuredAt : validIso(previousCreatedAt) ? previousCreatedAt : null;
    if (!measuredAt) return null;
    return { measuredAt, pageSpeed: previous.pageSpeed, coreWebVitals: previous.coreWebVitals };
  }
  const carried = previous.lastGoodPageSpeed;
  if (carried?.pageSpeed && validIso(carried.measuredAt)) return carried;
  return null;
}

/** Adds `lastGoodPageSpeed` to a new payload only when this run measured nothing. Returns the payload unchanged otherwise. */
export function withLastGoodPageSpeed<T extends PageSpeedCarrier & { pageSpeedUnavailable?: string }>(
  next: T,
  previous: PageSpeedCarrier | null | undefined,
  previousCreatedAt: string | null | undefined,
): T {
  if (next.pageSpeed || !next.pageSpeedUnavailable) return next;
  const lastGood = lastGoodFromPrevious(previous, previousCreatedAt);
  return lastGood ? { ...next, lastGoodPageSpeed: lastGood } : next;
}

/** "5 days ago" style label for the UI, from an ISO date; falls back to the date itself. */
export function describeAge(measuredAt: string, now: number = Date.now()): string {
  const t = Date.parse(measuredAt);
  if (Number.isNaN(t)) return measuredAt;
  const days = Math.floor((now - t) / 86_400_000);
  const date = new Date(t).toISOString().slice(0, 10);
  if (days <= 0) return `earlier today (${date})`;
  if (days === 1) return `1 day ago (${date})`;
  return `${days} days ago (${date})`;
}
