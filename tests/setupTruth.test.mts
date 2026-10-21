import test from "node:test";
import assert from "node:assert/strict";
import {
  assessGeneratedDocument,
  blockedBy,
  finalSetupLine,
  summarizeDocumentRun,
  type DocOutcome,
} from "../lib/domain/project/setupRun.ts";
import { deriveSetupChecklist, latestOnPageScore } from "../lib/domain/project/setupChecklist.ts";
import { needsOnboarding } from "../lib/domain/project/onboardingGate.ts";

const FULL = "# Product\n\n" + "Marlo audits your site and tells you what to fix first. ".repeat(6) + "\n\n- Ships weekly.";

const o = (key: DocOutcome["key"], title: string, status: DocOutcome["status"]): DocOutcome => ({ key, title, status });

test("assessGeneratedDocument rejects empty and whitespace streams (audit D4/D5)", () => {
  assert.equal(assessGeneratedDocument("").ok, false);
  assert.equal(assessGeneratedDocument("  \n ").ok, false);
});

test("assessGeneratedDocument rejects short, truncated, unclosed-fence and half-table output", () => {
  assert.equal(assessGeneratedDocument("# Title\n\nShort.").ok, false);
  assert.equal(assessGeneratedDocument(FULL + "\n\nAnd then the").ok, false);
  assert.equal(assessGeneratedDocument(FULL + " Pricing starts at,").ok, false);
  assert.equal(assessGeneratedDocument(FULL + "\n```js\nconst a = 1;").ok, false);
  assert.equal(assessGeneratedDocument(FULL + "\n| a | b |\n| c | d").ok, false);
});

test("assessGeneratedDocument accepts a complete document", () => {
  assert.deepEqual(assessGeneratedDocument(FULL), { ok: true });
  assert.deepEqual(assessGeneratedDocument(FULL + "\n```js\nx\n```\n"), { ok: true });
});

test("blockedBy: dependents wait for Product Info (audit D6)", () => {
  const run = [o("product-info", "Product Information", "failed")];
  assert.equal(blockedBy("marketing-strategy", run), "Product Information");
  assert.equal(blockedBy("content-strategy", run), "Product Information");
  assert.equal(blockedBy("design-guide", run), "Product Information");
  assert.equal(blockedBy("competitor-analysis", run), null);
  assert.equal(blockedBy("product-info", run), null);
});

test("blockedBy: Design Guide also needs Marketing Strategy, blocked counts as unmet", () => {
  const run = [o("product-info", "Product Information", "ready"), o("marketing-strategy", "Marketing Strategy", "blocked")];
  assert.equal(blockedBy("design-guide", run), "Marketing Strategy");
  assert.equal(blockedBy("design-guide", [o("product-info", "P", "ready"), o("marketing-strategy", "M", "ready")]), null);
});

test("summarizeDocumentRun words partial failure honestly (audit probe: '4 of 6 ... 2 failed')", () => {
  const s = summarizeDocumentRun([
    o("product-info", "Product Information", "ready"),
    o("marketing-strategy", "Marketing Strategy", "ready"),
    o("competitor-analysis", "Competitor Analysis", "ready"),
    o("competitor-comparison", "Competitor Comparison", "ready"),
    o("content-strategy", "Content Strategy", "failed"),
    o("design-guide", "Design Guide", "failed"),
  ]);
  assert.equal(s.ready, 4);
  assert.equal(s.hasProblems, true);
  assert.match(s.text, /^4 of 6 documents ready, 2 failed \(Content Strategy, Design Guide\): open Context to retry\.$/);
});

test("summarizeDocumentRun: all ready has no problems; no-competitor skips are not problems", () => {
  const ok = summarizeDocumentRun([o("product-info", "Product Information", "ready")]);
  assert.equal(ok.hasProblems, false);
  assert.equal(ok.text, "1 of 1 documents ready.");
  const skip = summarizeDocumentRun([
    o("product-info", "Product Information", "ready"),
    o("competitor-analysis", "Competitor Analysis", "skipped"),
  ]);
  assert.equal(skip.hasProblems, false);
  assert.match(skip.text, /1 skipped \(Competitor Analysis: no competitors yet\)/);
});

test("finalSetupLine says complete only with zero problems", () => {
  assert.equal(finalSetupLine([]).ok, true);
  assert.match(finalSetupLine([]).text, /^Setup complete/);
  const bad = finalSetupLine(["site crawl failed", "2 documents failed"]);
  assert.equal(bad.ok, false);
  assert.match(bad.text, /^Setup finished with problems: site crawl failed; 2 documents failed\./);
});

test("deriveSetupChecklist: only missing things appear", () => {
  assert.deepEqual(deriveSetupChecklist({ auditCount: 1, description: "x", documentCount: 3, competitorCount: 2 }), []);
  const ids = (f: Parameters<typeof deriveSetupChecklist>[0]) => deriveSetupChecklist(f).map((s) => s.id);
  assert.deepEqual(ids({ auditCount: 0, description: "", documentCount: 0, competitorCount: 0 }), [
    "audit",
    "description",
    "documents",
    "competitors",
  ]);
  assert.deepEqual(ids({ auditCount: 1, description: "   ", documentCount: 1, competitorCount: 1 }), ["description"]);
  const comp = deriveSetupChecklist({ auditCount: 1, description: "x", documentCount: 1, competitorCount: 0 });
  assert.equal(comp[0].optional, true);
});

test("latestOnPageScore reads the real score, never invents one (audit D2: hard-coded 97)", () => {
  assert.equal(latestOnPageScore([]), null);
  assert.equal(latestOnPageScore([{ url: "https://a.com", payload: { technical: {} } }]), null);
  assert.equal(latestOnPageScore([{ url: "https://a.com", payload: "not json" }]), null);
  assert.equal(
    latestOnPageScore([
      { url: "https://a.com", created_at: "2026-01-01", payload: { technical: { onPageScore: 40 } } },
      { url: "https://a.com", created_at: "2026-02-01", payload: JSON.stringify({ technical: { onPageScore: 72.4 } }) },
    ]),
    72,
  );
});

test("latestOnPageScore prefers the audit for the project url", () => {
  const rows = [
    { url: "https://other.com/", created_at: "2026-03-01", payload: { technical: { onPageScore: 10 } } },
    { url: "https://a.com", created_at: "2026-01-01", payload: { technical: { onPageScore: 88 } } },
  ];
  assert.equal(latestOnPageScore(rows, "a.com"), 88);
});

test("needsOnboarding: only when there are no projects at all (audit D8)", () => {
  const base = { projectsCount: 0, activeProjectId: null, error: "No active project" };
  assert.equal(needsOnboarding(base), true);
  assert.equal(needsOnboarding({ ...base, projectsCount: 2 }), false, "has projects but none active");
  assert.equal(needsOnboarding({ ...base, activeProjectId: "p1" }), false);
  assert.equal(needsOnboarding({ ...base, loading: true }), false);
  assert.equal(needsOnboarding({ ...base, error: "Internal error" }), false, "a real failure is not onboarding");
  assert.equal(needsOnboarding({ ...base, error: null }), false);
});
