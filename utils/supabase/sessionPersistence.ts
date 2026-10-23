/**
 * "Remember me" support. @supabase/ssr always writes auth cookies with a
 * 400-day maxAge and ignores a cookieOptions override, so the only reliable
 * lever is to drop maxAge in each client's own `setAll`.
 *
 * A marker cookie, itself a session cookie (no maxAge), records that the user
 * unticked "Remember me". While it exists, auth cookies are written without
 * maxAge too. Closing the browser clears the marker and the auth cookies
 * together, so the user is signed out. When ticked, the marker is removed and
 * the default persistent behaviour applies.
 *
 * Pure functions only: no next/headers or document access, so it is unit tested.
 */

export const SESSION_ONLY_COOKIE = "marlo_session_only";

type CookieOptionsLike = { maxAge?: number; expires?: Date } & Record<string, unknown>;

/** True when the cookie list says the user chose a session-only login. */
export function isSessionOnly(cookies: { name: string; value: string }[]): boolean {
  return cookies.some((c) => c.name === SESSION_ONLY_COOKIE && c.value === "1");
}

/** Parses `document.cookie` style text into a name/value list. */
export function parseCookieHeader(header: string): { name: string; value: string }[] {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf("=");
      return i === -1 ? { name: part, value: "" } : { name: part.slice(0, i), value: part.slice(i + 1) };
    });
}

/**
 * Options to use when writing a cookie. Session-only drops maxAge/expires so
 * the browser keeps it until it closes. Deletions (maxAge 0 or a past expiry)
 * are left alone so sign-out still clears cookies.
 */
export function applySessionPersistence<T extends CookieOptionsLike>(
  options: T | undefined,
  sessionOnly: boolean
): T | undefined {
  if (!sessionOnly || !options) return options;
  if (options.maxAge === 0) return options;
  if (options.expires && options.expires.getTime() <= Date.now()) return options;
  const rest: Record<string, unknown> = { ...options };
  delete rest.maxAge;
  delete rest.expires;
  return rest as T;
}

/** Cookie string for the marker, set from the login page before signing in. */
export function sessionMarkerCookie(remember: boolean): string {
  return remember
    ? `${SESSION_ONLY_COOKIE}=; path=/; max-age=0; SameSite=Lax`
    : `${SESSION_ONLY_COOKIE}=1; path=/; SameSite=Lax`;
}

/**
 * True when a failed getUser() looks transient (network down, 5xx, rate
 * limit) rather than "this session is invalid". Callers must not treat a
 * transient failure as signed out.
 */
export function isTransientAuthError(error: { name?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  const status = error.status;
  return status === 0 || status === 429 || (typeof status === "number" && status >= 500);
}

const PROTECTED_PREFIXES = ["/dashboard", "/settings"];

/** Only the app itself needs a session; marketing, /login, /terms, /privacy and callbacks stay public. */
export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
