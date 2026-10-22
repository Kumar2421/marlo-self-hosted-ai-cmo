import test from "node:test";
import assert from "node:assert/strict";
import {
  findVanishedFindings, flagVanishedFindings, isVanished, vanishedNote, VANISHED_LINE,
  type VanishPorts,
} from "../lib/domain/findings/vanishedFindings.ts";
import { auditFindingInputs, saveAuditFindings } from "../lib/domain/findings/auditFindings.ts";
import { countFindings } from "../lib/domain/findings/findingDisplay.ts";
import { buildFixFirstView } from "../lib/domain/overview/fixFirst.ts";
import { evidenceRowsForFinding } from "../lib/domain/findings/evidenceDisplay.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

const PAGE = "https://example.com/pricing";
const NOW = "2026-10-22T10:00:00.000Z";

function finding(over: Partial<Finding> & { id: string }): Finding {
  return {
    projectId: "p1", source: "seo-audit", category: "meta-title", entityType: "page-issue", entityId: "meta-title-missing",
    url: PAGE, severity: "warning", evidence: { label: "Title missing" }, recommendation: "Add a title.", status: "new",
    firstSeen: NOW, lastSeen: NOW, resolvedAt: null, ...over,
  };
}
const audit = (issueIds: string[], over: Record<string, unknown> = {}) => ({
  url: PAGE, findings: issueIds.map((issueId) => ({ issueId })), checksRan: { lighthouse: false }, ...over,
});

const lh = { category: "lighthouse", entityId: "lighthouse-mobile-x" };
const cases: Array<{ name: string; findings: Finding[]; audit: ReturnType<typeof audit>; expected: string[] }> = [
  { name: "fixed issue vanishes", findings: [finding({ id: "a" })], audit: audit(["og-image-missing"]), expected: ["a"] },
  { name: "issue still reported does not vanish", findings: [finding({ id: "a" })], audit: audit(["meta-title-missing"]), expected: [] },
  { name: "in-progress and failed vanish too", findings: [finding({ id: "a", status: "fixing" }), finding({ id: "b", status: "acknowledged" }), finding({ id: "c", status: "failed" })], audit: audit([]), expected: ["a", "b", "c"] },
  { name: "fixed, verified are left alone", findings: [finding({ id: "a", status: "fixed" }), finding({ id: "b", status: "verified" })], audit: audit([]), expected: [] },
  { name: "other URL untouched", findings: [finding({ id: "a", url: "https://example.com/about" })], audit: audit([]), expected: [] },
  { name: "trailing slash is the same page", findings: [finding({ id: "a", url: PAGE + "/" })], audit: audit([]), expected: ["a"] },
  { name: "other sources untouched", findings: [finding({ id: "a", source: "search-console", category: "search-visibility" }), finding({ id: "b", source: "geo", category: "geo_readiness" })], audit: audit([]), expected: [] },
  { name: "PageSpeed missing: lighthouse findings do not vanish", findings: [finding({ id: "a", ...lh })], audit: audit([], { checksRan: { lighthouse: false } }), expected: [] },
  { name: "audit without checksRan: lighthouse does not vanish", findings: [finding({ id: "a", ...lh })], audit: audit([], { checksRan: undefined }), expected: [] },
  { name: "PageSpeed ran: absent lighthouse finding vanishes", findings: [finding({ id: "a", ...lh })], audit: audit([], { checksRan: { lighthouse: true } }), expected: ["a"] },
  { name: "PageSpeed ran: reported lighthouse finding stays", findings: [finding({ id: "a", ...lh })], audit: audit(["lighthouse-mobile-x"], { checksRan: { lighthouse: true } }), expected: [] },
  { name: "failed audit vanishes nothing", findings: [finding({ id: "a" })], audit: audit([], { failed: true }), expected: [] },
  { name: "redirected audit vanishes nothing", findings: [finding({ id: "a" })], audit: audit([], { finalUrl: "https://example.com/login" }), expected: [] },
  { name: "same-page final URL is fine", findings: [finding({ id: "a" })], audit: audit([], { finalUrl: PAGE + "/" }), expected: ["a"] },
];
for (const c of cases) {
  test(`findVanishedFindings: ${c.name}`, () => {
    assert.deepEqual(findVanishedFindings(c.findings, c.audit).map((f) => f.id), c.expected);
  });
}

