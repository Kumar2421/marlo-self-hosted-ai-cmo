import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveRecommendations } from "../lib/domain/recommendations/recommendationRules.ts";
import { classifyFinding } from "../lib/domain/codefix/fixCatalog.ts";
import { explainFinding } from "../lib/domain/seo/findingExplanations.ts";
import { auditFindingInputs } from "../lib/domain/findings/auditFindings.ts";
import {
  collapseDuplicateFindings,
  countFindings,
  findingCountSentence,
  findingCountStats,
  findingTitle,
  stripInlineCode,
} from "../lib/domain/findings/findingDisplay.ts";
import { evidenceRowsForFinding } from "../lib/domain/findings/evidenceDisplay.ts";
import { encodingLabel, lastAuditedLabel } from "../lib/domain/seo/auditDisplay.ts";
import {
  knownLighthouseAuditIds,
  lighthouseAuditId,
  lighthouseCategoryOf,
  lighthouseGuide,
  lighthouseScoreLabel,
  type LighthouseCategory,
} from "../lib/domain/seo/lighthouseAudits.ts";
import { parseLighthouse } from "../lib/domain/seo/pageSpeedInsights.ts";

const agentSource = readFileSync(new URL("../lib/domain/seo/SEOAgent.ts", import.meta.url), "utf8");
const SEO_AUDIT_IDS = [...new Set([...agentSource.matchAll(/issueId: "([a-z0-9-]+)"/g)].map((m) => m[1]!))];

/** A Lighthouse finding built through the real audit mapping, so its identity and evidence are the production ones. */
function lighthouseFinding(auditId: string, extra: Record<string, unknown> = {}, device = "mobile") {
  const [input] = auditFindingInputs("p1", {
    url: "https://example.com/",
    findings: [{
      issueId: `lighthouse-${device}-${auditId}`,
      category: "lighthouse",
      severity: "Error",
      label: `Title of ${auditId}`,
      evidence: { device, mode: "diagnostic", score: 0, displayValue: null, auditId, ...extra } as Record<string, string | number | null>,
    }],
  });
  return { ...input!, id: `f_${auditId}_${device}` };
}

const recFor = (f: ReturnType<typeof lighthouseFinding>) => deriveRecommendations(f);
const reasonOf = (f: ReturnType<typeof lighthouseFinding>) => (classifyFinding(f) as { reason: string }).reason;

// ---- Bug 5: recommendations match the finding's category -------------------------------------------------

const GENERIC_SPEED_TEXT = /speed and performance fixes touch how the page is built/i;

test("every Lighthouse audit Marlo knows gets a recommendation in its own category, with what, how to fix and how to check", () => {
  const ids = knownLighthouseAuditIds();
  assert.ok(ids.length >= 40, `expected a real table, got ${ids.length}`);
  for (const auditId of ids) {
    const guide = lighthouseGuide(auditId)!;
    assert.ok(guide.what.length > 20 && guide.fix.length > 20 && guide.verify.length > 20, `${auditId} guide is incomplete`);
    for (const device of ["mobile", "desktop"]) {
      const finding = lighthouseFinding(auditId, {}, device);
      assert.equal(lighthouseCategoryOf(finding), guide.category, `${auditId} category`);
      const recs = recFor(finding);
      assert.equal(recs.length, 1, auditId);
      const rec = recs[0]!;
      assert.equal(rec.type, "lighthouse_issue");
      assert.equal(rec.title, guide.title, auditId);
      assert.ok(rec.summary.includes(guide.what), `${auditId}: summary says what is wrong`);
      assert.ok(rec.implementation.description.startsWith(guide.fix), `${auditId}: action is the fix`);
      assert.match(rec.implementation.description, /To check it:/, `${auditId}: says how to verify`);
      assert.ok(rec.summary.includes(`Title of ${auditId}`), `${auditId}: uses the finding's own evidence`);
      assert.ok(rec.summary.includes(device), `${auditId}: names the device`);
      // The reason shown beside "Fix in code" must fit the category too.
      const fix = classifyFinding(finding);
      if (fix.mode === "manual" && guide.category !== "performance") assert.doesNotMatch(fix.reason, GENERIC_SPEED_TEXT, auditId);
      if (guide.category === "accessibility") {
        assert.doesNotMatch(`${rec.title} ${rec.summary} ${rec.implementation.description}`, /speed|performance|score improves/i, `${auditId} reads like a speed finding`);
      }
    }
  }
});

