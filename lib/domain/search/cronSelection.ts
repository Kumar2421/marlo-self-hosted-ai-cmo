import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CHUNK_SIZE, fetchAllPages, mapChunks, type PageResult } from "../jobs/paginate.ts";
import type { SnapshotTarget } from "./dueProjects.ts";

// Selection reads for the search-monitor cron. Every read is paged (PostgREST answers at most
// 1000 rows per request) and ordered by a unique key so the pages never overlap.

type Log = (message: string) => void;
const defaultLog: Log = (message) => console.error(message);

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The Supabase builder's row type is generic over the select string; these reads cast to the row shape they ask for. */
function rowsOf<T>(query: unknown): PromiseLike<PageResult<T>> {
  return query as PromiseLike<PageResult<T>>;
}

type ConnectionRow = { id: string; project_id: string; user_id: string; status?: string | null };

/**
 * GSC connections with their health and whether a property is selected. The health columns come from
 * migration 20261021000000; until it is applied the query falls back to the old columns and nothing is skipped.
 */
export async function loadGscTargets(db: SupabaseClient, log: Log = defaultLog): Promise<{ rows: SnapshotTarget[] } | { error: string }> {
  const read = (columns: string) =>
    fetchAllPages<ConnectionRow>((from, to) =>
      rowsOf(
        db
          .from("integration_connections")
          .select(columns)
          .eq("provider", "gsc")
          .not("project_id", "is", null)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );

  let rows: ConnectionRow[];
  try {
    rows = await read("id, project_id, user_id, status");
  } catch {
    try {
      rows = await read("id, project_id, user_id");
    } catch (err) {
      return { error: describe(err) };
    }
  }

  // Connections missing from this set would be skipped as "no_property", so a failed read must not look like an empty one.
  let withProperty: Set<string> | null = null;
  try {
    const selected = await fetchAllPages<{ connection_id: string }>((from, to) =>
      rowsOf(
        db
          .from("integration_resources")
          .select("connection_id")
          .eq("resource_type", "search_console_property")
          .eq("selected", true)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
    withProperty = new Set(selected.map((r) => String(r.connection_id)));
  } catch (err) {
    log(`[search-monitor] could not read selected Search Console properties; no connection will be skipped for a missing property: ${describe(err)}`);
  }

  return {
    rows: rows.map((c) => ({
      projectId: String(c.project_id),
      userId: String(c.user_id),
      status: c.status ?? null,
      hasProperty: withProperty ? withProperty.has(String(c.id)) : undefined,
    })),
  };
}

/** Project ids that already have a snapshot for `day`. Throws on a failed read: a wrong "done" set would re-capture or skip projects. */
export async function loadSnapshotsDoneToday(db: SupabaseClient, day: string): Promise<Set<string>> {
  const rows = await fetchAllPages<{ project_id: unknown }>((from, to) =>
    rowsOf(db.from("search_snapshots").select("project_id").eq("snapshot_date", day).order("project_id", { ascending: true }).range(from, to)),
  );
  return new Set(rows.map((row) => String(row.project_id)));
}

/**
 * Latest snapshot capture time per project over the last 30 days; projects without one sort first.
 * The id list is chunked (a 3000-id `.in()` is too long a URL). A chunk whose read fails is logged and
 * left out entirely, so its projects are all treated as never captured; the other chunks still count.
 */
export async function lastCaptureTimes(
  db: SupabaseClient,
  projectIds: string[],
  options: { now?: Date; log?: Log; chunkSize?: number } = {},
): Promise<Map<string, string>> {
  const log = options.log ?? defaultLog;
  const out = new Map<string, string>();
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return out;
  const since = new Date((options.now ?? new Date()).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

  const perChunk = await mapChunks(ids, options.chunkSize ?? DEFAULT_CHUNK_SIZE, async (part) => {
    try {
      return await fetchAllPages<{ project_id: unknown; captured_at: unknown }>((from, to) =>
        rowsOf(
          db
            .from("search_snapshots")
            .select("project_id, captured_at")
            .gte("snapshot_date", since)
            .in("project_id", part)
            .order("project_id", { ascending: true })
            .order("snapshot_date", { ascending: true })
            .range(from, to),
        ),
      );
    } catch (err) {
      log(`[search-monitor] last capture times unavailable for ${part.length} projects; treating them as never captured: ${describe(err)}`);
      return [];
    }
  });

  for (const rows of perChunk) {
    for (const row of rows) {
      const id = String(row.project_id);
      const at = String(row.captured_at);
      const prev = out.get(id);
      if (!prev || at > prev) out.set(id, at);
    }
  }
  return out;
}

/** Projects with a GitHub App link. The link is stored per project in user_settings as `github_app:<projectId>`. Throws on a failed read. */
export async function linkedGithubProjects(db: SupabaseClient): Promise<Array<{ userId: string; projectId: string }>> {
  const PREFIX = "github_app:";
  const rows = await fetchAllPages<{ user_id: unknown; key: unknown }>((from, to) =>
    rowsOf(
      db
        .from("user_settings")
        .select("user_id, key")
        .like("key", `${PREFIX}%`)
        .order("user_id", { ascending: true })
        .order("key", { ascending: true })
        .range(from, to),
    ),
  );
  return rows
    .map((row) => ({ userId: String(row.user_id), projectId: String(row.key).slice(PREFIX.length) }))
    .filter((project) => project.projectId !== "");
}
