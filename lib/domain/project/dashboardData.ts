import { createHash } from "node:crypto";

// Each table's real "most recent" timestamp column — not all of them are
// created_at. link_checks/geo_checks/site_crawls/traffic_checks are
// single-row-per-project snapshots keyed on checked_at, and findings tracks
// first_seen/last_seen instead. Ordering every table by a literal
// "created_at" 500s on the five that don't have it.
export const DATASETS: Record<string, string> = {
  project_documents: "created_at",
  project_competitors: "created_at",
  seo_audits: "created_at",
  link_checks: "checked_at",
  geo_checks: "checked_at",
  site_crawls: "checked_at",
  traffic_checks: "checked_at",
  findings: "last_seen",
  code_fixes: "created_at",
  leads: "created_at",
};

/**
 * Upper bound on rows returned per table. Newest rows win (every query orders
 * newest first), so a project with a huge backlog keeps a bounded payload
 * instead of streaming thousands of rows on every dashboard load.
 */
export const MAX_ROWS_PER_TABLE = 1000;

export type DatasetQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/** The slice of a Supabase client the loader needs, so tests can fake it. */
export type DatasetClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(column: string, opts: { ascending: boolean }): {
          limit(count: number): DatasetQuery;
        };
      };
    };
  };
};

/**
 * Loads every dataset for a project concurrently (one round trip of latency
 * instead of ten sequential ones). Resolves to the rows per table, or to the
 * first error in DATASETS order so the failure message stays deterministic.
 */
export async function loadPlatformDatasets(
  client: DatasetClient,
  projectId: string
): Promise<{ data: Record<string, unknown[]> } | { error: string }> {
  const tables = Object.entries(DATASETS);
  const results = await Promise.all(
    tables.map(([table, orderColumn]) =>
      client
        .from(table)
        .select("*")
        .eq("project_id", projectId)
        .order(orderColumn, { ascending: false })
        .limit(MAX_ROWS_PER_TABLE)
    )
  );

  const data: Record<string, unknown[]> = {};
  for (let i = 0; i < tables.length; i++) {
    const { data: rows, error } = results[i];
    if (error) return { error: `Failed to load ${tables[i][0]}: ${error.message}` };
    data[tables[i][0]] = rows ?? [];
  }
  return { data };
}

/** Strong ETag for a serialized body. */
export function etagFor(body: string): string {
  return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

/** True when the request's If-None-Match header names this ETag (or *). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === etag || t === "*");
}
