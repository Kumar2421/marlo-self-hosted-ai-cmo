import test from "node:test";
import assert from "node:assert/strict";
import {
  countLeads,
  defaultFilter,
  filterLabel,
  filterLeads,
  hasEmail,
  isQualified,
  leadQualification,
  profileSummary,
} from "../lib/domain/leads/leadListView.ts";

const leads = [
  { id: "a", email: "a@x.com" },
  { id: "b", email: null },
  { id: "c", email: "" },
  { id: "d", email: "d@x.com" },
];

test("hasEmail ignores null, empty and blank values", () => {
  assert.equal(hasEmail({ email: "a@x.com" }), true);
  assert.equal(hasEmail({ email: null }), false);
  assert.equal(hasEmail({ email: "  " }), false);
  assert.equal(hasEmail({ email: undefined }), false);
});

test("countLeads splits with and without email", () => {
  assert.deepEqual(countLeads(leads), { all: 4, withEmail: 2, noEmail: 2, qualified: 0 });
  assert.deepEqual(countLeads([]), { all: 0, withEmail: 0, noEmail: 0, qualified: 0 });
});

test("defaultFilter prefers leads with email only when there are some", () => {
  assert.equal(defaultFilter(leads), "with");
  assert.equal(defaultFilter([{ email: null }]), "all");
  assert.equal(defaultFilter([]), "all");
});

test("filterLeads keeps order and does not mutate", () => {
  assert.deepEqual(filterLeads(leads, "with").map((l) => l.id), ["a", "d"]);
  assert.deepEqual(filterLeads(leads, "without").map((l) => l.id), ["b", "c"]);
  assert.deepEqual(filterLeads(leads, "all").map((l) => l.id), ["a", "b", "c", "d"]);
  assert.equal(leads.length, 4);
});

test("filterLabel shows the matching count", () => {
  const counts = countLeads(leads);
  assert.equal(filterLabel("all", counts), "All (4)");
  assert.equal(filterLabel("with", counts), "With email (2)");
  assert.equal(filterLabel("without", counts), "No email (2)");
});

test("profileSummary joins role and company type", () => {
  assert.equal(profileSummary({ roles: ["Founder", "CEO"], industries: ["B2B SaaS"] }), "Founder at B2B SaaS");
  assert.equal(profileSummary({ roles: ["Founder"], industries: [] }), "Founder");
  assert.equal(profileSummary({ roles: [], industries: ["B2B SaaS"] }), "B2B SaaS");
  assert.equal(profileSummary({ roles: [], industries: [] }), "Lead profile");
});

const q = { fit_reason: "Head of Sales at Acme. Role matches sales.", source_url: "https://www.linkedin.com/in/ann" };

test("a LinkedIn-sourced lead with a reason is qualified even without an email", () => {
  const l = { email: null, ...q };
  assert.equal(isQualified(l), true);
  assert.deepEqual(leadQualification(l).channels, ["linkedin"]);
});

test("a guessed email (email_verified, or pattern_candidate) does not qualify a lead", () => {
  const src = { fit_reason: "fits", source_url: "https://acme.example/team" };
  assert.equal(isQualified({ email: "a.b@acme.example", email_verified: 1, ...src }), false);
  assert.equal(isQualified({ email: "a.b@acme.example", email_quality: "pattern_candidate", ...src }), false);
  assert.equal(isQualified({ email: "a.b@acme.example", email_verified: 0, ...src }), true);
});

test("a lead with no stored reason is not qualified, which is every lead saved before this change", () => {
  assert.equal(isQualified({ email: "a@x.com", source_url: "https://x.com" }), false);
});

test("defaultFilter opens on Qualified when any lead qualifies; filter and label follow", () => {
  const list = [{ id: "1", email: null, ...q }, { id: "2", email: "b@x.com" }];
  assert.equal(defaultFilter(list), "qualified");
  assert.deepEqual(filterLeads(list, "qualified").map((l) => l.id), ["1"]);
  assert.equal(filterLabel("qualified", countLeads(list)), "Qualified (1)");
});
