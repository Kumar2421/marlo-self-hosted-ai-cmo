import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages, type PageResult } from "../jobs/paginate.ts";
import { LEAD_PROFILE_DOC } from "./leadProfileStore.ts";

export type DueLeadProject = { id: string; owner_id: string; name: string; category: string | null; leads_auto_last_at: string | null };

type Log = (message: string) => void;
const defaultLog: Log = (message) => console.error(message);

function rowsOf<T>(query: unknown): PromiseLike<PageResult<T>> {
  return query as PromiseLike<PageResult<T>>;
}

/**
 * Ids of projects whose lead profile document is confirmed. The filter is a superset of isConfirmed():
 * it keeps any profile whose JSON has a confirmedAt that is not null, and generateAutoLeads re-checks the
 * full rules. Throws on a failed read.
 */
export async function confirmedLeadProfileProjects(db: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAllPages<{ project_id: unknown }>((from, to) =>
    rowsOf(
      db
        .from("project_documents")
        .select("project_id")
        .eq("doc_type", LEAD_PROFILE_DOC)
        .like("content", '%"confirmedAt"%')
        .not("content", "like", '%"confirmedAt":null%')
        .order("project_id", { ascending: true })
        .range(from, to),
    ),
  );
  return new Set(rows.map((row) => String(row.project_id)));
}

/**
 * Projects whose leads are due for a refresh (never refreshed, or last refreshed before `cutoffIso`), oldest
 * stamp first with never-refreshed projects ahead of all of them, then by id so the order is stable. Paged,
 * because PostgREST answers at most 1000 rows per request. Only projects with a confirmed lead profile are
 * returned, since the others would only answer "profile needed"; if that profile read fails the filter is
 * dropped (logged) and every due project is returned, as before.
 */
export async function selectDueLeadProjects(
  db: SupabaseClient,
  cutoffIso: string,
  log: Log = defaultLog,
): Promise<{ projects: DueLeadProject[] } | { error: string }> {
  let due: DueLeadProject[];
  try {
    due = await fetchAllPages<DueLeadProject>((from, to) =>
      rowsOf(
        db
          .from("projects")
          .select("id, owner_id, name, category, leads_auto_last_at")
          .or(`leads_auto_last_at.is.null,leads_auto_last_at.lt.${cutoffIso}`)
          .order("leads_auto_last_at", { ascending: true, nullsFirst: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const confirmed = await confirmedLeadProfileProjects(db);
    return { projects: due.filter((project) => confirmed.has(String(project.id))) };
  } catch (err) {
    log(`[leads-refresh] could not read confirmed lead profiles; refreshing every due project: ${err instanceof Error ? err.message : String(err)}`);
    return { projects: due };
  }
}
