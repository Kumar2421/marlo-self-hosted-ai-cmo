/**
 * Optional access password for self-host (SQLite) mode.
 *
 * Self-host mode has no sign-in: anyone who can reach the app can use it, including the model keys
 * saved in Settings. That is fine on localhost and unsafe on a public server. When MARLO_ACCESS_PASSWORD
 * is set, every request must carry HTTP Basic credentials with that password (any user name).
 *
 * Pure (no Next.js imports) so node tests cover it. The proxy applies it only in self-host mode.
 */

/** Paths that never need the password (container and uptime health checks). */
const OPEN_PATHS = new Set(["/api/healthz"]);

export type AccessDecision = { allow: true } | { allow: false; challenge: string };

const CHALLENGE = 'Basic realm="Marlo", charset="UTF-8"';

/** Compares two strings in time that does not depend on where they first differ. */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Reads the password out of an `Authorization: Basic ...` header; null when it is missing or malformed. */
export function passwordFromBasicHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(header);
  if (!match) return null;
  let decoded: string;
  try {
    const bin = atob(match[1].replace(/-/g, "+").replace(/_/g, "/"));
    decoded = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  return decoded.slice(colon + 1);
}

export function checkSelfHostAccess(input: {
  /** The configured MARLO_ACCESS_PASSWORD; empty or missing means the gate is off. */
  password: string | null | undefined;
  authorization: string | null | undefined;
  pathname: string;
}): AccessDecision {
  const configured = (input.password ?? "").trim() ? input.password! : "";
  if (!configured) return { allow: true };
  if (OPEN_PATHS.has(input.pathname)) return { allow: true };
  const given = passwordFromBasicHeader(input.authorization);
  if (given !== null && safeEqual(given, configured)) return { allow: true };
  return { allow: false, challenge: CHALLENGE };
}
