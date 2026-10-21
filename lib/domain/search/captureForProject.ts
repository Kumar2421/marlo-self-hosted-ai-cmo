import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { fetchSearchAnalytics, getSelectedSearchConsoleSite } from "@/lib/domain/analytics/googleAnalyticsData";
import { getSelectedSearchConsoleSite as getSelectedSearchConsoleSiteSupabase, listConnectionHealth } from "@/lib/domain/integrations/integrationStoreSupabase";
import { getValidPlatformGoogleToken } from "@/lib/domain/shared/getValidPlatformGoogleToken";
import { captureSearchSnapshot, fetchSearchAnalyticsWithToken } from "./searchConsoleClient";
import type { SearchSnapshotPayload } from "./searchSnapshot";
import { saveSnapshot } from "./searchSnapshotStore";
import { saveSnapshot as saveSnapshotSupabase } from "./searchSnapshotStoreSupabase";

const NEEDS_RECONNECT = "Google connection needs to be reconnected: reconnect Google in Settings, then the daily snapshot resumes.";
const NO_PROPERTY = "No Search Console property is selected for this project — pick one in Settings → Integrations.";

/** Platform mode: capture and store today's snapshot for one project. */
export async function captureProjectSnapshotPlatform(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  now = new Date(),
): Promise<SearchSnapshotPayload> {
  // A connection already known to be broken would only fail again (and spend the cron budget).
  if ((await listConnectionHealth(db, userId, projectId)).some((health) => health.status === "needs_reconnect")) {
    throw new Error(NEEDS_RECONNECT);
  }
  const siteUrl = await getSelectedSearchConsoleSiteSupabase(db, userId, projectId);
  if (!siteUrl) throw new Error(NO_PROPERTY);
  // getValidPlatformGoogleToken records invalid_grant / invalid_client on the connection when the refresh is rejected.
  const accessToken = await getValidPlatformGoogleToken(db, userId, projectId);
  const payload = await captureSearchSnapshot(
    (site, start, end, dimensions, limit) => fetchSearchAnalyticsWithToken(accessToken, site, start, end, dimensions, limit),
    siteUrl,
    now,
  );
  await saveSnapshotSupabase(db, userId, projectId, payload, now);
  return payload;
}

/** Self-host mode: same, against the local SQLite store. */
export async function captureProjectSnapshotSelfHost(projectId: string, now = new Date()): Promise<SearchSnapshotPayload> {
  const siteUrl = getSelectedSearchConsoleSite(projectId);
  if (!siteUrl) throw new Error(NO_PROPERTY);
  const payload = await captureSearchSnapshot(fetchSearchAnalytics, siteUrl, now);
  saveSnapshot(getDb(), projectId, payload, now);
  return payload;
}
