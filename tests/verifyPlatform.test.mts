import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FIXED_FINDINGS_PAGE_SIZE, MAX_FIXED_FINDINGS, listFixedFindingRows } from "../lib/domain/findings/fixedFindingRows.ts";

const NOW = "2026-10-14T12:00:00.000Z";
type Row = Record<string, unknown>;

function findingRow(i: number): Row {
  return { id: `f${String(i).padStart(5, "0")}`, project_id: "p1", user_id: "u1", status: "fixed", source: "seo-audit", category: "meta-title", severity: "warning", entity_type: "page-issue", entity_id: "meta-title-too-long", url: "https://example.com/", evidence: {}, recommendation: "", first_seen: NOW, last_seen: NOW, resolved_at: null };
}

/** Fake PostgREST: each range is answered with at most `serverCap` rows, like the real row cap. */
class FakeFindingsQuery {
  db: FakeDb;
  constructor(db: FakeDb) {
    this.db = db;
  }
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  order(column: string): this {
    this.db.orders.push(column);
    return this;
  }
  async range(from: number, to: number): Promise<{ data: Row[]; error: null }> {
    this.db.ranges.push([from, to]);
    const end = Math.min(to, from + this.db.serverCap - 1, this.db.rows.length - 1);
    return { data: end >= from ? this.db.rows.slice(from, end + 1) : [], error: null };
  }
}

class FakeDb {
  rows: Row[];
  serverCap: number;
  ranges: Array<[number, number]> = [];
  orders: string[] = [];
  constructor(rows: Row[], serverCap = FIXED_FINDINGS_PAGE_SIZE) {
    this.rows = rows;
    this.serverCap = serverCap;
  }
  from(): FakeFindingsQuery {
    return new FakeFindingsQuery(this);
  }
}

function rowsOf(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => findingRow(i));
}

test("fixed findings are read in ranges, so a set larger than one 1000-row response is not truncated", async () => {
  const db = new FakeDb(rowsOf(2500));
  const rows = await listFixedFindingRows(db as unknown as SupabaseClient);
  assert.equal(rows.length, 2500);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2500);
  assert.deepEqual(db.ranges, [[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
  assert.ok(db.orders.length === db.ranges.length && db.orders.every((column) => column === "id"));
});

test("an exact multiple of the page size reads to the end and stops on the empty page", async () => {
  const db = new FakeDb(rowsOf(1000));
  const rows = await listFixedFindingRows(db as unknown as SupabaseClient);
  assert.equal(rows.length, 1000);
  assert.deepEqual(db.ranges, [[0, 999], [1000, 1999]]);
});

test("a server that answers with fewer rows than asked for does not make the cursor skip any", async () => {
  const db = new FakeDb(rowsOf(1200), 500);
  const rows = await listFixedFindingRows(db as unknown as SupabaseClient);
  assert.equal(rows.length, 1200);
  assert.equal(new Set(rows.map((row) => row.id)).size, 1200);
});

test("the overall cap bounds one run's read", async () => {
  const db = new FakeDb(rowsOf(MAX_FIXED_FINDINGS + 1000));
  const rows = await listFixedFindingRows(db as unknown as SupabaseClient);
  assert.equal(rows.length, MAX_FIXED_FINDINGS);
  assert.ok(db.ranges.every(([, to]) => to <= MAX_FIXED_FINDINGS - 1));
});
