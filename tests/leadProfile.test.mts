import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getLeadProfile, saveLeadProfile } from "../lib/domain/leads/leadProfileStore.ts";
import {
  applyExclusions, describeProfile, emptyProfile, isConfirmed, LIMITS, normalizeProfile, pickSearch, profileProblems, suggestProfile,
} from "../lib/domain/leads/leadProfile.ts";
import { normalizeOfferModel } from "../lib/domain/offer/offerModel.ts";

const base = { marketingStrategy: null, productInfo: null, category: "Project management software", name: "Acme", competitors: [] as string[] };

test("normalizeProfile trims, dedupes case-insensitively, drops blanks and non-strings", () => {
  const p = normalizeProfile({ roles: [" Founder ", "founder", "", 5, "CMO"], industries: ["SaaS", "saas"], locations: [], exclude: ["Acme.com"] });
  assert.deepEqual(p.roles, ["Founder", "CMO"]);
  assert.deepEqual(p.industries, ["SaaS"]);
  assert.deepEqual(p.exclude, ["Acme.com"]);
  assert.equal(p.confirmedAt, null);
});

test("normalizeProfile enforces limits and tolerates garbage input", () => {
  const many = Array.from({ length: 30 }, (_, i) => `Role ${i}`);
  const p = normalizeProfile({ roles: many, exclude: many, problem: "x".repeat(1000) });
  assert.equal(p.roles.length, LIMITS.roles);
  assert.equal(p.exclude.length, LIMITS.exclude);
  assert.equal(p.problem.length, LIMITS.problemLength);
  assert.deepEqual(normalizeProfile(null), emptyProfile());
  assert.deepEqual(normalizeProfile("nope"), emptyProfile());
  assert.equal(normalizeProfile({ roles: "Founder" }).roles.length, 0);
});

test("normalizeProfile keeps only known company sizes and an explicit boolean for webRelated", () => {
  const p = normalizeProfile({ sizes: ["11-50", "huge", "1000+"], webRelated: "yes" });
  assert.deepEqual(p.sizes, ["11-50", "1000+"]);
  assert.equal(p.webRelated, false);
  assert.equal(normalizeProfile({ webRelated: true }).webRelated, true);
});

test("a profile needs a job title or a kind of company or customer before it can be confirmed", () => {
  assert.equal(profileProblems(emptyProfile()).length, 1);
  assert.equal(profileProblems(normalizeProfile({ roles: ["Founder"] })).length, 0);
  // A buyer with no job title (a clinic, a shop's customer) is enough.
  assert.equal(profileProblems(normalizeProfile({ industries: ["Dental clinics"] })).length, 0);
  assert.equal(profileProblems(normalizeProfile({ roles: ["Founder"], industries: ["SaaS"] })).length, 0);
});

test("isConfirmed needs a confirmation time AND a valid profile", () => {
  const ok = normalizeProfile({ roles: ["Founder"], industries: ["SaaS"], confirmedAt: "2026-10-10T00:00:00Z" });
  assert.equal(isConfirmed(ok), true);
  assert.equal(isConfirmed({ ...ok, confirmedAt: null }), false);
  assert.equal(isConfirmed({ ...ok, roles: [] }), true);
  assert.equal(isConfirmed({ ...ok, roles: [], industries: [] }), false);
  assert.equal(isConfirmed(null), false);
});

test("suggestProfile reads the ICP, adds competitors as exclusions and starts unconfirmed", () => {
  const p = suggestProfile({
    ...base,
    marketingStrategy: "## Ideal Customer Profile\n- Industry: B2B SaaS\n- Location: India\n- Heads of Marketing and Founders\n",
    competitors: ["rival.com", "other.io"],
  });
  assert.ok(p.roles.includes("Head of Marketing"));
  assert.deepEqual(p.industries, ["B2B SaaS"]);
  assert.deepEqual(p.locations, ["India"]);
  assert.deepEqual(p.exclude, ["rival.com", "other.io"]);
  assert.equal(p.confirmedAt, null);
});

test("suggestProfile with no ICP falls back to the category as the kind of company", () => {
  const p = suggestProfile(base);
  assert.deepEqual(p.industries, ["Project management software"]);
  assert.deepEqual(p.roles, []);
  assert.equal(profileProblems(p).length, 0);
});

test("suggestProfile prefers what the site says (the offer model) and falls back to the docs for gaps", () => {
  const offer = normalizeOfferModel({
    sells: "Custom software",
    whoPays: "small businesses in Tamil Nadu",
    roles: [],
    industries: [],
    locations: ["Tamil Nadu"],
    problem: "Teams run on spreadsheets and lose track of deals.",
    webRelated: false,
  });
  const p = suggestProfile({ ...base, offer });
  assert.deepEqual(p.industries, ["small businesses in Tamil Nadu"]);
  assert.deepEqual(p.locations, ["Tamil Nadu"]);
  assert.equal(p.problem, "Teams run on spreadsheets and lose track of deals.");
  assert.equal(p.confirmedAt, null);
  assert.equal(profileProblems(p).length, 0);
});

