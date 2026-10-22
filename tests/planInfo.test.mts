import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanInfo, lockedFeature } from "../lib/domain/plans/planInfo.ts";
import { FEATURE_IDS, LIMIT_KEYS } from "../lib/domain/plans/planMatrix.ts";

test("self-host: not enforced, everything on, unlimited", () => {
  const info = buildPlanInfo({ plan: "selfhost", enforced: true });
  assert.equal(info.plan, "selfhost");
  assert.equal(info.enforced, false);
  assert.ok(FEATURE_IDS.every((id) => info.features[id] === true));
  assert.ok(LIMIT_KEYS.every((k) => info.limits[k] === -1));
});

test("hosted, enforcement off: every feature on whatever the plan", () => {
  const info = buildPlanInfo({ plan: "free", enforced: false });
  assert.equal(info.enforced, false);
  assert.ok(FEATURE_IDS.every((id) => info.features[id] === true));
  assert.equal(info.limits.credits_per_month, 20);
});

test("hosted, enforced: features follow the matrix", () => {
  const free = buildPlanInfo({ plan: "free", enforced: true });
  assert.equal(free.features.leads_finder, false);
  assert.equal(free.features.x_drafts, false);
  assert.equal(free.features.seo_audit_manual, true);
  const lite = buildPlanInfo({ plan: "lite", enforced: true });
  assert.equal(lite.features.x_drafts, true);
  assert.equal(lite.features.article_writer, false);
  const pro = buildPlanInfo({ plan: "pro", enforced: true });
  assert.ok(FEATURE_IDS.every((id) => pro.features[id] === true));
  assert.equal(pro.limits.credits_per_month, 1000);
});

test("lockedFeature: never locks without plan info, when not enforced, or on self-host", () => {
  assert.equal(lockedFeature(undefined, "leads_finder").locked, false);
  assert.equal(lockedFeature(null, "leads_finder").locked, false);
  assert.equal(lockedFeature(buildPlanInfo({ plan: "free", enforced: false }), "leads_finder").locked, false);
  assert.equal(lockedFeature(buildPlanInfo({ plan: "selfhost", enforced: false }), "leads_finder").locked, false);
});

test("lockedFeature: locks with min plan and label when enforced", () => {
  const free = buildPlanInfo({ plan: "free", enforced: true });
  assert.deepEqual(lockedFeature(free, "leads_finder"), { locked: true, minPlan: "pro", label: "Leads finder" });
  const r = lockedFeature(free, "x_drafts");
  assert.equal(r.locked && r.minPlan, "lite");
  assert.equal(lockedFeature(free, "seo_audit_manual").locked, false);
  assert.equal(lockedFeature(buildPlanInfo({ plan: "pro", enforced: true }), "leads_finder").locked, false);
});
