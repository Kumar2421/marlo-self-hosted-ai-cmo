import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_SOURCE_LABEL, onboardingFields } from "../lib/domain/onboarding/onboardingFields.ts";

test("a normal first run asks both questions and has nothing to prefill", () => {
  for (const none of [null, undefined, "", "   "]) {
    assert.deepEqual(onboardingFields(none), { askSource: true, askRole: true, impliedSource: null, prefillUrl: "" });
  }
});

test("arriving from the audit skips both questions, prefills the site and records the source", () => {
  const f = onboardingFields("  https://acme.test/ ");
  assert.equal(f.askSource, false);
  assert.equal(f.askRole, false);
  assert.equal(f.prefillUrl, "https://acme.test/");
  assert.equal(f.impliedSource, AUDIT_SOURCE_LABEL);
});
