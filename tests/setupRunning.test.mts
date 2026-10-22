import test from "node:test";
import assert from "node:assert/strict";
import { isSetupRunning, settleSetupRun } from "../lib/domain/project/setupRun.ts";

// The project store keeps one "which project's setup run is in flight" id.
// These helpers decide what Context/Analytics show from it.

test("the active project shows as running while its run is in flight", () => {
  assert.equal(isSetupRunning("p1", "p1"), true);
});

test("the run only counts for the project it belongs to", () => {
  assert.equal(isSetupRunning("p1", "p2"), false, "switched to another project mid-run");
  assert.equal(isSetupRunning("p1", undefined), false, "no active project");
  assert.equal(isSetupRunning(null, "p1"), false, "no run in flight");
});

test("settling the run clears it only for the project that started it", () => {
  assert.equal(settleSetupRun("p1", "p1"), null);
  assert.equal(settleSetupRun("p2", "p1"), "p2", "an earlier run finishing must not end a newer one");
  assert.equal(settleSetupRun(null, "p1"), null);
});

test("a second project created while the first run writes documents keeps the newer run", () => {
  let running: string | null = "p1";
  running = "p2"; // createProject for p2 starts its own run
  running = settleSetupRun(running, "p1"); // p1's chain settles late
  assert.equal(isSetupRunning(running, "p2"), true);
  running = settleSetupRun(running, "p2");
  assert.equal(isSetupRunning(running, "p2"), false);
});
