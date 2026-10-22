import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_LIMITS,
  canCreateProject,
  canFetchLeadsToday,
  dailyLeadsCap,
  getUserPlan,
  projectCap,
} from "../lib/entitlements.ts";
import { dailyDraftBatchLimit } from "../lib/domain/x/xDraftTypes.ts";

// Tests run without NEXT_PUBLIC_PLATFORM_MODE / Supabase env, so FEATURES.PLATFORM_MODE
// is false (self-host). Self-host must never be gated.
// The plan matrix itself is covered by planMatrix.test.mts and planPolicy.test.mts.

test("self-host resolves to the selfhost plan", async () => {
  assert.equal(await getUserPlan("test_user"), "selfhost");
});

test("self-host is never capped on projects or daily leads", async () => {
  assert.deepEqual(await canCreateProject("test_user"), { allowed: true, remaining: -1, limit: -1 });
  assert.deepEqual(await canFetchLeadsToday("test_user"), { allowed: true, remaining: -1, limit: -1 });
});

test("enforcement off keeps today's hosted caps (legacy limits)", () => {
  assert.deepEqual(LEGACY_LIMITS.projects, { free: 4, lite: 10, pro: -1 });
  assert.deepEqual(LEGACY_LIMITS.daily_leads, { free: 10, lite: 50, pro: -1 });
  assert.equal(projectCap("free", false), 4);
  assert.equal(projectCap("lite", false), 10);
  assert.equal(projectCap("pro", false), -1);
  assert.equal(dailyLeadsCap("free", false), 10);
  assert.equal(dailyLeadsCap("lite", false), 50);
  assert.equal(dailyLeadsCap("pro", false), -1);
  // Social draft batches (limit comes from the same plan value) are unchanged.
  assert.equal(dailyDraftBatchLimit("free"), 5);
  assert.equal(dailyDraftBatchLimit("lite"), 20);
  assert.equal(dailyDraftBatchLimit("pro"), -1);
});

test("enforcement on uses the plan matrix", () => {
  assert.equal(projectCap("free", true), 1);
  assert.equal(projectCap("lite", true), 1);
  assert.equal(projectCap("pro", true), 1);
  assert.equal(dailyLeadsCap("free", true), 0);
  assert.equal(dailyLeadsCap("lite", true), 0);
  assert.equal(dailyLeadsCap("pro", true), -1);
});
