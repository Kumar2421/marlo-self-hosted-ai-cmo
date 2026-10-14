import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_LEAD_WINDOW_MS, autoLeadCooldownRemainingMs, retryAfterSeconds } from "../lib/domain/leads/autoLeadWindow.ts";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");

test("a project never stamped may generate now", () => {
  assert.equal(autoLeadCooldownRemainingMs(null, NOW), 0);
  assert.equal(autoLeadCooldownRemainingMs(undefined, NOW), 0);
});

test("a project stamped less than 24h ago is in cooldown for the remainder", () => {
  const last = new Date(NOW - 3_600_000).toISOString();
  assert.equal(autoLeadCooldownRemainingMs(last, NOW), AUTO_LEAD_WINDOW_MS - 3_600_000);
});

test("a project stamped 24h or more ago may generate again", () => {
  assert.equal(autoLeadCooldownRemainingMs(new Date(NOW - AUTO_LEAD_WINDOW_MS).toISOString(), NOW), 0);
  assert.equal(autoLeadCooldownRemainingMs(new Date(NOW - AUTO_LEAD_WINDOW_MS - 1).toISOString(), NOW), 0);
});

test("an unparseable stamp does not lock the project out forever", () => {
  assert.equal(autoLeadCooldownRemainingMs("not-a-date", NOW), 0);
});

test("retry-after is whole seconds and at least one while cooling down", () => {
  assert.equal(retryAfterSeconds(1), 1);
  assert.equal(retryAfterSeconds(1500), 2);
  assert.equal(retryAfterSeconds(60_000), 60);
});
