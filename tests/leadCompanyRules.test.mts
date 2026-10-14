import test from "node:test";
import assert from "node:assert/strict";
import { inferCompany, parseLinkedInResult } from "../lib/domain/leads/profileParse.ts";
import { isGeographyTerm, locationTerms } from "../lib/domain/leads/leadGeography.ts";

const roleLine = (title: string, headline = "", location = "") =>
  parseLinkedInResult({
    title: `Pat Quinn - ${title}`,
    url: "https://www.linkedin.com/in/pat-quinn",
    content: `# Pat Quinn | Headline: ${headline} | Location: ${location} | Description: Works in B2B.`,
  });

test("a 'Role, Place' title never takes the place for a company", () => {
  assert.equal(roleLine("Marketing Manager, Berlin", "", "Lisbon, Portugal")?.company ?? null, null);
  assert.equal(roleLine("Engineering Manager, Remote", "", "Denver, Colorado, United States")?.company ?? null, null);
  assert.equal(roleLine("Sales Director, Europe", "", "Madrid, Spain")?.company ?? null, null);
  assert.equal(roleLine("Head of Sales, Canada", "", "Toronto, Ontario, Canada")?.company ?? null, null);
});

test("a 'Role, X' title still names a real company", () => {
  assert.equal(roleLine("Founder, Lumen Labs", "", "Denver, Colorado, United States")?.company, "Lumen Labs");
});

test("a candidate equal to the profile's own location word is rejected", () => {
  // "Crystal" is a word of the profile's location, so it cannot be the employer.
  assert.equal(inferCompany({ resultTitle: "X - Head of Sales, Crystal", headline: "", currentRole: "", location: "Crystal Lake, Illinois" }), null);
});

test("a candidate equal to a query location token is rejected", () => {
  assert.equal(
    inferCompany({ resultTitle: "X - Head of Sales, Amsterdam", headline: "", currentRole: "", queryLocation: "Amsterdam, Netherlands" }),
    null
  );
  assert.equal(
    inferCompany({ resultTitle: "X - Head of Sales, Acme", headline: "", currentRole: "", queryLocation: "Amsterdam, Netherlands" }),
    "Acme"
  );
});

test("geography terms: countries, cities, US states and codes, regions", () => {
  for (const term of ["Berlin", "Germany", "Texas", "TX", "Europe", "EMEA", "APAC", "Remote", "Hybrid", "Worldwide", "United States", "New York"]) {
    assert.equal(isGeographyTerm(term), true, term);
  }
  for (const term of ["Acme Corp", "Crystal", "Lumen Labs"]) {
    assert.equal(isGeographyTerm(term), false, term);
  }
});

test("locationTerms yields the phrase, its parts and its words", () => {
  const terms = locationTerms("Austin, Texas, United States");
  for (const t of ["austin", "texas", "united states", "united", "states", "austin, texas, united states"]) {
    assert.ok(terms.has(t), t);
  }
  assert.equal(locationTerms("").size, 0);
});

test("'at scale' and 'at heart' are not companies", () => {
  assert.equal(inferCompany({ resultTitle: "X", headline: "Helping startups grow at scale", currentRole: "" }), null);
  assert.equal(inferCompany({ resultTitle: "X", headline: "SaaS at heart", currentRole: "" }), null);
  assert.equal(inferCompany({ resultTitle: "X", headline: "Built for work at Scale", currentRole: "" }), null);
});

test("'at X' still works when X is a capitalised name", () => {
  assert.equal(inferCompany({ resultTitle: "X", headline: "Head of Growth at Acme Corp", currentRole: "" }), "Acme Corp");
  assert.equal(inferCompany({ resultTitle: "X", headline: "Engineer at 3M", currentRole: "" }), "3M");
  assert.equal(inferCompany({ resultTitle: "X", headline: "Home at Home Depot", currentRole: "" }), "Home Depot");
});

test("a lowercase 'at' followed by a lowercase word is never a company", () => {
  assert.equal(inferCompany({ resultTitle: "X", headline: "Making teams fly at speed", currentRole: "" }), null);
});
