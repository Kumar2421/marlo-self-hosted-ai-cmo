import test from "node:test";
import assert from "node:assert/strict";
import { decideRecheck } from "../lib/domain/findings/recheckDecision.ts";
import { applyRecheck, type FindingRepository } from "../lib/domain/findings/findingService.ts";
import { verifyFinding, isAutoVerifiable, type VerifyCheckPorts } from "../lib/domain/findings/verifyFinding.ts";
import { AUTO_VERIFY_MAX_ATTEMPTS, AUTO_VERIFY_RECHECK_GAP_MS, runAutoVerify, type AutoVerifyMarker, type AutoVerifyPorts, type FixedFinding } from "../lib/domain/findings/autoVerifyJob.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";
import { storedGeoGapVerdictPort } from "../lib/domain/geo/geoGapPort.ts";
import { geoGapEntityId } from "../lib/domain/geo/geoGaps.ts";
import type { GeoRunRow } from "../lib/domain/geo/types.ts";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const PROMPT = "best crm for a small team";

function runRow(over: Partial<GeoRunRow> & { ago?: number } = {}): GeoRunRow {
  const { ago, ...rest } = over;
  return {
    prompt: PROMPT, engine: "Gemini", method: "gemini-grounded", runAt: iso(ago ?? DAY),
    mentioned: false, cited: false, competitors: [], sources: [], answerExcerpt: "", ...rest,
  };
}

function gap(status: Finding["status"], over: Partial<Finding> = {}): Finding {
  return {
    id: "gap1", projectId: "p1", source: "geo", category: "geo_gap", severity: "warning", entityType: "prompt",
    entityId: geoGapEntityId(PROMPT), url: "https://acme.com/", evidence: { prompt: PROMPT, method: "gemini-grounded" },
    recommendation: "Publish a page.", status, firstSeen: iso(5 * DAY), lastSeen: iso(DAY), resolvedAt: null, ...over,
  };
}

/** Counts store reads so a test can prove only stored rows are read (no provider port exists). */
function portsOver(rows: GeoRunRow[], calls: { reads: string[] } = { reads: [] }): VerifyCheckPorts {
  return {
    runSeoAudit: async () => { throw new Error("no audit expected"); },
    runGeoReadiness: async () => { throw new Error("no readiness expected"); },
    geoGapVerdict: storedGeoGapVerdictPort((since) => { calls.reads.push(since); return rows.filter((r) => r.runAt >= since); }),
  };
}

function repoFor(f: Finding) {
  const state = { current: f };
  const repo = {
    state,
    get: () => state.current,
    list: () => [state.current],
    transition: (_p: string, _i: string, status: Finding["status"]) => (state.current = { ...state.current, status }),
    refresh: (_p: string, _i: string, input: Partial<Finding>) => (state.current = { ...state.current, ...input }),
  };
  return repo as unknown as FindingRepository & { state: { current: Finding } };
}

test("manual re-check: a later run naming the project verifies the gap through applyRecheck", async () => {
  const finding = gap("fixed");
  const calls = { reads: [] as string[] };
  const decision = await decideRecheck(portsOver([runRow({ ago: DAY, mentioned: true })], calls), finding, NOW);
  assert.ok(decision.kind === "checked" && decision.outcome === "verified");
  const repo = repoFor(finding);
  await applyRecheck(repo, "p1", "gap1", decision.result);
  assert.equal(repo.state.current.status, "verified");
  assert.equal((repo.state.current.evidence.verification as { outcome: string }).outcome, "verified");
  assert.equal(repo.state.current.evidence.prompt, PROMPT, "gap evidence is kept");
  assert.deepEqual(calls.reads, [finding.firstSeen], "only stored rows since first_seen are read");
});

test("manual re-check: a later run that still misses fails a fixed gap", async () => {
  const finding = gap("fixed");
  const decision = await decideRecheck(portsOver([runRow({ ago: DAY })]), finding, NOW);
  assert.ok(decision.kind === "checked" && decision.outcome === "failed");
  const repo = repoFor(finding);
  await applyRecheck(repo, "p1", "gap1", decision.result);
  assert.equal(repo.state.current.status, "failed");
});

test("manual re-check: no run after first_seen is 'fix pending' and changes nothing", async () => {
  const decision = await decideRecheck(portsOver([runRow({ ago: 6 * DAY, mentioned: true })]), gap("fixed"), NOW);
  assert.ok(decision.kind === "skipped");
  assert.match(decision.reason, /Fix pending/);
});

test("manual re-check: a later miss on a gap not marked fixed stays pending (S8: failed only when fixed)", async () => {
  for (const status of ["new", "acknowledged", "fixing"] as const) {
    const decision = await decideRecheck(portsOver([runRow({ ago: DAY })]), gap(status), NOW);
    assert.ok(decision.kind === "skipped", status);
    assert.match(decision.reason, /Fix pending/);
  }
  const verified = await decideRecheck(portsOver([runRow({ ago: DAY, mentioned: true })]), gap("new"), NOW);
  assert.ok(verified.kind === "checked" && verified.outcome === "verified");
});

