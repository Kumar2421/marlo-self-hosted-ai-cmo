import test from "node:test";
import assert from "node:assert/strict";
import {
  HONEYPOT_FIELD,
  isValidEmail,
  normalizeWebsite,
  validateWaitlist,
  waitlistMessage,
  waitlistPlanPrefix,
} from "../lib/domain/waitlist/validate.ts";

const base = { email: "Jane@Example.com ", plan: "lite", interval: "annual" };

test("accepts a minimal valid request and normalizes the email", () => {
  const r = validateWaitlist(base);
  assert.deepEqual(r, { ok: true, value: { email: "jane@example.com", website: null, plan: "lite", interval: "annual" } });
});

test("interval defaults to monthly", () => {
  const r = validateWaitlist({ email: "a@b.co", plan: "pro" });
  assert.ok(r.ok);
  assert.equal(r.value.interval, "monthly");
});

test("rejects bad emails", () => {
  for (const email of ["", "nope", "a@b", "a@b.c", "a b@c.com", "@c.com", "a@@c.com", "a@c..com", `${"x".repeat(250)}@c.com`, "a\u0000@c.com", 5, null, undefined]) {
    const r = validateWaitlist({ ...base, email });
    assert.equal(r.ok, false, String(email));
    if (!r.ok && r.reason === "invalid") assert.equal(r.field, "email");
  }
  assert.equal(isValidEmail("first.last+tag@sub.example.io"), true);
});

test("website is optional and normalized", () => {
  assert.equal(normalizeWebsite(""), null);
  assert.equal(normalizeWebsite("   "), null);
  assert.equal(normalizeWebsite("example.com"), "https://example.com/");
  assert.equal(normalizeWebsite("http://example.com/a?b=1"), "http://example.com/a?b=1");
  const ok = validateWaitlist({ ...base, website: "acme.dev" });
  assert.ok(ok.ok);
  assert.equal(ok.value.website, "https://acme.dev/");
  assert.ok(validateWaitlist({ ...base, website: "" }).ok);
  assert.ok(validateWaitlist({ ...base, website: null }).ok);
});

test("rejects unusable websites", () => {
  for (const website of ["javascript:alert(1)", "ftp://example.com", "https://user:pw@example.com", "localhost", "not a url", "https://x.com/" + "a".repeat(400), 12]) {
    const r = validateWaitlist({ ...base, website });
    assert.equal(r.ok, false, String(website));
    if (!r.ok && r.reason === "invalid") assert.equal(r.field, "website");
  }
});

test("plan and interval must be in the allowed sets", () => {
  for (const plan of ["free", "lite", "pro", "selfhost-interest"]) assert.ok(validateWaitlist({ ...base, plan }).ok, plan);
  for (const plan of ["enterprise", "", "LITE", undefined, 1]) {
    const r = validateWaitlist({ ...base, plan });
    assert.equal(r.ok, false);
    if (!r.ok && r.reason === "invalid") assert.equal(r.field, "plan");
  }
  const bad = validateWaitlist({ ...base, interval: "weekly" });
  assert.equal(bad.ok, false);
  if (!bad.ok && bad.reason === "invalid") assert.equal(bad.field, "interval");
});

test("a filled honeypot is reported as honeypot, even if the rest is invalid", () => {
  assert.deepEqual(validateWaitlist({ ...base, [HONEYPOT_FIELD]: "http://spam.test" }), { ok: false, reason: "honeypot" });
  assert.deepEqual(validateWaitlist({ email: "x", [HONEYPOT_FIELD]: "bot" }), { ok: false, reason: "honeypot" });
  assert.ok(validateWaitlist({ ...base, [HONEYPOT_FIELD]: "" }).ok);
  assert.ok(validateWaitlist({ ...base, [HONEYPOT_FIELD]: "   " }).ok);
});

test("non-object bodies are invalid", () => {
  for (const body of [null, undefined, "x", 3, [], [{ email: "a@b.co" }]]) assert.equal(validateWaitlist(body).ok, false);
});

test("message format and dedupe prefix", () => {
  assert.equal(waitlistMessage("lite", "annual"), "plan=lite;interval=annual");
  assert.equal(waitlistPlanPrefix("lite"), "plan=lite;%");
  assert.ok(waitlistMessage("lite", "monthly").startsWith("plan=lite;"));
  // "plan=pro;%" must not match the selfhost row, and vice versa.
  assert.ok(!waitlistMessage("selfhost-interest", "monthly").startsWith("plan=pro;"));
});
