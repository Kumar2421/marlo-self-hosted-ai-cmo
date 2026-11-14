import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAuditUrl } from "../lib/domain/audit/normalizeAuditUrl.ts";

test("a bare domain gets https", () => {
  assert.equal(normalizeAuditUrl("example.com"), "https://example.com/");
  assert.equal(normalizeAuditUrl("  www.example.com/pricing  "), "https://www.example.com/pricing");
  assert.equal(normalizeAuditUrl("blog.example.co.uk?a=1"), "https://blog.example.co.uk/?a=1");
});

test("full addresses are kept as they are", () => {
  assert.equal(normalizeAuditUrl("https://example.com/"), "https://example.com/");
  assert.equal(normalizeAuditUrl("http://example.com/a"), "http://example.com/a");
  assert.equal(normalizeAuditUrl("HTTPS://Example.com"), "https://example.com/");
});

test("things that are not a website address give null", () => {
  for (const bad of ["", "   ", null, undefined, "hello", "not a url", "ftp://example.com", "javascript:alert(1)", "mailto:a@b.co", "https://", "a".repeat(3000)]) {
    assert.equal(normalizeAuditUrl(bad as string | null | undefined), null, String(bad).slice(0, 30));
  }
});

test("a pasted address with spaces inside is rejected, not guessed", () => {
  assert.equal(normalizeAuditUrl("example .com"), null);
});
