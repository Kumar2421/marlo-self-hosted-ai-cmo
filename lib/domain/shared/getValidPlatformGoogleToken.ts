import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAccessToken } from "./googleAnalyticsOAuth";
import { isGoogleAuthError, needsReconnect } from "./googleAuthError.ts";
import {
  getProjectIntegration,
  getIntegrationSecrets,
  markConnectionNeedsReconnect,
  saveIntegrationSecrets,
} from "@/lib/domain/integrations/integrationStoreSupabase";

const EXPIRY_SKEW_MS = 60_000;

/** Platform-mode mirror of googleAnalyticsData.ts's internal
 * getValidAccessToken() (self-host) — same project-scoped connection
 * lookup, same "try GSC row or GA4 row, either carries the same token"
 * reasoning, refreshing via the shared refreshAccessToken() when stale and
 * persisting the refreshed token back through the Vault-backed adapter. */
export async function getValidPlatformGoogleToken(
  db: SupabaseClient,
  userId: string,
  projectId: string
): Promise<string> {
  const integration =
    (await getProjectIntegration(db, userId, projectId, "google-search-console")) ??
    (await getProjectIntegration(db, userId, projectId, "google-analytics"));
  if (!integration) {
    throw new Error("Google Analytics / Search Console isn't connected for this project — connect it in Settings → API Credentials.");
  }

  const secrets = await getIntegrationSecrets(db, userId, integration.id);
  if (!secrets?.refreshToken) {
    throw new Error("Google Analytics / Search Console credentials are incomplete — reconnect this project.");
  }

  if (secrets.accessToken && Date.now() < secrets.expiresAt - EXPIRY_SKEW_MS) {
    return secrets.accessToken;
  }

  let refreshed;
  try {
    refreshed = await refreshAccessToken(secrets.refreshToken);
  } catch (err) {
    // A revoked or mismatched grant will not recover by itself: remember it so the cron stops retrying and the UI can say so.
    if (isGoogleAuthError(err) && needsReconnect(err.code)) {
      await markConnectionNeedsReconnect(db, userId, projectId, integration.integrationType, err.code);
    }
    throw err;
  }
  await saveIntegrationSecrets(db, userId, integration.id, {
    accessToken: refreshed.accessToken,
    refreshToken: secrets.refreshToken,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}
