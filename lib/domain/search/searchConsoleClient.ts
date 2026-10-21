import { buildSnapshotPayload, snapshotRanges, type SearchSnapshotPayload } from "./searchSnapshot.ts";
import type { QueryRow } from "./types.ts";

/** Fetches Search Console rows for one date range; implementations hide how auth works. */
export type FetchSearchRows = (
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit?: number,
) => Promise<QueryRow[]>;

/** Platform mode: the caller already holds an access token decrypted from Vault. */
export async function fetchSearchAnalyticsWithToken(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 25000,
): Promise<QueryRow[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Search Console query failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  return data.rows ?? [];
}

/** Thrown instead of saving a snapshot whose rows cannot all be right (see assessSnapshotRows). */
export class PartialSnapshotError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PartialSnapshotError";
  }
}

export type SnapshotRows = { d7: QueryRow[]; d28: QueryRow[]; d90: QueryRow[]; prev28: QueryRow[]; d28Pages: QueryRow[] };

/**
 * Is this set of Search Console responses internally consistent? Pure.
 *
 * An empty main window next to a populated previous window would be stored
 * as "every search was lost", and the 90-day window always contains the
 * 28-day one. A genuinely empty site (every window empty) is valid: there is
 * nothing to mislead with, and the overview shows "collecting data".
 */
export function assessSnapshotRows(rows: SnapshotRows): { ok: true } | { ok: false; reason: string } {
  const has = (r: QueryRow[]) => r.length > 0;
  if (!has(rows.d28) && (has(rows.prev28) || has(rows.d90) || has(rows.d7))) {
    return { ok: false, reason: "Search Console returned no data for the last 28 days but did for other periods. Not saved, so nothing is reported as lost. Try again later." };
  }
  if (has(rows.d28) && !has(rows.d90)) {
    return { ok: false, reason: "Search Console returned an incomplete 90-day window. Not saved. Try again later." };
  }
  if (has(rows.d28) && !has(rows.d28Pages)) {
    return { ok: false, reason: "Search Console returned no page data for the last 28 days. Not saved. Try again later." };
  }
  return { ok: true };
}

/** One Search Console snapshot: 5 parallel calls (4 query windows + query/page for the main window). */
export async function captureSearchSnapshot(
  fetchRows: FetchSearchRows,
  siteUrl: string,
  now: Date = new Date(),
): Promise<SearchSnapshotPayload> {
  const ranges = snapshotRanges(now);
  const [d7, d28, d90, prev28, d28Pages] = await Promise.all([
    fetchRows(siteUrl, ranges.d7.startDate, ranges.d7.endDate, ["query"]),
    fetchRows(siteUrl, ranges.d28.startDate, ranges.d28.endDate, ["query"]),
    fetchRows(siteUrl, ranges.d90.startDate, ranges.d90.endDate, ["query"]),
    fetchRows(siteUrl, ranges.prev28.startDate, ranges.prev28.endDate, ["query"]),
    fetchRows(siteUrl, ranges.d28.startDate, ranges.d28.endDate, ["query", "page"]),
  ]);
  const rows = { d7, d28, d90, prev28, d28Pages };
  const verdict = assessSnapshotRows(rows);
  if (!verdict.ok) throw new PartialSnapshotError(verdict.reason);
  return buildSnapshotPayload({ now, siteUrl, ranges, rows });
}
