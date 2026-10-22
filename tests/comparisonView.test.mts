import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildComparisonView,
  comparisonToMarkdown,
  parseComparisonMarkdown,
} from "../lib/domain/documents/comparisonView.ts";

const project = { name: "MLForge Studio", url: "https://mlforge.studio" };
const competitors = [
  { id: "a", url: "https://a.com", name: "A.com", startingPrice: "$10/month", features: ["SEO audit", "Lead tracking"] },
  { id: "b", url: "https://b.com", name: "B.com", startingPrice: "free", features: ["Lead tracking", "API access"] },
];
const own = (over = {}) => ({
  id: "own",
  url: "https://mlforge.studio",
  name: "MLForge Studio",
  startingPrice: "contact sales",
  features: ["Custom ML models", "seo audit"],
  extracted: true,
  ...over,
});

test("own product comes from project data, not Marlo", () => {
  const v = buildComparisonView(project, { ownProduct: own(), competitors });
  assert.equal(v.own.name, "MLForge Studio");
  assert.equal(v.own.url, project.url);
  assert.equal(v.own.status, "ready");
  assert.equal(v.own.startingPrice, "contact sales");
  assert.deepEqual(v.own.features, ["Custom ML models", "seo audit"]);
});

test("gaps and differentiators are derived from the data", () => {
  const v = buildComparisonView(project, { ownProduct: own(), competitors });
  assert.deepEqual(v.gaps, ["Lead tracking", "API access"]);
  assert.deepEqual(v.differentiators, ["Custom ML models"]);
});

test("legacy Marlo own product is treated as missing", () => {
  const legacy = own({ id: "marlo", name: "Marlo", url: "https://github.com/Kumar2421/marlo" });
  const v = buildComparisonView(project, { ownProduct: legacy, competitors });
  assert.equal(v.own.status, "missing");
  assert.equal(v.own.name, "MLForge Studio");
  assert.deepEqual(v.own.features, []);
  assert.deepEqual(v.gaps, []);
  assert.deepEqual(v.differentiators, []);
  // Marlo-named record with the project's own url still rejected for another project name
  assert.equal(buildComparisonView(project, { ownProduct: own({ name: "Marlo" }), competitors }).own.status, "missing");
});

test("record for a different site is stale -> missing", () => {
  const v = buildComparisonView(project, { ownProduct: own({ url: "https://other.com" }), competitors });
  assert.equal(v.own.status, "missing");
});

test("no own data at all -> honest missing state, no fake list", () => {
  const v = buildComparisonView(project, { competitors });
  assert.equal(v.own.status, "missing");
  assert.deepEqual(v.own.features, []);
  assert.equal(v.own.startingPrice, "");
});

test("own site not extracted -> not_extracted, no gaps claims", () => {
  const v = buildComparisonView(project, { ownProduct: own({ extracted: false, features: [], startingPrice: "" }), competitors });
  assert.equal(v.own.status, "not_extracted");
  assert.deepEqual(v.gaps, []);
  assert.deepEqual(v.differentiators, []);
});

test("markdown round-trip keeps own product; older markdown has none", () => {
  const md = comparisonToMarkdown({ ownProduct: own(), competitors, generatedAt: "2026-01-01" });
  const parsed = parseComparisonMarkdown(md);
  assert.equal(parsed.ownProduct?.name, "MLForge Studio");
  assert.equal(parsed.ownProduct?.extracted, true);
  assert.equal(parsed.competitors.length, 2);
  assert.equal(parsed.competitors[0].name, "A.com");

  const unread = parseComparisonMarkdown(
    comparisonToMarkdown({ ownProduct: own({ extracted: false }), competitors, generatedAt: "2026-01-01" }),
  );
  assert.equal(unread.ownProduct?.extracted, false);
  assert.equal(unread.competitors.length, 2);

  const old = parseComparisonMarkdown(comparisonToMarkdown({ competitors, generatedAt: "2026-01-01" }));
  assert.equal(old.ownProduct, null);
  assert.equal(old.competitors.length, 2);
  assert.equal(buildComparisonView(project, old).own.status, "missing");
});