test("the verdict ignores the other method and other prompts", async () => {
  const rows = [runRow({ ago: DAY, mentioned: true, method: "simulated" }), runRow({ ago: DAY, mentioned: true, prompt: "something else" })];
  const decision = await decideRecheck(portsOver(rows), gap("fixed"), NOW);
  assert.equal(decision.kind, "skipped");
});

test("regression: verifyFinding without the geoGapVerdict port still returns skipped", async () => {
  const bare: VerifyCheckPorts = { runSeoAudit: async () => [], runGeoReadiness: async () => [] };
  const result = await verifyFinding(bare, gap("fixed"), NOW);
  assert.equal(result.outcome, "skipped");
  const decision = await decideRecheck(bare, gap("fixed"), NOW);
  assert.equal(decision.kind, "skipped");
});

test("a finding without first_seen is never decided from stored rows", async () => {
  const port = storedGeoGapVerdictPort(() => [runRow({ mentioned: true })]);
  assert.equal(await port({ entityId: geoGapEntityId(PROMPT), evidence: { prompt: PROMPT } }), "no-new-runs");
});

test("geo_gap findings are auto-verifiable without a url", () => {
  assert.equal(isAutoVerifiable({ ...gap("fixed"), url: null }), true);
});

// ---- auto-verify job candidates ----

type Fake = {
  ports: AutoVerifyPorts;
  transitions: Array<[string, string]>;
  evidence: Map<string, Record<string, unknown>>;
  markers: Map<string, AutoVerifyMarker>;
  audits: string[];
  counts: { reads: number };
};

function item(finding: Finding, actionResults: FixedFinding["actionResults"] = []): FixedFinding {
  return { userId: "u1", projectId: "p1", finding, actionResults };
}

function fake(items: FixedFinding[], opts: { runs?: GeoRunRow[]; markers?: Record<string, AutoVerifyMarker>; auditHas?: string[] } = {}): Fake {
  const f: Fake = { ports: null as never, transitions: [], evidence: new Map(), markers: new Map(Object.entries(opts.markers ?? {})), audits: [], counts: { reads: 0 } };
  f.ports = {
    listFixedFindings: async () => items,
    readMarkers: async () => new Map(f.markers),
    writeMarker: async (_s, id, m) => { f.markers.set(id, m); },
    checkPorts: (it) => ({
      runSeoAudit: async () => {
        f.audits.push(it.finding.id);
        return (opts.auditHas ?? []).map((issueId) => ({ issueId, category: "meta-title", severity: "Warning", label: "x", evidence: {}, autoFixable: true }));
      },
      runGeoReadiness: async () => [],
      geoGapVerdict: storedGeoGapVerdictPort((since) => { f.counts.reads++; return (opts.runs ?? []).filter((r) => r.runAt >= since); }),
    }),
    finalize: async (it, status, ev) => { f.transitions.push([it.finding.id, status]); f.evidence.set(it.finding.id, ev); },
    transition: async () => {},
    saveEvidence: async (it, ev) => { f.evidence.set(it.finding.id, ev); },
  };
  return f;
}

const budget = { budgetMs: 60_000, maxItems: 50, clock: () => 0 };

test("job: a fixed geo gap without a newer run is skipped and spends no attempt, skip or marker", async () => {
  const f = fake([item(gap("fixed"))], { runs: [runRow({ ago: 6 * DAY, mentioned: true })] });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, []);
  assert.equal(f.markers.size, 0);
  assert.equal(summary.skipped, 0);
  assert.equal(f.audits.length, 0);
});

test("job: a fixed geo gap with a newer mentioning run is verified with no implementation delay", async () => {
  const f = fake([item(gap("fixed"))], { runs: [runRow({ ago: DAY, mentioned: true })] });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, [["gap1", "verified"]]);
  assert.equal(summary.verified, 1);
  assert.equal(f.markers.get("gap1")?.attempts, 1);
  assert.equal(f.audits.length, 0, "no page audit for a gap");
});

test("job: a fixed geo gap with a newer run that still misses is failed", async () => {
  const f = fake([item(gap("fixed"))], { runs: [runRow({ ago: DAY })] });
  await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, [["gap1", "failed"]]);
});

test("job: a gap still 'fixing' is only auto-closed by a mentioning run, never failed", async () => {
  const miss = fake([item(gap("fixing"))], { runs: [runRow({ ago: DAY })] });
  await runAutoVerify(miss.ports, NOW, budget);
  assert.deepEqual(miss.transitions, []);
  assert.equal(miss.markers.size, 0);
  const hit = fake([item(gap("fixing"))], { runs: [runRow({ ago: DAY, mentioned: true })] });
  await runAutoVerify(hit.ports, NOW, budget);
  assert.deepEqual(hit.transitions, [["gap1", "verified"]]);
});

