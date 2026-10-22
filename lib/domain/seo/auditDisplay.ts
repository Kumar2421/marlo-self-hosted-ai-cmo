/**
 * Wording for audit facts the SEO and Technical tabs show. Pure, so the "honest when absent" rules are tested.
 */

/**
 * The Content-Encoding row on the Technical tab. The crawler asks for uncompressed pages (the guarded
 * fetcher pins `Accept-Encoding: identity` so its byte cap is a real size bound and it never decompresses),
 * so a missing header means "we did not ask", not "the site sends no compression". It is only shown as a
 * value when the server actually named one.
 */
export function encodingLabel(encoding: string | null | undefined): string {
  const value = typeof encoding === "string" ? encoding.trim() : "";
  return value ? value : "Not measured";
}

/** "Last audited Oct 6, 2026 (16 days ago)" from an ISO timestamp, or null when the date is missing or unreadable. UTC day, so it does not shift by timezone. */
export function lastAuditedLabel(auditedAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!auditedAt) return null;
  const at = new Date(auditedAt);
  if (Number.isNaN(at.getTime())) return null;
  const date = at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  const age = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return `Last audited ${date} (${age})`;
}
