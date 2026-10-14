import test from "node:test";
import assert from "node:assert/strict";
import { canonicalProfileUrl, cleanCompany, extractName, inferCompany, parseLinkedInResult } from "../lib/domain/leads/profileParse.ts";

// Shapes copied from measured Tavily LinkedIn results: structured "Label: value" content, title "Name - Headline".
const KIM = {
  title: "Kim Cook - B2B SaaS Marketing VP and Strategist",
  url: "https://www.linkedin.com/in/kim-cook-marketing",
  content:
    "# Kim Cook | Headline: B2B Marketing leader | Current role: Head Of Marketing | Seniority: Head, Marketing | " +
    "Location: Austin, Texas, United States | Experience: 19 years 8 months | LinkedIn:  \u00b7 1,451 followers | " +
    "Description: Helping B2B SaaS teams turn pipeline into revenue.",
};

const DIRECTOR_AT = {
  title: "Mara Vogt - Director of Marketing at Crystal | LinkedIn",
  url: "https://de.linkedin.com/in/mara-vogt",
  content:
    "# Mara Vogt | Headline: Director of Marketing at Crystal | Current role: Director of Marketing | " +
    "Seniority: Director, Marketing | Location: Berlin, Germany | LinkedIn:  \u00b7 2.3K followers | Description: Brand and demand.",
};

const COFOUNDER = {
  title: "\u{1F680} Sam Lee \u2728 - Founder, Lumen Labs",
  url: "https://www.linkedin.com/in/samlee",
  content:
    "# Sam Lee | Headline: Co-Founder, Lumen Labs | Location: Denver, Colorado, United States | " +
    "LinkedIn:  \u00b7 880 followers | Description: Building analytics for small shops.",
};

const CREDENTIALS = {
  title: "Jane Doe, MBA - Head of Growth at Acme Corp | LinkedIn",
  url: "https://www.linkedin.com/in/jane-doe-mba",
  content:
    "# Jane Doe, MBA | Headline: Head of Growth at Acme Corp | Current role: Head of Growth | " +
    "Location: Austin, Texas, United States | LinkedIn:  \u00b7 4,020 followers | Description: Growth at Acme Corp.",
};

const SPANISH = {
  title: "Juan P\u00e9rez - Director de Marketing en Crystal | LinkedIn",
  url: "https://es.linkedin.com/in/juanperez",
  content:
    "# Juan P\u00e9rez | Headline: Director de Marketing en Crystal | Location: Madrid, Spain | " +
    "LinkedIn:  \u00b7 310 followers | Description: Marketing para empresas B2B.",
};

test("parses a structured LinkedIn profile into the expected fields", () => {
  const p = parseLinkedInResult(KIM);
  assert.ok(p);
  assert.equal(p.name, "Kim Cook");
  assert.equal(p.headline, "B2B Marketing leader");
  assert.equal(p.title, "Head Of Marketing");
  assert.equal(p.seniority, "Head, Marketing");
  assert.equal(p.location, "Austin, Texas, United States");
  assert.equal(p.followers, 1451);
  assert.equal(p.sourceUrl, "https://www.linkedin.com/in/kim-cook-marketing");
  assert.equal(p.company, null, "no company rule fires, so it stays unknown");
});

test("company from 'at X' in the headline, with a regional subdomain canonicalised", () => {
  const p = parseLinkedInResult(DIRECTOR_AT);
  assert.ok(p);
  assert.equal(p.company, "Crystal");
  assert.equal(p.sourceUrl, "https://www.linkedin.com/in/mara-vogt");
  assert.equal(p.followers, 2300);
  assert.equal(p.title, "Director of Marketing");
});

test("company from 'Role, X' and emoji-decorated names", () => {
  const p = parseLinkedInResult(COFOUNDER);
  assert.ok(p);
  assert.equal(p.name, "Sam Lee");
  assert.equal(p.company, "Lumen Labs");
  assert.equal(p.title, "", "no Current role label means an empty title, not a copy of the headline");
});

