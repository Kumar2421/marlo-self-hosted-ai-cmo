/**
 * What the SEO tab's "Google data" card shows before the user opens it. Pure and built on the
 * shared `googleHealthView`, so "connected", "needs reconnect" and "not connected" mean the same
 * thing here as in Settings. The card is only collapsed once there is nothing left to set up
 * (a site and property are chosen); until then the full card stays, because the user has work to do.
 */
import type { GoogleHealthView } from "./googleHealthView.ts";

export type GoogleCardSummary =
  | { mode: "full" }
  | { mode: "connect"; canReuse: boolean; email: string | null }
  | { mode: "summary"; tone: "ok" | "warn"; site: string | null; property: string | null; syncLabel: string; message: string | null; showReconnect: boolean };

export type GoogleCardSummaryInput = {
  health: GoogleHealthView;
  account: { connectedHere: boolean; canReuse: boolean; email: string | null };
  /** Every chosen resource's name, by kind; null when none is chosen. */
  selected: { site: string | null; property: string | null };
  /** True when every integration that has resources has one chosen (nothing left to set up). */
  ready: boolean;
  now?: Date;
};

/** "Synced today", "Synced yesterday", "Synced 3 days ago", or an honest "Not synced yet". */
export function syncLabel(lastSyncAt: string | null | undefined, now: Date = new Date()): string {
  if (!lastSyncAt) return "Not synced yet";
  const at = new Date(lastSyncAt);
  if (Number.isNaN(at.getTime())) return "Not synced yet";
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (days <= 0) return "Synced today";
  if (days === 1) return "Synced yesterday";
  return `Synced ${days} days ago`;
}

export function buildGoogleCardSummary(input: GoogleCardSummaryInput): GoogleCardSummary {
  const { health, account, selected, ready } = input;
  if (!account.connectedHere) return { mode: "connect", canReuse: account.canReuse, email: account.email };
  if (!ready) return { mode: "full" };
  return {
    mode: "summary",
    tone: health.state === "needs_reconnect" ? "warn" : "ok",
    site: selected.site,
    property: selected.property,
    syncLabel: syncLabel(health.lastSyncAt, input.now),
    message: health.state === "needs_reconnect" ? health.message : null,
    showReconnect: health.showReconnect,
  };
}
