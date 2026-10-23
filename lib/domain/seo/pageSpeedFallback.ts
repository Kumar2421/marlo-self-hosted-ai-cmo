/** Last good PageSpeed scores per URL. The audit row already stored for a URL (seo_audits, one row per
 * project+url) is the cache: when a new run gets no PageSpeed answer, the previous scores are carried
 * over under their own key with the date they were measured. They are never written into `pageSpeed`,
 * so a stale score cannot pass as a fresh one (findings and `checksRan` keep reading `pageSpeed` only). */

import type { CwvSnapshot, LighthouseIssue, PageSpeedResult, PageSpeedScores, PageSpeedStrategy } from "./pageSpeedInsights.ts";

/** One strategy's measurement, parked until the other strategy arrives (the UI needs both to draw scores). */
export type StrategyMeasure = { scores: PageSpeedScores; cwv: CwvSnapshot; issues: LighthouseIssue[]; measuredAt: string };

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
  lighthouseIssues?: PageSpeedResult["lighthouseIssues"];
  /** Strategies measured by the dedicated route so far. Promoted into pageSpeed once both are present. */
  pageSpeedPartial?: Partial<Record<PageSpeedStrategy, StrategyMeasure>>;
  pageSpeedUnavailable?: string;
  /** Bumped on every merge; the Supabase update is conditional on it so parallel merges cannot overwrite each other. */
  pageSpeedRev?: number;
  issues?: { label: string; level: string }[];
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

const PSI_NOTICE = /^(PageSpeed Insights\b|Failed to fetch PageSpeed)/i;

/**
 * Pure: fold one strategy's measurement into a stored audit payload. Merges by strategy key, so mobile and
 * desktop measured in either order (or re-applied) end up identical. Scores are only written to `pageSpeed`
 * once both strategies are present; until then the first one waits in `pageSpeedPartial`. A payload that
 * already has fresh scores is left alone. `changed` is false when nothing needs writing.
 */
export function mergeStrategyMeasure<T extends PageSpeedCarrier>(
  payload: T,
  strategy: PageSpeedStrategy,
  measure: StrategyMeasure,
): { payload: T; changed: boolean } {
  if (payload.pageSpeed) return { payload, changed: false };
  const partial = { ...(payload.pageSpeedPartial ?? {}), [strategy]: measure };
  const { mobile, desktop } = partial;
  if (!mobile || !desktop) return { payload: { ...payload, pageSpeedPartial: partial }, changed: true };

  const { pageSpeedPartial: _drop, pageSpeedUnavailable: _unavailable, ...rest } = payload;
  void _drop;
  void _unavailable;
  const measuredAt = mobile.measuredAt > desktop.measuredAt ? mobile.measuredAt : desktop.measuredAt;
  const merged = {
    ...rest,
    pageSpeed: { desktop: desktop.scores, mobile: mobile.scores },
    coreWebVitals: { desktop: desktop.cwv, mobile: mobile.cwv },
    lighthouseIssues: { desktop: desktop.issues, mobile: mobile.issues },
    pageSpeedMeasuredAt: measuredAt,
    ...(rest.issues ? { issues: rest.issues.filter((i) => !PSI_NOTICE.test(i.label)) } : {}),
  } as unknown as T;
  return { payload: merged, changed: true };
}
