import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  FEATURE_IDS,
  LIMIT_KEYS,
  PLAN_IDS,
  PLAN_LIMITS,
  PLAN_PRICES,
  listFeaturesForPlan,
  type FeatureId,
  type LimitKey,
  type PlanId,
} from "../lib/domain/plans/planMatrix.ts";
import { can, limit } from "../lib/domain/plans/planPolicy.ts";

// Written out by hand from the pricing spec table (not derived from the matrix),
// so a drift in planMatrix.ts fails here.
const SPEC_MIN_PLAN: Record<FeatureId, PlanId> = {
  websites: "free",
  credits: "free",
  website_analysis: "free",
  seo_audit_manual: "free",
  seo_daily_monitor: "lite",
  findings_track: "free",
  findings_auto_verify: "lite",
  geo_tracking: "free",
  geo_weekly_auto: "lite",
  traffic_connect: "free",
  traffic_history: "lite",
  competitors_strategy_docs: "lite",
  coding_agent: "lite",
  x_drafts: "lite",
  notifications_in_app: "free",
  notifications_email_digest: "lite",
  leads_finder: "pro",
  outreach_email: "pro",
  reddit_drafts: "pro",
  linkedin_drafts: "pro",
  hn_drafts: "pro",
  article_writer: "pro",
  cms_publish: "pro",
  chat: "free",
  support_community: "free",
  support_email: "lite",
  support_priority: "pro",
};

const RANK: Record<PlanId, number> = { free: 0, lite: 1, pro: 2 };

test("every feature x plan matches the spec table", () => {
  for (const id of FEATURE_IDS) {
    for (const plan of PLAN_IDS) {
      const expected = RANK[plan] >= RANK[SPEC_MIN_PLAN[id]];
      assert.equal(can(plan, id), expected, `${plan} / ${id}`);
    }
  }
});

test("FEATURES lists each feature id exactly once and nothing else", () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), [...FEATURE_IDS].sort());
  assert.deepEqual([...FEATURE_IDS].sort(), Object.keys(SPEC_MIN_PLAN).sort());
  for (const f of FEATURES) {
    assert.ok(f.label.length > 0 && f.description.length > 0, `${f.id} has label and description`);
  }
});

test("Leads, outreach, Reddit/LinkedIn/HN, articles and CMS publish are Pro only; X is Lite+", () => {
  for (const id of ["leads_finder", "outreach_email", "reddit_drafts", "linkedin_drafts", "hn_drafts", "article_writer", "cms_publish"] as const) {
    assert.deepEqual(PLAN_IDS.filter((p) => can(p, id)), ["pro"], id);
  }
  assert.deepEqual(PLAN_IDS.filter((p) => can(p, "x_drafts")), ["lite", "pro"]);
});

test("plans are monotonic: a higher plan never loses a feature", () => {
  for (const f of FEATURES) {
    if (can("free", f.id)) assert.ok(can("lite", f.id) && can("pro", f.id), f.id);
    if (can("lite", f.id)) assert.ok(can("pro", f.id), f.id);
  }
});

const SPEC_LIMITS: Record<LimitKey, Record<PlanId, number>> = {
  websites: { free: 1, lite: 1, pro: 1 },
  credits_per_month: { free: 20, lite: 300, pro: 1000 },
  geo_prompts: { free: 3, lite: 10, pro: 10 },
  geo_manual_runs_per_week: { free: 1, lite: -1, pro: -1 },
  chat_messages_per_month: { free: 10, lite: -1, pro: -1 },
  traffic_view_days: { free: 28, lite: -1, pro: -1 },
  daily_leads: { free: 0, lite: 0, pro: -1 },
};

test("numeric limits match the spec table", () => {
  assert.deepEqual([...LIMIT_KEYS].sort(), Object.keys(SPEC_LIMITS).sort());
  for (const key of LIMIT_KEYS) {
    for (const plan of PLAN_IDS) {
      assert.equal(limit(plan, key), SPEC_LIMITS[key][plan], `${plan} / ${key}`);
    }
  }
  assert.deepEqual(PLAN_LIMITS, SPEC_LIMITS);
});

test("price data: Free $0, Lite $29 / $24 per month annual / $290 per year, Pro $79 / $66 / $790", () => {
  assert.deepEqual(PLAN_PRICES.free, { monthly: 0, annualPerMonth: 0, annualTotal: 0 });
  assert.deepEqual(PLAN_PRICES.lite, { monthly: 29, annualPerMonth: 24, annualTotal: 290 });
  assert.deepEqual(PLAN_PRICES.pro, { monthly: 79, annualPerMonth: 66, annualTotal: 790 });
});

test("annual price is 10 months (2 months free) and the per-month figure is that total over 12", () => {
  for (const plan of PLAN_IDS) {
    const p = PLAN_PRICES[plan];
    assert.equal(p.annualTotal, p.monthly * 10, plan);
    assert.equal(p.annualPerMonth, Math.round(p.annualTotal / 12), plan);
    assert.ok(p.annualPerMonth <= p.monthly, plan);
  }
});

test("listFeaturesForPlan returns every feature in matrix order with inclusion and limits", () => {
  for (const plan of PLAN_IDS) {
    const rows = listFeaturesForPlan(plan);
    assert.deepEqual(rows.map((r) => r.id), FEATURES.map((f) => f.id));
    for (const row of rows) assert.equal(row.included, can(plan, row.id), `${plan} / ${row.id}`);
  }
  const lite = listFeaturesForPlan("lite");
  assert.deepEqual(lite.find((r) => r.id === "credits")?.limit, { key: "credits_per_month", value: 300 });
  assert.deepEqual(lite.find((r) => r.id === "geo_tracking")?.limit, { key: "geo_prompts", value: 10 });
  assert.equal(lite.find((r) => r.id === "seo_audit_manual")?.limit, undefined);
  const free = listFeaturesForPlan("free");
  assert.equal(free.find((r) => r.id === "leads_finder")?.included, false);
  assert.deepEqual(free.find((r) => r.id === "geo_tracking")?.limit, { key: "geo_prompts", value: 3 });
});
