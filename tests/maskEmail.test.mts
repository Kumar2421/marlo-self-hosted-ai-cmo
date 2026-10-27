import assert from "node:assert/strict";
import { test } from "node:test";
import { maskEmail } from "../lib/maskEmail.ts";

test("keeps two characters and the domain", () => {
  assert.equal(maskEmail("senthil210520012421@gmail.com"), "se…@gmail.com");
  assert.equal(maskEmail("owner@acme.example.test"), "ow…@acme.example.test");
});

test("short local parts keep one character", () => {
  assert.equal(maskEmail("a@b.co"), "a…@b.co");
  assert.equal(maskEmail("ab@b.co"), "a…@b.co");
});

test("empty, missing or malformed input is returned safely", () => {
  assert.equal(maskEmail(null), "");
  assert.equal(maskEmail(undefined), "");
  assert.equal(maskEmail(""), "");
  assert.equal(maskEmail("not-an-email"), "not-an-email");
  assert.equal(maskEmail("@nolocal.com"), "@nolocal.com");
  assert.equal(maskEmail("trailing@"), "trailing@");
});

test("uses the last @ when the local part is odd", () => {
  assert.equal(maskEmail('"a@b"@example.com'), '"a…@example.com');
});
