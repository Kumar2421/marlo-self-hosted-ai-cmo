import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionFinding, canUserTransitionFinding, FINDING_STATUSES, FINDING_TRANSITIONS } from "../lib/domain/findings/findingTypes.ts";

test("finding lifecycle allows the intended forward transitions", () => {
  assert.equal(canTransitionFinding("new", "acknowledged"), true);
  assert.equal(canTransitionFinding("acknowledged", "fixing"), true);
  assert.equal(canTransitionFinding("fixing", "fixed"), true);
  assert.equal(canTransitionFinding("fixed", "verified"), true);
  assert.equal(canTransitionFinding("failed", "fixing"), true);
});

test("finding lifecycle rejects invalid jumps", () => {
  assert.equal(canTransitionFinding("new", "fixed"), false);
  assert.equal(canTransitionFinding("verified", "fixed"), false);
  assert.equal(canTransitionFinding("verified", "acknowledged"), false);
  assert.equal(canTransitionFinding("fixed", "fixing"), false);
  assert.equal(canTransitionFinding("failed", "fixed"), false);
});

test("recheck edges into verified/failed are in the one table, from every open status", () => {
  for (const from of ["new", "acknowledged", "fixing", "fixed"] as const) {
    assert.equal(canTransitionFinding(from, "verified"), true, `${from} -> verified`);
    assert.equal(canTransitionFinding(from, "failed"), true, `${from} -> failed`);
  }
  assert.equal(canTransitionFinding("failed", "verified"), true);
  assert.equal(canTransitionFinding("verified", "failed"), false);
});

test("a user can never request verified or failed directly, from any status", () => {
  for (const from of FINDING_STATUSES) {
    assert.equal(canUserTransitionFinding(from, "verified"), false, `${from} -> verified`);
    assert.equal(canUserTransitionFinding(from, "failed"), false, `${from} -> failed`);
  }
  assert.equal(canUserTransitionFinding("new", "acknowledged"), true);
  assert.equal(canUserTransitionFinding("failed", "fixing"), true);
  assert.equal(canUserTransitionFinding("new", "fixed"), false);
});

test("every status has an explicit transition definition", () => {
  assert.deepEqual(Object.keys(FINDING_TRANSITIONS).sort(), [
    "acknowledged", "failed", "fixed", "fixing", "new", "verified",
  ]);
});
