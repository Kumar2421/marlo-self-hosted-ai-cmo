import type Database from "better-sqlite3";
import { isoDate, retentionCutoff, type SearchSnapshotPayload } from "./searchSnapshot.ts";

export type StoredSnapshot = {
  snapshotDate: string;
  capturedAt: string;
  payload: SearchSnapshotPayload;
};

// Self-host (SQLite) store. Takes the database explicitly (callers pass
// getDb()) so it can be tested against an in-memory database.

/** Save today's snapshot (replacing any earlier one the same day) and prune old history. */
export function saveSnapshot(db: Database.Database, projectId: string, payload: SearchSnapshotPayload, now = new Date()): void {
  db.prepare(
    `INSERT INTO search_snapshots (project_id, snapshot_date, payload, captured_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, snapshot_date) DO UPDATE SET payload = excluded.payload, captured_at = excluded.captured_at`,
  ).run(projectId, isoDate(now), JSON.stringify(payload), now.toISOString());
  db.prepare("DELETE FROM search_snapshots WHERE project_id = ? AND snapshot_date < ?").run(projectId, retentionCutoff(now));
}

export function getLatestSnapshot(db: Database.Database, projectId: string): StoredSnapshot | null {
  const row = db
    .prepare("SELECT snapshot_date, captured_at, payload FROM search_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 1")
    .get(projectId) as { snapshot_date: string; captured_at: string; payload: string } | undefined;
  if (!row) return null;
  return { snapshotDate: row.snapshot_date, capturedAt: row.captured_at, payload: JSON.parse(row.payload) };
}

/** The newest snapshot dated on or before `date` (YYYY-MM-DD): the state at a past moment, e.g. a merge. */
export function getSnapshotOnOrBefore(db: Database.Database, projectId: string, date: string): StoredSnapshot | null {
  const row = db
    .prepare("SELECT snapshot_date, captured_at, payload FROM search_snapshots WHERE project_id = ? AND snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1")
    .get(projectId, date) as { snapshot_date: string; captured_at: string; payload: string } | undefined;
  if (!row) return null;
  return { snapshotDate: row.snapshot_date, capturedAt: row.captured_at, payload: JSON.parse(row.payload) };
}

export function countSnapshots(db: Database.Database, projectId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM search_snapshots WHERE project_id = ?").get(projectId) as { n: number };
  return row.n;
}
