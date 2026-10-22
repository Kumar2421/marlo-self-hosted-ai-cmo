import assert from "node:assert/strict";
import test from "node:test";
import {
  GROUNDING_RULES,
  buildUnverifiedFooter,
  countUnverifiedClaims,
  findUnverifiedClaims,
  guardCompletionResult,
  guardDocumentStream,
} from "../lib/domain/documents/grounding.ts";
import { ProductInfoGenerator } from "../lib/domain/documents/ProductInfoGenerator.ts";
import { MarketingStrategyGenerator } from "../lib/domain/documents/MarketingStrategyGenerator.ts";
import { ContentStrategyGenerator } from "../lib/domain/documents/ContentStrategyGenerator.ts";
import { DesignGuideGenerator } from "../lib/domain/documents/DesignGuideGenerator.ts";
import { CompetitorAnalysisGenerator } from "../lib/domain/documents/CompetitorAnalysisGenerator.ts";
import { buildComparisonExtractionPrompt } from "../lib/domain/documents/CompetitorComparisonGenerator.ts";
import { assessGeneratedDocument, unverifiedClaimsLogLine } from "../lib/domain/project/setupRun.ts";

const SOURCE = "Home is an open source CRM. Plans start at $12 per month. Trusted by 500 teams. Built in 2023.";

const cases: { name: string; text: string; flagged: boolean }[] = [
  { name: "internal metrics percentage", text: "Home's internal metrics (2023-24) show 42% reduction in post-deployment incidents.", flagged: true },
  { name: "forks spike after hackathon", text: "GitHub traffic shows a spike in forks of the core repo after a recent Hackathon announcement.", flagged: true },
  { name: "internal pilot revenue", text: "Home's own internal pilot with a large enterprise had a $200M Revenue Ops Team.", flagged: true },
  { name: "HN praise", text: "Early adopters have posted on Hacker News praising unified dashboards.", flagged: true },
  { name: "ICP revenue", text: "Primary: companies typically $50M+ revenue.", flagged: true },
  { name: "ICP employees range", text: "Mid-market firms with 200-500 employees.", flagged: true },
  { name: "bullet with percentage customers", text: "- 87% of customers renew within a year.", flagged: true },
  { name: "number present in source", text: "Trusted by 500 teams today.", flagged: false },
  { name: "price present in source", text: "Pricing starts at $12 per month for teams.", flagged: false },
  { name: "hypothesis label", text: "Hypothesis: customers see a 40% reduction in incidents.", flagged: false },
  { name: "idea to test", text: "Idea to test: a post on Hacker News praising unified dashboards.", flagged: false },
  { name: "not stated", text: "Customer count: Not stated on the site.", flagged: false },
  { name: "plain prose no figures", text: "Home unifies CRM data for small teams.", flagged: false },
  { name: "cites url", text: "Traffic grew 30% per https://example.com/report.", flagged: false },
  { name: "number without claim context", text: "Section 3 covers 5 pillars.", flagged: false },
];

for (const c of cases) {
  test(`claim detector: ${c.name}`, () => {
    assert.equal(findUnverifiedClaims(c.text, SOURCE).length > 0, c.flagged);
  });
}

test("claims under an Assumptions heading are not flagged, others are", () => {
  const md = "## 1. ICP\nCompanies with 200-500 employees buy this.\n\n## Assumptions to validate\n- Companies with 200-500 employees and $50M revenue.";
  const claims = findUnverifiedClaims(md, SOURCE);
  assert.equal(claims.length, 1);
  assert.match(claims[0].sentence, /buy this/);
});

test("footer carries headline and count, and count parses back", () => {
  const claims = findUnverifiedClaims("Internal metrics show 42% fewer incidents.\nEarly adopters have posted on Reddit praising it.", SOURCE);
  const footer = buildUnverifiedFooter(claims);
  assert.match(footer, /Contains unverified claims: review before use/);
  assert.equal(countUnverifiedClaims(footer), 2);
  assert.equal(buildUnverifiedFooter([]), "");
});

test("assessGeneratedDocument reports flagged count and stays ok", () => {
  const body = "## Overview\n" + "Home is a CRM for small teams that need one place for their data. ".repeat(5);
  assert.deepEqual(assessGeneratedDocument(body), { ok: true });
  const flagged = body + buildUnverifiedFooter(findUnverifiedClaims("Internal metrics show 42% fewer incidents.", SOURCE));
  const r = assessGeneratedDocument(flagged);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.unverifiedClaims, 1);
  assert.match(unverifiedClaimsLogLine("Content Strategy", 1), /1 unverified claim flagged/);
});

test("stream guard passes text through and appends the note", async () => {
  const enc = new TextEncoder();
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode("## A\nInternal metrics show 42% "));
      c.enqueue(enc.encode("fewer incidents.\n"));
      c.close();
    },
  });
  const out = await new Response(guardDocumentStream(src, SOURCE)).text();
  assert.match(out, /^## A\nInternal metrics show 42% fewer incidents\./);
  assert.equal(countUnverifiedClaims(out), 1);
  const r = guardCompletionResult({ text: "Clean sentence about the product." }, { bodyText: SOURCE });
  assert.equal(r.text, "Clean sentence about the product.");
  const r2 = guardCompletionResult({ text: "Customers saw 99% growth." }, { bodyText: SOURCE });
  assert.match(r2.text!, /unverified claim/);
});

test("every generator prompt includes the grounding rules", async () => {
  const seen: string[] = [];
  const driver = (async (a: { system?: string; messages: { content: string }[] }) => {
    seen.push((a.system ?? "") + "\n" + a.messages.map((m) => m.content).join("\n"));
    return { text: "" };
  }) as never;
  const base = { projectName: "Home", url: "https://home.test", bodyText: "x", metaTitle: "t", metaDescription: "d", model: "m" };
  await new ProductInfoGenerator(driver, "k").generate(base);
  await new MarketingStrategyGenerator(driver, "k").generate(base);
  await new ContentStrategyGenerator(driver, "k").generate(base);
  await new ContentStrategyGenerator(driver, "k").generate({ ...base, tavilyApiKey: "tv" });
  await new DesignGuideGenerator(driver, "k").generate({ ...base, themeColor: null, fonts: [], logoUrl: null, faviconUrl: null, ogImageUrl: null } as never);
  await new CompetitorAnalysisGenerator(driver, "k").generate({
    ...base,
    competitors: [{ url: "https://c.test", title: "C", description: "D" }],
  });
  seen.push(buildComparisonExtractionPrompt("ctx"));
  assert.equal(seen.length, 7);
  for (const p of seen) assert.ok(p.includes(GROUNDING_RULES), "missing grounding rules");
  assert.match(GROUNDING_RULES, /Not stated on the site/);
  assert.match(GROUNDING_RULES, /Assumptions to validate/);
});
