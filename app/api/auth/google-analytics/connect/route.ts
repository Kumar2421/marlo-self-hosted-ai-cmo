import { CREDENTIALS_PATH } from "@/lib/settingsPaths";
import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/googleAnalyticsOAuth";
import { createOAuthState } from "@/lib/domain/integrations/oauthState";
import { createOAuthState as createOAuthStateSupabase } from "@/lib/domain/integrations/oauthStateSupabase";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { GA_SERVICE_COOKIE, parseServiceParam, scopesForServices, serviceParamFor, type GoogleDataService } from "@/lib/googleOAuthScopes";

function authRedirect(baseUrl: string, services: GoogleDataService[]) {
  const url = new URL(baseUrl);
  // Only the requested service(s) are asked for; earlier grants are kept (incremental consent).
  url.searchParams.set("scope", scopesForServices(services));
  url.searchParams.set("include_granted_scopes", "true");
  const res = NextResponse.redirect(url.toString());
  // Remembered for the callback (10 min, same life as the OAuth state).
  res.cookies.set(GA_SERVICE_COOKIE, serviceParamFor(services), { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/api/auth/google-analytics" });
  return res;
}

export async function GET(req: NextRequest) {
  const redirectUri = req.nextUrl.origin + "/api/auth/google-analytics/callback";
  const services = parseServiceParam(req.nextUrl.searchParams.get("service"));
  const returnTo = req.nextUrl.searchParams.get("return") === "dashboard" ? "dashboard" : "settings";
  const errorRedirect = (message: string) =>
    NextResponse.redirect(req.nextUrl.origin + CREDENTIALS_PATH + "?ga_error=" + encodeURIComponent(message));

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorRedirect("Not authenticated");

    const db = createServiceClient();
    const projectId =
      req.nextUrl.searchParams.get("project") ||
      (
        await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle()
      ).data?.value;
    if (!projectId) return errorRedirect("Select or create a project before connecting Google.");

    try {
      const state = await createOAuthStateSupabase(db, user.id, { projectId, returnTo });
      return authRedirect(buildAuthUrl(redirectUri, state), services);
    } catch (err) {
      return errorRedirect(err instanceof Error ? err.message : String(err));
    }
  }

  const projectId = req.nextUrl.searchParams.get("project") || getActiveProjectId();
  if (!projectId) {
    return errorRedirect("Select or create a project before connecting Google.");
  }

  try {
    const state = createOAuthState({ projectId, returnTo });
    return authRedirect(buildAuthUrl(redirectUri, state), services);
  } catch (err) {
    return errorRedirect(err instanceof Error ? err.message : String(err));
  }
}
