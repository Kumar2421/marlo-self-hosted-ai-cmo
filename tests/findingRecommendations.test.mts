import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveRecommendations } from "../lib/domain/recommendations/recommendationRules.ts";
import { classifyFinding, FIX_KIND_INFO, FIX_KINDS } from "../lib/domain/codefix/fixCatalog.ts";
import { auditFindingInputs } from "../lib/domain/findings/auditFindings.ts";
import { evaluateReadiness } from "../lib/domain/geo/readiness.ts";

type Rec = ReturnType<typeof deriveRecommendations>[number];

/** The real SEO audit catalogue: every literal issueId SEOAgent can emit, read from the source so it cannot drift. */
const agentSource = readFileSync(new URL("../lib/domain/seo/SEOAgent.ts", import.meta.url), "utf8");
const SEO_AUDIT_IDS = [...new Set([...agentSource.matchAll(/issueId: "([a-z0-9-]+)"/g)].map((m) => m[1]!))];
const LIGHTHOUSE_IDS = ["lighthouse-mobile-render-blocking-resources", "lighthouse-desktop-image-alt", "lighthouse-mobile-image-alt"];

/** Findings built through the real audit mapping, so the identity (source, category, entityId, evidence) is the production one. */
function seoAuditFindings() {
  const audit = {
    url: "https://example.com/pricing",
    findings: [
      ...SEO_AUDIT_IDS.map((issueId) => ({ issueId, category: categoryOf(issueId), severity: "Warning" as const, label: issueId, evidence: { missing: "og:title, og:image", length: 80, h1Count: 2, fromLevel: 1, toLevel: 3, path: "/pricing", url: "https://example.com/pricing" } })),
      ...LIGHTHOUSE_IDS.map((issueId) => ({ issueId, category: "lighthouse", severity: "Error" as const, label: issueId, evidence: { device: issueId.includes("mobile") ? "mobile" : "desktop", mode: "opportunity", score: 0.3, displayValue: "Potential savings of 1.2 s", auditId: issueId.replace(/^lighthouse-(mobile|desktop)-/, "") } })),
    ],
  };
  return auditFindingInputs("project_1", audit).map((input, i) => ({ ...input, id: `seo_${i}` }));
}

function categoryOf(issueId: string): string {
  const prefix = issueId.split("-").slice(0, -1).join("-");
  return agentSource.match(new RegExp(`issueId: "${issueId}",\\s+category: "([a-z-]+)"`))?.[1] ?? prefix;
}

/** The real GEO readiness catalogue: every check id evaluateReadiness can emit, as the readiness route stores them. */
function geoFindings() {
  const failing = evaluateReadiness({ robots: { state: "ok", body: "User-agent: *\nDisallow: /" }, llms: { state: "missing" }, sitemapXml: { state: "missing" }, homepageHtml: "<html><body><p>hi</p></body></html>" });
  return failing.checks
    .filter((c) => c.status === "fail")
    .map((check, i) => ({
      id: `geo_${i}`, projectId: "project_1", source: "geo", category: "geo_readiness", entityType: "readiness_check", entityId: check.id,
      url: "https://example.com/", evidence: { method: "readiness", label: check.label, detail: check.detail, score: failing.score }, recommendation: check.fix,
    }));
}

const toLike = (f: { id: string; entityType: string; entityId: string; url: string | null; evidence: Record<string, unknown>; source: string; category: string }) => f;

/** What each issue is about: a recommendation must mention its own topic. */
const TOPIC: Array<[RegExp, RegExp]> = [
  [/^meta-title-/, /title/i],
  [/^meta-description-/, /description/i],
  [/^canonical-missing$/, /canonical/i],
  [/^heading-h1-/, /\bH1\b|main heading/i],
  [/^heading-order-skip$/, /heading/i],
  [/^og-tags-/, /open graph|preview/i],
  [/^twitter-tags-/, /twitter|\bX\b/i],
  [/^robots-txt-/, /robots/i],
  [/^lighthouse-/, /lighthouse|audit|speed/i],
  [/^llms-txt$/, /llms/i],
  [/^crawler-/, /robots/i],
  [/^sitemap$/, /sitemap/i],
  [/^schema$/, /structured data|json-ld/i],
  [/^structure$/, /heading|outline|h1/i],
];

