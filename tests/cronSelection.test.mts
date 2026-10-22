import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, fetchAllPages, mapChunks } from "../lib/domain/jobs/paginate.ts";
import { lastCaptureTimes, linkedGithubProjects, loadGscTargets, loadSnapshotsDoneToday } from "../lib/domain/search/cronSelection.ts";
import { listProposalsDone } from "../lib/domain/actions/automationSettingsStoreSupabase.ts";
import { selectDueLeadProjects } from "../lib/domain/leads/dueLeadProjects.ts";
import { selectDueProjects } from "../lib/domain/search/dueProjects.ts";

type Row = Record<string, unknown>;
type Call = { table: string; op: string; args: unknown[] };

/**
 * Fake PostgREST. `eq`, `gte`, `in` and `not(col, "is", null)` really filter; `like`, `or`, `order` are recorded.
 * Every ranged answer is capped at `cap` rows, like the real server's max-rows. `fail(table, calls)` returns an
 * error message to make that request fail.
 */
function fakeDb(
  tables: Record<string, Row[]>,
  options: { cap?: number; fail?: (table: string, calls: Call[]) => string | null } = {},
) {
  const cap = options.cap ?? 1000;
  const calls: Call[] = [];
  const ranges: Record<string, Array<[number, number]>> = {};
  const inLengths: number[] = [];
  const db = {
    from(table: string) {
      const mine: Call[] = [];
      let rows = tables[table] ?? [];
      const rec = (op: string, args: unknown[]) => {
        const c = { table, op, args };
        mine.push(c);
        calls.push(c);
      };
      const builder: Record<string, unknown> = {};
      const chain = (op: string, apply?: (args: unknown[]) => void) => (...args: unknown[]) => {
        rec(op, args);
        apply?.(args);
        return builder;
      };
      builder.select = chain("select");
      builder.eq = chain("eq", ([col, val]) => (rows = rows.filter((r) => r[col as string] === val)));
      builder.gte = chain("gte", ([col, val]) => (rows = rows.filter((r) => String(r[col as string]) >= String(val))));
      builder.in = chain("in", ([col, vals]) => {
        inLengths.push((vals as unknown[]).length);
        rows = rows.filter((r) => (vals as unknown[]).includes(r[col as string]));
      });
      builder.not = chain("not", ([col, op, val]) => {
        if (op === "is" && val === null) rows = rows.filter((r) => r[col as string] != null);
      });
      builder.like = chain("like");
      builder.or = chain("or");
      builder.order = chain("order");
      builder.range = (from: number, to: number) => {
        rec("range", [from, to]);
        (ranges[table] ??= []).push([from, to]);
        const message = options.fail?.(table, mine) ?? null;
        if (message) return Promise.resolve({ data: null, error: { message } });
        return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null });
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls, ranges, inLengths };
}

