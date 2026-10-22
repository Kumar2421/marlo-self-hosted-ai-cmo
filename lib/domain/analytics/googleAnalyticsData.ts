import { ga4FromReport } from "@/lib/domain/analytics/trafficResult";
import { refreshAccessToken } from "@/lib/domain/shared/googleAnalyticsOAuth";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import {
  getIntegrationSecrets,
  getProjectIntegration,
  saveIntegrationSecrets,
  getSelectedIntegrationResource,
} from "@/lib/domain/integrations/integrationStore";

async function getValidAccessToken(): Promise<string> {
  const projectId = getActiveProjectId();
  if (!projectId) throw new Error("No active project — select or create a project first.");

  const integration =
    getProjectIntegration(projectId, "google-search-console") ??
    getProjectIntegration(projectId, "google-analytics");
  if (!integration) {
    throw new Error("Google Analytics / Search Console isn't connected for this project — connect it in Settings → API Credentials.");
  }

  const secrets = getIntegrationSecrets(integration.id);
  if (!secrets?.refreshToken) {
    throw new Error("Google Analytics / Search Console credentials are incomplete — reconnect this project.");
  }

  if (secrets.accessToken && Date.now() < secrets.expiresAt - 60_000) {
    return secrets.accessToken;
  }

  const refreshed = await refreshAccessToken(secrets.refreshToken);
  saveIntegrationSecrets(integration.id, {
    accessToken: refreshed.accessToken,
    refreshToken: secrets.refreshToken,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

export type SearchAnalyticsRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function fetchSearchAnalytics(
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 25000
): Promise<SearchAnalyticsRow[]> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Search Console query failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  return data.rows ?? [];
}

export type GA4Summary = { sessions: number; activeUsers: number; screenPageViews: number };

export async function fetchGA4Summary(propertyId: string, startDate: string, endDate: string): Promise<GA4Summary | null> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GA4 report failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  // No rows means no data (or no tag), reported as null rather than 0 sessions.
  return ga4FromReport(await res.json());
}

export function getSelectedSearchConsoleSite(projectId: string): string | null {
  const integration = getProjectIntegration(projectId, "google-search-console");
  return integration ? getSelectedIntegrationResource(integration.id, "search_console_property")?.resourceId ?? null : null;
}

export function getSelectedGA4Property(projectId: string): { id: string; name: string } | null {
  const integration = getProjectIntegration(projectId, "google-analytics");
  const resource = integration ? getSelectedIntegrationResource(integration.id, "ga4_property") : null;
  return resource ? { id: resource.resourceId, name: resource.resourceName } : null;
}

/** Generic GA4 runReport (self-host token). Returns the raw report JSON. */
export async function fetchGA4Report(propertyId: string, body: unknown): Promise<{ rows?: unknown[] }> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GA4 report failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  return res.json();
}