test("the real catalogue is what we think it is", () => {
  assert.ok(SEO_AUDIT_IDS.length >= 12, `expected the 12 SEO audit ids, got ${SEO_AUDIT_IDS.join(", ")}`);
  for (const id of ["meta-title-too-long", "og-tags-missing", "heading-h1-missing", "canonical-missing", "twitter-tags-missing", "robots-txt-disallow"]) assert.ok(SEO_AUDIT_IDS.includes(id), id);
  assert.deepEqual(geoFindings().map((f) => f.entityId).sort(), ["crawler-claudebot", "crawler-google-extended", "crawler-gptbot", "crawler-perplexitybot", "llms-txt", "schema", "sitemap", "structure"]);
});

test("every real finding gets exactly one recommendation about its own topic (audit D1: probes returned only 'Add a canonical URL')", () => {
  const all = [...seoAuditFindings(), ...geoFindings()];
  for (const finding of all) {
    const recs = deriveRecommendations(toLike(finding));
    assert.equal(recs.length, 1, `${finding.entityId} should get exactly one recommendation`);
    const rec = recs[0]!;
    const text = `${rec.title} ${rec.summary} ${rec.implementation.description}`;
    const topic = TOPIC.find(([id]) => id.test(finding.entityId));
    assert.ok(topic, `no topic rule for ${finding.entityId}`);
    assert.match(text, topic[1], `${finding.entityId}: "${rec.title}" is not about its own issue`);
    if (finding.entityId !== "canonical-missing") {
      assert.notEqual(rec.type, "missing_canonical", `${finding.entityId} must not get the canonical recommendation`);
      assert.doesNotMatch(rec.title, /canonical/i, `${finding.entityId} got "${rec.title}"`);
    }
    assert.ok(rec.title.length > 0 && rec.summary.length > 0 && rec.implementation.description.length > 0);
  }
});

test("audit probes: title, Open Graph, H1 and llms.txt findings no longer return the canonical recommendation", () => {
  const probe = (source: string, entityId: string, category: string) =>
    deriveRecommendations({ id: "p", entityType: "x", entityId, url: "https://example.com/", evidence: {}, source, category });
  for (const [source, id, category] of [["seo-audit", "meta-title-too-long", "meta-title"], ["seo-audit", "og-tags-missing", "og-tags"], ["seo-audit", "heading-h1-missing", "heading-structure"], ["geo", "llms-txt", "geo_readiness"]] as const) {
    const recs = deriveRecommendations({ id: "p", entityType: "x", entityId: id, url: "https://example.com/", evidence: {}, source, category });
    assert.deepEqual(recs.map((r) => r.title).filter((t) => /canonical/i.test(t)), [], id);
    assert.equal(recs.length, 1);
  }
  assert.equal(probe("seo-audit", "canonical-missing", "canonical")[0]?.type, "missing_canonical");
});

test("titles differ per SEO issue, so the list is not one repeated recommendation", () => {
  const titles = seoAuditFindings().filter((f) => !f.entityId.startsWith("lighthouse-")).map((f) => deriveRecommendations(toLike(f))[0]!.title);
  assert.equal(new Set(titles).size, titles.length, titles.join(" | "));
});

test("unknown ids get a generic review step, never a wrong specific one", () => {
  for (const [source, entityId, category] of [["seo-audit", "future-issue-x", "future"], ["geo", "future-check", "geo_readiness"], ["other", "whatever", "misc"]] as const) {
    const recs = deriveRecommendations({ id: "u", entityType: "x", entityId, url: "https://example.com/", evidence: {}, source, category });
    assert.equal(recs.length, 1, source);
    assert.equal(recs[0]!.type, "review_finding");
    assert.match(recs[0]!.implementation.description, /fixing/i);
    assert.equal(recs[0]!.implementation.kind, "manual");
  }
});

