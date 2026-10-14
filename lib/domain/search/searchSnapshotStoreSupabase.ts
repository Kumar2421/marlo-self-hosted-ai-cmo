import type { SupabaseClient } from "@supabase/supabase-js";
import { isoDate, retentionCutoff, type SearchSnapshotPayload } from "./searchSnapshot.ts";
import type { StoredSnapshot } from "./searchSnapshotStore.ts";

// Platform (Supabase) store. Uses the service-role client, so every query is
// scoped by user_id and project_id explicitly.

export async function saveSnapshot(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  payload: SearchSnapshotPayload,
  now = new Date(),
): Promise<void> {
  const { error } = await db.from("search_snapshots").upsert(
    { project_id: projectId, user_id: userId, snapshot_date: isoDate(now), payload, captured_at: now.toISOString() },
    { onConflict: "project_id,snapshot_date" },
  );
  if (error) throw new Error(error.message);
  await db.from("search_snapshots").delete().eq("project_id", projectId).eq("user_id", userId).lt("snapshot_date", retentionCutoff(now));
}

export async function getLatestSnapshot(db: SupabaseClient, userId: string, projectId: string): Promise<StoredSnapshot | null> {
  const { data, error } = await db
    .from("search_snapshots")
    .select("snapshot_date, captured_at, payload")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load search snapshot: ${error.message}`);
  if (!data) return null;
  return { snapshotDate: String(data.snapshot_date), capturedAt: String(data.captured_at), payload: data.payload as SearchSnapshotPayload };
}

/**
 * The newest snapshot captured at or before `at` (ISO timestamp): the state at a past moment, e.g. a merge.
 * Compared by capture time, not day, so a snapshot taken later the same day is never the "before" state.
 */
export async function getSnapshotOnOrBefore(db: SupabaseClient, userId: string, projectId: string, at: string): Promise<StoredSnapshot | null> {
  const { data, error } = await db
    .from("search_snapshots")
    .select("snapshot_date, captured_at, payload")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .lte("captured_at", at)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load search snapshot: ${error.message}`);
  if (!data) return null;
  return { snapshotDate: String(data.snapshot_date), capturedAt: String(data.captured_at), payload: data.payload as SearchSnapshotPayload };
}

export async function countSnapshots(db: SupabaseClient, userId: string, projectId: string): Promise<number> {
  const { count } = await db
    .from("search_snapshots")
    .select("project_id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("user_id", userId);
  return count ?? 0;
}
