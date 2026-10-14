import { CREDENTIALS_PATH } from "@/lib/settingsPaths";
import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import {
  exchangeCodeForTokens,
  getConnectedEmail,
  listSearchConsoleSites,
  listGA4Properties,
} from "@/lib/domain/shared/googleAnalyticsOAuth";
import {
  replaceIntegrationResources,
  saveIntegrationSecrets,
  upsertProjectIntegration,
} from "@/lib/domain/integrations/integrationStore";
import { consumeOAuthState } from "@/lib/domain/integrations/oauthState";
import {
  replaceIntegrationResources as replaceIntegrationResourcesSupabase,
  saveIntegrationSecrets as saveIntegrationSecretsSupabase,
  upsertProjectIntegration as upsertProjectIntegrationSupabase,
} from "@/lib/domain/integrations/integrationStoreSupabase";
import { consumeOAuthState as consumeOAuthStateSupabase } from "@/lib/domain/integrations/oauthStateSupabase";
import { createClient } from "@/utils/supabase/server";
import { checkOAuthCallbackOwner, OAUTH_OWNER_MISMATCH_MESSAGE } from "@/lib/domain/integrations/oauthCallbackGuard";

function redirectUrl(req: NextRequest, returnTo: "dashboard" | "settings", params: Record<string, string>) {
  const base = returnTo === "dashboard" ? req.nextUrl.origin + "/dashboard" : req.nextUrl.origin + CREDENTIALS_PATH;
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const fallback = req.nextUrl.origin + CREDENTIALS_PATH;

  if (!code || !state) {
    return NextResponse.redirect(fallback + "?ga_error=" + encodeURIComponent("Invalid Google authorization response."));
  }

  const redirectUri = req.nextUrl.origin + "/api/auth/google-analytics/callback";

  if (FEATURES.PLATFORM_MODE) {
    const db = createServiceClient();
    const oauthState = await consumeOAuthStateSupabase(db, state);
    if (!oauthState) {
      return NextResponse.redirect(fallback + "?ga_error=" + encodeURIComponent("Google authorization expired or was already used. Please reconnect."));
    }

    // The state is already consumed (single use). Only the signed-in user it was issued to may store tokens for it.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!checkOAuthCallbackOwner(user?.id, oauthState.userId).ok) {
      return NextResponse.redirect(fallback + "?ga_error=" + encodeURIComponent(OAUTH_OWNER_MISMATCH_MESSAGE));
    }

    try {
      const tokens = await exchangeCodeForTokens(code, redirectUri);
      if (!tokens.refreshToken) {
        return NextResponse.redirect(
          redirectUrl(req, oauthState.returnTo, {
            ga_error: "No refresh token returned. Disconnect the prior grant in Google Account security, then reconnect.",
          })
        );
      }

      const [email, gscSites, ga4Properties] = await Promise.all([
        getConnectedEmail(tokens.accessToken),
        listSearchConsoleSites(tokens.accessToken),
        listGA4Properties(tokens.accessToken),
      ]);

      const now = new Date().toISOString();
      const gsc = await upsertProjectIntegrationSupabase(db, oauthState.userId, {
        projectId: oauthState.projectId,
        integrationType: "google-search-console",
        accountIdentifier: email,
        connectedAt: now,
      });
      const ga4 = await upsertProjectIntegrationSupabase(db, oauthState.userId, {
        projectId: oauthState.projectId,
        integrationType: "google-analytics",
        accountIdentifier: email,
        connectedAt: now,
      });

      await Promise.all([
        saveIntegrationSecretsSupabase(db, oauthState.userId, gsc.id, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        }),
        saveIntegrationSecretsSupabase(db, oauthState.userId, ga4.id, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        }),
      ]);

      await Promise.all([
        replaceIntegrationResourcesSupabase(
          db,
          oauthState.userId,
          gsc.id,
          gscSites.map((site) => ({ resourceType: "search_console_property", resourceId: site, resourceName: site, metadata: {} }))
        ),
        replaceIntegrationResourcesSupabase(
          db,
          oauthState.userId,
          ga4.id,
          ga4Properties.map((property) => ({ resourceType: "ga4_property", resourceId: property.id, resourceName: property.name, metadata: {} }))
        ),
      ]);

      return NextResponse.redirect(
        redirectUrl(req, oauthState.returnTo, {
          ga_connected: "1",
          ga_project: oauthState.projectId,
          ga_gsc_count: String(gscSites.length),
          ga_ga4_count: String(ga4Properties.length),
        })
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.redirect(redirectUrl(req, oauthState.returnTo, { ga_error: raw }));
    }
  }

  const oauthState = consumeOAuthState(state);
  if (!oauthState) {
    return NextResponse.redirect(fallback + "?ga_error=" + encodeURIComponent("Google authorization expired or was already used. Please reconnect."));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(
        redirectUrl(req, oauthState.returnTo, {
          ga_error: "No refresh token returned. Disconnect the prior grant in Google Account security, then reconnect.",
        })
      );
    }

    const [email, gscSites, ga4Properties] = await Promise.all([
      getConnectedEmail(tokens.accessToken),
      listSearchConsoleSites(tokens.accessToken),
      listGA4Properties(tokens.accessToken),
    ]);

    const now = new Date().toISOString();
    const gsc = upsertProjectIntegration({
      projectId: oauthState.projectId,
      provider: "google",
      integrationType: "google-search-console",
      accountIdentifier: email,
      connectedAt: now,
    });
    const ga4 = upsertProjectIntegration({
      projectId: oauthState.projectId,
      provider: "google",
      integrationType: "google-analytics",
      accountIdentifier: email,
      connectedAt: now,
    });

    saveIntegrationSecrets(gsc.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
    saveIntegrationSecrets(ga4.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    replaceIntegrationResources(
      gsc.id,
      gscSites.map((site) => ({
        resourceType: "search_console_property",
        resourceId: site,
        resourceName: site,
        metadata: {},
      }))
    );
    replaceIntegrationResources(
      ga4.id,
      ga4Properties.map((property) => ({
        resourceType: "ga4_property",
        resourceId: property.id,
        resourceName: property.name,
        metadata: {},
      }))
    );

    return NextResponse.redirect(
      redirectUrl(req, oauthState.returnTo, {
        ga_connected: "1",
        ga_project: oauthState.projectId,
        ga_gsc_count: String(gscSites.length),
        ga_ga4_count: String(ga4Properties.length),
      })
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(redirectUrl(req, oauthState.returnTo, { ga_error: raw }));
  }
}