const noLog = () => {};
const ids = (n: number, prefix = "p") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(5, "0")}`);

// ---------- helpers ----------

test("fetchAllPages reads every row when the data is larger than one 1000-row response", async () => {
  const data = Array.from({ length: 2500 }, (_, i) => i);
  const seen: Array<[number, number]> = [];
  const rows = await fetchAllPages<number>(async (from, to) => {
    seen.push([from, to]);
    return { data: data.slice(from, to + 1), error: null };
  });
  assert.equal(rows.length, 2500);
  assert.equal(rows[0], 0);
  assert.equal(rows[2499], 2499);
  assert.deepEqual(seen, [[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
});

test("fetchAllPages: an exact multiple of the page size needs one more (empty) page, then stops", async () => {
  const data = Array.from({ length: 1000 }, (_, i) => i);
  let calls = 0;
  const rows = await fetchAllPages<number>(async (from, to) => {
    calls += 1;
    return { data: data.slice(from, to + 1), error: null };
  });
  assert.equal(rows.length, 1000);
  assert.equal(calls, 2);
});

test("fetchAllPages: a server that answers fewer rows than asked for (lower max-rows) cannot cut the read short", async () => {
  const { db } = fakeDb({ t: Array.from({ length: 1234 }, (_, i) => ({ id: i })) }, { cap: 500 });
  const rows = await fetchAllPages<Row>((from, to) => (db.from("t") as unknown as { range(a: number, b: number): Promise<{ data: Row[]; error: null }> }).range(from, to));
  assert.equal(rows.length, 1234);
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 1234 }, (_, i) => i));
});

test("fetchAllPages stops at max, never asks for rows past it, and warns", async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (m: string) => void warnings.push(String(m));
  try {
    const seen: Array<[number, number]> = [];
    const rows = await fetchAllPages<number>(
      async (from, to) => {
        seen.push([from, to]);
        return { data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null };
      },
      1000,
      2500,
    );
    assert.equal(rows.length, 2500);
    assert.deepEqual(seen, [[0, 999], [1000, 1999], [2000, 2499]]);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = original;
  }
});

test("fetchAllPages throws on the first error instead of returning a partial list", async () => {
  let calls = 0;
  await assert.rejects(
    fetchAllPages<number>(async (from) => {
      calls += 1;
      return from === 0 ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null } : { data: null, error: { message: "boom" } };
    }),
    /boom/,
  );
  assert.equal(calls, 2);
});

test("chunk: boundaries around the chunk size", () => {
  assert.deepEqual(chunk([], 200), []);
  assert.deepEqual(chunk([1, 2, 3], 200), [[1, 2, 3]]);
  assert.deepEqual(chunk(ids(200), 200).map((c) => c.length), [200]);
  assert.deepEqual(chunk(ids(201), 200).map((c) => c.length), [200, 1]);
  assert.deepEqual(chunk(ids(400), 200).map((c) => c.length), [200, 200]);
  assert.deepEqual(chunk(ids(3000)).map((c) => c.length), Array(15).fill(200));
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.throws(() => chunk([1], 0));
});

test("mapChunks keeps chunk order and limits concurrency", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapChunks(ids(10), 2, async (part, index) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5 - Math.min(index, 4)));
    running -= 1;
    return part[0];
  }, 3);
  assert.deepEqual(out, ["p00000", "p00002", "p00004", "p00006", "p00008"]);
  assert.ok(peak <= 3 && peak >= 2);
  assert.deepEqual(await mapChunks([], 200, async () => 1), []);
});

// ---------- search-monitor selection ----------

test("loadGscTargets: more than 1000 connections and selected properties are all seen", async () => {
  const connections = ids(2500).map((p, i) => ({ id: `c${i}`, project_id: p, user_id: `u${i}`, provider: "gsc", status: "active" }));
  // Only even connections have a selected property, 1250 of them: more than one response.
  const resources = connections
    .filter((_, i) => i % 2 === 0)
    .map((c, i) => ({ id: `r${i}`, connection_id: c.id, resource_type: "search_console_property", selected: true }));
  const { db, ranges } = fakeDb({ integration_connections: connections, integration_resources: resources });
  const out = await loadGscTargets(db, noLog);
  assert.ok("rows" in out);
  assert.equal(out.rows.length, 2500);
  assert.equal(out.rows.filter((r) => r.hasProperty).length, 1250);
  assert.equal(out.rows[2499].projectId, "p02499");
  assert.equal(out.rows[2499].hasProperty, false);
  assert.equal(out.rows[2498].hasProperty, true);
  assert.deepEqual(ranges.integration_connections.slice(0, 3), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.deepEqual(ranges.integration_resources.slice(0, 2), [[0, 999], [1000, 1999]]);
});

test("loadGscTargets: falls back to the old columns before the health migration, and reports an error when both fail", async () => {
  const connections = ids(3).map((p, i) => ({ id: `c${i}`, project_id: p, user_id: `u${i}`, provider: "gsc" }));
  const noStatus = fakeDb({ integration_connections: connections }, {
    fail: (table, calls) => (table === "integration_connections" && calls.some((c) => c.op === "select" && String(c.args[0]).includes("status")) ? "column status does not exist" : null),
  });
  const ok = await loadGscTargets(noStatus.db, noLog);
  assert.ok("rows" in ok && ok.rows.length === 3);

  const broken = fakeDb({ integration_connections: connections }, { fail: (table) => (table === "integration_connections" ? "db down" : null) });
  assert.deepEqual(await loadGscTargets(broken.db, noLog), { error: "db down" });
});

test("loadGscTargets: a failed property read is logged and nothing is skipped as no_property", async () => {
  const connections = ids(3).map((p, i) => ({ id: `c${i}`, project_id: p, user_id: `u${i}`, provider: "gsc", status: "active" }));
  const { db } = fakeDb({ integration_connections: connections }, { fail: (table) => (table === "integration_resources" ? "timeout" : null) });
  const logs: string[] = [];
  const out = await loadGscTargets(db, (m) => logs.push(m));
  assert.ok("rows" in out);
  assert.ok(out.rows.every((r) => r.hasProperty === undefined));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /timeout/);
  assert.equal(selectDueProjects(out.rows, new Set()).length, 3);
});

test("loadSnapshotsDoneToday: more than 1000 snapshots for the day are all in the set; other days are not", async () => {
  const today = ids(1500).map((p) => ({ project_id: p, snapshot_date: "2026-10-22" }));
  const old = ids(50, "q").map((p) => ({ project_id: p, snapshot_date: "2026-10-21" }));
  const { db } = fakeDb({ search_snapshots: [...today, ...old] });
  const done = await loadSnapshotsDoneToday(db, "2026-10-22");
  assert.equal(done.size, 1500);
  assert.ok(done.has("p01499"));
  assert.ok(!done.has("q00000"));
});

test("loadSnapshotsDoneToday throws on a failed read", async () => {
  const { db } = fakeDb({ search_snapshots: [] }, { fail: () => "statement timeout" });
  await assert.rejects(loadSnapshotsDoneToday(db, "2026-10-22"), /statement timeout/);
});

test("listProposalsDone: more than 1000 done markers are all seen, and a failed read throws", async () => {
  const rows = ids(1700).map((p) => ({ project_id: p, doc_type: "auto_propose_done:2026-10-22" }));
  const { db } = fakeDb({ project_documents: [...rows, { project_id: "other", doc_type: "auto_propose_done:2026-10-21" }] });
  const done = await listProposalsDone(db, "2026-10-22");
  assert.equal(done.size, 1700);
  assert.ok(!done.has("other"));
  const bad = fakeDb({ project_documents: [] }, { fail: () => "nope" });
  await assert.rejects(listProposalsDone(bad.db, "2026-10-22"), /nope/);
});

test("linkedGithubProjects: more than 1000 links are all returned and parsed", async () => {
  const rows = ids(1200).map((p, i) => ({ user_id: `u${i}`, key: `github_app:${p}` }));
  const { db } = fakeDb({ user_settings: [...rows, { user_id: "x", key: "github_app:" }] });
  const out = await linkedGithubProjects(db);
  assert.equal(out.length, 1200);
  assert.deepEqual(out[1199], { userId: "u1199", projectId: "p01199" });
});

test("lastCaptureTimes: 3000 ids are sent in chunks of 200 and every project's latest capture is found", async () => {
  const projectIds = ids(3000);
  const snapshots: Row[] = [];
  for (const p of projectIds) {
    snapshots.push({ project_id: p, snapshot_date: "2026-10-20", captured_at: `2026-10-20T0${Number(p.slice(1)) % 10}:00:00.000Z` });
    snapshots.push({ project_id: p, snapshot_date: "2026-10-21", captured_at: "2026-10-21T01:00:00.000Z" });
  }
  snapshots.push({ project_id: "p00000", snapshot_date: "2026-08-01", captured_at: "2026-08-01T00:00:00.000Z" }); // outside the 30 days
  const { db, inLengths, calls } = fakeDb({ search_snapshots: snapshots });
  const out = await lastCaptureTimes(db, projectIds, { now: new Date("2026-10-22T05:00:00Z"), log: noLog });
  assert.equal(out.size, 3000);
  assert.equal(out.get("p00000"), "2026-10-21T01:00:00.000Z");
  assert.equal(out.get("p02999"), "2026-10-21T01:00:00.000Z");
  assert.equal(inLengths.length >= 15, true);
  assert.ok(inLengths.every((n) => n <= 200), "no .in() list is longer than 200 ids");
  assert.equal(new Set(calls.filter((c) => c.op === "gte").map((c) => c.args[1])).size, 1);
  assert.equal(calls.find((c) => c.op === "gte")?.args[1], "2026-09-22");
});

test("lastCaptureTimes: one chunk of 200 and 201 ids make one and two requests per page", async () => {
  const run = async (n: number) => {
    const { db, inLengths } = fakeDb({ search_snapshots: [] });
    await lastCaptureTimes(db, ids(n), { log: noLog });
    return inLengths;
  };
  assert.deepEqual(await run(200), [200]);
  assert.deepEqual(await run(201), [200, 1]);
  assert.deepEqual(await run(0), []);
});

test("lastCaptureTimes: more than 1000 rows in one chunk are paged", async () => {
  // 200 projects x 30 days = 6000 rows for one chunk.
  const projectIds = ids(200);
  const snapshots: Row[] = [];
  for (let d = 1; d <= 30; d += 1) {
    const day = `2026-10-${String(d).padStart(2, "0")}`;
    for (const p of projectIds) snapshots.push({ project_id: p, snapshot_date: day, captured_at: `${day}T01:00:00.000Z` });
  }
  const { db, ranges } = fakeDb({ search_snapshots: snapshots });
  const out = await lastCaptureTimes(db, projectIds, { now: new Date("2026-10-31T00:00:00Z"), log: noLog });
  assert.equal(out.size, 200);
  assert.ok(ranges.search_snapshots.length >= 6);
  assert.equal(out.get("p00199"), "2026-10-30T01:00:00.000Z");
});

test("lastCaptureTimes: a failing chunk is logged, its projects count as never captured, the other chunks still count", async () => {
  const projectIds = ids(450); // chunks: 0-199, 200-399, 400-449
  const snapshots = projectIds.map((p) => ({ project_id: p, snapshot_date: "2026-10-21", captured_at: "2026-10-21T01:00:00.000Z" }));
  const failingFirst = projectIds[200];
  const { db } = fakeDb({ search_snapshots: snapshots }, {
    fail: (_t, calls) => {
      const inCall = calls.find((c) => c.op === "in");
      return inCall && (inCall.args[1] as string[]).includes(failingFirst) ? "URI too long" : null;
    },
  });
  const logs: string[] = [];
  const run = () => lastCaptureTimes(db, projectIds, { now: new Date("2026-10-22T00:00:00Z"), log: (m) => logs.push(m) });
  const out = await run();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /200 projects/);
  assert.match(logs[0], /URI too long/);
  assert.equal(out.size, 250);
  assert.ok(out.has("p00000") && out.has("p00199") && out.has("p00449"));
  assert.ok(!out.has("p00200") && !out.has("p00399"));

  // Deterministic: the same failure gives the same map and the same ordering, with the unknown ones first by id.
  const again = await run();
  assert.deepEqual([...again.entries()], [...out.entries()]);
  const targets = projectIds.map((projectId) => ({ projectId, userId: "u" }));
  const order = selectDueProjects(targets, new Set(), out).map((t) => t.projectId);
  assert.deepEqual(order.slice(0, 200), projectIds.slice(200, 400));
  assert.equal(order.length, 450);
});

test("lastCaptureTimes: a thrown (non-PostgREST) error is also caught and logged", async () => {
  const db = { from() { throw new Error("socket hang up"); } } as unknown as SupabaseClient;
  const logs: string[] = [];
  const out = await lastCaptureTimes(db, ids(5), { log: (m) => logs.push(m) });
  assert.equal(out.size, 0);
  assert.match(logs[0], /socket hang up/);
});

// ---------- leads-refresh selection ----------

test("selectDueLeadProjects: more than 1000 due projects are all read, ordered oldest stamp first with nulls first", async () => {
  const projects = ids(2300).map((p, i) => ({ id: p, owner_id: "u", name: p, category: null, leads_auto_last_at: i % 3 === 0 ? null : "2026-10-01T00:00:00.000Z" }));
  const profiles = projects.map((p) => ({ project_id: p.id, doc_type: "lead_profile", content: '{"confirmedAt":"2026-10-01T00:00:00.000Z"}' }));
  const { db, calls, ranges } = fakeDb({ projects, project_documents: profiles });
  const out = await selectDueLeadProjects(db, "2026-10-21T00:00:00.000Z", noLog);
  assert.ok("projects" in out);
  assert.equal(out.projects.length, 2300);
  assert.deepEqual(ranges.projects.slice(0, 3), [[0, 999], [1000, 1999], [2000, 2999]]);
  const orders = calls.filter((c) => c.table === "projects" && c.op === "order").slice(0, 2);
  assert.deepEqual(orders[0].args, ["leads_auto_last_at", { ascending: true, nullsFirst: true }]);
  assert.deepEqual(orders[1].args, ["id", { ascending: true }]);
  const or = calls.find((c) => c.table === "projects" && c.op === "or");
  assert.equal(or?.args[0], "leads_auto_last_at.is.null,leads_auto_last_at.lt.2026-10-21T00:00:00.000Z");
});

test("selectDueLeadProjects: only projects with a confirmed lead profile are returned; the profile read is a paged lead_profile query", async () => {
  const projects = ids(1500).map((p) => ({ id: p, owner_id: "u", name: p, category: null, leads_auto_last_at: null }));
  // 1200 confirmed profiles (more than one response), the rest have none.
  const profiles = projects.slice(0, 1200).map((p) => ({ project_id: p.id, doc_type: "lead_profile", content: "{}" }));
  const { db, calls } = fakeDb({ projects, project_documents: [...profiles, { project_id: "p01400", doc_type: "other", content: "{}" }] });
  const out = await selectDueLeadProjects(db, "2026-10-21T00:00:00.000Z", noLog);
  assert.ok("projects" in out);
  assert.equal(out.projects.length, 1200);
  assert.equal(out.projects[1199].id, "p01199");
  const docCalls = calls.filter((c) => c.table === "project_documents");
  assert.deepEqual(docCalls.find((c) => c.op === "eq")?.args, ["doc_type", "lead_profile"]);
  assert.ok(docCalls.some((c) => c.op === "like" && String(c.args[1]).includes("confirmedAt")));
});

test("selectDueLeadProjects: if the profile read fails the filter is dropped (logged) and every due project is returned", async () => {
  const projects = ids(5).map((p) => ({ id: p, owner_id: "u", name: p, category: null, leads_auto_last_at: null }));
  const { db } = fakeDb({ projects }, { fail: (table) => (table === "project_documents" ? "timeout" : null) });
  const logs: string[] = [];
  const out = await selectDueLeadProjects(db, "2026-10-21T00:00:00.000Z", (m) => logs.push(m));
  assert.ok("projects" in out);
  assert.equal(out.projects.length, 5);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /timeout/);
});

test("selectDueLeadProjects: a failed project read is returned as an error (the route answers 500)", async () => {
  const { db } = fakeDb({}, { fail: (table) => (table === "projects" ? "permission denied" : null) });
  assert.deepEqual(await selectDueLeadProjects(db, "2026-10-21T00:00:00.000Z", noLog), { error: "permission denied" });
});
