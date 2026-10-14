import { BLOCKED_MESSAGE, assertResolvesPublic, type LookupFn } from "./ssrf.ts";

/**
 * Up-front validation for a URL typed by a user (audit form, competitor list). Stricter than the
 * fetcher: default ports only, no credentials, bounded length, and DNS checked. Errors are generic.
 */

export const MAX_USER_URL_LENGTH = 2048;
export const INVALID_USER_URL_MESSAGE = "Enter a valid website URL.";
const USER_URL_PORTS = new Set(["", "80", "443"]);

export async function assertSafeUserUrl(raw: string, lookup?: LookupFn): Promise<URL> {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_USER_URL_LENGTH) {
    throw new Error(INVALID_USER_URL_MESSAGE);
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(INVALID_USER_URL_MESSAGE);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(INVALID_USER_URL_MESSAGE);
  if (u.username || u.password) throw new Error("Remove the username and password from the URL.");
  if (!USER_URL_PORTS.has(u.port)) throw new Error(BLOCKED_MESSAGE);
  try {
    await assertResolvesPublic(u.hostname, lookup);
  } catch {
    throw new Error(BLOCKED_MESSAGE);
  }
  return u;
}
