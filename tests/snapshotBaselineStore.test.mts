import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getSnapshotOnOrBefore } from "../lib/domain/search/searchSnapshotStore.ts";
import type { SearchSnapshotPayload } from "../lib/domain/search/searchSnapshot.ts";

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE search_snapshots (
    project_id TEXT NOT NULL, snapshot_date TEXT NOT NULL, payload TEXT NOT NULL, captured_at TEXT NOT NULL,
    PRIMARY KEY (project_id, snapshot_date))`);
  return db;
}

const payload = (position: number) => ({ version: 1, marker: position }) as unknown as SearchSnapshotPayload;

/** One snapshot per day (the table's key), captured at the given moment. */
function add(db: Database.Database, day: string, capturedAt: string, position: number) {
  db.prepare("INSERT INTO search_snapshots (project_id, snapshot_date, payload, captured_at) VALUES ('p', ?, ?, ?)")
    .run(day, JSON.stringify(payload(position)), capturedAt);
}

test("sqlite baseline: a merge is compared with the newest snapshot captured at or before it, not by day", () => {
  const db = memoryDb();
  add(db, "2026-09-30", "2026-09-30T23:50:00.000Z", 11);
  add(db, "2026-10-10", "2026-10-10T06:00:00.000Z", 4);

  // Merged 2026-10-01T00:00Z: the newest snapshot is from 2026-10-10, so the one captured before the merge is the baseline.
  const merged = getSnapshotOnOrBefore(db, "p", "2026-10-01T00:00:00.000Z");
  assert.equal(merged?.snapshotDate, "2026-09-30");
  assert.equal(merged?.capturedAt, "2026-09-30T23:50:00.000Z");
  assert.equal((merged?.payload as unknown as { marker: number }).marker, 11);
});

test("sqlite baseline: a same-day snapshot captured after the merge is not returned", () => {
  const db = memoryDb();
  add(db, "2026-10-01", "2026-10-01T09:00:00.000Z", 4);
  assert.equal(getSnapshotOnOrBefore(db, "p", "2026-10-01T00:00:00.000Z"), null);
  assert.equal(getSnapshotOnOrBefore(db, "p", "2026-10-01T09:00:00.000Z")?.capturedAt, "2026-10-01T09:00:00.000Z", "at the exact moment it counts");
});

test("sqlite baseline: other projects' snapshots are never used", () => {
  const db = memoryDb();
  db.prepare("INSERT INTO search_snapshots VALUES ('other', '2026-09-30', ?, '2026-09-30T10:00:00.000Z')").run(JSON.stringify(payload(1)));
  assert.equal(getSnapshotOnOrBefore(db, "p", "2026-10-01T00:00:00.000Z"), null);
});
