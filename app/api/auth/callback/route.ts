import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { FEATURES } from "@/lib/features";
import { getConnectedEmail, listSearchConsoleSites, listGA4Properties } from "@/lib/domain/shared/googleAnalyticsOAuth";
import { getConnectedEmail as getGmailConnectedEmail } from "@/lib/domain/shared/gmailOAuth";
import { fetchGrantedScopes } from "@/lib/domain/shared/googleTokenInfo";
import { grantedServices } from "@/lib/googleOAuthScopes";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import {
  upsertProjectIntegration,
  saveIntegrationSecrets,
  replaceIntegrationResources,
} from "@/lib/domain/integrations/integrationStore";
import {
  upsertProjectIntegration as upsertProjectIntegrationSupabase,
  saveIntegrationSecrets as saveIntegrationSecretsSupabase,
  replaceIntegrationResources as replaceIntegrationResourcesSupabase,
} from "@/lib/domain/integrations/integrationStoreSupabase";

/** Production only: a Google sign-in that requested the GA4/Search Console
 * scopes (see app/login/page.tsx) hands back provider_token/
 * provider_refresh_token on the session — reuse those to seed a real
 * project_integrations connection (same shape the manual "Connect Google
 * Analytics" flow creates — see auth/google-analytics/callback/route.ts),
 * so the Settings resource picker and Traffic tab need zero special-casing
 * for "connected via login" vs "connected manually". No auto-pick of a
 * single site/property anymore (PR#3 removed that guessing) — every real
 * site/property found gets listed as a resource; the user picks in
 * Settings → API Credentials if there's more than one. Self-host mode
 * never requests these scopes, so providerToken is simply absent there and
 * this is a no-op. Requires an active project to attach to — if none
 * exists yet (brand new install, no project created), this silently skips;
 * the user can always connect manually later once a project exists. */
async function persistPlatformGmailTokens(
  userId: string,
  providerToken: string,
  providerRefreshToken: string
) {
  const db = createServiceClient();
  const [email, scopes] = await Promise.all([getGmailConnectedEmail(providerToken), fetchGrantedScopes(providerToken)]);
  const now = new Date().toISOString();

  const [{ data: accessSecretId, error: accessErr }, { data: refreshSecretId, error: refreshErr }] =
    await Promise.all([
      db.rpc("vault_set_secret", { p_secret: providerToken, p_name: `gmail_token:${userId}:access` }),
      db.rpc("vault_set_secret", { p_secret: providerRefreshToken, p_name: `gmail_token:${userId}:refresh` }),
    ]);

  if (accessErr || refreshErr) {
    throw new Error(accessErr?.message ?? refreshErr?.message ?? "Failed to store Gmail token");
  }

  const { error } = await db.from("integration_connections").upsert(
    {
      user_id: userId,
      project_id: null,
      provider: "gmail",
      access_token_secret_id: accessSecretId as string,
      refresh_token_secret_id: refreshSecretId as string,
      token_expiry: now,
      external_email: email ?? null,
      external_property: null,
      // Google lets people untick individual permissions, so record what was really granted.
      scopes,
      updated_at: now,
    },
    { onConflict: "user_id,project_id,provider" }
  );

  if (error) throw new Error(error.message);
}

async function persistGoogleServiceTokensSupabase(
  userId: string,
  providerToken: string,
  providerRefreshToken: string
) {
  const db = createServiceClient();
  const { data: setting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "active_project_id")
    .maybeSingle();
  const projectId = setting?.value;
  if (!projectId) return;

  const [email, gscSites, ga4Properties] = await Promise.all([
    getConnectedEmail(providerToken),
    listSearchConsoleSites(providerToken),
    listGA4Properties(providerToken),
  ]);
  // expiresAt isn't reported on the Supabase session — treat as already
  // stale so the first real API call refreshes it rather than trusting a
  // made-up TTL.
  const now = new Date().toISOString();

  const gsc = await upsertProjectIntegrationSupabase(db, userId, {
    projectId,
    integrationType: "google-search-console",
    accountIdentifier: email,
    connectedAt: now,
  });
  const ga4 = await upsertProjectIntegrationSupabase(db, userId, {
    projectId,
    integrationType: "google-analytics",
    accountIdentifier: email,
    connectedAt: now,
  });

  await Promise.all([
    saveIntegrationSecretsSupabase(db, userId, gsc.id, { accessToken: providerToken, refreshToken: providerRefreshToken, expiresAt: 0 }),
    saveIntegrationSecretsSupabase(db, userId, ga4.id, { accessToken: providerToken, refreshToken: providerRefreshToken, expiresAt: 0 }),
  ]);

  await Promise.all([
    replaceIntegrationResourcesSupabase(
      db,
      userId,
      gsc.id,
      gscSites.map((site) => ({ resourceType: "search_console_property", resourceId: site, resourceName: site, metadata: {} }))
    ),
    replaceIntegrationResourcesSupabase(
      db,
      userId,
      ga4.id,
      ga4Properties.map((property) => ({ resourceType: "ga4_property", resourceId: property.id, resourceName: property.name, metadata: {} }))
    ),
  ]);
}

