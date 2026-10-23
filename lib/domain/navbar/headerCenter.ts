// What the middle of the dashboard's top bar shows. Pure (no React) so it can be unit-tested.
import type { HeaderStatus } from "../../headerStatus.ts";

/** One number's availability, as the bar's data hooks report it. Nothing here is ever a guessed zero. */
export type StatInput =
  | { state: "ready"; value: number }
  | { state: "pending" } // still loading, or not loaded yet
  | { state: "error" }
  | { state: "connect" }; // needs Google to be connected (or reconnected)

export type StatKey = "clicks" | "findings" | "leads";

export type StatsInput = Record<StatKey, StatInput>;

export type StatItem = {
  key: StatKey;
  label: string;
  /** Compact number, an em dash when unavailable, or "Connect Google" when the item is a link. */
  display: string;
  /** Full sentence for the tooltip and the accessible name. */
  title: string;
  /** "connect-google": render as a link to the Traffic tab instead of plain text. */
  action: "connect-google" | null;
};

export type HeaderCenter =
  | { mode: "status"; kind: "running" | "done" | "error"; text: string }
  | { mode: "stats"; items: StatItem[] };

export const EM_DASH = "—";

/** 999 -> "999", 1234 -> "1.2K", 12400 -> "12K", 1_500_000 -> "1.5M". Not finite or negative -> em dash. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return EM_DASH;
  const v = Math.round(n);
  if (v < 1000) return String(v);
  const suffixes = ["K", "M", "B"];
  const oneDecimal = (x: number) => String(Math.round(x * 10) / 10);
  let x = v;
  let idx = -1;
  while (x >= 1000 && idx < suffixes.length - 1) {
    x /= 1000;
    idx++;
  }
  let text = x < 10 ? oneDecimal(x) : String(Math.round(x));
  // 999_950 rounds up to 1000K: roll into the next unit instead.
  if (Number(text) >= 1000 && idx < suffixes.length - 1) {
    text = oneDecimal(Number(text) / 1000);
    idx++;
  }
  return `${text}${suffixes[idx]}`;
}

const LABELS: Record<StatKey, { label: string; title: string }> = {
  clicks: { label: "Clicks 28d", title: "Search Console clicks, last 28 days" },
  findings: { label: "Open findings", title: "Open findings" },
  leads: { label: "Leads", title: "Leads" },
};

const ORDER: StatKey[] = ["clicks", "findings", "leads"];

export function statItem(key: StatKey, input: StatInput): StatItem {
  const { label, title } = LABELS[key];
  switch (input.state) {
    case "ready": {
      const display = formatCompact(input.value);
      if (display === EM_DASH) return { key, label, display, title: `${title}: not available`, action: null };
      return { key, label, display, title: `${title}: ${Math.round(input.value).toLocaleString("en-US")}`, action: null };
    }
    case "connect":
      return key === "clicks"
        ? { key, label, display: "Connect Google", title: `${title}: connect Google to see this`, action: "connect-google" }
        : { key, label, display: EM_DASH, title: `${title}: not available`, action: null };
    case "pending":
      return { key, label, display: EM_DASH, title: `${title}: loading`, action: null };
    case "error":
      return { key, label, display: EM_DASH, title: `${title}: not available`, action: null };
  }
}

/**
 * Busy (a job is running, or just finished/failed and has not gone quiet yet)
 * shows the status line. Everything else, including plain info lines and the
 * idle state, shows the numbers, so an idle bar never carries a stale message.
 */
export function headerCenter(status: HeaderStatus, stats: StatsInput): HeaderCenter {
  if (status.kind === "running" || status.kind === "done" || status.kind === "error") {
    return { mode: "status", kind: status.kind, text: status.text };
  }
  return { mode: "stats", items: ORDER.map((key) => statItem(key, stats[key])) };
}
