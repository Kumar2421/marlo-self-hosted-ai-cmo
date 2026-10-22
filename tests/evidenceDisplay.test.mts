import test from "node:test";
import assert from "node:assert/strict";
import { evidenceRowsForFinding, splitEvidenceRows, whyItMattersForFinding } from "../lib/domain/findings/evidenceDisplay.ts";

test("seo-audit findings render their own raw evidence, not analytics fields", () => {
  const finding = {
    source: "seo-audit",
    evidence: { label: "Meta title too long", whyItMatters: "Search engines truncate long titles.", current: "x".repeat(80), length: 80 },
  };
  const rows = evidenceRowsForFinding(finding);
  assert.deepEqual(rows.map((r) => r.key).sort(), ["current", "length"]);
  assert.equal(rows.find((r) => r.key === "length")?.label, "Length");
});

test("seo-audit whyItMatters is exposed separately, not duplicated in the row list", () => {
  const finding = { source: "seo-audit", evidence: { whyItMatters: "It matters because X.", label: "Y" } };
  assert.equal(whyItMattersForFinding(finding), "It matters because X.");
  assert.equal(evidenceRowsForFinding(finding).some((r) => r.key === "whyItMatters"), false);
});

test("analytics findings keep the original Clicks/Impressions/CTR/etc rendering", () => {
  const finding = {
    source: "search-console",
    evidence: {
      clicks: 12, impressions: 400, ctr: 0.03, position: 8.2,
      page: { meta: { indexable: true, canonical: "https://x.com" }, contentRelevance: { keywordRelevance: 72 }, serverTiming: { ttfbMs: 1800 } },
    },
  };
  const rows = evidenceRowsForFinding(finding);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.equal(byKey.clicks, 12);
  assert.equal(byKey.ctr, "3.0%");
  assert.equal(byKey.indexable, true);
  assert.equal(byKey.canonical, "https://x.com");
  assert.equal(byKey.keywordRelevance, "72%");
  assert.equal(byKey.ttfb, "1800 ms");
});

test("analytics findings never get a whyItMatters callout", () => {
  const finding = { source: "search-console", evidence: { clicks: 1 } };
  assert.equal(whyItMattersForFinding(finding), null);
});

test("missing canonical on an analytics finding still shows explicitly, not silently dropped", () => {
  const finding = { source: "search-console", evidence: { page: { meta: { canonical: null } } } };
  const rows = evidenceRowsForFinding(finding);
  assert.equal(rows.find((r) => r.key === "canonical")?.value, "Missing");
});

test("splitEvidenceRows moves the Lighthouse run details behind Details and drops nothing", () => {
  const finding = {
    source: "seo-audit",
    evidence: { label: "Buttons need names", auditId: "button-name", device: "mobile", mode: "diagnostic", score: null, displayValue: "3 elements" },
  };
  const rows = evidenceRowsForFinding(finding);
  const { main, details } = splitEvidenceRows(rows);
  assert.deepEqual(details.map((r) => r.key).sort(), ["auditId", "device", "mode", "score"]);
  assert.deepEqual(main.map((r) => r.key), ["displayValue"]);
  assert.equal(main.length + details.length, rows.length);
  assert.equal(details.find((r) => r.key === "score")?.value, "Not measured");
});

test("splitEvidenceRows leaves other findings untouched", () => {
  const rows = evidenceRowsForFinding({ source: "seo-audit", evidence: { label: "Title long", current: "x", length: 80, mode: "x" } });
  const { main, details } = splitEvidenceRows(rows);
  assert.equal(details.length, 0);
  assert.deepEqual(main, rows);
});
