import type { SupabaseClient } from "@supabase/supabase-js";
import type { FindingRow } from "./findingStoreSupabase.ts";

/** PostgREST answers at most this many rows per request (the default max-rows). */
export const FIXED_FINDINGS_PAGE_SIZE = 1000;
/** Upper bound on the fixed findings read in one run. */
export const MAX_FIXED_FINDINGS = 5000;

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
