/**
 * Turns what a person types or a link carries into the address the audit runs on. Visitors type "example.com", and
 * the marketing site's forms send exactly that, so a bare domain must work, not be silently ignored.
 * The server stays the real gate (it rejects private and local addresses); this only decides "is this a website
 * address at all" and adds https:// when it is missing.
 */
export function normalizeAuditUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // "mailto:a@b.co" would otherwise parse as a login on a host called mailto.
  if (url.username || url.password) return null;
  // A real site has a dot in its name (or is an IP/localhost, which the server rejects with its own message).
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return url.toString();
}
