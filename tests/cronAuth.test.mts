import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCron, runWithBudget } from "../lib/jobs/jobRunner.ts";
import { claimDueLeadRefresh } from "../lib/jobs/leadRefreshClaim.ts";

test("isAuthorizedCron rejects 'Bearer undefined' when CRON_SECRET is unset", () => {
  assert.equal(isAuthorizedCron("Bearer undefined", undefined), false);
  assert.equal(isAuthorizedCron("Bearer ", undefined), false);
});

test("isAuthorizedCron rejects empty, blank and literal-undefined secrets", () => {
  assert.equal(isAuthorizedCron("Bearer ", ""), false);
  assert.equal(isAuthorizedCron("Bearer  ", "   "), false);
  assert.equal(isAuthorizedCron("Bearer undefined", "undefined"), false);
  assert.equal(isAuthorizedCron("Bearer null", "null"), false);
});

test("isAuthorizedCron rejects a missing header", () => {
  assert.equal(isAuthorizedCron(null, "s3cret-value"), false);
});

test("isAuthorizedCron accepts only the exact bearer secret", () => {
  assert.equal(isAuthorizedCron("Bearer s3cret-value", "s3cret-value"), true);
  assert.equal(isAuthorizedCron("Bearer s3cret-valu", "s3cret-value"), false);
  assert.equal(isAuthorizedCron("Bearer s3cret-value-x", "s3cret-value"), false);
  assert.equal(isAuthorizedCron("s3cret-value", "s3cret-value"), false);
  assert.equal(isAuthorizedCron("bearer s3cret-value", "s3cret-value"), false);
});

test("runWithBudget stops at the budget and reports the rest as skipped", async () => {
  let clock = 0;
  const seen: number[] = [];
  const summary = await runWithBudget(
    [1, 2, 3, 4],
    async (n) => {
      seen.push(n);
      clock += 10;
    },
    { budgetMs: 25, now: () => clock },
  );
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(summary.processed, 3);
  assert.equal(summary.skipped, 1);
});

/** Fake of the one chained query claimDueLeadRefresh issues. */
function fakeProjectsDb(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<{ op: string; args: unknown }> = [];
  const builder = {
    update(values: unknown) { calls.push({ op: "update", args: values }); return builder; },
    eq(col: string, val: unknown) { calls.push({ op: "eq", args: [col, val] }); return builder; },
    or(filter: string) { calls.push({ op: "or", args: filter }); return builder; },
    select(cols: string) { calls.push({ op: "select", args: cols }); return Promise.resolve(result); },
  };
  return {
    db: { from: (table: string) => { calls.push({ op: "from", args: table }); return builder; } } as never,
    calls,
  };
}

test("claimDueLeadRefresh wins only when the conditional update matched a row", async () => {
  const won = fakeProjectsDb({ data: [{ id: "p1" }], error: null });
  assert.equal(await claimDueLeadRefresh(won.db, "p1", "2026-10-13T00:00:00.000Z", "2026-10-14T00:00:00.000Z"), true);
  const filter = won.calls.find((c) => c.op === "or")?.args as string;
  assert.equal(filter, "leads_auto_last_at.is.null,leads_auto_last_at.lt.2026-10-13T00:00:00.000Z");

  const lost = fakeProjectsDb({ data: [], error: null });
  assert.equal(await claimDueLeadRefresh(lost.db, "p1", "2026-10-13T00:00:00.000Z", "2026-10-14T00:00:00.000Z"), false);
});

test("claimDueLeadRefresh surfaces database errors", async () => {
  const failing = fakeProjectsDb({ data: null, error: { message: "boom" } });
  await assert.rejects(claimDueLeadRefresh(failing.db, "p1", "x", "y"), /boom/);
});
