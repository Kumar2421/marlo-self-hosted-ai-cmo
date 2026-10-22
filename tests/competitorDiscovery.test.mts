import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryQueries, extractCompetitorCandidates, normalizeHost, type SearchHit } from "../lib/domain/documents/competitorCandidates.ts";
import { isModelNotFound, modelAttempts } from "../lib/llm/modelFallback.ts";

const hit = (url: string, title = "", content = ""): SearchHit => ({ url, title, content });
const domains = (c: { domain: string }[]) => c.map((x) => x.domain);

test("normalizeHost strips protocol, www, path, port and case", () => {
  assert.equal(normalizeHost("HTTPS://www.Example.com:8080/a/b?x=1#y"), "example.com");
  assert.equal(normalizeHost("example.com"), "example.com");
});

test("buildDiscoveryQueries uses comparison searches and a category query from the title", () => {
  const q = buildDiscoveryQueries("Marlo", "Marlo | AI SEO platform for startups");
  assert.ok(q.includes("Marlo alternatives"));
  assert.ok(q.includes("Marlo competitors"));
  assert.ok(q.includes("Marlo vs"));
  assert.ok(q.some((s) => /best AI SEO platform for startups alternatives/i.test(s)));
  assert.ok(!q.some((s) => /marlo.*marlo/i.test(s) && s.startsWith("best")), "brand is removed from the category query");
});

test("buildDiscoveryQueries skips a category query when the title is just the brand", () => {
  const q = buildDiscoveryQueries("Marlo", "Marlo");
  assert.equal(q.length, 4);
});

test("a company site seen across several searches becomes a candidate", () => {
  const out = extractCompetitorCandidates(
    [
      [hit("https://rival.com/product", "Rival")],
      [hit("https://rival.com/pricing", "Rival pricing")],
      [hit("https://other.io", "Other")],
    ],
    "marlo.ai",
  );
  assert.deepEqual(domains(out), ["rival.com"]);
  assert.match(out[0].reason, /2 competitor-style searches/);
});

test("a single stray result is not enough", () => {
  assert.deepEqual(extractCompetitorCandidates([[hit("https://random.com", "Random")]], "marlo.ai"), []);
});

test("a competitor's own comparison page counts extra", () => {
  const out = extractCompetitorCandidates([[hit("https://rival.com/alternatives/marlo", "Rival vs Marlo")]], "marlo.ai");
  assert.deepEqual(domains(out), ["rival.com"]);
  assert.match(out[0].reason, /comparison page/);
});

test("domains named inside review or listicle snippets are picked up, the listicle itself is not", () => {
  const out = extractCompetitorCandidates(
    [
      [hit("https://www.g2.com/products/marlo/competitors", "Top Marlo alternatives", "Compare rival.com, other.io and more tools.")],
      [hit("https://medium.com/@x/best-tools", "Best tools", "We like rival.com for pricing.")],
    ],
    "marlo.ai",
  );
  assert.deepEqual(domains(out), ["rival.com"]);
  assert.match(out[0].reason, /named in 2 review or comparison results/i);
});

test("review sites, social, news and the product's own domain are never candidates", () => {
  const out = extractCompetitorCandidates(
    [
      [hit("https://www.g2.com/a"), hit("https://reddit.com/r/x"), hit("https://www.marlo.ai/"), hit("https://docs.marlo.ai/x")],
      [hit("https://www.g2.com/b"), hit("https://reddit.com/r/y"), hit("https://www.marlo.ai/pricing"), hit("https://docs.marlo.ai/y")],
    ],
    "marlo.ai",
  );
  assert.deepEqual(out, []);
});

test("candidates are ranked by evidence, tied by name, and capped at 12", () => {
  const strong = [hit("https://strong.com/a"), hit("https://strong.com/alternatives", "strong alternative")];
  const weak = Array.from({ length: 20 }, (_, i) => hit(`https://co${String(i).padStart(2, "0")}.com/x`));
  const out = extractCompetitorCandidates([strong, [...strong, ...weak], weak], "marlo.ai");
  assert.equal(out[0].domain, "strong.com");
  assert.equal(out.length, 12);
  assert.deepEqual(extractCompetitorCandidates([strong, [...strong, ...weak], weak], "marlo.ai"), out, "deterministic");
});

