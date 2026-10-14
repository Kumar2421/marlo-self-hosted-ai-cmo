import test from "node:test";
import assert from "node:assert/strict";
import { createLeadDedupe, type DedupeCandidate } from "../lib/domain/leads/leadDedupe.ts";

const jane: DedupeCandidate = {
  name: "Jane Doe",
  company: "",
  title: "Head of Marketing",
  email: null,
  sourceUrl: "https://www.linkedin.com/in/jane-doe",
};

test("a lead with no company is a duplicate when its source page is already saved", () => {
  const dedupe = createLeadDedupe([{ name: "Jane Doe", company: "", title: "VP", source_url: "https://www.linkedin.com/in/jane-doe" }]);
  assert.equal(dedupe.isDuplicate({ ...jane, title: "Something else" }), true);
});

test("source URLs match case-insensitively", () => {
  const dedupe = createLeadDedupe([{ name: "X", company: "", source_url: "https://WWW.linkedin.com/in/Jane-Doe" }]);
  assert.equal(dedupe.isDuplicate({ ...jane, name: "Other Name", sourceUrl: "https://www.linkedin.com/in/jane-doe" }), true);
});

test("a company-less lead matches an existing row on lowercase name + title", () => {
  const dedupe = createLeadDedupe([{ name: "  JANE doe ", company: "", title: "head of MARKETING", source_url: null }]);
  assert.equal(dedupe.isDuplicate({ ...jane, sourceUrl: null }), true);
});

test("name + title with a different title is not a duplicate (two people can share a name)", () => {
  const dedupe = createLeadDedupe([{ name: "Jane Doe", company: "", title: "CFO", source_url: null }]);
  assert.equal(dedupe.isDuplicate({ ...jane, sourceUrl: null }), false);
});

test("name + title is not used when the candidate has a company", () => {
  const dedupe = createLeadDedupe([{ name: "Jane Doe", company: "", title: "Head of Marketing", source_url: null }]);
  assert.equal(dedupe.isDuplicate({ ...jane, company: "Acme", sourceUrl: null }), false);
});

test("the old name + company key still works", () => {
  const dedupe = createLeadDedupe([{ name: "Jane Doe", company: "Acme", title: "", source_url: null }]);
  assert.equal(dedupe.isDuplicate({ ...jane, company: "ACME", title: "", sourceUrl: null }), true);
  assert.equal(dedupe.isDuplicate({ ...jane, company: "Beta", title: "", sourceUrl: null }), false);
});

test("email still dedupes", () => {
  const dedupe = createLeadDedupe([{ email: "Jane@Acme.com", name: "Someone Else", company: "", source_url: null }]);
  assert.equal(dedupe.isDuplicate({ ...jane, email: "jane@acme.com", sourceUrl: null }), true);
});

test("a reserved lead blocks a repeat later in the same batch", () => {
  const dedupe = createLeadDedupe([]);
  assert.equal(dedupe.isDuplicate(jane), false);
  dedupe.reserve(jane);
  assert.equal(dedupe.isDuplicate({ ...jane, title: "Head of Marketing " }), true);
});

test("a fresh person with no shared keys is not a duplicate", () => {
  const dedupe = createLeadDedupe([{ name: "Ann Lee", company: "", title: "CEO", source_url: "https://www.linkedin.com/in/ann" }]);
  assert.equal(dedupe.isDuplicate(jane), false);
});
