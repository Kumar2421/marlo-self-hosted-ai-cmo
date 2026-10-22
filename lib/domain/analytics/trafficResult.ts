/**
 * Pure helpers for the Traffic API response. No IO.
 *
 * Rule: a failed or empty Google response is never reported as zeros. The
 * response says what happened (`status`), why (`reason`), whether the user can
 * fix it by reconnecting (`needsReconnect`), and carries `totals: null`.
 */

export type TrafficStatus = "ok" | "no_data" | "error" | "not_connected";

export type TrafficDay = { date: string; clicks: number; impressions: number; ctr: number; position: number };
export type TrafficTotals = { clicks: number; impressions: number; ctr: number; position: number };

/** The 28-day window ending at the freshest day Search Console has (3 days ago). UTC throughout, like the snapshots. */
export function trafficWindow(now: Date = new Date()): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 27));
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

/** Totals from the daily rows, position weighted by impressions. Null when there is nothing to total. */
export function totalsFromDays(days: TrafficDay[]): TrafficTotals | null {
  const impressions = days.reduce((sum, r) => sum + r.impressions, 0);
  const clicks = days.reduce((sum, r) => sum + r.clicks, 0);
  if (days.length === 0 || (impressions === 0 && clicks === 0)) return null;
  const weighted = days.reduce((sum, r) => sum + r.position * r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : 0,
  };
}

const RECONNECT = /invalid_grant|invalid_client|unauthorized_client|token request failed|HTTP 40[13]\b|isn't connected|credentials are incomplete|reconnect/i;

/** Plain-language reason for a Google failure, and whether reconnecting is the fix. Never echoes Google's raw body. */
export function classifyGoogleError(message: string): { reason: string; needsReconnect: boolean } {
  if (RECONNECT.test(message)) {
    return { reason: "Google didn't accept the saved connection. Reconnect Google in Settings to see this data.", needsReconnect: true };
  }
  const http = /HTTP (\d{3})/.exec(message)?.[1];
  if (http === "429") return { reason: "Google is rate limiting requests right now. Try again in a few minutes.", needsReconnect: false };
  if (http && http.startsWith("5")) return { reason: "Google had a problem answering. Try again in a few minutes.", needsReconnect: false };
  return { reason: "We couldn't load this data from Google. Try again.", needsReconnect: false };
}

export type SearchTraffic = {
  status: TrafficStatus;
  /** Short, user-facing sentence; null when status is "ok". */
  reason: string | null;
  needsReconnect: boolean;
  totals: TrafficTotals | null;
  byDate: TrafficDay[];
};

/** The Search Console half of the response. `error` is the caught message, if the calls threw. */
export function searchTraffic(args: { connected: boolean; error: string | null; byDate: TrafficDay[] }): SearchTraffic {
  if (!args.connected) {
    return { status: "not_connected", reason: "Search Console isn't connected for this project.", needsReconnect: false, totals: null, byDate: [] };
  }
  if (args.error) {
    const { reason, needsReconnect } = classifyGoogleError(args.error);
    return { status: "error", reason, needsReconnect, totals: null, byDate: [] };
  }
  const totals = totalsFromDays(args.byDate);
  if (!totals) {
    return {
      status: "no_data",
      reason: "Google reports no search clicks or views for this period yet. New sites and properties can take a few days.",
      needsReconnect: false,
      totals: null,
      byDate: [],
    };
  }
  return { status: "ok", reason: null, needsReconnect: false, totals, byDate: args.byDate };
}

export type Ga4Summary = { sessions: number; activeUsers: number; screenPageViews: number };

/** A GA4 report with no rows means no data (or no tag), not zero sessions. */
export function ga4FromReport(report: {
  rows?: Array<{ metricValues?: Array<{ value: string }> }>;
}): Ga4Summary | null {
  const values = report.rows?.[0]?.metricValues?.map((m) => Number(m.value));
  if (!values || values.length < 3 || values.some((n) => !Number.isFinite(n))) return null;
  return { sessions: values[0], activeUsers: values[1], screenPageViews: values[2] };
}
