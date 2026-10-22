import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_IDS, PLAN_PRICES } from "../lib/domain/plans/planMatrix.ts";
import { buildPlanCard, buildPlanCards, formatLimit, PRICING_BETA, PRICING_BETA_NOTE } from "../lib/domain/plans/pricingView.ts";

test("one card per plan, prices come from PLAN_PRICES", () => {
  const cards = buildPlanCards();
  assert.deepEqual(cards.map((c) => c.id), [...PLAN_IDS]);
  for (const c of cards) assert.equal(c.price, PLAN_PRICES[c.id]);
});

test("free lists base features; paid cards list only what is new or changed", () => {
  const ids = (p: "free" | "lite" | "pro") => buildPlanCard(p).rows.map((r) => r.id);
  assert.ok(ids("free").includes("seo_audit_manual"));
  assert.ok(!ids("free").includes("coding_agent"));
  assert.ok(ids("lite").includes("coding_agent"));
  assert.ok(!ids("lite").includes("leads_finder"));
  assert.ok(!ids("lite").includes("seo_audit_manual"));
  assert.ok(ids("pro").includes("leads_finder"));
  assert.ok(!ids("pro").includes("coding_agent"));
  // Changed limits are shown again at the higher plan.
  assert.ok(ids("lite").includes("credits"));
  assert.equal(buildPlanCard("lite").rows.find((r) => r.id === "credits")?.limitText, "300 / month");
  assert.equal(buildPlanCard("free").rows.find((r) => r.id === "credits")?.limitText, "20 / month");
  // Unchanged limits (websites 1 -> 1) are not repeated.
  assert.ok(!ids("lite").includes("websites"));
});

test("inheritsFrom chain", () => {
  assert.equal(buildPlanCard("free").inheritsFrom, null);
  assert.equal(buildPlanCard("lite").inheritsFrom?.name, "Free");
  assert.equal(buildPlanCard("pro").inheritsFrom?.name, "Lite");
});

test("formatLimit", () => {
  assert.equal(formatLimit("daily_leads", 0), null);
  assert.equal(formatLimit("daily_leads", -1), "Unlimited");
  assert.equal(formatLimit("traffic_view_days", 28), "28 days");
  assert.equal(formatLimit("traffic_view_days", -1), "Full history");
  assert.equal(formatLimit("geo_prompts", 10), "10 prompts");
});

test("beta flag and note", () => {
  assert.equal(typeof PRICING_BETA, "boolean");
  assert.match(PRICING_BETA_NOTE, /beta/i);
});
