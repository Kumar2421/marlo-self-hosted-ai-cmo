import test from "node:test";
import assert from "node:assert/strict";
import { buildFixFirstView, pickInitialTab, plainSentence, FIX_FIRST_ERROR } from "../lib/domain/overview/fixFirst.ts";
import type { RankFinding } from "../lib/domain/overview/rankNextActions.ts";

const NOW = "2026-10-21T12:00:00.000Z";
function f(id: string, over: Partial<RankFinding> = {}): RankFinding {
  return {
    id,
    status: "new",
    severity: "warning",
    source: "seo-audit",
    entityId: "heading-h1-missing",
    firstSeen: NOW,
    lastSeen: NOW,
    recommendation: "Add one H1 heading. More.",
    evidence: {},
    ...over,
  };
}
const base = { hasWebsite: true, audit: "present" as const, now: NOW };

test("hidden without a website", () => {
  assert.deepEqual(buildFixFirstView({ ...base, hasWebsite: false, findings: { status: "ready", data: [] } }), { kind: "hidden" });
});

test("loading while findings load, never an empty state", () => {
  assert.equal(buildFixFirstView({ ...base, findings: { status: "pending" } }).kind, "loading");
});

test("error with the plain message", () => {
  assert.deepEqual(buildFixFirstView({ ...base, findings: { status: "error" } }), { kind: "error", message: FIX_FIRST_ERROR });
});

test("same issue across pages is one row with a count; most severe group first; button opens its top finding", () => {
  const view = buildFixFirstView({
    ...base,
    findings: {
      status: "ready",
      data: [
        f("a", { severity: "info", url: "https://x.test/a" }),
        f("b", { severity: "critical", url: "https://x.test/b" }),
        f("c", { url: "https://x.test/c" }),
        f("d", { severity: "info", url: "https://x.test/d" }),
      ],
    },
  });
  assert.equal(view.kind, "actions");
  if (view.kind !== "actions") return;
  assert.equal(view.items.length, 1);
  assert.equal(view.moreCount, 0);
  assert.equal(view.items[0].findingId, "b");
  assert.equal(view.items[0].count, 4);
  assert.equal(view.items[0].sentence, "Add one H1 heading (4 pages)");
  assert.equal(view.items[0].button, "Open");
});

test("at most two rows; the rest become a more-in-Findings count", () => {
  const kinds = ["heading-h1-missing", "meta-title-missing", "canonical-missing", "og-image-missing"];
  const view = buildFixFirstView({
    ...base,
    findings: {
      status: "ready",
      data: kinds.map((k, i) => f(`f${i}`, { entityId: k, recommendation: `Fix thing number ${i}. More.`, severity: i === 0 ? "critical" : "warning" })),
    },
  });
  assert.equal(view.kind, "actions");
  if (view.kind !== "actions") return;
  assert.equal(view.items.length, 2);
  assert.equal(view.moreCount, 2);
  assert.equal(view.items[0].findingId, "f0");
  assert.ok(view.items.every((i) => !/^fix:/i.test(i.sentence) && i.count === 1 && !i.sentence.includes("(")));
});

test("plainSentence strips the ranking prefixes and the trailing period", () => {
  assert.equal(plainSentence("Fix: Add a meta description."), "Add a meta description");
  assert.equal(plainSentence("Let Marlo fix: add a title"), "Add a title");
  assert.equal(plainSentence("Check that the fix worked: X"), "Check that the fix worked: X");
});

test("verified findings are not work: clear when the audit exists", () => {
  assert.equal(buildFixFirstView({ ...base, findings: { status: "ready", data: [f("a", { status: "verified" })] } }).kind, "clear");
});

test("no findings and no audit says no audit yet; with an audit says nothing needs attention", () => {
  assert.equal(buildFixFirstView({ ...base, audit: "missing", findings: { status: "ready", data: [] } }).kind, "no_audit");
  assert.equal(buildFixFirstView({ ...base, audit: "present", findings: { status: "ready", data: [] } }).kind, "clear");
});

test("audit still loading is loading, audit failing is an error (never 'nothing needs attention')", () => {
  assert.equal(buildFixFirstView({ ...base, audit: "pending", findings: { status: "ready", data: [] } }).kind, "loading");
  assert.equal(buildFixFirstView({ ...base, audit: "error", findings: { status: "ready", data: [] } }).kind, "error");
});

test("findings still show when the audit is missing", () => {
  assert.equal(buildFixFirstView({ ...base, audit: "missing", findings: { status: "ready", data: [f("a")] } }).kind, "actions");
});

test("does not mutate input", () => {
  const data = [f("a"), f("b")];
  const copy = JSON.parse(JSON.stringify(data));
  buildFixFirstView({ ...base, findings: { status: "ready", data } });
  assert.deepEqual(data, copy);
});

const TABS = ["SEO", "Links", "Findings"] as const;
const pick = (saved: string | null, open: number | null) =>
  pickInitialTab({ saved, tabs: TABS, openFindings: open, fallback: "SEO", findingsTab: "Findings" });

test("default tab: saved choice wins, then Findings when open, else SEO, null while unknown", () => {
  assert.equal(pick("Links", 5), "Links");
  assert.equal(pick("SEO", 5), "SEO");
  assert.equal(pick(null, 5), "Findings");
  assert.equal(pick(null, 0), "SEO");
  assert.equal(pick(null, null), null);
  assert.equal(pick("Bogus", 2), "Findings");
  assert.equal(pick("Links", null), "Links");
});
