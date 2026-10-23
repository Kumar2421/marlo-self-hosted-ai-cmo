/** Google OAuth scopes per purpose. Sign-in requests identity only; Gmail and
 * Analytics/Search Console scopes are requested when the user connects them.
 * Self-host mode brings its own OAuth credentials and manual integration flows.
 */
export type GoogleOAuthPurpose = "login" | "gmail" | "google-data";

const IDENTITY_SCOPES = ["openid", "email", "profile"];
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];
const GOOGLE_DATA_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

/** Scopes to request for one Google OAuth round-trip. Sign-in asks for identity
 * only; mailbox and analytics access are asked when the user connects that
 * feature (incremental consent, see googleOAuthQueryParams). */
export function scopesFor(purpose: GoogleOAuthPurpose): string {
  if (purpose === "login") return IDENTITY_SCOPES.join(" ");
  const extra = purpose === "gmail" ? GMAIL_SCOPES : GOOGLE_DATA_SCOPES;
  return [...IDENTITY_SCOPES, ...extra].join(" ");
}

/** Login: plain consent, no offline token. Connect flows: offline access plus
 * include_granted_scopes so a later connect keeps what was already granted. */
export function googleOAuthQueryParams(purpose: GoogleOAuthPurpose): Record<string, string> {
  if (purpose === "login") return {};
  return { access_type: "offline", prompt: "consent", include_granted_scopes: "true" };
}

/** Which optional Google services a sign-in actually granted. When Google's
 * tokeninfo is unavailable (scopes null) a refresh token is the fallback signal:
 * only connect flows ask for offline access, plain login never does. */
export function grantedServices(
  scopes: readonly string[] | null | undefined,
  hasRefreshToken = false
): { gmail: boolean; googleData: boolean } {
  if (!scopes) return { gmail: hasRefreshToken, googleData: hasRefreshToken };
  const set = new Set(scopes);
  return {
    gmail: GMAIL_SCOPES.some((s) => set.has(s)),
    googleData: GOOGLE_DATA_SCOPES.some((s) => set.has(s)),
  };
}

// ---- Search Console and Analytics as two independent connections ----

export type GoogleDataService = "search-console" | "analytics";
export const GOOGLE_DATA_SERVICES: readonly GoogleDataService[] = ["search-console", "analytics"];

export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

const SERVICE_SCOPE: Record<GoogleDataService, string> = {
  "search-console": SEARCH_CONSOLE_SCOPE,
  analytics: ANALYTICS_SCOPE,
};

export const SERVICE_LABEL: Record<GoogleDataService, string> = {
  "search-console": "Search Console",
  analytics: "Analytics",
};

/** Cookie carrying the requested service(s) from the connect route to the callback. */
export const GA_SERVICE_COOKIE = "ga_service";

/** Plain-text pointer shown on every tab except Traffic, where the only Connect button lives. */
export const CONNECT_IN_TRAFFIC_HINT = "Connect Google in the Traffic tab.";
export const RECONNECT_IN_TRAFFIC_HINT = "Reconnect Google in the Traffic tab.";

/** `?service=` of the connect route. Missing or unknown means both (the old behaviour, so Settings keeps working). */
export function parseServiceParam(value: string | null | undefined): GoogleDataService[] {
  if (value === "search-console") return ["search-console"];
  if (value === "analytics") return ["analytics"];
  return [...GOOGLE_DATA_SERVICES];
}

/** Value to carry through the OAuth round-trip (inverse of parseServiceParam). */
export function serviceParamFor(services: readonly GoogleDataService[]): string {
  return services.length === 1 ? services[0] : "both";
}

/** Scopes for one connect round-trip: email identity plus only the requested services. */
export function scopesForServices(services: readonly GoogleDataService[]): string {
  return [...services.map((s) => SERVICE_SCOPE[s]), "https://www.googleapis.com/auth/userinfo.email"].join(" ");
}

export type ServiceGrant = {
  /** False when Google's tokeninfo could not be read: nothing is claimed either way. */
  known: boolean;
  granted: Record<GoogleDataService, boolean>;
};

/** Which services a token really has, from the scopes Google reports (cumulative with include_granted_scopes). */
export function parseGrantedServices(scopes: readonly string[] | null | undefined): ServiceGrant {
  if (!scopes || scopes.length === 0) return { known: false, granted: { "search-console": false, analytics: false } };
  const set = new Set(scopes);
  return {
    known: true,
    granted: { "search-console": set.has(SEARCH_CONSOLE_SCOPE), analytics: set.has(ANALYTICS_SCOPE) },
  };
}

export type GrantOutcome = {
  /** Services to store as connected after this round-trip. */
  connect: GoogleDataService[];
  /** Requested services the user did not grant (unticked). */
  missing: GoogleDataService[];
  /** Plain-language message for the user, or null when everything requested was granted. */
  message: string | null;
};

/**
 * Decide what a callback stores. A service is connected only when it was requested and Google
 * reports it granted. With unreadable scopes the requested services are trusted (Google only
 * returns a token for what was consented to) and nothing beyond them is claimed.
 */
export function resolveGrant(requested: readonly GoogleDataService[], grant: ServiceGrant): GrantOutcome {
  if (!grant.known) return { connect: [...requested], missing: [], message: null };
  const connect = GOOGLE_DATA_SERVICES.filter((s) => grant.granted[s] && requested.includes(s));
  const missing = requested.filter((s) => !grant.granted[s]);
  const names = (list: readonly GoogleDataService[]) => list.map((s) => SERVICE_LABEL[s]).join(" and ");
  const message =
    missing.length === 0
      ? null
      : `${names(missing)} permission was not granted. ${connect.length > 0 ? `${names(connect)} is connected; ` : ""}reconnect and tick the box to add ${missing.length > 1 ? "them" : "it"}.`;
  return { connect, missing, message };
}

/** Connect link for the Traffic tab (also used to reconnect), one service at a time. */
export function googleConnectHref(service: GoogleDataService | "both", returnTo: "settings" | "dashboard" = "dashboard"): string {
  const params = new URLSearchParams();
  if (returnTo === "dashboard") params.set("return", "dashboard");
  if (service !== "both") params.set("service", service);
  const q = params.toString();
  return `/api/auth/google-analytics/connect${q ? `?${q}` : ""}`;
}

export type ServiceRowState = "not_connected" | "connected" | "needs_reconnect";
export type ServiceRow = { service: GoogleDataService; label: string; state: ServiceRowState; action: "Connect" | "Reconnect" | null };

/**
 * Per-service rows from the project's stored integration types. Backward compatible: users who
 * connected both before have both rows. Health is project-wide (the server reports the worst),
 * so needs-reconnect applies to each service that is connected.
 */
export function googleServiceRows(integrationTypes: readonly string[] | null | undefined, needsReconnect: boolean): ServiceRow[] {
  const types = new Set(integrationTypes ?? []);
  const typeOf: Record<GoogleDataService, string> = { "search-console": "google-search-console", analytics: "google-analytics" };
  return GOOGLE_DATA_SERVICES.map((service) => {
    const connected = types.has(typeOf[service]);
    const state: ServiceRowState = !connected ? "not_connected" : needsReconnect ? "needs_reconnect" : "connected";
    return {
      service,
      label: SERVICE_LABEL[service],
      state,
      action: state === "connected" ? null : state === "needs_reconnect" ? "Reconnect" : "Connect",
    };
  });
}
