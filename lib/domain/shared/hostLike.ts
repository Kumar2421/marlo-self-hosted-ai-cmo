/**
 * Normalises a user-entered website value ("acme.com", "www.acme.com/pricing", "https://acme.com")
 * into an https/http URL plus its host, or null when it does not look like a website at all
 * (a bare name, a sentence, another scheme). Pure: no DNS, no network.
 */

export type HostLike = { url: string; host: string };

const MAX_LENGTH = 2048;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** True for a dotted DNS name with a plausible TLD. IP literals and single labels are not host-like. */
export function isHostLike(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h.length > 253) return false;
  const labels = h.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  return TLD.test(labels[labels.length - 1]);
}

export function normalizeHostUrl(input: unknown): HostLike | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_LENGTH || /\s/.test(raw)) return null;
  const candidate = SCHEME.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!isHostLike(host)) return null;
  return { url: u.href, host };
}
