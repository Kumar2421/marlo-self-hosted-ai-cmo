/**
 * What the Traffic header should render, decided in one pure place so the UI
 * only maps this to markup. Cards exist only when there are real totals.
 */

import type { TrafficStatus, TrafficTotals } from "./trafficResult.ts";

/** The parts of the Traffic API response the header needs. Older responses lack `status`, so everything is optional. */
export type TrafficResponseLike = {
  status?: TrafficStatus;
  reason?: string | null;
  needsReconnect?: boolean;
  needs_reconnect?: boolean;
  totals?: TrafficTotals | null;
  byDate?: unknown[] | null;
  site?: string | null;
  gscError?: string | null;
};

export type TrafficCard = { key: "clicks" | "impressions" | "ctr" | "position"; label: string; value: string };

export type TrafficView = {
  kind: "cards" | "no_data" | "error" | "not_connected";
  cards: TrafficCard[];
  /** Text to show instead of cards; null when cards are shown. */
  message: string | null;
  showReconnect: boolean;
};

export const NO_DATA_TEXT = "No data yet: Google reports no search clicks or views for this period.";

const num = (n: number) => Math.round(n).toLocaleString("en-US");

function inferStatus(r: TrafficResponseLike): TrafficStatus {
  if (r.status) return r.status;
  if (!r.site) return "not_connected";
  if (r.gscError) return "error";
  return r.totals ? "ok" : "no_data";
}

export function buildTrafficView(response: TrafficResponseLike | null | undefined): TrafficView {
  const r = response ?? {};
  const status = inferStatus(r);
  const reconnect = r.needsReconnect === true || r.needs_reconnect === true;

  if (status === "ok" && r.totals) {
    const t = r.totals;
    return {
      kind: "cards",
      message: null,
      showReconnect: false,
      cards: [
        { key: "clicks", label: "Total Clicks", value: num(t.clicks) },
        { key: "impressions", label: "Impressions", value: num(t.impressions) },
        { key: "ctr", label: "Click Rate", value: `${(t.ctr * 100).toFixed(1)}%` },
        // Position 0 means "no data", so it is only ever shown with impressions behind it.
        { key: "position", label: "Avg. Position", value: t.impressions > 0 && t.position > 0 ? t.position.toFixed(1) : "—" },
      ],
    };
  }
  if (status === "error") {
    return {
      kind: "error",
      cards: [],
      message: r.reason ?? "We couldn't load your search data from Google. Try again.",
      showReconnect: reconnect,
    };
  }
  if (status === "not_connected") {
    return { kind: "not_connected", cards: [], message: r.reason ?? "Search Console isn't connected for this project.", showReconnect: false };
  }
  return { kind: "no_data", cards: [], message: r.reason ?? NO_DATA_TEXT, showReconnect: false };
}
