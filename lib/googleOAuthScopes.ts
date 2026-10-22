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
