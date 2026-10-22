import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DATASETS,
  etagFor,
  etagMatches,
  loadPlatformDatasets,
  type DatasetClient,
} from "../lib/domain/project/dashboardData.ts";

type Call = { table: string; columns: string; orderColumn: string; limit: number; projectId: string; inColumn?: string; inValues?: string[] };

/** Fake Supabase client: every query takes `delayMs`, and the active/peak query counts are tracked. */
function fakeClient(opts: { delayMs?: number; failTable?: string; rows?: Record<string, unknown[]> } = {}) {
  const calls: Call[] = [];
  let active = 0;
  let peak = 0;
  const client: DatasetClient = {
    from(table) {
      const call: Partial<Call> = { table };
      return {
        select(columns) {
          call.columns = columns;
          return {
            eq(_column, value) {
              call.projectId = value;
              const filterable: ReturnType<ReturnType<ReturnType<DatasetClient["from"]>["select"]>["eq"]> = {
                in(column: string, values: readonly string[]) {
                  call.inColumn = column;
                  call.inValues = [...values];
                  return filterable;
                },
                order(column: string) {
                  call.orderColumn = column;
                  return {
                    limit(count) {
                      call.limit = count;
                      calls.push(call as Call);
                      active++;
                      peak = Math.max(peak, active);
                      return new Promise((resolve) =>
                        setTimeout(() => {
                          active--;
                          resolve(
                            table === opts.failTable
                              ? { data: null, error: { message: "boom" } }
                              : { data: opts.rows?.[table] ?? [], error: null }
                          );
                        }, opts.delayMs ?? 0)
                      );
                    },
                  };
                },
              };
              return filterable;
            },
          };
        },
      };
    },
  };
  return { client, calls, peak: () => peak };
}

const REMOVED_TABLES = ["link_checks", "geo_checks", "site_crawls", "traffic_checks", "findings", "code_fixes", "leads"];

test("only the three datasets the dashboard reads are loaded; the unused tables are gone", () => {
  assert.deepEqual(Object.keys(DATASETS), ["project_documents", "project_competitors", "seo_audits"]);
  for (const table of REMOVED_TABLES) assert.ok(!(table in DATASETS), table);
});

test("the route and the loader never reference a removed table", () => {
  for (const file of ["../app/api/project/data/route.ts", "../lib/domain/project/dashboardData.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    // Strip comments: the loader documents which tables were dropped.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const table of REMOVED_TABLES) assert.ok(!code.includes(table), `${file} still mentions ${table}`);
  }
});

test("no query uses select *, every list is capped, and audits do not pull the whole payload", async () => {
  for (const spec of Object.values(DATASETS)) {
    assert.ok(!spec.columns.includes("*") && !spec.sqliteColumns.includes("*"));
    assert.ok(spec.limit > 0 && spec.limit <= 200);
  }
  const { client, calls } = fakeClient();
  await loadPlatformDatasets(client, "p1");
  for (const call of calls) assert.notEqual(call.columns.trim(), "*");
  const audits = calls.find((c) => c.table === "seo_audits");
  assert.ok(audits && !/(^|[ ,])payload([ ,]|$)/.test(audits.columns), "audits must select a payload path, not the column");
});

test("a partial request queries only the named datasets", async () => {
  const { client, calls } = fakeClient();
  const result = await loadPlatformDatasets(client, "p1", ["project_documents"]);
  assert.ok("data" in result);
  assert.deepEqual(calls.map((c) => c.table), ["project_documents"]);
  assert.deepEqual(Object.keys(result.data), ["project_documents"]);
});

test("audit rows are reduced to url, created_at and the on-page score", async () => {
  const { client } = fakeClient({
    rows: { seo_audits: [{ url: "https://x.com", created_at: "2026-01-01", onPageScore: 81.4 }] },
  });
  const result = await loadPlatformDatasets(client, "p1");
  assert.ok("data" in result);
  assert.deepEqual(result.data.seo_audits, [
    { url: "https://x.com", created_at: "2026-01-01", payload: { technical: { onPageScore: 81.4 } } },
  ]);
});

test("every dataset is queried for the project, newest first, with a row cap", async () => {
  const { client, calls } = fakeClient();
  const result = await loadPlatformDatasets(client, "p1");
  assert.ok("data" in result);
  assert.deepEqual(Object.keys(result.data), Object.keys(DATASETS));
  assert.equal(calls.length, Object.keys(DATASETS).length);
  for (const call of calls) {
    const spec = DATASETS[call.table as keyof typeof DATASETS];
    assert.equal(call.projectId, "p1");
    assert.equal(call.columns, spec.columns);
    assert.equal(call.orderColumn, spec.orderColumn);
    assert.equal(call.limit, spec.limit);
  }
});

test("the dataset queries run concurrently, not one after another", async () => {
  const { client, peak } = fakeClient({ delayMs: 40 });
  const started = Date.now();
  await loadPlatformDatasets(client, "p1");
  const elapsed = Date.now() - started;
  assert.equal(peak(), Object.keys(DATASETS).length, "all queries in flight at once");
  // Sequential would be 3 x 40ms = 120ms; concurrent is ~40ms.
  assert.ok(elapsed < 110, `took ${elapsed}ms`);
});

test("rows are returned per table and null data becomes an empty list", async () => {
  const { client } = fakeClient({ rows: { project_competitors: [{ id: 1 }, { id: 2 }] } });
  const result = await loadPlatformDatasets(client, "p1");
  assert.ok("data" in result);
  assert.deepEqual(result.data.project_competitors, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(result.data.project_documents, []);
});

test("a failing table reports which one", async () => {
  const { client } = fakeClient({ failTable: "seo_audits" });
  const result = await loadPlatformDatasets(client, "p1");
  assert.deepEqual(result, { error: "Failed to load seo_audits: boom" });
});

test("etag is stable for the same body, differs for a different body, and matches If-None-Match", () => {
  const a = etagFor('{"x":1}');
  assert.equal(a, etagFor('{"x":1}'));
  assert.notEqual(a, etagFor('{"x":2}'));
  assert.ok(etagMatches(a, a));
  assert.ok(etagMatches(`W/${a}`, a));
  assert.ok(etagMatches(`"other", ${a}`, a));
  assert.ok(etagMatches("*", a));
  assert.ok(!etagMatches(null, a));
  assert.ok(!etagMatches('"other"', a));
});

test("the self-hosted lottie wasm is the exact file the installed player ships", () => {
  const ours = readFileSync(new URL("../public/dotlottie-player.wasm", import.meta.url));
  const theirs = readFileSync(new URL("../node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm", import.meta.url));
  assert.ok(ours.equals(theirs), "public/dotlottie-player.wasm is stale: re-copy it after upgrading @lottiefiles/dotlottie-web");
});

test("the proxy matcher skips static .wasm so the player does not trigger a Supabase auth call", () => {
  const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(source, /\|lottie\|wasm\)\$/);
});
