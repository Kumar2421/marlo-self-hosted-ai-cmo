import { createHash } from "node:crypto";
import { REAL_DOCUMENT_TYPES } from "../../document-types.ts";
import { slimAuditRow, type DashboardDataset } from "./dashboardCache.ts";

export type DatasetSpec = {
  /** Columns selected on Supabase. Never `*`: documents carry long text and audits a crawled body. */
  columns: string;
  /** Columns selected on the self-host SQLite store (no PostgREST JSON paths there). */
  sqliteColumns: string;
  /** The table's real "most recent" timestamp column. */
  orderColumn: string;
  /** Upper bound on rows, newest first. */
  limit: number;
  /** When set, only rows whose doc_type is in this list are read (applied before the limit). */
  docTypes?: readonly string[];
};

/**
 * The datasets the dashboard actually reads, with only the columns it uses.
 * (link_checks, geo_checks, site_crawls, traffic_checks, findings, code_fixes
 * and leads used to be loaded here too; nothing consumed them, and each panel
 * that needs them has its own endpoint.)
 *
 * - project_documents: one row per doc type (primary key project_id + doc_type).
 * - project_competitors: a handful of rows; id/url/created_at is all the panel shows.
 * - seo_audits: one row per audited URL. Only the on-page score is pulled out of
 *   the payload (PostgREST JSON path) instead of shipping the whole crawl.
 */
export const DATASETS: Record<DashboardDataset, DatasetSpec> = {
  project_documents: {
    columns: "doc_type, content, updated_at",
    sqliteColumns: "doc_type, content, updated_at",
    orderColumn: "created_at",
    limit: 50,
    // Allowlist, not a marker exclusion: cron markers share this table and are always newer.
    docTypes: REAL_DOCUMENT_TYPES,
  },
  project_competitors: {
    columns: "id, url, created_at",
    sqliteColumns: "id, url, created_at",
    orderColumn: "created_at",
    limit: 200,
  },
  seo_audits: {
    columns: "url, created_at, onPageScore:payload->technical->onPageScore",
    sqliteColumns: "url, created_at, payload",
    orderColumn: "created_at",
    limit: 20,
  },
};

/** Per-table row post-processing applied after the query. */
export function shapeRows(table: DashboardDataset, rows: unknown[]): unknown[] {
  return table === "seo_audits" ? rows.map((r) => slimAuditRow(r as Record<string, unknown>)) : rows;
}

export type DatasetQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

type DatasetFilterable = {
  in(column: string, values: readonly string[]): DatasetFilterable;
  order(column: string, opts: { ascending: boolean }): {
    limit(count: number): DatasetQuery;
  };
};

/** The slice of a Supabase client the loader needs, so tests can fake it. */
export type DatasetClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): DatasetFilterable;
    };
  };
};

/**
 * Loads the requested datasets (default: all of them) for a project
 * concurrently. Resolves to the rows per table, or to the first error in
 * request order so the failure message stays deterministic.
 */
export async function loadPlatformDatasets(
  client: DatasetClient,
  projectId: string,
  names: readonly DashboardDataset[] = Object.keys(DATASETS) as DashboardDataset[]
): Promise<{ data: Record<string, unknown[]> } | { error: string }> {
  const results = await Promise.all(
    names.map((table) => {
      const spec = DATASETS[table];
      let query = client.from(table).select(spec.columns).eq("project_id", projectId);
      if (spec.docTypes) query = query.in("doc_type", spec.docTypes);
      return query
        .order(spec.orderColumn, { ascending: false })
        .limit(spec.limit);
    })
  );

  const data: Record<string, unknown[]> = {};
  for (let i = 0; i < names.length; i++) {
    const { data: rows, error } = results[i];
    if (error) return { error: `Failed to load ${names[i]}: ${error.message}` };
    data[names[i]] = shapeRows(names[i], rows ?? []);
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
