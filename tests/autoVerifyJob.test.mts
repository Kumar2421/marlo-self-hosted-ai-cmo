import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_VERIFY_DELAY_MS, AUTO_VERIFY_MAX_ATTEMPTS, STILL_DETECTED_NOTE, autoVerifyDocType, latestImplementedAt, runAutoVerify,
  type AutoVerifyMarker, type AutoVerifyPorts, type FixedFinding,
} from "../lib/domain/findings/autoVerifyJob.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";
import type { FreshAuditFinding, VerifyCheckPorts } from "../lib/domain/findings/verifyFinding.ts";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function implementation(ms: number) {
  return { implementation: { via: "manual", implementedAt: iso(ms), baseline: null } };
}

function fixedItem(id: string, opts: { projectId?: string; implementedAgo?: number; source?: string } = {}): FixedFinding {
  const projectId = opts.projectId ?? "p1";
  const finding: Finding = {
    id,
    projectId,
    source: opts.source ?? "seo-audit",
    category: "meta-title",
    severity: "warning",
    entityType: "page-issue",
    entityId: "meta-title-too-long",
    url: "https://example.com/",
    evidence: { label: "Meta title too long" },
    recommendation: "Shorten it.",
    status: "fixed",
    firstSeen: iso(10 * DAY),
    lastSeen: iso(DAY),
    resolvedAt: null,
  };
  const ago = opts.implementedAgo ?? 2 * DAY;
  return { userId: "u1", projectId, finding, actionResults: [implementation(ago)] };
}

type Fake = {
  ports: AutoVerifyPorts;
  transitions: Array<[string, string]>;
  evidence: Array<{ id: string; evidence: Record<string, unknown> }>;
  markers: Map<string, Map<string, AutoVerifyMarker>>;
  checked: string[];
};

/** Fake ports. `audit` decides what a fresh SEO audit returns per finding id; a null result means the check is skipped. */
function fake(items: FixedFinding[], opts: {
  audit?: (id: string) => FreshAuditFinding[] | Error;
  failReadProject?: string;
  failTransitionFor?: string;
  failFinalizeFor?: string;
  /** The audit never settles (a hung background call). */
  hang?: boolean;
} = {}): Fake {
  const transitions: Array<[string, string]> = [];
  const evidence: Array<{ id: string; evidence: Record<string, unknown> }> = [];
  const markers = new Map<string, Map<string, AutoVerifyMarker>>();
  const checked: string[] = [];
  const ports: AutoVerifyPorts = {
    // The store returns only fixed findings; the fake mirrors that filter.
    listFixedFindings: async () => items.filter((i) => i.finding.status === "fixed"),
    readMarkers: async (scope) => {
      if (opts.failReadProject === scope.projectId) throw new Error("db unavailable");
      return markers.get(scope.projectId) ?? new Map();
    },
    writeMarker: async (scope, findingId, marker) => {
      const byFinding = markers.get(scope.projectId) ?? new Map<string, AutoVerifyMarker>();
      byFinding.set(findingId, marker);
      markers.set(scope.projectId, byFinding);
    },
    checkPorts: (item): VerifyCheckPorts => ({
      runSeoAudit: async () => {
        checked.push(item.finding.id);
        if (opts.hang) return new Promise<FreshAuditFinding[]>(() => {});
        const result = opts.audit?.(item.finding.id) ?? [];
        if (result instanceof Error) throw result;
        return result;
      },
      runGeoReadiness: async () => [],
    }),
    finalize: async (item, status, next) => {
      if (opts.failFinalizeFor === item.finding.id) throw new Error("atomic write failed");
      transitions.push([item.finding.id, status]);
      evidence.push({ id: item.finding.id, evidence: next });
    },
    transition: async (item, status) => {
      if (opts.failTransitionFor === item.finding.id) throw new Error("write failed");
      transitions.push([item.finding.id, status]);
    },
    saveEvidence: async (item, next) => {
      evidence.push({ id: item.finding.id, evidence: next });
    },
  };
  return { ports, transitions, evidence, markers, checked };
}

const budget = { budgetMs: 60_000, maxItems: 50, clock: () => 0 };

