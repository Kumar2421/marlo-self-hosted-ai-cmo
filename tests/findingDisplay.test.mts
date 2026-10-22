import test from "node:test";
import assert from "node:assert/strict";
import { countFindings, explainPriority, findingTitle, mergedPullRequestNote, pagePath } from "../lib/domain/findings/findingDisplay.ts";

test("findingTitle prefers the audit label", () => {
  assert.equal(findingTitle({ evidence: { label: "  Missing meta description " }, recommendation: "Add one. It helps." }), "Missing meta description");
});

test("findingTitle falls back to the first sentence of the recommendation", () => {
  assert.equal(findingTitle({ evidence: {}, recommendation: "Add a canonical tag. Search engines then pick the right page." }), "Add a canonical tag.");
  assert.equal(findingTitle({ evidence: { label: "   " }, recommendation: "Fix the title" }), "Fix the title");
});

test("findingTitle never returns an empty title", () => {
  assert.equal(findingTitle({ evidence: {}, recommendation: "" }), "Untitled finding");
});

test("pagePath shows just the path", () => {
  assert.equal(pagePath("https://example.com/blog/post?x=1#top"), "/blog/post");
  assert.equal(pagePath("https://example.com"), "/");
  assert.equal(pagePath(null), "No page");
  assert.equal(pagePath("not a url"), "not a url");
});

test("countFindings: verified no longer needs attention, severities count only open findings", () => {
  const counts = countFindings([
    { severity: "critical", status: "new" },
    { severity: "critical", status: "verified" },
    { severity: "warning", status: "fixing" },
    { severity: "warning", status: "failed" },
    { severity: "info", status: "acknowledged" },
  ]);
  assert.deepEqual(counts, { needsAttention: 4, awaitingVerification: 0, critical: 1, warning: 2, verified: 1 });
});

test("countFindings on nothing", () => {
  assert.deepEqual(countFindings([]), { needsAttention: 0, awaitingVerification: 0, critical: 0, warning: 0, verified: 0 });
});

test("countFindings: fixed findings are awaiting verification, not unresolved and not verified", () => {
  const counts = countFindings([
    { severity: "critical", status: "fixed" },
    { severity: "warning", status: "fixed" },
    { severity: "critical", status: "failed" },
    { severity: "warning", status: "verified" },
  ]);
  assert.deepEqual(counts, { needsAttention: 1, awaitingVerification: 2, critical: 1, warning: 0, verified: 1 });
  assert.equal(counts.needsAttention + counts.awaitingVerification + counts.verified, 4);
});

test("explainPriority spells out why a finding ranks where it does", () => {
  assert.equal(explainPriority({ severity: "critical", status: "new", url: "https://example.com/" }), "Critical, new, on your homepage");
  assert.equal(explainPriority({ severity: "warning", status: "failed", url: "https://example.com/blog/post?x=1" }), "Warning, still detected after a fix, on /blog/post");
  assert.equal(explainPriority({ severity: "info", status: "fixing", url: null }), "Info, being fixed");
  assert.equal(explainPriority({ severity: "critical", status: "fixed", url: "https://example.com" }), "Critical, awaiting re-check, on your homepage");
});

test("mergedPullRequestNote only promises what Marlo really does", () => {
  const base = { category: "x", entityId: "e", url: "https://example.com/", evidence: {} as Record<string, unknown> };
  const recheck = "Merged. Marlo re-checks this page about 24 hours after the merge and will mark it verified or still detected.";
  assert.equal(mergedPullRequestNote({ ...base, source: "seo-audit", entityId: "meta-title-missing" }), recheck);
  assert.equal(mergedPullRequestNote({ ...base, source: "geo", category: "geo_readiness", entityId: "llms-txt" }), recheck);
  assert.equal(mergedPullRequestNote({ ...base, source: "search-console", evidence: { opportunity: { type: "ctr" } } }), "Merged. Marlo is measuring what the change did.");
  // Lighthouse findings need a PageSpeed run, so they are never re-checked automatically.
  assert.match(mergedPullRequestNote({ ...base, source: "seo-audit", category: "lighthouse", entityId: "lighthouse-mobile-image-alt" }), /use Re-check/);
  assert.match(mergedPullRequestNote({ ...base, source: "search-console" }), /use Re-check/);
});
