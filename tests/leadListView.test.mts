import test from "node:test";
import assert from "node:assert/strict";
import {
  countLeads,
  defaultFilter,
  filterLabel,
  filterLeads,
  hasEmail,
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
  assert.deepEqual(countLeads(leads), { all: 4, withEmail: 2, noEmail: 2 });
  assert.deepEqual(countLeads([]), { all: 0, withEmail: 0, noEmail: 0 });
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