test("GEO mention-gap findings get a content recommendation about being named in AI answers", () => {
  const recs = deriveRecommendations({ id: "g", entityType: "prompt", entityId: "best-crm", url: null, evidence: {}, source: "geo", category: "geo_mention_gap" });
  assert.equal(recs.length, 1);
  assert.equal(recs[0]!.type, "geo_mention_gap");
  assert.equal(recs[0]!.implementation.kind, "content");
  assert.match(recs[0]!.title, /AI answers/);
});

test("every auto-fixable real finding gets the matching 'Fix in code' hint; manual ones do not claim code", () => {
  const reached = new Set<string>();
  for (const finding of [...seoAuditFindings(), ...geoFindings()]) {
    const fix = classifyFinding(finding);
    const rec = deriveRecommendations(toLike(finding))[0] as Rec;
    if (fix.mode === "auto") {
      for (const kind of fix.kinds) reached.add(kind);
      assert.equal(rec.implementation.kind, "code", `${finding.entityId} is auto-fixable`);
      assert.match(rec.implementation.description, /Fix in code/, finding.entityId);
      assert.ok(rec.implementation.description.includes(fix.label), `${finding.entityId}: hint should name "${fix.label}"`);
    } else {
      assert.notEqual(rec.implementation.kind, "code", `${finding.entityId} is manual`);
      assert.doesNotMatch(rec.implementation.description, /Fix in code/, finding.entityId);
    }
  }
  // Every catalogue kind a real finding can reach today is covered above; the rest are checked with the classifier's own inputs below.
  for (const kind of ["title", "meta_description", "open_graph", "twitter_card", "alt_text", "json_ld", "llms_txt", "canonical"]) assert.ok(reached.has(kind), `no real finding reached ${kind}`);
});

test("every kind in FIX_KINDS that the classifier can auto-fix carries the hint", () => {
  const probes = [
    { source: "seo-audit", category: "sitemap", entityId: "sitemap-missing" },
    { source: "geo", category: "geo_readiness", entityId: "faq" },
  ];
  const seen = new Set<string>();
  for (const p of probes) {
    const fix = classifyFinding({ ...p, evidence: {} });
    assert.equal(fix.mode, "auto", p.entityId);
    if (fix.mode !== "auto") continue;
    fix.kinds.forEach((k) => seen.add(k));
    const rec = deriveRecommendations({ id: "k", entityType: "x", url: "https://example.com/", evidence: {}, ...p })[0]!;
    assert.equal(rec.implementation.kind, "code");
    assert.match(rec.implementation.description, /Fix in code/);
    assert.ok(rec.implementation.description.includes(fix.label));
  }
  assert.ok(seen.has("sitemap") && seen.has("faq_schema"));
  for (const kind of FIX_KINDS) assert.ok(FIX_KIND_INFO[kind].label.length > 0);
});

test("Lighthouse findings keep a Lighthouse recommendation; image-alt also offers the alt text fix", () => {
  const lh = seoAuditFindings().filter((f) => f.entityId.startsWith("lighthouse-"));
  assert.equal(lh.length, LIGHTHOUSE_IDS.length);
  for (const f of lh) {
    const rec = deriveRecommendations(toLike(f))[0]!;
    assert.equal(rec.type, "lighthouse_issue");
    assert.equal(rec.priority, "high");
    if (f.entityId.endsWith("image-alt")) assert.match(rec.implementation.description, /Fix in code.*Image alt text/);
    else assert.doesNotMatch(rec.implementation.description, /Fix in code/);
  }
});

test("search-console findings: no canonical claim without page data, legacy page rules still apply with it", () => {
  const sc = (evidence: Record<string, unknown>) => deriveRecommendations({ id: "s", entityType: "query", entityId: "q", url: "https://example.com/", evidence, source: "search-console", category: "search-visibility" });
  assert.deepEqual(sc({}), []);
  assert.deepEqual(sc({ page: {} }), []);
  assert.deepEqual(sc({ page: { meta: { indexable: true } } }).map((r) => r.type), ["missing_canonical"]);
});