test("the four accessibility findings from the QA report get concrete, correct guidance", () => {
  const cases: Array<[string, RegExp[]]> = [
    ["button-name", [/aria-label/, /visible text/, /Accessibility pane/]],
    ["meta-viewport", [/user-scalable=no/, /maximum-scale/, /<meta name="viewport"/]],
    ["heading-order", [/one level at a time/i, /h4 to h3/, /outline/i]],
    ["label-content-name-mismatch", [/aria-label/, /visible text/, /Name must contain the visible text/]],
  ];
  for (const [auditId, patterns] of cases) {
    const finding = lighthouseFinding(auditId, { displayValue: "3 elements" });
    const rec = recFor(finding)[0]!;
    const all = `${rec.title} ${rec.summary} ${rec.implementation.description}`;
    for (const pattern of patterns) assert.match(all, pattern, `${auditId}: ${pattern}`);
    assert.doesNotMatch(all, GENERIC_SPEED_TEXT);
    assert.doesNotMatch(all, /performance, accessibility or best-practice/);
    assert.doesNotMatch(rec.implementation.description, /re-run the SEO audit to confirm the score improves/);
    assert.match(rec.summary, /3 elements/, "shows the evidence value");
    assert.equal(classifyFinding(finding).mode, "manual");
    assert.match(reasonOf(finding), /accessibility/i);
  }
});

