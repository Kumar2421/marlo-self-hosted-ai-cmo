import test from "node:test";
import assert from "node:assert/strict";
import { describeFit, rankProfiles } from "../lib/domain/leads/leadFit.ts";
import { personLeadFields } from "../lib/domain/leads/leadRow.ts";

const profile = {
  name: "Ann Lee", title: "Head of Sales", company: "Acme", headline: "Head of Sales at Acme | SaaS", description: "Runs sales for a SaaS company",
  location: "Chennai, India", seniority: "head", sourceUrl: "https://www.linkedin.com/in/ann-lee",
} as never;
const target = { role: "Head of Sales", companyOrIndustry: "SaaS", location: "Chennai" };

test("the reason names only what matched, and starts with who they are", () => {
  const r = describeFit(profile, target);
  assert.match(r, /^Head of Sales at Acme\./);
  assert.match(r, /[Rr]ole matches/);
  assert.match(r, /works in "saas"/);
  assert.match(r, /based in Chennai, India/);
});

test("nothing matched means an empty reason, never an invented one", () => {
  assert.equal(describeFit(profile, { role: "Plumber", companyOrIndustry: "mining", location: "Oslo" }), "");
});

test("ranked profiles carry their reason", () => {
  const ranked = rankProfiles([profile], target);
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].fitReason, /[Rr]ole matches/);
});

test("personLeadFields stores the reason, trims empty to null, and flags guessed emails", () => {
  const lead = { name: "A", title: "t", company: "c", location: "l", email: null, sourceUrl: "https://x.test", fitReason: "  " };
  const f = personLeadFields(lead, { email: "a@c.com", emailGuessed: true, query: "q", now: "n" });
  assert.equal(f.fit_reason, null);
  assert.equal(f.email_verified, true);
  assert.equal(personLeadFields({ ...lead, fitReason: "fits" }, { email: null, emailGuessed: false, query: "q", now: "n" }).fit_reason, "fits");
});