test("job: a gap that is new or acknowledged is never a candidate", async () => {
  const f = fake([item(gap("new")), item(gap("acknowledged", { id: "gap2" }))], { runs: [runRow({ ago: DAY, mentioned: true })] });
  await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, []);
  assert.equal(f.counts.reads, 0);
});

test("job: geo gap respects the attempt cap and the recheck gap", async () => {
  const runs = [runRow({ ago: DAY, mentioned: true })];
  const capped = fake([item(gap("fixed"))], { runs, markers: { gap1: { attempts: AUTO_VERIFY_MAX_ATTEMPTS, lastCheckedAt: iso(10 * DAY) } } });
  await runAutoVerify(capped.ports, NOW, budget);
  assert.deepEqual(capped.transitions, []);
  const recent = fake([item(gap("fixed"))], { runs, markers: { gap1: { attempts: 1, lastCheckedAt: iso(AUTO_VERIFY_RECHECK_GAP_MS - 60_000) } } });
  await runAutoVerify(recent.ports, NOW, budget);
  assert.deepEqual(recent.transitions, []);
});

test("job: a store read error on a gap is a silent skip, not a decided outcome", async () => {
  const f = fake([item(gap("fixed"))]);
  const original = f.ports.checkPorts;
  f.ports.checkPorts = (it) => ({ ...original(it), geoGapVerdict: async () => { throw new Error("db down"); } });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, []);
  assert.equal(summary.errored, 0);
  assert.equal(f.markers.size, 0);
});

function vanishedFinding(status: Finding["status"], at = iso(DAY)): Finding {
  return {
    id: "v1", projectId: "p1", source: "seo-audit", category: "meta-title", severity: "warning", entityType: "page-issue",
    entityId: "meta-title-too-long", url: "https://acme.com/", evidence: { label: "Meta title", vanished: { at, auditAt: at } },
    recommendation: "Shorten it.", status, firstSeen: iso(9 * DAY), lastSeen: iso(DAY), resolvedAt: null,
  };
}

test("job: a vanished finding is verified only by a real re-audit that no longer flags it", async () => {
  const at = iso(DAY);
  const f = fake([item(vanishedFinding("new", at))], { auditHas: [] });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.audits, ["v1"]);
  assert.deepEqual(f.transitions, [["v1", "verified"]]);
  assert.equal(summary.verified, 1);
  assert.equal(f.markers.get("v1")?.vanishedAt, at);
});

test("job: a vanished finding the re-audit still flags keeps its status, drops the flag, and is not retried for that flag", async () => {
  const at = iso(DAY);
  const f = fake([item(vanishedFinding("acknowledged", at))], { auditHas: ["meta-title-too-long"] });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, [], "no status change");
  assert.equal(summary.stillDetected, 1);
  const ev = f.evidence.get("v1")!;
  assert.equal("vanished" in ev, false);
  assert.equal((ev.autoVerify as { outcome: string }).outcome, "failed");
  // Same flag again: not checked twice.
  const again = fake([item(vanishedFinding("acknowledged", at))], { auditHas: [], markers: { v1: { attempts: 1, lastCheckedAt: iso(3 * DAY), vanishedAt: at } } });
  await runAutoVerify(again.ports, NOW, budget);
  assert.deepEqual(again.audits, []);
});

test("job: a skipped vanished check (page unreachable) also counts as the one try for that flag", async () => {
  const at = iso(DAY);
  const f = fake([item(vanishedFinding("new", at))]);
  const original = f.ports.checkPorts;
  f.ports.checkPorts = (it) => ({ ...original(it), runSeoAudit: async () => { throw new Error("boom"); } });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.equal(summary.skipped, 1);
  assert.equal(f.markers.get("v1")?.vanishedAt, at);
  const next = new Date(NOW.getTime() + 2 * DAY);
  const second = fake([item(vanishedFinding("new", at))], { auditHas: [], markers: { v1: f.markers.get("v1")! } });
  await runAutoVerify(second.ports, next, budget);
  assert.deepEqual(second.audits, []);
});

test("job: a new vanished flag is checked again, but still under the attempt cap", async () => {
  const oldAt = iso(8 * DAY);
  const f = fake([item(vanishedFinding("new", iso(DAY)))], { auditHas: [], markers: { v1: { attempts: 1, lastCheckedAt: iso(5 * DAY), vanishedAt: oldAt } } });
  await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.audits, ["v1"]);
  const capped = fake([item(vanishedFinding("new", iso(DAY)))], { auditHas: [], markers: { v1: { attempts: AUTO_VERIFY_MAX_ATTEMPTS, lastCheckedAt: iso(5 * DAY), vanishedAt: oldAt } } });
  await runAutoVerify(capped.ports, NOW, budget);
  assert.deepEqual(capped.audits, []);
});

test("job: lighthouse vanished findings are never auto-checked (a crawl cannot prove their absence)", async () => {
  const lh = { ...vanishedFinding("new"), category: "lighthouse", entityId: "lighthouse-mobile-x" };
  const f = fake([item(lh)], { auditHas: [] });
  await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.audits, []);
});
