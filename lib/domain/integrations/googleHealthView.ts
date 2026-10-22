/**
 * What every Google surface (Settings badge, SEO card, GEO message, Traffic)
 * shows for the connection, decided in one pure place. The server already
 * reports `google: { connected, needsReconnect, reason }` on
 * GET /api/project/integrations. "Connected" means a connection exists; it only
 * counts as healthy when `needsReconnect` is false.
 */

export type GoogleHealthInput = {
  connected?: boolean;
  needsReconnect?: boolean;
  needs_reconnect?: boolean;
  reason?: string | null;
};

export type GoogleHealthState = "unknown" | "not_connected" | "needs_reconnect" | "connected";

export type GoogleHealthView = {
  state: GoogleHealthState;
  /** Badge for the Settings card; null when there is nothing to badge. */
  badge: { label: string; tone: "ok" | "warn" } | null;
  /** Plain-language sentence for the state; null when healthy and nothing to add. */
  message: string | null;
  showReconnect: boolean;
};

export const RECONNECT_TEXT = "Google connection needs to be reconnected.";

export function googleHealthView(google: GoogleHealthInput | null | undefined): GoogleHealthView {
  if (!google) return { state: "unknown", badge: null, message: null, showReconnect: false };
  if (google.connected !== true) return { state: "not_connected", badge: null, message: null, showReconnect: false };
  if (google.needsReconnect === true || google.needs_reconnect === true) {
    return {
      state: "needs_reconnect",
      badge: { label: "Needs reconnect", tone: "warn" },
      message: google.reason?.trim() || RECONNECT_TEXT,
      showReconnect: true,
    };
  }
  return { state: "connected", badge: { label: "Connected", tone: "ok" }, message: google.reason?.trim() || null, showReconnect: false };
}

/** The existing Google connect flow (one route for platform and self-host). */
export function googleReconnectHref(returnTo: "settings" | "dashboard"): string {
  return returnTo === "dashboard" ? "/api/auth/google-analytics/connect?return=dashboard" : "/api/auth/google-analytics/connect";
}

/** GEO "AI referral visits" text when there are no visits to show. Null means: render the normal result. */
export function referralNotice(
  health: GoogleHealthView,
  referral: "ok" | "not_connected" | "unavailable",
): { text: string; showReconnect: boolean } | null {
  if (health.state === "needs_reconnect" && referral !== "ok") return { text: RECONNECT_TEXT, showReconnect: true };
  if (referral === "unavailable") return { text: "We could not read Google Analytics right now.", showReconnect: false };
  if (referral === "not_connected") {
    return health.state === "connected"
      ? { text: "Choose a Google Analytics property on the SEO tab to see visits that come from AI assistants.", showReconnect: false }
      : { text: "Connect Google Analytics in Settings to see visits that come from AI assistants.", showReconnect: false };
  }
  return null;
}
