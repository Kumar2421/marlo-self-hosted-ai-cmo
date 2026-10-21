import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DATASETS,
  MAX_ROWS_PER_TABLE,
  etagFor,
  etagMatches,
  loadPlatformDatasets,
  type DatasetClient,
} from "../lib/domain/project/dashboardData.ts";

type Call = { table: string; orderColumn: string; limit: number; projectId: string };

/** Fake Supabase client: every query takes `delayMs`, and the active/peak query counts are tracked. */
function fakeClient(opts: { delayMs?: number; failTable?: string; rows?: Record<string, unknown[]> } = {}) {
  const calls: Call[] = [];
  let active = 0;
  let peak = 0;
  const client: DatasetClient = {
    from(table) {
      const call: Partial<Call> = { table };
      return {
        select() {
          return {
            eq(_column, value) {
              call.projectId = value;
              return {
                order(column) {
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
            },
          };
        },
      };
    },
  };
  return { client, calls, peak: () => peak };
}

test("every dataset is queried for the project, newest first, with a row cap", async () => {
  const { client, calls } = fakeClient();
  const result = await loadPlatformDatasets(client, "p1");
  assert.ok("data" in result);
  assert.deepEqual(Object.keys(result.data), Object.keys(DATASETS));
  assert.equal(calls.length, Object.keys(DATASETS).length);
  for (const call of calls) {
    assert.equal(call.projectId, "p1");
    assert.equal(call.orderColumn, DATASETS[call.table]);
    assert.equal(call.limit, MAX_ROWS_PER_TABLE);
  }
});

test("the dataset queries run concurrently, not one after another", async () => {
  const { client, peak } = fakeClient({ delayMs: 40 });
  const started = Date.now();
  await loadPlatformDatasets(client, "p1");
  const elapsed = Date.now() - started;
  assert.equal(peak(), Object.keys(DATASETS).length, "all queries in flight at once");
  // Sequential would be 10 x 40ms = 400ms.
  assert.ok(elapsed < 250, `took ${elapsed}ms`);
});

test("rows are returned per table and null data becomes an empty list", async () => {
  const { client } = fakeClient({ rows: { leads: [{ id: 1 }, { id: 2 }] } });
  const result = await loadPlatformDatasets(client, "p1");
  assert.ok("data" in result);
  assert.deepEqual(result.data.leads, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(result.data.findings, []);
});

test("a failing table reports which one", async () => {
  const { client } = fakeClient({ failTable: "findings" });
  const result = await loadPlatformDatasets(client, "p1");
  assert.deepEqual(result, { error: "Failed to load findings: boom" });
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
