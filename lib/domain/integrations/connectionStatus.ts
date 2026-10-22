export type ConnectionHealth = { status: string | null; lastErrorCode: string | null; lastErrorAt: string | null };

export type GoogleConnectionStatus = {
  connected: boolean;
  needsReconnect: boolean;
  reason: string | null;
  lastSyncAt: string | null;
};

const REASONS: Record<string, string> = {
  invalid_client: "Google rejected this app's OAuth client. The Google sign-in configuration on the server needs fixing before reconnecting will work.",
  invalid_grant: "Google access was revoked or expired. Reconnect Google.",
};

export function isNeedsReconnect(health: ConnectionHealth | null | undefined): boolean {
  return health?.status === "needs_reconnect";
}

/** The most urgent health among a project's Google rows (needs_reconnect wins). */
export function worstHealth(rows: Array<ConnectionHealth | null | undefined>): ConnectionHealth | null {
  const present = rows.filter((row): row is ConnectionHealth => !!row);
  return present.find(isNeedsReconnect) ?? present[0] ?? null;
}

/**
 * What the UI banner needs, built from rows already read. `connected` means a
 * Google connection exists, not that it works: `needsReconnect` says it does not.
 * `hasProperty` is null when unknown.
 */
export function buildGoogleConnectionStatus(input: {
  connected: boolean;
  health: ConnectionHealth | null;
  hasProperty: boolean | null;
  lastSyncAt: string | null;
}): GoogleConnectionStatus {
  const { connected, health, hasProperty, lastSyncAt } = input;
  if (!connected) return { connected: false, needsReconnect: false, reason: null, lastSyncAt };
  if (isNeedsReconnect(health)) {
    const code = health?.lastErrorCode ?? "";
    return {
      connected: true,
      needsReconnect: true,
      reason: REASONS[code] ?? "Google connection needs attention. Reconnect Google.",
      lastSyncAt,
    };
  }
  if (hasProperty === false) {
    return { connected: true, needsReconnect: false, reason: "No Search Console property is selected for this project.", lastSyncAt };
  }
  return { connected: true, needsReconnect: false, reason: null, lastSyncAt };
}
