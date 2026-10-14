/**
 * Post-install destinations. Pure and client-safe (no Node imports), so the server routes and the
 * settings page share one validator.
 */

const SETTINGS_FALLBACK = "/settings/integrations";

/** Only same-site paths may be used as a post-install destination. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  // Control characters (tabs included) are refused: the URL parser strips them, so "/\t/evil.com" would become "//evil.com".
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** An absolute URL on `origin` for a validated path, with these query parameters set. Anything that would leave the origin goes to the settings page instead. */
export function returnUrl(origin: string, path: string | null, params: Record<string, string>): URL {
  const base = new URL(origin);
  let url = new URL(path ?? SETTINGS_FALLBACK, base);
  if (url.origin !== base.origin) url = new URL(SETTINGS_FALLBACK, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}
