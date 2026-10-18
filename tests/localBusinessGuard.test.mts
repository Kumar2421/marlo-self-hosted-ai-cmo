import test from "node:test";
import assert from "node:assert/strict";
import { isLocalBusinessSearchBlocked, LOCAL_BUSINESS_COMING_SOON_MESSAGE } from "../lib/features.ts";

test("local business search is blocked in hosted platform mode", () => {
  assert.equal(isLocalBusinessSearchBlocked(true), true);
});

test("local business search stays available in self-host mode", () => {
  assert.equal(isLocalBusinessSearchBlocked(false), false);
});

test("coming soon message is the documented 403 text", () => {
  assert.equal(LOCAL_BUSINESS_COMING_SOON_MESSAGE, "Local business search is coming soon.");
});
