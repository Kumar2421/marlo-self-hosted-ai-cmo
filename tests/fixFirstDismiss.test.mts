import test from "node:test";
import assert from "node:assert/strict";
import { fixFirstDismissKey, isFixFirstDismissed, suggestionSignature } from "../lib/domain/overview/fixFirstDismiss.ts";

test("signature is order independent and empty for no suggestions", () => {
  assert.equal(suggestionSignature([{ findingId: "b" }, { findingId: "a" }]), "a|b");
  assert.equal(suggestionSignature([{ findingId: "a" }, { findingId: "b" }]), "a|b");
  assert.equal(suggestionSignature([]), "");
});

test("hidden only while the stored signature still matches what would be shown", () => {
  assert.equal(isFixFirstDismissed("a|b", "a|b"), true);
  assert.equal(isFixFirstDismissed("a|b", "a|c"), false, "a changed suggestion list comes back on its own");
  assert.equal(isFixFirstDismissed("a|b", "a"), false, "one was fixed: show the rest");
  assert.equal(isFixFirstDismissed(null, "a|b"), false);
  assert.equal(isFixFirstDismissed(undefined, "a|b"), false);
});

test("nothing to hide when there are no suggestions", () => {
  assert.equal(isFixFirstDismissed("", ""), false);
  assert.equal(isFixFirstDismissed("a", ""), false);
});

test("the stored choice is per project", () => {
  assert.notEqual(fixFirstDismissKey("p1"), fixFirstDismissKey("p2"));
});
