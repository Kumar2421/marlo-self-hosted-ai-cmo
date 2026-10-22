/** Real OAuth2 for GA4 + Search Console — same pattern as gmailOAuth.ts (raw
 * fetch, no `googleapis` package). Reuses the SAME app-level OAuth client
 * (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET) as Gmail — one Google Cloud project
 * can issue one OAuth client covering multiple scopes, so this is a separate
 * consent flow (different scopes, own token set) rather than a second client
 * the user would have to create and paste in again. */

import { GoogleAuthError, envValue, parseGoogleApiError, parseGoogleTokenError } from "./googleAuthError.ts";
import { checkGoogleServiceScopes } from "../integrations/googleScopes.ts";

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export type GoogleTokens = { accessToken: string; refreshToken?: string; expiresAt: number };

export function buildAuthUrl(redirectUri: string, state?: string): string {
  const clientId = envValue(process.env.GMAIL_CLIENT_ID);
  if (!clientId) throw new Error("GMAIL_CLIENT_ID not set — add it in Settings → API Credentials, then restart the server.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const clientId = envValue(process.env.GMAIL_CLIENT_ID);
  const clientSecret = envValue(process.env.GMAIL_CLIENT_SECRET);
  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET not set.");

  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
  } catch {
    // The underlying error can carry request details; keep only the typed code.
    throw new GoogleAuthError("network");
  }
  if (!res.ok) throw parseGoogleTokenError(res.status, await res.text().catch(() => ""));
  return res.json();
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokens> {
  const data = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const data = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

export async function getConnectedEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email ?? null;
  } catch {
    return null;
  }
}

/** Throws GoogleAuthError (never returns [] for a failure, so "no sites" and "call failed" differ). */
async function googleGet(url: string, accessToken: string): Promise<{ [key: string]: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new GoogleAuthError("network");
  }
  if (!res.ok) throw parseGoogleApiError(res.status, await res.text().catch(() => ""));
  return (await res.json()) as { [key: string]: unknown };
}

/** All Search Console properties visible to this Google account. Throws GoogleAuthError on failure. */
export async function listSearchConsoleSites(accessToken: string): Promise<string[]> {
  const data = await googleGet("https://www.googleapis.com/webmasters/v3/sites", accessToken);
  const entries = (data.siteEntry ?? []) as { siteUrl: string }[];
  return entries.map((entry) => entry.siteUrl).filter(Boolean);
}

/** All GA4 properties visible to this Google account. Throws GoogleAuthError on failure. */
export async function listGA4Properties(accessToken: string): Promise<{ id: string; name: string }[]> {
  const data = await googleGet("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", accessToken);
  const properties: { id: string; name: string }[] = [];
  for (const account of (data.accountSummaries ?? []) as { propertySummaries?: { property?: string; displayName?: string }[] }[]) {
    for (const property of account.propertySummaries ?? []) {
      if (property.property) {
        properties.push({ id: property.property, name: property.displayName ?? property.property });
      }
    }
  }
  return properties;
}

export type DiscoveredGoogleResources = {
  gscSites: string[];
  ga4Properties: { id: string; name: string }[];
  /** True only when the listing call succeeded; an empty list from a failed call must not replace stored resources. */
  gscListed: boolean;
  ga4Listed: boolean;
  /** Plain-language problems, one per failed or ungranted service. Empty means everything asked for worked. */
  problems: string[];
};

/**
 * Lists Search Console sites and GA4 properties after a connect. A service whose
 * permission was not granted is not called; a service whose call fails is
 * reported in `problems` instead of silently becoming an empty list.
 * `grantedScopes` null means the grant could not be read: both are tried.
 */
export async function discoverGoogleResources(accessToken: string, grantedScopes: string[] | null): Promise<DiscoveredGoogleResources> {
  const scopes = checkGoogleServiceScopes(grantedScopes);
  const problems: string[] = [];
  let gscSites: string[] = [];
  let ga4Properties: { id: string; name: string }[] = [];

  if (scopes.problem) {
    if (!scopes.gsc) problems.push("Search Console permission not granted: reconnect and tick it.");
    if (!scopes.ga4) problems.push("Google Analytics permission not granted: reconnect and tick it.");
  }
  const [gsc, ga4] = await Promise.allSettled([
    scopes.gsc ? listSearchConsoleSites(accessToken) : Promise.resolve([] as string[]),
    scopes.ga4 ? listGA4Properties(accessToken) : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const gscListed = scopes.gsc && gsc.status === "fulfilled";
  const ga4Listed = scopes.ga4 && ga4.status === "fulfilled";
  if (gsc.status === "fulfilled") gscSites = gsc.value;
  else problems.push(`Could not list Search Console sites: ${gsc.reason instanceof Error ? gsc.reason.message : "unknown error"}`);
  if (ga4.status === "fulfilled") ga4Properties = ga4.value;
  else problems.push(`Could not list Google Analytics properties: ${ga4.reason instanceof Error ? ga4.reason.message : "unknown error"}`);

  return { gscSites, ga4Properties, gscListed, ga4Listed, problems };
}

/** First GA4 property for this account, or null if none — used only as the
 * initial pick right after OAuth connect; the Traffic tab's picker is the
 * real source of truth after that. */
export async function listFirstGA4Property(accessToken: string): Promise<{ id: string; name: string } | null> {
  const properties = await listGA4Properties(accessToken);
  return properties[0] ? { id: properties[0].id, name: properties[0].name } : null;
}
