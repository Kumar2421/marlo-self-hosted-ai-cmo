/**
 * Wording for audit facts the SEO and Technical tabs show. Pure, so the "honest when absent" rules are tested.
 */
import { relativeDayLabel, shortDateLabel } from "../shared/dayLabel.ts";

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

type OnPageIssue = { label: string; level: "Warning" | "Error" };

/**
 * The on-page issues worth counting and listing. The raw `issues` list also carries notices that are
 * not page problems (PageSpeed did not answer) and, in older stored audits, the missing canonical twice
 * under two names. The Findings tab never had either, which made the counts disagree (for example 5 vs 4).
 */
export function onPageIssues(issues: OnPageIssue[]): OnPageIssue[] {
  const seen = new Set<string>();
  const out: OnPageIssue[] = [];
  for (const issue of issues) {
    if (/^(PageSpeed Insights\b|Failed to fetch PageSpeed)/i.test(issue.label)) continue;
    const key = /^Missing canonical (URL|tag)$/i.test(issue.label) ? "missing-canonical" : issue.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export type OverviewTile = { key: string; label: string; value: number | null; caption: string };

/**
 * The tiles under "Audit overview". Findings, Lighthouse and on-page issues often count the same
 * problems, so when every tile that has a number shows the same one they are merged into a single
 * tile whose caption carries the breakdown. Otherwise the three tiles stay as they are.
 */
export function auditOverviewTiles(counts: { needsAttention: number | null; lighthouse: number; onPage: number }): OverviewTile[] {
  const tiles: OverviewTile[] = [
    { key: "findings", label: "Findings", value: counts.needsAttention, caption: "Needs attention" },
    { key: "lighthouse", label: "Lighthouse", value: counts.lighthouse, caption: "Measured issues" },
    { key: "onpage", label: "On-page checks", value: counts.onPage, caption: "Failed in this crawl" },
  ];
  const known = tiles.filter((t) => t.value !== null);
  if (known.length === tiles.length && known.every((t) => t.value === known[0].value)) {
    const n = known[0].value as number;
    return [{ key: "merged", label: "Issues", value: n, caption: "Findings, Lighthouse and on-page checks all agree" }];
  }
  return tiles;
}

/** "Last audited Oct 6, 2026 (16 days ago)" from an ISO timestamp, or null when the date is missing or unreadable. Calendar days in the viewer's timezone (or `timeZone`), so "today" means today for them. */
export function lastAuditedLabel(auditedAt: string | null | undefined, now: Date = new Date(), timeZone?: string): string | null {
  if (!auditedAt) return null;
  const at = new Date(auditedAt);
  if (Number.isNaN(at.getTime())) return null;
  return `Last audited ${shortDateLabel(at, timeZone)} (${relativeDayLabel(at, now, timeZone)})`;
}
