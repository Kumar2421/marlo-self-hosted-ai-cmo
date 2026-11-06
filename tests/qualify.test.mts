import test from "node:test";
import assert from "node:assert/strict";
import { isLinkedInProfileUrl, normalizeWhatsapp, qualifyLead } from "../lib/domain/leads/qualify.ts";

const base = { fitReason: "Runs a clinic in Chennai, matches your target", sourceUrl: "https://clinic.example/contact" };

test("an email found on a page, with a reason and a source, is qualified", () => {
  const q = qualifyLead({ ...base, email: "hello@clinic.example" });
  assert.equal(q.qualified, true);
  assert.deepEqual(q.channels, ["email"]);
  assert.deepEqual(q.missing, []);
});

test("a guessed email never makes a lead reachable, and the reason says so", () => {
  const q = qualifyLead({ ...base, email: "ann.lee@acme.com", emailGuessed: true });
  assert.equal(q.qualified, false);
  assert.deepEqual(q.channels, []);
  assert.match(q.missing[0], /guessed/i);
});

test("a guessed email does not hide a real second channel", () => {
  const q = qualifyLead({ ...base, email: "a.b@acme.com", emailGuessed: true, whatsapp: "+91 98765 43210" });
  assert.equal(q.qualified, true);
  assert.deepEqual(q.channels, ["whatsapp"]);
});

test("a LinkedIn profile URL as the source counts as a channel; a search or job URL does not", () => {
  assert.equal(isLinkedInProfileUrl("https://www.linkedin.com/in/ann-lee"), true);
  assert.equal(isLinkedInProfileUrl("https://in.linkedin.com/company/acme"), true);
  assert.equal(isLinkedInProfileUrl("https://www.linkedin.com/jobs/view/1"), false);
  assert.equal(isLinkedInProfileUrl("https://notlinkedin.com/in/ann"), false);
  assert.equal(isLinkedInProfileUrl("javascript:alert(1)"), false);
  const q = qualifyLead({ fitReason: "CTO at a SaaS", sourceUrl: "https://www.linkedin.com/in/ann-lee" });
  assert.equal(q.qualified, true);
  assert.deepEqual(q.channels, ["linkedin"]);
});

test("missing reason or source page each keep a lead unqualified", () => {
  assert.deepEqual(qualifyLead({ email: "a@b.co", sourceUrl: "https://b.co" }).missing, ["No reason it fits your profile"]);
  assert.deepEqual(qualifyLead({ email: "a@b.co", fitReason: "fits" }).missing, ["No source page"]);
  assert.equal(qualifyLead({ email: "a@b.co", fitReason: "fits", sourceUrl: "javascript:x" }).qualified, false);
});

test("a malformed email or a short phone is not a channel", () => {
  assert.deepEqual(qualifyLead({ ...base, email: "not an email" }).channels, []);
  assert.equal(normalizeWhatsapp("12345"), null);
  assert.equal(normalizeWhatsapp("+91 98765 43210"), "919876543210");
});

test("nothing at all lists every gap", () => {
  const q = qualifyLead({});
  assert.equal(q.qualified, false);
  assert.equal(q.missing.length, 3);
});
