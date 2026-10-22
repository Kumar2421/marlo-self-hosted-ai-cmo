import type { SupabaseClient } from "@supabase/supabase-js";
import type { FindingRow } from "./findingStoreSupabase.ts";

/** PostgREST answers at most this many rows per request (the default max-rows). */
export const FIXED_FINDINGS_PAGE_SIZE = 1000;
/** Upper bound on the fixed findings read in one run. */
export const MAX_FIXED_FINDINGS = 5000;

type RangeResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Reads every row of a query in ranges, so no read silently stops at the server's row cap.
 * `page(from, to)` must build an ordered, ranged query (ordered by a unique column).
 * The cursor advances by the rows actually returned, and the total is capped at MAX_FIXED_FINDINGS.
 */
export async function readAllRows<T>(page: (from: number, to: number) => RangeResult<T>): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (from < MAX_FIXED_FINDINGS) {
    const to = Math.min(from + FIXED_FINDINGS_PAGE_SIZE, MAX_FIXED_FINDINGS) - 1;
    const { data, error } = await page(from, to);
    if (error) throw new Error(error.message);
    const got = data ?? [];
    if (got.length === 0) break;
    rows.push(...got);
    from += got.length;
  }
  return rows;
}

/**
 * The rows the auto-verify job may check: every fixed finding, plus geo-gap findings being fixed
 * and seo-audit findings flagged evidence.vanished that are still open. The job re-filters each
 * (status, gap/flag rules); this only bounds what it reads.
 */
export async function listAutoVerifyCandidateRows(db: SupabaseClient): Promise<Array<FindingRow & { user_id: string }>> {
  type Row = FindingRow & { user_id: string };
  const fixed = await listFixedFindingRows(db);
  const gaps = await readAllRows<Row>((from, to) =>
    db.from("findings").select("*").eq("source", "geo").eq("category", "geo_gap").eq("status", "fixing").order("id", { ascending: true }).range(from, to) as unknown as RangeResult<Row>);
  const vanished = await readAllRows<Row>((from, to) =>
    db.from("findings").select("*").eq("source", "seo-audit").in("status", ["new", "acknowledged", "fixing", "failed"]).not("evidence->vanished", "is", null).order("id", { ascending: true }).range(from, to) as unknown as RangeResult<Row>);
  const seen = new Set<string>();
  return [...fixed, ...gaps, ...vanished].filter((r) => (seen.has(String(r.id)) ? false : (seen.add(String(r.id)), true)));
}

/**
 * Every fixed finding, read in ranges. One unpaged query would silently stop at
 * the server's row cap. Ordered by id so consecutive ranges never repeat or skip
 * a row. The cursor advances by the rows actually returned, so a server that
 * answers with fewer rows than the range asked for cannot skip any.
 */
export async function listFixedFindingRows(db: SupabaseClient): Promise<Array<FindingRow & { user_id: string }>> {
  const rows: Array<FindingRow & { user_id: string }> = [];
  let from = 0;
  while (from < MAX_FIXED_FINDINGS) {
    const to = Math.min(from + FIXED_FINDINGS_PAGE_SIZE, MAX_FIXED_FINDINGS) - 1;
    const { data, error } = await db.from("findings").select("*").eq("status", "fixed").order("id", { ascending: true }).range(from, to);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Array<FindingRow & { user_id: string }>;
    if (page.length === 0) break;
    rows.push(...page);
    from += page.length;
  }
  return rows;
}
