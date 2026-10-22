export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export const GSC_SCOPE_MISSING_MESSAGE = "Search Console permission not granted: reconnect and tick it.";
export const GA4_SCOPE_MISSING_MESSAGE = "Google Analytics permission not granted: reconnect and tick it.";

export type GoogleScopeCheck = {
  /** False when the grant could not be read (tokeninfo failed): nothing is claimed either way. */
  known: boolean;
  gsc: boolean;
  ga4: boolean;
  /** Plain-language problem for the user, or null when both permissions are present or unknown. */
  problem: string | null;
};

/** `granted` is the scope list Google reported for the token, or null when it could not be read. */
export function checkGoogleServiceScopes(granted: string[] | null | undefined): GoogleScopeCheck {
  if (!granted || granted.length === 0) return { known: false, gsc: true, ga4: true, problem: null };
  const gsc = granted.includes(GSC_SCOPE);
  const ga4 = granted.includes(GA4_SCOPE);
  const problem = !gsc && !ga4
    ? `${GSC_SCOPE_MISSING_MESSAGE} ${GA4_SCOPE_MISSING_MESSAGE}`
    : !gsc ? GSC_SCOPE_MISSING_MESSAGE : !ga4 ? GA4_SCOPE_MISSING_MESSAGE : null;
  return { known: true, gsc, ga4, problem };
}
