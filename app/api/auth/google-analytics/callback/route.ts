import { CREDENTIALS_PATH } from "@/lib/settingsPaths";
import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import {
  exchangeCodeForTokens,
  getConnectedEmail,
  listGA4Properties,
  listSearchConsoleSites,
} from "@/lib/domain/shared/googleAnalyticsOAuth";
import { fetchGrantedScopes } from "@/lib/domain/shared/googleTokenInfo";
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
import {
  GA_SERVICE_COOKIE,
  parseGrantedServices,
  parseServiceParam,
  resolveGrant,
  type GoogleDataService,
} from "@/lib/googleOAuthScopes";

function redirectUrl(req: NextRequest, returnTo: "dashboard" | "settings", params: Record<string, string>) {
  const base = returnTo === "dashboard" ? req.nextUrl.origin + "/dashboard" : req.nextUrl.origin + CREDENTIALS_PATH;
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

/** Lists only the connected services. A failed listing is a problem, never an empty list. */
async function discoverConnected(accessToken: string, connect: readonly GoogleDataService[]) {
  const wantGsc = connect.includes("search-console");
  const wantGa4 = connect.includes("analytics");
  const problems: string[] = [];
  const [gsc, ga4] = await Promise.allSettled([
    wantGsc ? listSearchConsoleSites(accessToken) : Promise.resolve([] as string[]),
    wantGa4 ? listGA4Properties(accessToken) : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  if (wantGsc && gsc.status === "rejected") {
    problems.push(`Could not list Search Console sites: ${gsc.reason instanceof Error ? gsc.reason.message : "unknown error"}`);
  }
  if (wantGa4 && ga4.status === "rejected") {
    problems.push(`Could not list Google Analytics properties: ${ga4.reason instanceof Error ? ga4.reason.message : "unknown error"}`);
  }
  return {
    gscSites: gsc.status === "fulfilled" ? gsc.value : [],
    ga4Properties: ga4.status === "fulfilled" ? ga4.value : [],
    gscListed: wantGsc && gsc.status === "fulfilled",
    ga4Listed: wantGa4 && ga4.status === "fulfilled",
    problems,
  };
}

/**
 * Google lets users untick scopes, so what is stored follows what was really granted:
 * only the requested services Google reports as granted become connected rows.
 */
async function resolveConnection(accessToken: string, requested: readonly GoogleDataService[]) {
  const [email, granted] = await Promise.all([getConnectedEmail(accessToken), fetchGrantedScopes(accessToken)]);
  const outcome = resolveGrant(requested, parseGrantedServices(granted));
  const found = await discoverConnected(accessToken, outcome.connect);
  return {
    email,
    connect: outcome.connect,
    ...found,
    problems: outcome.message ? [outcome.message, ...found.problems] : found.problems,
  };
}

const NOTHING_GRANTED = "No Google permission was granted. Reconnect and tick the box.";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const fallback = req.nextUrl.origin + CREDENTIALS_PATH;

  if (!code || !state) {
    return NextResponse.redirect(fallback + "?ga_error=" + encodeURIComponent("Invalid Google authorization response."));
  }

  const redirectUri = req.nextUrl.origin + "/api/auth/google-analytics/callback";
  // Absent cookie (older tab, Settings flow) means both, as before.
  const requested = parseServiceParam(req.cookies.get(GA_SERVICE_COOKIE)?.value);
  const done = (url: string) => {
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: GA_SERVICE_COOKIE, path: "/api/auth/google-analytics" });
    return res;
  };

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
        return done(
          redirectUrl(req, oauthState.returnTo, {
            ga_error: "No refresh token returned. Disconnect the prior grant in Google Account security, then reconnect.",
          })
        );
      }

      const { email, connect, gscSites, ga4Properties, gscListed, ga4Listed, problems } = await resolveConnection(tokens.accessToken, requested);
      if (connect.length === 0) {
        return done(redirectUrl(req, oauthState.returnTo, { ga_error: problems[0] ?? NOTHING_GRANTED }));
      }

      const now = new Date().toISOString();
      const secrets = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt };
      const store = async (integrationType: "google-search-console" | "google-analytics") => {
        const row = await upsertProjectIntegrationSupabase(db, oauthState.userId, {
          projectId: oauthState.projectId,
          integrationType,
          accountIdentifier: email,
          connectedAt: now,
        });
        await saveIntegrationSecretsSupabase(db, oauthState.userId, row.id, secrets);
        return row;
      };
      const [gsc, ga4] = await Promise.all([
        connect.includes("search-console") ? store("google-search-console") : null,
        connect.includes("analytics") ? store("google-analytics") : null,
      ]);

      // A listing that failed or was not permitted keeps the resources (and the chosen one) already stored.
      await Promise.all([
        gsc && gscListed
          ? replaceIntegrationResourcesSupabase(
              db,
              oauthState.userId,
              gsc.id,
              gscSites.map((site) => ({ resourceType: "search_console_property", resourceId: site, resourceName: site, metadata: {} }))
            )
          : null,
        ga4 && ga4Listed
          ? replaceIntegrationResourcesSupabase(
              db,
              oauthState.userId,
              ga4.id,
              ga4Properties.map((property) => ({ resourceType: "ga4_property", resourceId: property.id, resourceName: property.name, metadata: {} }))
            )
          : null,
      ]);

      // Tokens are saved, but a missing (unticked) permission or a failed listing is not a clean success.
      if (problems.length > 0) {
        return done(redirectUrl(req, oauthState.returnTo, { ga_error: problems.join(" ") }));
      }

      return done(
        redirectUrl(req, oauthState.returnTo, {
          ga_connected: "1",
          ga_project: oauthState.projectId,
          ga_gsc_count: String(gscSites.length),
          ga_ga4_count: String(ga4Properties.length),
        })
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return done(redirectUrl(req, oauthState.returnTo, { ga_error: raw }));
    }
  }

  const oauthState = consumeOAuthState(state);
  if (!oauthState) {
    return NextResponse.redirect(fallback + "?ga_error=" + encodeURIComponent("Google authorization expired or was already used. Please reconnect."));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      return done(
        redirectUrl(req, oauthState.returnTo, {
          ga_error: "No refresh token returned. Disconnect the prior grant in Google Account security, then reconnect.",
        })
      );
    }

    const { email, connect, gscSites, ga4Properties, gscListed, ga4Listed, problems } = await resolveConnection(tokens.accessToken, requested);
    if (connect.length === 0) {
      return done(redirectUrl(req, oauthState.returnTo, { ga_error: problems[0] ?? NOTHING_GRANTED }));
    }

    const now = new Date().toISOString();
    const secrets = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt };
    const store = (integrationType: "google-search-console" | "google-analytics") => {
      const row = upsertProjectIntegration({
        projectId: oauthState.projectId,
        provider: "google",
        integrationType,
        accountIdentifier: email,
        connectedAt: now,
      });
      saveIntegrationSecrets(row.id, secrets);
      return row;
    };
    const gsc = connect.includes("search-console") ? store("google-search-console") : null;
    const ga4 = connect.includes("analytics") ? store("google-analytics") : null;

    if (gsc && gscListed) {
      replaceIntegrationResources(
        gsc.id,
        gscSites.map((site) => ({
          resourceType: "search_console_property",
          resourceId: site,
          resourceName: site,
          metadata: {},
        }))
      );
    }
    if (ga4 && ga4Listed) {
      replaceIntegrationResources(
        ga4.id,
        ga4Properties.map((property) => ({
          resourceType: "ga4_property",
          resourceId: property.id,
          resourceName: property.name,
          metadata: {},
        }))
      );
    }

    if (problems.length > 0) {
      return done(redirectUrl(req, oauthState.returnTo, { ga_error: problems.join(" ") }));
    }

    return done(
      redirectUrl(req, oauthState.returnTo, {
        ga_connected: "1",
        ga_project: oauthState.projectId,
        ga_gsc_count: String(gscSites.length),
        ga_ga4_count: String(ga4Properties.length),
      })
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return done(redirectUrl(req, oauthState.returnTo, { ga_error: raw }));
  }
}