test("credentials after a comma are removed from the name; company from 'at X'", () => {
  const p = parseLinkedInResult(CREDENTIALS);
  assert.ok(p);
  assert.equal(p.name, "Jane Doe");
  assert.equal(p.company, "Acme Corp");
  assert.equal(p.followers, 4020);
});

test("non-English profile without Current role: name and location kept, company unsure so null", () => {
  const p = parseLinkedInResult(SPANISH);
  assert.ok(p);
  assert.equal(p.name, "Juan P\u00e9rez");
  assert.equal(p.title, "");
  assert.equal(p.location, "Madrid, Spain");
  assert.equal(p.company, null);
});

test("rejects company, jobs, pulse, posts and non-LinkedIn pages", () => {
  assert.equal(parseLinkedInResult({ title: "Crystal | LinkedIn", url: "https://www.linkedin.com/company/crystal", content: "" }), null);
  assert.equal(parseLinkedInResult({ title: "Data Lead - Hiring | LinkedIn", url: "https://www.linkedin.com/jobs/view/123", content: "" }), null);
  assert.equal(parseLinkedInResult({ title: "Post", url: "https://www.linkedin.com/pulse/some-article", content: "" }), null);
  assert.equal(parseLinkedInResult({ title: "Jane Doe - Post", url: "https://www.linkedin.com/posts/jane_activity-1", content: "" }), null);
  assert.equal(parseLinkedInResult({ title: "Jane Doe - Head of Sales", url: "https://www.forbes.com/profile/jane-doe", content: "" }), null);
  assert.equal(parseLinkedInResult({ title: "Jane Doe", url: "not a url", content: "" }), null);
});

test("rejects listicle titles that are not a person's name", () => {
  const listicle = { title: "Top 10 marketing leaders in Austin - LinkedIn", url: "https://www.linkedin.com/in/top-ten", content: "" };
  assert.equal(parseLinkedInResult(listicle), null);
  assert.equal(extractName("Kim Cook, MBA - Head of Sales"), "Kim Cook");
  assert.equal(extractName("Best SaaS agencies - Directory 2024"), null);
});

test("ambiguous company (two rules disagree, or 'A and B') is null, never a guess", () => {
  const conflict = { title: "Ana Ruiz - VP Sales at Beta", url: "https://www.linkedin.com/in/ana-ruiz", content: "# Ana Ruiz | Headline: VP Sales at Gamma | Location: Lisbon, Portugal" };
  assert.equal(parseLinkedInResult(conflict)?.company, null);
  assert.equal(inferCompany({ resultTitle: "X - Head of Sales at Acme and Beta", headline: "", currentRole: "" }), null);
});

test("canonicalProfileUrl accepts only /in/ person pages and normalises them", () => {
  assert.equal(canonicalProfileUrl("https://linkedin.com/in/Jane-Doe/?trk=x"), "https://www.linkedin.com/in/jane-doe");
  assert.equal(canonicalProfileUrl("http://www.linkedin.com/in/jane-doe/details/experience/"), "https://www.linkedin.com/in/jane-doe");
  assert.equal(canonicalProfileUrl("https://www.linkedin.com/company/acme"), null);
  assert.equal(canonicalProfileUrl("https://evillinkedin.com/in/jane"), null);
  assert.equal(canonicalProfileUrl("ftp://linkedin.com/in/jane"), null);
});

test("cleanCompany trims trailing stopwords and rejects placeholders", () => {
  assert.equal(cleanCompany("Acme Corp of"), "Acme Corp");
  assert.equal(cleanCompany("Crystal, Austin"), "Crystal");
  assert.equal(cleanCompany("Freelance"), null);
  assert.equal(cleanCompany("Self-employed"), null);
  assert.equal(cleanCompany("Stealth Mode"), null);
  assert.equal(cleanCompany("https://acme.com"), null);
});

test("parse never throws on empty or odd input", () => {
  assert.equal(parseLinkedInResult({ title: "", url: "https://www.linkedin.com/in/x", content: "" }), null);
  const odd = parseLinkedInResult({ title: "Lee Park", url: "https://www.linkedin.com/in/leepark", content: undefined as unknown as string });
  assert.ok(odd);
  assert.equal(odd.followers, null);
  assert.equal(odd.company, null);
});
