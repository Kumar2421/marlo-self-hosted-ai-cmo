import test from "node:test";
import assert from "node:assert/strict";
import { canCreateProject, canFetchLeadsToday, getUserPlan } from "../lib/entitlements.ts";

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