// A fake store with the real semantics: upsert replaces evidence (and keeps the status),
// setEvidence touches evidence only and is conditional on the status read.
function fakeStore(initial: Finding[]) {
  const rows = new Map(initial.map((f) => [f.id, structuredClone(f)]));
  const calls: string[] = [];
  const ports: VanishPorts = {
    list: () => [...rows.values()].map((f) => structuredClone(f)),
    setEvidence: (f, evidence) => {
      const row = rows.get(f.id)!;
      if (row.status !== f.status) throw new Error("stale");
      calls.push(f.id);
      row.evidence = evidence;
    },
  };
  const upsert = async (input: { entityId: string; category: string; url: string; evidence: Record<string, unknown> }) => {
    const row = [...rows.values()].find((r) => r.entityId === input.entityId && r.category === input.category && r.url === input.url);
    if (row) { row.evidence = input.evidence; row.lastSeen = "later"; }
  };
  return { rows, calls, ports, upsert };
}

test("flagging writes evidence only: status and lastSeen unchanged, first flag date kept", async () => {
  const store = fakeStore([finding({ id: "a", status: "fixing" })]);
  assert.equal(await flagVanishedFindings(store.ports, "p1", audit([]), NOW), 1);
  const row = store.rows.get("a")!;
  assert.equal(row.status, "fixing");
  assert.equal(row.lastSeen, NOW);
  assert.deepEqual(row.evidence.vanished, { at: NOW, auditAt: NOW });
  assert.equal(row.evidence.label, "Title missing");
  // A later audit that also misses it does not rewrite the flag.
  assert.equal(await flagVanishedFindings(store.ports, "p1", audit([]), "2026-10-29T00:00:00.000Z"), 0);
  assert.deepEqual(row.evidence.vanished, { at: NOW, auditAt: NOW });
  assert.deepEqual(store.calls, ["a"]);
});

test("a reappearing issue clears the flag (the audit upsert rewrites the evidence)", async () => {
  const store = fakeStore([finding({ id: "a", status: "new" })]);
  await flagVanishedFindings(store.ports, "p1", audit([]), NOW);
  assert.equal(isVanished(store.rows.get("a")!), true);
  const reappear = { url: PAGE, findings: [{ issueId: "meta-title-missing", category: "meta-title", severity: "Warning" as const, label: "Title missing", evidence: {} }] };
  await saveAuditFindings(store.upsert, auditFindingInputs("p1", reappear));
  assert.equal(isVanished(store.rows.get("a")!), false);
  assert.equal("vanished" in store.rows.get("a")!.evidence, false);
});

test("a status change between read and write loses quietly; a broken store never throws", async () => {
  const store = fakeStore([finding({ id: "a", status: "new" })]);
  const racing: VanishPorts = { ...store.ports, setEvidence: () => { throw new Error("stale"); } };
  assert.equal(await flagVanishedFindings(racing, "p1", audit([]), NOW), 0);
  const broken: VanishPorts = { list: () => { throw new Error("db down"); }, setEvidence: () => undefined };
  assert.equal(await flagVanishedFindings(broken, "p1", audit([]), NOW), 0);
});

test("flag leaves other pages and a PSI-less audit's lighthouse findings unflagged", async () => {
  const store = fakeStore([
    finding({ id: "home", url: "https://example.com/" }),
    finding({ id: "lh", ...lh }),
    finding({ id: "gone" }),
  ]);
  await flagVanishedFindings(store.ports, "p1", audit([]), NOW);
  assert.deepEqual(store.calls, ["gone"]);
});

// View models
const flagged = (over: Partial<Finding> = {}) => finding({ id: "v", evidence: { label: "Title missing", vanished: { at: NOW, auditAt: NOW } }, ...over });

test("vanishedNote: shown for open flagged findings only", () => {
  assert.equal(vanishedNote(flagged()), VANISHED_LINE);
  assert.equal(vanishedNote(flagged({ status: "verified" })), null);
  assert.equal(vanishedNote(flagged({ status: "fixed" })), null);
  assert.equal(vanishedNote(finding({ id: "x" })), null);
});

test("counts: a vanished but unverified finding still needs attention", () => {
  assert.equal(countFindings([flagged(), finding({ id: "o", severity: "critical" })]).needsAttention, 2);
});

test("evidence panel does not show the raw vanished flag", () => {
  assert.equal(evidenceRowsForFinding(flagged()).some((r) => r.key === "vanished"), false);
});

test("Fix first: a vanished finding is a low 'Re-check' row below real fixes", () => {
  const real = finding({ id: "real", entityId: "heading-h1-missing", category: "heading-structure", severity: "warning", recommendation: "Add one H1 heading. More." });
  const view = buildFixFirstView({ hasWebsite: true, audit: "present", now: NOW, findings: { status: "ready", data: [flagged({ severity: "critical" }), real] } });
  assert.equal(view.kind, "actions");
  if (view.kind !== "actions") return;
  assert.equal(view.items[0].findingId, "real");
  assert.equal(view.items[1].findingId, "v");
  assert.equal(view.items[1].button, "Re-check");
  assert.match(view.items[1].sentence, /re-check/i);
});
