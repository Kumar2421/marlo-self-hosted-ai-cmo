import test from "node:test";
import assert from "node:assert/strict";
import { recheckNote } from "../lib/domain/findings/recheckNote.ts";

test("verified says verified only with the API status", () => {
  const n = recheckNote({ status: "verified" });
  assert.equal(n?.tone, "verified");
  assert.match(n!.text, /^Verified/);
});

test("failed is not shown as verified", () => {
  const n = recheckNote({ status: "failed", reason: "Still missing a title." });
  assert.equal(n?.tone, "failed");
  assert.equal(n?.text, "Still missing a title.");
});

test("skipped shows the server reason with an honest prefix", () => {
  const reason = "Fix pending: later AI answers still do not name you. Mark the fix as done, then re-check.";
  const n = recheckNote({ status: "skipped", reason });
  assert.equal(n?.tone, "waiting");
  assert.equal(n?.text, `Not verified yet: ${reason}`);
  assert.doesNotMatch(n!.text, /^Verified/);
});

test("pending shows the reason", () => {
  const n = recheckNote({ status: "pending", reason: "Fix pending: this question has not been checked again." });
  assert.equal(n?.text, "Not verified yet: Fix pending: this question has not been checked again.");
});

test("missing or blank reason falls back to a generic sentence", () => {
  for (const reason of [undefined, null, "  "]) {
    const n = recheckNote({ status: "skipped", reason });
    assert.match(n!.text, /^Not verified yet: we couldn't check this one right now/);
  }
});

test("no outcome, no note; long reasons are capped", () => {
  assert.equal(recheckNote(null), null);
  assert.ok(recheckNote({ status: "skipped", reason: "x".repeat(900) })!.text.length < 320);
});
