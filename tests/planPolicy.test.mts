import test from "node:test";
import assert from "node:assert/strict";
import { FEATURE_IDS, PLAN_IDS, type FeatureId, type LimitKey } from "../lib/domain/plans/planMatrix.ts";
import { can, limit, minPlanFor, normalizePlan, resolvePlan } from "../lib/domain/plans/planPolicy.ts";

test("normalizePlan accepts the three plan ids and maps everything else to free", () => {
  assert.equal(normalizePlan("free"), "free");
  assert.equal(normalizePlan("lite"), "lite");
  assert.equal(normalizePlan("pro"), "pro");
  assert.equal(normalizePlan(" PRO "), "pro");
  for (const bad of [null, undefined, "", "enterprise", "selfhost", "team", 3, {}, [], true]) {
    assert.equal(normalizePlan(bad), "free", String(bad));
  }
});

test("can() denies unknown features and unknown plans fall back to free", () => {
  assert.equal(can("pro", "no_such_feature" as FeatureId), false);
  assert.equal(can("bogus" as never, "leads_finder"), false);
  assert.equal(can("bogus" as never, "chat"), true);
});

test("limit() returns 0 for an unknown key and free limits for an unknown plan", () => {
  assert.equal(limit("pro", "nope" as LimitKey), 0);
  assert.equal(limit("bogus" as never, "credits_per_month"), 20);
});

test("minPlanFor reports the unlocking plan", () => {
  assert.equal(minPlanFor("x_drafts"), "lite");
  assert.equal(minPlanFor("leads_finder"), "pro");
  assert.equal(minPlanFor("chat"), "free");
  assert.equal(minPlanFor("nope" as FeatureId), undefined);
});

test("resolvePlan: self-host is always pro, whatever else is true", () => {
  for (const enforcement of [true, false]) {
    for (const rawPlan of ["free", "lite", "pro", null, "junk"]) {
      for (const lookupFailed of [true, false]) {
        assert.equal(resolvePlan({ enforcement, selfHost: true, rawPlan, lookupFailed }), "pro");
      }
    }
  }
});

test("resolvePlan: enforcement off unlocks everything (current behavior)", () => {
  for (const rawPlan of ["free", "lite", "pro", null, undefined, "junk"]) {
    const plan = resolvePlan({ enforcement: false, selfHost: false, rawPlan });
    assert.equal(plan, "pro");
    for (const id of FEATURE_IDS) assert.equal(can(plan, id), true, id);
  }
  assert.equal(resolvePlan({ enforcement: false, selfHost: false, rawPlan: "free", lookupFailed: true }), "pro");
});

test("resolvePlan: enforcement on uses the stored plan", () => {
  for (const p of PLAN_IDS) assert.equal(resolvePlan({ enforcement: true, selfHost: false, rawPlan: p }), p);
});

test("resolvePlan: enforcement on fails CLOSED to free on lookup failure, missing row or unknown value", () => {
  assert.equal(resolvePlan({ enforcement: true, selfHost: false, rawPlan: "pro", lookupFailed: true }), "free");
  assert.equal(resolvePlan({ enforcement: true, selfHost: false, rawPlan: null }), "free");
  assert.equal(resolvePlan({ enforcement: true, selfHost: false, rawPlan: undefined }), "free");
  assert.equal(resolvePlan({ enforcement: true, selfHost: false, rawPlan: "platinum" }), "free");
});
