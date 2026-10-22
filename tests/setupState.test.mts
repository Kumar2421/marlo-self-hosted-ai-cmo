import test from "node:test";
import assert from "node:assert/strict";
import {
  SETUP_STEPS,
  STALE_RUNNING_MS,
  WAITING_PREFIX,
  anyFreshRunning,
  applyTransition,
  deriveSetupState,
  isStale,
  isUnfinished,
  needsSetupAttention,
  newSetupState,
  nextStepsToRun,
  normalizeSetupState,
  setupCardRows,
  summarizeSetup,
  type SetupState,
  type Transition,
} from "../lib/domain/project/setupState.ts";

const T0 = new Date("2026-10-22T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function apply(state: SetupState, t: Transition, now = T0): SetupState {
  const r = applyTransition(state, t, now);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.state;
}

test("a new state lists every step pending, in creation order", () => {
  const s = newSetupState(T0, true);
  assert.deepEqual(nextStepsToRun(s, T0), [...SETUP_STEPS]);
  assert.equal(s.startedAt, T0.toISOString());
  assert.equal(isUnfinished(s, T0), true);
});

test("a state that was only derived (startedAt null) is never auto-resumed", () => {
  assert.equal(isUnfinished(newSetupState(T0, false), T0), false);
});

test("done steps are not run again; pending ones keep their order", () => {
  let s = newSetupState(T0, true);
  for (const k of ["audit", "description", "competitors", "leads", "product-info"] as const) s = apply(s, { step: k, status: "done" });
  assert.deepEqual(nextStepsToRun(s, T0), ["marketing-strategy", "competitor-analysis", "competitor-comparison", "content-strategy", "design-guide"]);
  assert.equal(summarizeSetup(s, T0).text, "5 of 10 ready");
});

test("a failed source blocks its dependents but they stay pending for a later retry", () => {
  let s = newSetupState(T0, true);
  s = apply(s, { step: "audit", status: "done" });
  s = apply(s, { step: "product-info", status: "failed", error: "model timeout" });
  const next = nextStepsToRun(s, T0);
  assert.ok(!next.includes("marketing-strategy"));
  assert.ok(!next.includes("content-strategy"));
  assert.ok(!next.includes("design-guide"));
  assert.ok(next.includes("description"), "unrelated steps still run");
  assert.ok(!next.includes("product-info"), "failed is not retried automatically");
  assert.ok(nextStepsToRun(s, T0, { retryFailed: true }).includes("product-info"));
});

test("a failed audit blocks everything that is written from the crawl", () => {
  const s = apply(newSetupState(T0, true), { step: "audit", status: "failed", error: "HTTP 403" });
  assert.deepEqual(nextStepsToRun(s, T0), []);
  assert.equal(isUnfinished(s, T0), false);
  assert.ok(s.finishedAt);
});

test("a stale running step counts as interrupted and is picked up; a fresh one is not", () => {
  let s = apply(newSetupState(T0, true), { step: "audit", status: "running" });
  assert.equal(anyFreshRunning(s, at(60_000)), true);
  assert.ok(!nextStepsToRun(s, at(60_000)).includes("audit"));
  const later = at(STALE_RUNNING_MS + 1);
  assert.equal(isStale(s.steps.audit, later), true);
  assert.equal(nextStepsToRun(s, later)[0], "audit");
  assert.equal(anyFreshRunning(s, later), false);
  s = apply(s, { step: "audit", status: "running" }, later); // an interrupted step can be claimed again
  assert.equal(s.steps.audit.status, "running");
});

test("two tabs cannot both claim the same step", () => {
  const s = apply(newSetupState(T0, true), { step: "audit", status: "running" });
  const second = applyTransition(s, { step: "audit", status: "running" }, at(5_000));
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.reason, "conflict");
});

test("done cannot move back unless the transition is an explicit retry", () => {
  const s = apply(newSetupState(T0, true), { step: "audit", status: "done" });
  for (const status of ["pending", "running", "failed"] as const) {
    const r = applyTransition(s, { step: "audit", status }, T0);
    assert.equal(r.ok, false, status);
  }
  assert.equal(applyTransition(s, { step: "audit", status: "running", retry: true }, at(1)).ok, true);
  assert.equal(applyTransition(s, { step: "audit", status: "done" }, at(1)).ok, true, "re-reporting done is idempotent");
});

