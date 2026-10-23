import test from "node:test";
import assert from "node:assert/strict";
import { UNLOCK_DISMISS_DAYS, parseDismissedAt, shouldShowUnlockPanel } from "../lib/domain/plans/unlockPanel.ts";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const DAY = 86_400_000;

test("shows only for the hosted free plan", () => {
  assert.equal(shouldShowUnlockPanel({ plan: "free", dismissedAt: null, now: NOW }), true);
  for (const plan of ["lite", "pro", "selfhost"] as const) assert.equal(shouldShowUnlockPanel({ plan, dismissedAt: null, now: NOW }), false, plan);
});

test("never shows while the plan is unknown, so it cannot flash for paying users", () => {
  assert.equal(shouldShowUnlockPanel({ plan: undefined, dismissedAt: null, now: NOW }), false);
});

test("a dismissed panel stays hidden for exactly the dismiss window, then returns", () => {
  assert.equal(shouldShowUnlockPanel({ plan: "free", dismissedAt: NOW - 1000, now: NOW }), false);
  assert.equal(shouldShowUnlockPanel({ plan: "free", dismissedAt: NOW - (UNLOCK_DISMISS_DAYS * DAY - 1), now: NOW }), false);
  assert.equal(shouldShowUnlockPanel({ plan: "free", dismissedAt: NOW - UNLOCK_DISMISS_DAYS * DAY, now: NOW }), true);
});

test("an unreadable stored value counts as not dismissed", () => {
  assert.equal(parseDismissedAt(null), null);
  assert.equal(parseDismissedAt(""), null);
  assert.equal(parseDismissedAt("abc"), null);
  assert.equal(parseDismissedAt("-5"), null);
  assert.equal(parseDismissedAt("1700000000000"), 1700000000000);
});