const stillThere: FreshAuditFinding = { issueId: "meta-title-too-long", category: "meta-title", severity: "Warning", label: "Meta title too long", evidence: {}, autoFixable: true };

test("latestImplementedAt reads the saved implementation and ignores malformed results", () => {
  assert.equal(latestImplementedAt([null, {}, { implementation: { implementedAt: "not a date" } }]), null);
  const older = iso(3 * DAY);
  const newer = iso(DAY);
  assert.equal(latestImplementedAt([{ implementation: { via: "manual", implementedAt: older, baseline: null } }, { implementation: { via: "manual", implementedAt: newer, baseline: null } }]), Date.parse(newer));
});

test("a fix is only checked once its change has been live for 24 hours", async () => {
  const fresh = fake([fixedItem("early", { implementedAgo: AUTO_VERIFY_DELAY_MS - 60_000 }), fixedItem("ready", { implementedAgo: AUTO_VERIFY_DELAY_MS + 60_000 })], { audit: () => [] });
  const summary = await runAutoVerify(fresh.ports, NOW, budget);
  assert.deepEqual(fresh.checked, ["ready"]);
  assert.equal(summary.verified, 1);
});

test("a gone issue verifies the finding and records the evidence", async () => {
  const f = fake([fixedItem("a")], { audit: () => [] });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, [["a", "verified"]]);
  assert.equal(f.evidence[0].evidence.autoVerify && (f.evidence[0].evidence.autoVerify as { outcome: string }).outcome, "verified");
  assert.equal(summary.verified, 1);
  assert.equal(summary.failed, 0);
});

test("a still-present issue fails the finding with the 'Still detected' note", async () => {
  const f = fake([fixedItem("a")], { audit: () => [stillThere] });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, [["a", "failed"]]);
  const auto = f.evidence[0].evidence.autoVerify as { outcome: string; note: string; checkedAt: string };
  assert.equal(auto.outcome, "failed");
  assert.equal(auto.note, STILL_DETECTED_NOTE);
  assert.equal(auto.checkedAt, NOW.toISOString());
  assert.equal(summary.failed, 1);
});

test("a check that cannot run is skipped and leaves the finding fixed", async () => {
  const f = fake([fixedItem("a")], { audit: () => new Error("network") });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, []);
  assert.equal(summary.skipped, 1);
  assert.equal(f.markers.get("p1")?.get("a")?.attempts, 1);
});

test("attempt cap: a finding is not checked after three attempts", async () => {
  const f = fake([fixedItem("a")], { audit: () => new Error("network") });
  f.markers.set("p1", new Map([["a", { attempts: AUTO_VERIFY_MAX_ATTEMPTS, lastCheckedAt: iso(3 * DAY) }]]));
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.checked, []);
  assert.equal(summary.skipped, 0);
});

test("idempotent marker: a rerun inside the recheck gap does not check again", async () => {
  const f = fake([fixedItem("a")], { audit: () => new Error("network") });
  await runAutoVerify(f.ports, NOW, budget);
  const again = await runAutoVerify(f.ports, NOW, budget);
  assert.equal(f.checked.length, 1);
  assert.equal(again.skipped, 0);
  assert.equal(f.markers.get("p1")?.get("a")?.attempts, 1);
});

test("a finding that was verified is not picked up again (status is the source of truth)", async () => {
  const items = [fixedItem("a")];
  const f = fake(items, { audit: () => [] });
  await runAutoVerify(f.ports, NOW, budget);
  items[0].finding.status = "verified";
  const later = await runAutoVerify(f.ports, new Date(NOW.getTime() + 2 * DAY), budget);
  assert.equal(f.checked.length, 1);
  assert.equal(later.verified, 0);
});

test("budget stop: the run stops once the time budget is spent and leaves the rest for later", async () => {
  let t = 0;
  const items = [fixedItem("a"), fixedItem("b"), fixedItem("c")];
  const f = fake(items, { audit: () => { t += 1000; return []; } });
  const summary = await runAutoVerify(f.ports, NOW, { budgetMs: 1500, maxItems: 50, clock: () => t, minAuditMs: 10 });
  assert.deepEqual(f.checked, ["a", "b"]);
  assert.equal(summary.verified, 2);
  assert.equal(summary.budgetSkipped, 1);
});