test("unknown steps and statuses are rejected", () => {
  const s = newSetupState(T0, true);
  const bad = applyTransition(s, { step: "nope" as never, status: "done" }, T0);
  assert.equal(!bad.ok && bad.reason, "invalid");
  const bad2 = applyTransition(s, { step: "audit", status: "weird" as never }, T0);
  assert.equal(!bad2.ok && bad2.reason, "invalid");
});

test("finishedAt is set when nothing is left to run and cleared when work reopens", () => {
  let s = newSetupState(T0, true);
  for (const k of SETUP_STEPS) s = apply(s, { step: k, status: "done" });
  assert.ok(s.finishedAt);
  assert.equal(isUnfinished(s, T0), false);
  s = apply(s, { step: "audit", status: "pending", retry: true });
  assert.equal(s.finishedAt, null);
});

test("summary counts ready steps, ignores skipped, reports failures", () => {
  let s = newSetupState(T0, true);
  s = apply(s, { step: "audit", status: "done" });
  s = apply(s, { step: "competitor-analysis", status: "skipped" });
  s = apply(s, { step: "competitor-comparison", status: "skipped" });
  s = apply(s, { step: "description", status: "failed", error: "x" });
  assert.equal(summarizeSetup(s, T0).text, "1 of 8 ready, 1 failed");
});

test("legacy project with every document counts as done and is not auto-resumed", () => {
  const s = deriveSetupState(
    { hasAudit: true, hasDescription: true, hasCompetitors: true, documents: ["product-info", "marketing-strategy", "competitor-analysis", "competitor-comparison", "content-strategy", "design-guide"] },
    T0,
  );
  assert.equal(nextStepsToRun(s, T0).length, 0);
  assert.ok(s.finishedAt);
  assert.equal(s.startedAt, null);
  assert.equal(needsSetupAttention(setupCardRows(s, T0)), false);
});

test("legacy project without competitors does not owe the two competitor documents", () => {
  const s = deriveSetupState({ hasAudit: true, hasDescription: true, hasCompetitors: false, documents: ["product-info", "marketing-strategy", "content-strategy", "design-guide"] }, T0);
  assert.equal(s.steps["competitor-analysis"].status, "skipped");
  assert.equal(nextStepsToRun(s, T0).length, 0);
});

test("legacy project with gaps shows them in the card with Run, but never auto-resumes", () => {
  const s = deriveSetupState({ hasAudit: false, hasDescription: false, hasCompetitors: false, documents: [] }, T0);
  assert.equal(isUnfinished(s, T0), false);
  const rows = setupCardRows(s, T0);
  assert.equal(needsSetupAttention(rows), true);
  assert.ok(rows.find((r) => r.key === "audit")?.canRun);
});

test("card rows: failed shows its error, a step behind a failed source is waiting with nothing to retry", () => {
  let s = newSetupState(T0, true);
  s = apply(s, { step: "audit", status: "done" });
  s = apply(s, { step: "product-info", status: "failed", error: "model timeout" });
  s = apply(s, { step: "marketing-strategy", status: "pending", error: `${WAITING_PREFIX}Product Information` });
  const rows = setupCardRows(s, T0);
  const failed = rows.find((r) => r.key === "product-info")!;
  assert.equal(failed.kind, "failed");
  assert.equal(failed.note, "model timeout");
  const waiting = rows.find((r) => r.key === "marketing-strategy")!;
  assert.equal(waiting.kind, "waiting");
  assert.equal(waiting.canRun, false);
  assert.match(waiting.note, /Product Information/);
});

test("running steps are not listed as missing in the card; interrupted ones are", () => {
  const s = apply(newSetupState(T0, true), { step: "audit", status: "running" });
  assert.ok(!setupCardRows(s, at(1000)).some((r) => r.key === "audit"));
  assert.equal(setupCardRows(s, at(STALE_RUNNING_MS + 1)).find((r) => r.key === "audit")?.kind, "interrupted");
});

test("normalize drops unknown keys and repairs garbage", () => {
  const s = normalizeSetupState({ steps: { audit: { status: "done", at: "x" }, bogus: { status: "done" }, leads: { status: "weird" } } }, T0);
  assert.equal(s.steps.audit.status, "done");
  assert.equal(s.steps.leads.status, "pending");
  assert.equal("bogus" in s.steps, false);
  assert.equal(normalizeSetupState(null, T0).steps.audit.status, "pending");
});