test("backticks in a Lighthouse title do not leak into the recommendation", () => {
  const finding = lighthouseFinding("meta-viewport");
  finding.evidence.label = "`[user-scalable=\"no\"]` is used in the `<meta name=\"viewport\">` element";
  const rec = recFor(finding)[0]!;
  assert.doesNotMatch(rec.summary, /`/);
  assert.match(rec.summary, /\[user-scalable="no"\] is used in the <meta name="viewport"> element/);
});

test("an audit with no guide gets neutral wording unless the audit recorded its category", () => {
  const unknown = lighthouseFinding("some-future-audit");
  assert.equal(lighthouseCategoryOf(unknown), null);
  const neutral = recFor(unknown)[0]!;
  assert.equal(neutral.type, "lighthouse_issue");
  assert.match(neutral.summary, /performance, accessibility or best-practice issue/);
  assert.match(reasonOf(unknown), /cannot tell which part/);
  assert.doesNotMatch(reasonOf(unknown), /speed/i);

  const recorded = lighthouseFinding("some-future-audit", { lighthouseCategory: "accessibility" });
  assert.equal(lighthouseCategoryOf(recorded), "accessibility");
  assert.match(recFor(recorded)[0]!.summary, /accessibility issue/);
  assert.match(reasonOf(recorded), /accessibility/);
  assert.doesNotMatch(reasonOf(recorded), GENERIC_SPEED_TEXT);

  const perf = lighthouseFinding("some-future-audit", { lighthouseCategory: "performance" });
  assert.match(reasonOf(perf), /speed and performance/);
});

test("the audit-time explanation is category-specific too (what the Findings drawer shows under 'What to do')", () => {
  for (const auditId of knownLighthouseAuditIds()) {
    const guide = lighthouseGuide(auditId)!;
    const input = lighthouseFinding(auditId);
    assert.ok(input.recommendation.startsWith(guide.fix), `${auditId} stored recommendation`);
    assert.ok(String(input.evidence.whyItMatters).includes(guide.what), `${auditId} stored why`);
  }
  const unknown = explainFinding({ issueId: "lighthouse-mobile-some-future-audit", evidence: { device: "mobile", mode: "diagnostic", auditId: "some-future-audit" } });
  assert.match(unknown.recommendation, /Review the Lighthouse audit detail/);
});

test("PSI audit categories are recorded from the response's own auditRefs", () => {
  const out = parseLighthouse({
    lighthouseResult: {
      categories: {
        performance: { score: 0.5, auditRefs: [{ id: "unused-javascript" }, { id: "button-name" }] },
        accessibility: { score: 0.5, auditRefs: [{ id: "button-name" }, { id: "some-future-audit" }] },
        "best-practices": { score: 1, auditRefs: [{ id: "errors-in-console" }] },
      },
      audits: {
        "button-name": { score: 0, title: "Buttons do not have an accessible name" },
        "some-future-audit": { score: 0, title: "Future" },
        "unused-javascript": { score: 0.2, title: "Reduce unused JavaScript", details: { type: "opportunity" } },
        "no-category": { score: 0.1, title: "Nothing says" },
      },
    },
  });
  const byId = Object.fromEntries(out.lighthouseIssues.map((i) => [i.id, i.category]));
  assert.equal(byId["button-name"], "accessibility", "a specific category wins over performance");
  assert.equal(byId["some-future-audit"], "accessibility");
  assert.equal(byId["unused-javascript"], "performance");
  assert.equal("category" in out.lighthouseIssues.find((i) => i.id === "no-category")!, false, "never guessed");
});

test("every SEO audit issueId has a specific recommendation and explanation; a new id without one fails here", () => {
  assert.ok(SEO_AUDIT_IDS.length >= 12);
  const defaultWhy = explainFinding({ issueId: "definitely-not-an-id", evidence: {} }).whyItMatters;
  for (const issueId of SEO_AUDIT_IDS) {
    const explained = explainFinding({ issueId, evidence: {} });
    assert.notEqual(explained.whyItMatters, defaultWhy, `${issueId} has no explainFinding case (add one)`);
    const recs = deriveRecommendations({ id: "x", entityType: "page-issue", entityId: issueId, url: "https://example.com/", evidence: {}, source: "seo-audit", category: "x" });
    assert.equal(recs.length, 1, issueId);
    assert.notEqual(recs[0]!.type, "review_finding", `${issueId} has no recommendation (add one to SEO_AUDIT in issueRecommendations.ts)`);
  }
});

test("the Lighthouse audits the QA report named are in the table, across all four categories", () => {
  for (const id of ["button-name", "meta-viewport", "heading-order", "label-content-name-mismatch", "image-alt", "link-name", "color-contrast"]) {
    assert.equal(lighthouseGuide(id)?.category, "accessibility", id);
  }
  const categories = new Set<LighthouseCategory>(knownLighthouseAuditIds().map((id) => lighthouseGuide(id)!.category));
  assert.deepEqual([...categories].sort(), ["accessibility", "best-practices", "performance", "seo"]);
  assert.equal(lighthouseAuditId({ entityId: "lighthouse-desktop-heading-order" }), "heading-order");
});

// ---- Bug 6: one counting function for both views ---------------------------------------------------------

const qaFindings = [
  ...Array.from({ length: 5 }, (_, i) => ({ severity: "critical" as const, status: "new" as const, id: `c${i}` })),
  { severity: "warning" as const, status: "acknowledged" as const, id: "w" },
  { severity: "critical" as const, status: "fixed" as const, id: "fixed" },
];

test("SEO overview and Findings tab read the same numbers and words (QA: 7 'need review' vs 6 needing attention)", () => {
  const counts = countFindings(qaFindings);
  assert.equal(counts.needsAttention, 6);
  assert.equal(counts.critical, 5);
  assert.equal(counts.warning, 1);
  assert.equal(counts.awaitingVerification, 1, "the Fixed finding is excluded");
  assert.equal(findingCountSentence(counts), "6 findings need attention: 5 critical, 1 warning");

  const stats = Object.fromEntries(findingCountStats(counts).map((s) => [s.key, s]));
  assert.equal(stats.needsAttention!.label, "Needs attention");
  assert.equal(stats.needsAttention!.value, 6);
  assert.equal(stats.critical!.value, 5);
  assert.equal(stats.warning!.value, 1);
  // The same severity words in both: "critical", never "errors".
  assert.doesNotMatch(findingCountSentence(counts), /error/i);
});

test("count sentence: singular, none, and verified or fixed are not counted", () => {
  assert.equal(findingCountSentence(countFindings([{ severity: "warning", status: "new" }])), "1 finding needs attention: 1 warning");
  assert.equal(findingCountSentence(countFindings([{ severity: "critical", status: "verified" }, { severity: "warning", status: "fixed" }])), "No findings need attention");
  assert.equal(findingCountSentence(countFindings([{ severity: "critical", status: "failed" }, { severity: "critical", status: "new" }])), "2 findings need attention: 2 critical");
});

test("the SEO overview and Findings tab share the helpers (no second counting path)", () => {
  const analytics = readFileSync(new URL("../components/dashboard/AnalyticsPanel.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../components/dashboard/FindingsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(analytics, /countFindings\(storedFindings\.data\)/);
  assert.match(analytics, /findingCountSentence\(findingCounts\)/);
  assert.match(workspace, /findingCountStats\(counts\)/);
  assert.doesNotMatch(analytics, /auditErrors|auditWarnings/);
});

// ---- Low items ---------------------------------------------------------------------------------------------

test("finding titles show plain text, not markdown backticks", () => {
  const label = "`[user-scalable=\"no\"]` is used in the `<meta name=\"viewport\">` element";
  assert.equal(findingTitle({ evidence: { label }, recommendation: "x" }), "[user-scalable=\"no\"] is used in the <meta name=\"viewport\"> element");
  assert.equal(findingTitle({ evidence: {}, recommendation: "Use `alt` text. More." }), "Use alt text.");
  assert.equal(stripInlineCode("no code"), "no code");
});

test("the heading-order duplicate collapses to one finding with one severity", () => {
  const row = (entityId: string, severity: "critical" | "warning", url = "https://example.com/") => ({ source: "seo-audit", entityId, url, severity });
  const list = [
    row("lighthouse-mobile-heading-order", "critical"),
    row("meta-title-missing", "critical"),
    row("heading-order-skip", "warning"),
    row("lighthouse-desktop-heading-order", "critical"),
  ];
  const out = collapseDuplicateFindings(list);
  assert.deepEqual(out.map((f) => f.entityId), ["lighthouse-mobile-heading-order", "meta-title-missing"]);
  assert.deepEqual(out.filter((f) => /heading/.test(f.entityId)).map((f) => f.severity), ["critical"]);

  // On a tie the on-page check is kept; other pages and unrelated findings are untouched.
  const tie = collapseDuplicateFindings([row("lighthouse-mobile-heading-order", "warning"), row("heading-order-skip", "warning"), row("heading-order-skip", "warning", "https://example.com/b")]);
  assert.deepEqual(tie.map((f) => `${f.entityId}@${f.url}`), ["heading-order-skip@https://example.com/", "heading-order-skip@https://example.com/b"]);
  assert.equal(collapseDuplicateFindings([row("heading-h1-missing", "critical"), row("heading-h1-missing", "critical")]).length, 2);
});

test("counts follow the de-duplicated list the Findings tab shows", () => {
  const visible = collapseDuplicateFindings([
    { source: "seo-audit", entityId: "lighthouse-mobile-heading-order", url: "u", severity: "critical" as const, status: "new" as const },
    { source: "seo-audit", entityId: "heading-order-skip", url: "u", severity: "warning" as const, status: "new" as const },
  ]);
  assert.equal(countFindings(visible).needsAttention, 1);
});

test("Last audited label: UTC date and age, nothing when the date is missing", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  assert.equal(lastAuditedLabel("2026-10-06T08:30:00Z", now), "Last audited Oct 6, 2026 (16 days ago)");
  assert.equal(lastAuditedLabel("2026-10-22T01:00:00Z", now), "Last audited Oct 22, 2026 (today)");
  assert.equal(lastAuditedLabel("2026-10-21T01:00:00Z", now), "Last audited Oct 21, 2026 (yesterday)");
  assert.equal(lastAuditedLabel(undefined, now), null);
  assert.equal(lastAuditedLabel(null, now), null);
  assert.equal(lastAuditedLabel("not a date", now), null);
});

test("a Lighthouse score is shown out of 100; an absent one says Not measured, never 0", () => {
  assert.equal(lighthouseScoreLabel(0), "0/100");
  assert.equal(lighthouseScoreLabel(0.3), "30/100");
  assert.equal(lighthouseScoreLabel(null), "Not measured");
  assert.equal(lighthouseScoreLabel(undefined), "Not measured");
  assert.equal(lighthouseScoreLabel("0"), "Not measured");

  const rows = (evidence: Record<string, unknown>) => evidenceRowsForFinding({ source: "seo-audit", evidence });
  assert.deepEqual(rows({ auditId: "button-name", device: "mobile", score: 0 }).find((r) => r.key === "score"), { key: "score", label: "Lighthouse score", value: "0/100" });
  assert.equal(rows({ auditId: "button-name", device: "mobile", score: null }).find((r) => r.key === "score")!.value, "Not measured");
  // On-page findings keep their own evidence untouched.
  assert.equal(rows({ length: 80 }).find((r) => r.key === "length")!.value, 80);
});

// ---- Bug 7: Encoding ------------------------------------------------------------------------------------

test("Encoding reads Not measured when no Content-Encoding was seen, since the crawler asks for identity", () => {
  assert.equal(encodingLabel(undefined), "Not measured");
  assert.equal(encodingLabel(null), "Not measured");
  assert.equal(encodingLabel("  "), "Not measured");
  assert.equal(encodingLabel("br"), "br");
  assert.equal(encodingLabel(" gzip "), "gzip");
});

test("the guarded fetcher still pins Accept-Encoding: identity and never decompresses (why the header is not changed)", () => {
  const source = readFileSync(new URL("../lib/domain/net/safeFetch.ts", import.meta.url), "utf8");
  assert.match(source, /"accept-encoding": "identity"/);
  assert.doesNotMatch(source, /createGunzip|createBrotliDecompress|createInflate|from "node:zlib"/);
  const dashboard = readFileSync(new URL("../components/dashboard/AnalyticsPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(dashboard, /encoding \?\? "None"/);
});