test("maxItems caps one run and the rest are counted as left over", async () => {
  const f = fake([fixedItem("a"), fixedItem("b"), fixedItem("c")], { audit: () => [] });
  const summary = await runAutoVerify(f.ports, NOW, { budgetMs: 60_000, maxItems: 1, clock: () => 0 });
  assert.equal(f.checked.length, 1);
  assert.equal(summary.budgetSkipped, 2);
});

test("rotation fairness: never-checked first, then the oldest check", async () => {
  const f = fake([fixedItem("recent"), fixedItem("never"), fixedItem("old")], { audit: () => new Error("network") });
  f.markers.set("p1", new Map([
    ["recent", { attempts: 1, lastCheckedAt: iso(DAY) }],
    ["old", { attempts: 1, lastCheckedAt: iso(4 * DAY) }],
  ]));
  await runAutoVerify(f.ports, NOW, { budgetMs: 60_000, maxItems: 2, clock: () => 0 });
  assert.deepEqual(f.checked, ["never", "old"]);
});

test("failure isolation: a project whose markers cannot be read does not stop the others", async () => {
  const f = fake([fixedItem("bad", { projectId: "p-bad" }), fixedItem("good", { projectId: "p-good" })], { audit: () => [], failReadProject: "p-bad" });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, [["good", "verified"]]);
  assert.equal(summary.errored, 1);
  assert.equal(summary.verified, 1);
});

test("atomic finalize failure is isolated and the rest of the run continues", async () => {
  const f = fake([fixedItem("a"), fixedItem("b")], { audit: () => [], failFinalizeFor: "a" });
  const summary = await runAutoVerify(f.ports, NOW, budget);
  assert.deepEqual(f.transitions, [["b", "verified"]]);
  assert.deepEqual(f.evidence.map((entry) => entry.id), ["b"]);
  assert.equal(summary.errored, 1);
});

test("the marker key is per finding", () => {
  assert.equal(autoVerifyDocType("finding_1"), "auto_verify:finding_1");
});

test("a hung audit is cut off at the timeout: the phase returns within budget and the item is skipped", async () => {
  const f = fake([fixedItem("a")], { hang: true });
  const started = Date.now();
  const summary = await runAutoVerify(f.ports, NOW, { budgetMs: 400, maxItems: 10, auditTimeoutMs: 50, minAuditMs: 20 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 400 + 1000, `returned in ${elapsed} ms`);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(f.transitions, []);
  // A timeout counts as one attempt, so a permanently slow page stops after the attempt cap.
  assert.equal(f.markers.get("p1")?.get("a")?.attempts, 1);
});

test("budget guard: no audit starts without the minimum budget, and no marker is written", async () => {
  const f = fake([fixedItem("a")], { audit: () => [] });
  const summary = await runAutoVerify(f.ports, NOW, { budgetMs: 100, maxItems: 10, minAuditMs: 9_000 });
  assert.deepEqual(f.checked, []);
  assert.equal(summary.budgetSkipped, 1);
  assert.equal(f.markers.get("p1")?.get("a"), undefined);
});

test("findings the verifier always skips never take a slot under the cap or burn an attempt", async () => {
  const lighthouse = fixedItem("lh");
  lighthouse.finding.category = "lighthouse";
  lighthouse.finding.entityId = "lighthouse-mobile-image-alt";
  const searchConsole = fixedItem("sc", { source: "search-console" });
  const noPage = fixedItem("np");
  noPage.finding.url = null;
  // "lh", "np" and "sc" sort before "real", so without the filter they would take the single slot.
  const f = fake([lighthouse, searchConsole, noPage, fixedItem("real")], { audit: () => [] });
  const summary = await runAutoVerify(f.ports, NOW, { budgetMs: 60_000, maxItems: 1, clock: () => 0 });
  assert.deepEqual(f.checked, ["real"]);
  assert.deepEqual(f.transitions, [["real", "verified"]]);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.budgetSkipped, 0);
  for (const id of ["lh", "sc", "np"]) assert.equal(f.markers.get("p1")?.get(id), undefined);
});