test("suggestProfile ignores an offer model that learned nothing about who buys", () => {
  const empty = normalizeOfferModel({ archetype: "other" });
  assert.deepEqual(suggestProfile({ ...base, offer: empty }), suggestProfile(base));
  assert.deepEqual(suggestProfile({ ...base, offer: null }), suggestProfile(base));
});

test("suggestProfile pulls the problem from the product info and guesses if it is web related", () => {
  const p = suggestProfile({
    ...base,
    productInfo: "# Acme\n\nAcme helps small shops grow their website traffic without hiring an SEO agency. It also tracks rankings.",
  });
  assert.match(p.problem, /grow their website traffic/);
  assert.equal(p.webRelated, true);
  assert.equal(suggestProfile({ ...base, category: "Accounting for plumbers", productInfo: "We invoice customers." }).webRelated, false);
});

test("pickSearch rotates across role x industry x location combinations and covers them all", () => {
  const p = normalizeProfile({ roles: ["Founder", "CMO"], industries: ["SaaS", "Fintech"], locations: ["India"] });
  const seen = new Set<string>();
  for (let day = 0; day < 4; day += 1) {
    const s = pickSearch(p, new Date(Date.UTC(2026, 9, 10 + day)));
    seen.add(`${s.role}|${s.companyOrIndustry}|${s.location}`);
  }
  assert.equal(seen.size, 4, "four consecutive days cover all four combinations");
  assert.deepEqual(pickSearch(p, new Date("2026-10-10T01:00:00Z")), pickSearch(p, new Date("2026-10-10T22:00:00Z")), "stable within a day");
});

test("pickSearch copes with a profile that has no locations or roles", () => {
  assert.equal(pickSearch(normalizeProfile({ roles: ["CEO"], industries: ["SaaS"] }), new Date()).location, "");
  assert.deepEqual(pickSearch(emptyProfile(), new Date()), { role: "", companyOrIndustry: "", location: "" });
});

test("applyExclusions removes competitors by company, source page or email domain", () => {
  const leads = [
    { name: "A", company: "Rival Inc", sourceUrl: "https://linkedin.com/in/a" },
    { name: "B", company: "Fine Co", sourceUrl: "https://www.rival.com/team" },
    { name: "C", company: "Fine Co", sourceUrl: null, email: "c@other.io" },
    { name: "D", company: "Good Ltd", sourceUrl: "https://linkedin.com/in/d", email: "d@good.com" },
  ];
  const kept = applyExclusions(leads, ["rival", "https://www.other.io/"]);
  assert.deepEqual(kept.map((l) => l.name), ["D"]);
});

test("applyExclusions with nothing to exclude returns everything", () => {
  const leads = [{ name: "A", company: "X", sourceUrl: null }];
  assert.equal(applyExclusions(leads, []), leads);
  assert.equal(applyExclusions(leads, ["  "]).length, 1);
});

test("describeProfile reads naturally and skips what is empty", () => {
  const p = normalizeProfile({ roles: ["Founder", "CMO"], industries: ["SaaS"], sizes: ["11-50"], locations: ["India"] });
  assert.equal(describeProfile(p), "people who work as Founder / CMO at SaaS companies with 11-50 employees in India");
  assert.equal(describeProfile(emptyProfile()), "");
});

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE project_documents (
    project_id TEXT NOT NULL, doc_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ready',
    content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, doc_type))`);
  return db;
}

test("sqlite store: nothing saved yet means no profile", () => {
  assert.equal(getLeadProfile(memoryDb(), "p1"), null);
});

test("sqlite store: save then read back, per project, and saving again replaces it", () => {
  const db = memoryDb();
  const profile = normalizeProfile({ roles: ["Founder"], industries: ["SaaS"], confirmedAt: "2026-10-10T00:00:00Z" });
  saveLeadProfile(db, "p1", profile);
  assert.deepEqual(getLeadProfile(db, "p1"), profile);
  assert.equal(getLeadProfile(db, "p2"), null);

  saveLeadProfile(db, "p1", { ...profile, roles: ["CEO"] });
  assert.deepEqual(getLeadProfile(db, "p1")?.roles, ["CEO"]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM project_documents").get() as { n: number }).n, 1);
});

test("sqlite store: the profile does not collide with the strategy documents", () => {
  const db = memoryDb();
  db.prepare("INSERT INTO project_documents (project_id, doc_type, content, created_at, updated_at) VALUES ('p1', 'marketing_strategy', '# doc', 't', 't')").run();
  saveLeadProfile(db, "p1", normalizeProfile({ roles: ["Founder"], industries: ["SaaS"] }));
  assert.equal((db.prepare("SELECT content FROM project_documents WHERE doc_type = 'marketing_strategy'").get() as { content: string }).content, "# doc");
});

test("sqlite store: corrupt stored content reads as no profile instead of throwing", () => {
  const db = memoryDb();
  db.prepare("INSERT INTO project_documents (project_id, doc_type, content, created_at, updated_at) VALUES ('p1', 'lead_profile', '{not json', 't', 't')").run();
  assert.equal(getLeadProfile(db, "p1"), null);
});
