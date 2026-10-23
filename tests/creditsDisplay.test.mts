import test from "node:test";
import assert from "node:assert/strict";
import { BETA_UNLIMITED_LABEL, creditsDisplay } from "../lib/credits-display.ts";

test("beta: shows used count, no allowance, no bar, and the unlimited label", () => {
  const view = creditsDisplay({ balance: -306, granted: 20, billingEnabled: false });
  assert.equal(view.used, 326);
  assert.equal(view.usedLabel, (326).toLocaleString());
  assert.equal(view.allowanceLabel, null);
  assert.equal(view.barPercent, null);
  assert.equal(view.remainingLabel, BETA_UNLIMITED_LABEL);
  assert.equal(BETA_UNLIMITED_LABEL, "Unlimited during beta");
});

test("beta: never renders an allowance or bar even when usage is within the grant", () => {
  const view = creditsDisplay({ balance: 15, granted: 20, billingEnabled: false });
  assert.equal(view.used, 5);
  assert.equal(view.allowanceLabel, null);
  assert.equal(view.barPercent, null);
});

test("enforced billing: shows allowance and a proportional bar", () => {
  const view = creditsDisplay({ balance: 15, granted: 20, billingEnabled: true });
  assert.equal(view.used, 5);
  assert.equal(view.allowanceLabel, "20");
  assert.equal(view.barPercent, 25);
  assert.equal(view.remainingLabel, "15");
});

test("enforced billing: usage above the allowance never becomes a bar", () => {
  const view = creditsDisplay({ balance: -306, granted: 20, billingEnabled: true });
  assert.equal(view.used, 326);
  assert.equal(view.barPercent, null);
});

test("enforced billing with no grant: no allowance and no bar", () => {
  const view = creditsDisplay({ balance: 0, granted: 0, billingEnabled: true });
  assert.equal(view.used, 0);
  assert.equal(view.allowanceLabel, null);
  assert.equal(view.barPercent, null);
});

test("used is never negative when balance exceeds the grant", () => {
  const view = creditsDisplay({ balance: 50, granted: 20, billingEnabled: true });
  assert.equal(view.used, 0);
  assert.equal(view.barPercent, 0);
});

import { creditsStatus } from "../lib/credits-display.ts";

test("creditsStatus: beta, healthy, low, out, and zero-grant rows", () => {
  assert.equal(creditsStatus({ balance: -5, granted: 20, billingEnabled: false }), "Beta");
  assert.equal(creditsStatus({ balance: 10, granted: 20, billingEnabled: true }), "Healthy");
  assert.equal(creditsStatus({ balance: 4, granted: 20, billingEnabled: true }), "Low");
  assert.equal(creditsStatus({ balance: 0, granted: 20, billingEnabled: true }), "Out");
  assert.equal(creditsStatus({ balance: 0, granted: 0, billingEnabled: true }), "Healthy");
});