/** Self-host mirror of the above — same real project_integrations rows the
 * manual connect flow creates, just triggered by the Google sign-in's
 * provider tokens instead of a dedicated OAuth round-trip. */
async function persistGoogleServiceTokens(providerToken: string, providerRefreshToken: string | undefined) {
  if (!providerRefreshToken) return;

  const projectId = getActiveProjectId();
  if (!projectId) return;

  const [email, gscSites, ga4Properties] = await Promise.all([
    getConnectedEmail(providerToken),
    listSearchConsoleSites(providerToken),
    listGA4Properties(providerToken),
  ]);

  const now = new Date().toISOString();
  const gsc = upsertProjectIntegration({
    projectId,
    provider: "google",
    integrationType: "google-search-console",
    accountIdentifier: email,
    connectedAt: now,
  });
  const ga4 = upsertProjectIntegration({
    projectId,
    provider: "google",
    integrationType: "google-analytics",
    accountIdentifier: email,
    connectedAt: now,
  });

  saveIntegrationSecrets(gsc.id, { accessToken: providerToken, refreshToken: providerRefreshToken, expiresAt: 0 });
  saveIntegrationSecrets(ga4.id, { accessToken: providerToken, refreshToken: providerRefreshToken, expiresAt: 0 });

  replaceIntegrationResources(
    gsc.id,
    gscSites.map((site) => ({ resourceType: "search_console_property", resourceId: site, resourceName: site, metadata: {} }))
  );
  replaceIntegrationResources(
    ga4.id,
    ga4Properties.map((property) => ({ resourceType: "ga4_property", resourceId: property.id, resourceName: property.name, metadata: {} }))
  );
}

// Exchanges the OAuth `code` Supabase redirects back with for a session.
// Requires the provider (Google) to actually be enabled in the Supabase
// project's Auth settings — this route alone doesn't grant that.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextParam = request.nextUrl.searchParams.get("next");
  const base = request.nextUrl.origin;

  let destination = "/dashboard";
  let hasGoogleServiceScopes = false;

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${base}/login?error=auth`);
    }

    // Plain sign-in (identity scopes only) also returns a provider_token, so
    // only treat the session as a service connect when Google granted
    // Gmail or Analytics/Search Console scopes.
    const providerToken = data.session?.provider_token;
    const services = providerToken
      ? grantedServices(await fetchGrantedScopes(providerToken), !!data.session?.provider_refresh_token)
      : { gmail: false, googleData: false };
    if (providerToken && (services.gmail || services.googleData)) {
      hasGoogleServiceScopes = true;
      try {
        if (FEATURES.PLATFORM_MODE) {
          if (data.session?.provider_refresh_token && data.user) {
            if (services.googleData) {
              await persistGoogleServiceTokensSupabase(data.user.id, providerToken, data.session.provider_refresh_token);
            }
            if (services.gmail) {
              await persistPlatformGmailTokens(data.user.id, providerToken, data.session.provider_refresh_token);
            }
          }
        } else if (services.googleData) {
          await persistGoogleServiceTokens(providerToken, data.session?.provider_refresh_token ?? undefined);
        }
      } catch (err) {
        // Login itself succeeded — don't fail the whole sign-in over GA/GSC
        // token bookkeeping. User just sees "Connect" still showing next.
        console.error("[auth/callback] Failed to persist Google service tokens:", err);
      }
    }
  }

  if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
    destination = nextParam;
  }

  // Re-running Google sign-in from "Connect Google Services" in the
  // dashboard (see components/dashboard/AnalyticsPanel.tsx) lands here too
  // — reuse the exact toast/tab-switch signal the manual OAuth flow uses
  // (google-analytics/callback/route.ts's ga_connected=1) so both paths
  // feel identical to the user, instead of silently landing back with no
  // feedback that anything happened.
  if (hasGoogleServiceScopes && destination === "/dashboard") {
    return NextResponse.redirect(`${base}${destination}?ga_connected=1`);
  }

  return NextResponse.redirect(`${base}${destination}`);
}