test("empty input yields nothing", () => {
  assert.deepEqual(extractCompetitorCandidates([], "marlo.ai"), []);
  assert.deepEqual(extractCompetitorCandidates([[], []], "marlo.ai"), []);
});

test("isModelNotFound recognizes the retired-model failure in its different shapes", () => {
  assert.equal(isModelNotFound({ status: 404, message: "404 The model `qwen/qwen3-32b` does not exist or you do not have access to it." }), true);
  assert.equal(isModelNotFound({ code: "model_not_found", message: "x" }), true);
  assert.equal(isModelNotFound({ error: { code: "model_not_found" } }), true);
  assert.equal(isModelNotFound(new Error("The model `x` has been decommissioned")), true);
});

test("isModelNotFound does not treat other failures as a missing model", () => {
  assert.equal(isModelNotFound({ status: 401, message: "Invalid API Key" }), false);
  assert.equal(isModelNotFound({ status: 429, message: "Rate limit reached for model x" }), false);
  assert.equal(isModelNotFound({ status: 404, message: "Route not found" }), false);
  assert.equal(isModelNotFound(null), false);
  assert.equal(isModelNotFound("model not found"), false);
});

test("modelAttempts tries the requested model first, then each alternative once", () => {
  assert.deepEqual(modelAttempts("old", ["a", "b"]), ["old", "a", "b"]);
  assert.deepEqual(modelAttempts("a", ["a", "b"]), ["a", "b"]);
});

import { buildDiscoveryQueries as bq, filterDeniedCandidates, isDeniedDomain, isRelevantToProduct, productCategory } from "../lib/domain/documents/competitorCandidates.ts";

test("generic project name: queries come from the description, not the bare name", () => {
  const q = bq("Home", "Home", "MLForge Studio builds enterprise AI and machine learning software for businesses.");
  assert.ok(q.length > 0);
  assert.ok(q.every((s) => !/\bHome\b/.test(s)), q.join(" | "));
  assert.ok(q.some((s) => /enterprise AI/i.test(s)));
});

test("real brand name keeps its brand queries and adds the category query first", () => {
  const q = bq("Acme", "Acme | Invoicing for freelancers", "");
  assert.equal(q[0], "best Invoicing for freelancers alternatives");
  assert.ok(q.includes("Acme alternatives"));
});

test("productCategory falls back to the first sentence of the description", () => {
  assert.equal(productCategory("Acme", "Acme", "Invoicing software for freelancers. Second sentence."), "Invoicing software for freelancers");
  assert.equal(productCategory("Acme", "Acme", ""), "");
});

test("deny list covers portals and is matched on subdomains", () => {
  for (const d of ["redfin.com", "www.zillow.com", "en.wikipedia.org", "https://www.linkedin.com/company/x", "m.youtube.com", "reddit.com", "crunchbase.com"]) {
    assert.ok(isDeniedDomain(d), d);
  }
  assert.ok(!isDeniedDomain("nestment.com"));
  assert.deepEqual(filterDeniedCandidates([{ domain: "zillow.com" }, { domain: "acme.io" }]).map((c) => c.domain), ["acme.io"]);
});

test("relevance: unrelated business is dropped, same category is kept", () => {
  const product = "Enterprise AI and machine learning software studio building custom ML products for businesses";
  assert.equal(isRelevantToProduct(product, "Nestment - Real estate investing for first-time homebuyers"), false);
  assert.equal(isRelevantToProduct(product, "Grammarly: Free writing assistant for spelling and grammar"), false);
  assert.equal(isRelevantToProduct(product, "Fractal - enterprise machine learning and AI consulting"), true);
});

test("relevance: too little text on either side keeps the candidate", () => {
  assert.equal(isRelevantToProduct("", "Anything at all here about stuff"), true);
  assert.equal(isRelevantToProduct(product2(), "(no title found) (no meta description found)"), true);
});
function product2() { return "Invoicing software for freelancers and agencies"; }
