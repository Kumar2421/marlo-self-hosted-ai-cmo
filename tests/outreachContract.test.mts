import test from "node:test";
import assert from "node:assert/strict";
import { OUTREACH_DAILY_CAP, OUTREACH_TEMPLATES, isOutreachTemplateId, mergeOutreachTags, outreachCreditCost } from "../lib/domain/leads/outreachContract.ts";

test("daily cap is 25 and credits are 1 per 5 emails, rounded up", () => {
  assert.equal(OUTREACH_DAILY_CAP, 25);
  assert.deepEqual([0, 1, 5, 6, 25].map(outreachCreditCost), [0, 1, 1, 2, 5]);
});

test("template ids are validated", () => {
  for (const t of OUTREACH_TEMPLATES) assert.equal(isOutreachTemplateId(t.id), true);
  assert.equal(isOutreachTemplateId("html"), false);
  assert.equal(isOutreachTemplateId(undefined), false);
});

test("merge tags fill blanks safely", () => {
  assert.equal(mergeOutreachTags("Hi {{name}} at {{company}} ({{title}})", { name: "Ana", company: null }), "Hi Ana at  ()");
});
