import test from "node:test";
import assert from "node:assert/strict";
import { dedupeProfiles, MAX_LEADS, rankProfiles, scoreProfile } from "../lib/domain/leads/leadFit.ts";
import type { ParsedLinkedInProfile } from "../lib/domain/leads/profileParse.ts";

function person(over: Partial<ParsedLinkedInProfile> & { slug: string }): ParsedLinkedInProfile {
  const { slug, ...rest } = over;
  return {
    name: "Kim Cook",
    headline: "",
    title: "",
    seniority: "",
    location: "",
    followers: null,
    company: null,
    description: "",
    ...rest,
    sourceUrl: `https://www.linkedin.com/in/${slug}`,
  };
}

const TARGET = { role: "Head of Marketing", companyOrIndustry: "B2B SaaS", location: "Austin, TX" };

const KIM = person({
  slug: "kim-cook",
  headline: "B2B Marketing leader",
  title: "Head Of Marketing",
  seniority: "Head, Marketing",
  location: "Austin, Texas, United States",
  description: "Helping B2B SaaS teams turn pipeline into revenue.",
});
const SALES_CHICAGO = person({
  slug: "ana-sales",
  name: "Ana Ruiz",
  headline: "Enterprise Sales Engineer",
  title: "Sales Engineer",
  location: "Chicago, Illinois, United States",
  description: "Hardware sales.",
});
const COORDINATOR_DENVER = person({
  slug: "lee-coord",
  name: "Lee Park",
  headline: "Marketing coordinator",
  title: "Marketing Coordinator",
  location: "Denver, Colorado",
});

test("a profile matching role, location and industry scores highest and is kept", () => {
  const fit = scoreProfile(KIM, TARGET);
  assert.equal(fit.keep, true);
  assert.ok(fit.score >= 8, `score was ${fit.score}`);
  assert.equal(scoreProfile(SALES_CHICAGO, TARGET).keep, false, "no role word matched, so dropped");
});

test("a generic role-word match is kept but ranks below a full match", () => {
  const coord = scoreProfile(COORDINATOR_DENVER, TARGET);
  assert.equal(coord.keep, true);
  assert.ok(coord.score < scoreProfile(KIM, TARGET).score);
});

test("with no role asked, an industry or location match is enough", () => {
  const industryOnly = person({ slug: "x1", headline: "Founder at a SaaS company", description: "SaaS" });
  assert.equal(scoreProfile(industryOnly, { role: "", companyOrIndustry: "SaaS", location: "" }).keep, true);
  assert.equal(scoreProfile(SALES_CHICAGO, { role: "", companyOrIndustry: "", location: "" }).keep, false);
});

test("the saved lead profile adds roles, industries and locations to the score", () => {
  const plain = scoreProfile(COORDINATOR_DENVER, { role: "", companyOrIndustry: "", location: "" }, null);
  const withProfile = scoreProfile(COORDINATOR_DENVER, { role: "", companyOrIndustry: "", location: "" }, {
    roles: ["Marketing Coordinator"],
    industries: [],
    locations: ["Denver"],
  });
  assert.ok(withProfile.score > plain.score);
});

test("rankProfiles sorts by score and keeps the engine order for ties", () => {
  const second = person({ slug: "kim-two", name: "Kim Two", headline: "Head of Marketing", title: "Head of Marketing", location: "Austin, TX" });
  const ranked = rankProfiles([COORDINATOR_DENVER, second, KIM], TARGET);
  assert.equal(ranked[0].sourceUrl, KIM.sourceUrl, "KIM has the most matches");
  assert.ok(ranked.every((r, i, arr) => i === 0 || arr[i - 1].score >= r.score));
  assert.ok(ranked.every((r) => r.sourceUrl !== SALES_CHICAGO.sourceUrl));
});

test("dedupe by profile URL, and by name+company when the company is known", () => {
  const sameUrl = person({ slug: "kim-cook", headline: "Head of Marketing", location: "Austin" });
  const sameNameCompany = person({ slug: "kim-other", name: "KIM COOK", company: "Crystal" });
  const sameNameCompany2 = person({ slug: "kim-third", name: "Kim Cook", company: "crystal" });
  const out = dedupeProfiles([KIM, sameUrl, { ...sameNameCompany }, sameNameCompany2]);
  assert.equal(out.length, 2, "one by URL, one by name+company");
});

test("rankProfiles caps the list at MAX_LEADS", () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    person({ slug: `p${i}`, name: `Person ${i}`, headline: "Head of Marketing", title: "Head of Marketing", location: "Austin, TX" })
  );
  assert.equal(rankProfiles(many, TARGET).length, MAX_LEADS);
  assert.equal(MAX_LEADS, 40);
});
