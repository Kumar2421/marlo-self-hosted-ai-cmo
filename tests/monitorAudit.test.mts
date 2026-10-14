import test from "node:test";
import assert from "node:assert/strict";
import { auditFindingInputs, type AuditFindingInput, type AuditLike } from "../lib/domain/findings/auditFindings.ts";
import {
  MONITOR_INTERVAL_MS, MONITOR_MAX_EXTRA_PAGES, pagesToAudit, runMonitorAudit, type MonitorPorts, type MonitorScope,
} from "../lib/domain/findings/monitorAudit.ts";
import type { Finding, FindingStatus } from "../lib/domain/findings/findingTypes.ts";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const SITE = "https://example.com";

const titleIssue = { issueId: "meta-title-too-long", category: "meta-title", severity: "Warning" as const, label: "Meta title too long", evidence: { length: 80 } };
const canonicalIssue = { issueId: "canonical-missing", category: "canonical", severity: "Error" as const, label: "Canonical missing", evidence: {} };

function scope(projectId: string, lastRunAt: string | null = null): MonitorScope {
  return { userId: "u1", projectId, siteUrl: SITE, lastRunAt };
}

type Store = Map<string, Finding>;
const identity = (f: { category: string; entityId: string; url: string | null }) => `${f.category}|${f.entityId}|${f.url ?? ""}`;

/** Mirrors findingStoreSupabase.upsertFinding: one row per identity; a verified finding that comes back moves to fixing. */
function applyUpsert(store: Store, projectId: string, input: AuditFindingInput): void {
  const key = identity({ category: input.category, entityId: input.entityId, url: input.url });
  const existing = store.get(key);
  const status: FindingStatus = existing?.status === "verified" ? "fixing" : (existing?.status ?? "new");
  store.set(key, {
    id: existing?.id ?? `f_${store.size + 1}`,
    projectId,
    source: input.source,
    category: input.category,
    severity: input.severity,
    entityType: input.entityType,
    entityId: input.entityId,
    url: input.url,
    evidence: input.evidence,
    recommendation: input.recommendation,
    status,
    firstSeen: existing?.firstSeen ?? iso(10 * DAY),
    lastSeen: iso(0),
    resolvedAt: null,
  });
}

function finding(store: Store, url: string, entityId: string, status: FindingStatus, category = "meta-title", lastSeenAgo = DAY): Finding {
  const f: Finding = {
    id: `seed_${entityId}_${url}`, projectId: "p1", source: "seo-audit", category, severity: "warning", entityType: "page-issue",
    entityId, url, evidence: { label: "seed" }, recommendation: "", status, firstSeen: iso(10 * DAY), lastSeen: iso(lastSeenAgo), resolvedAt: null,
  };
  store.set(identity(f), f);
  return f;
}

type Fake = { ports: MonitorPorts; store: Store; audits: string[]; markers: string[]; upserts: AuditFindingInput[] };

function fake(targets: MonitorScope[], opts: {
  pages?: Record<string, AuditLike>;
  known?: Record<string, Finding[]>;
  failProject?: string;
  /** Every page audit never settles. */
  hang?: boolean;
} = {}): Fake {
  const store: Store = new Map();
  const audits: string[] = [];
  const markers: string[] = [];
  const upserts: AuditFindingInput[] = [];
  for (const [projectId, list] of Object.entries(opts.known ?? {})) {
    for (const f of list) store.set(identity(f), { ...f, projectId });
  }
  const ports: MonitorPorts = {
    listTargets: async () => targets,
    knownFindings: async (s) => [...store.values()].filter((f) => f.projectId === s.projectId),
    audit: async (s, url) => {
      if (opts.hang) return new Promise<AuditLike>(() => {});
      if (opts.failProject === s.projectId) throw new Error("crawl failed");
      audits.push(`${s.projectId}:${url}`);
      const page = opts.pages?.[url];
      return page ?? { url, findings: [] };
    },
    upsert: async (s, input) => {
      upserts.push(input);
      applyUpsert(store, s.projectId, input);
    },
    writeMarker: async (s) => {
      markers.push(s.projectId);
    },
  };
  return { ports, store, audits, markers, upserts };
}

const budget = { budgetMs: 60_000, maxAudits: 50, clock: () => 0 };

test("the monitor's findings use the same identity and mapping as the audit route", () => {
  const audit: AuditLike = { url: SITE + "/", findings: [titleIssue] };
  const [input] = auditFindingInputs("p1", audit);
  assert.equal(input.source, "seo-audit");
  assert.equal(input.entityType, "page-issue");
  assert.equal(input.entityId, "meta-title-too-long");
  assert.equal(input.severity, "warning");
  assert.equal(input.url, SITE + "/");
  assert.equal(input.evidence.label, "Meta title too long");
  assert.equal(auditFindingInputs("p1", { url: SITE + "/", findings: [{ ...canonicalIssue }] })[0].severity, "critical");
});

test("re-auditing the same issue never creates a duplicate finding", async () => {
  const f = fake([scope("p1")], { pages: { [SITE]: { url: SITE, findings: [titleIssue] } } });
  await runMonitorAudit(f.ports, NOW, budget);
  await runMonitorAudit(f.ports, new Date(NOW.getTime() + 7 * DAY), budget);
  assert.equal(f.store.size, 1);
});

test("a new issue on the home page is upserted as a new finding", async () => {
  const f = fake([scope("p1")], { pages: { [SITE]: { url: SITE, findings: [canonicalIssue] } } });
  const summary = await runMonitorAudit(f.ports, NOW, budget);
  assert.equal(summary.newIssues, 1);
  assert.equal([...f.store.values()][0].status, "new");
});

test("regression: a verified finding whose issue comes back moves to fixing with a 'Reappeared on' note", async () => {
  const f = fake([scope("p1")], {
    known: { p1: [finding(new Map(), SITE, "meta-title-too-long", "verified")] },
    pages: { [SITE]: { url: SITE, findings: [titleIssue] } },
  });
  const summary = await runMonitorAudit(f.ports, NOW, budget);
  const after = [...f.store.values()][0];
  assert.equal(after.status, "fixing");
  assert.equal(after.evidence.regression, "Reappeared on 2026-10-14");
  assert.equal(summary.regressions, 1);
});

test("new findings that disappear are never auto-resolved", async () => {
  const seeded = new Map<string, Finding>();
  const gone = finding(seeded, SITE, "canonical-missing", "new", "canonical");
  const f = fake([scope("p1")], { known: { p1: [gone] }, pages: { [SITE]: { url: SITE, findings: [] } } });
  await runMonitorAudit(f.ports, NOW, budget);
  const after = f.store.get(identity(gone));
  assert.equal(after?.status, "new");
  assert.equal(f.upserts.length, 0);
});

test("rate: a project audited within six days is not audited again", async () => {
  const recent = fake([scope("p1", iso(2 * DAY))]);
  assert.equal((await runMonitorAudit(recent.ports, NOW, budget)).monitored, 0);
  assert.equal(recent.audits.length, 0);

  const due = fake([scope("p1", iso(MONITOR_INTERVAL_MS + DAY))]);
  assert.equal((await runMonitorAudit(due.ports, NOW, budget)).monitored, 1);
  assert.deepEqual(due.markers, ["p1"]);
});

test("pages: the home page plus at most two pages that already have findings", async () => {
  const known = {
    p1: [
      finding(new Map(), SITE + "/a", "meta-title-too-long", "new", "meta-title", 1 * DAY),
      finding(new Map(), SITE + "/b", "meta-title-too-long", "new", "meta-title", 2 * DAY),
      finding(new Map(), SITE + "/c", "meta-title-too-long", "new", "meta-title", 3 * DAY),
    ],
  };
  assert.equal(MONITOR_MAX_EXTRA_PAGES, 2);
  assert.deepEqual(pagesToAudit(SITE, known.p1), [SITE, SITE + "/a", SITE + "/b"]);
  const f = fake([scope("p1")], { known });
  await runMonitorAudit(f.ports, NOW, budget);
  assert.deepEqual(f.audits, [`p1:${SITE}`, `p1:${SITE}/a`, `p1:${SITE}/b`]);
});

test("the global audit cap limits the page audits in one run", async () => {
  const f = fake([scope("p1"), scope("p2")]);
  const summary = await runMonitorAudit(f.ports, NOW, { budgetMs: 60_000, maxAudits: 1, clock: () => 0 });
  assert.equal(f.audits.length, 1);
  assert.equal(summary.audited, 1);
});

test("with less than 15 seconds of budget, only one project is monitored per call", async () => {
  const f = fake([scope("p1", null), scope("p2", null), scope("p3", null)]);
  const summary = await runMonitorAudit(f.ports, NOW, { budgetMs: 5_000, maxAudits: 50, clock: () => 0, minAuditMs: 10 });
  assert.equal(summary.monitored, 1);
  assert.equal(summary.budgetSkipped, 2);
});

test("rotation: the project monitored longest ago goes first", async () => {
  const f = fake([scope("p1", iso(7 * DAY)), scope("p2", iso(20 * DAY)), scope("p3", null)]);
  await runMonitorAudit(f.ports, NOW, { budgetMs: 5_000, maxAudits: 50, clock: () => 0, minAuditMs: 10 });
  assert.deepEqual(f.markers, ["p3"]);
});

test("failure isolation: a project whose audit throws does not stop the next project", async () => {
  const f = fake([scope("p1"), scope("p2")], { failProject: "p1", pages: { [SITE]: { url: SITE, findings: [titleIssue] } } });
  const summary = await runMonitorAudit(f.ports, NOW, budget);
  // A throwing page audit skips that page; the project and the next project still run.
  assert.equal(summary.skippedPages, 1);
  assert.equal(summary.errored, 0);
  assert.equal(summary.monitored, 2);
  assert.equal([...f.store.values()].filter((x) => x.projectId === "p2").length, 1);
});

test("budget: the page loop stops when the clock passes the deadline", async () => {
  let t = 0;
  const known = { p1: [finding(new Map(), SITE + "/a", "meta-title-too-long", "new", "meta-title", DAY), finding(new Map(), SITE + "/b", "meta-title-too-long", "new", "meta-title", 2 * DAY)] };
  const f = fake([scope("p1")], { known });
  const origAudit = f.ports.audit;
  f.ports.audit = async (s, url) => {
    t += 1000;
    return origAudit(s, url);
  };
  await runMonitorAudit(f.ports, NOW, { budgetMs: 1500, maxAudits: 50, clock: () => t, minAuditMs: 10 });
  assert.equal(f.audits.length, 2);
});

test("a hung page audit is skipped at the timeout and the phase returns within budget", async () => {
  const f = fake([scope("p1")], { hang: true });
  const started = Date.now();
  const summary = await runMonitorAudit(f.ports, NOW, { budgetMs: 400, maxAudits: 10, auditTimeoutMs: 50, minAuditMs: 20 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 400 + 1000, `returned in ${elapsed} ms`);
  assert.equal(summary.skippedPages, 1);
  assert.equal(summary.audited, 0);
  assert.equal(f.upserts.length, 0);
});

test("budget guard: a project gets no marker when no audit can start in the budget", async () => {
  const f = fake([scope("p1", null)]);
  const summary = await runMonitorAudit(f.ports, NOW, { budgetMs: 5_000, maxAudits: 10, clock: () => 0 });
  assert.equal(summary.budgetSkipped, 1);
  assert.equal(summary.monitored, 0);
  assert.deepEqual(f.markers, []);
  assert.deepEqual(f.audits, []);
});

test("PageSpeed-only findings: a crawl audit never creates them and never touches an existing one", async () => {
  const seeded = new Map<string, Finding>();
  const lh = finding(seeded, SITE, "lighthouse-mobile-image-alt", "verified", "lighthouse");
  const lhIssue = { issueId: "lighthouse-mobile-image-alt", category: "lighthouse", severity: "Error" as const, label: "Image alt", evidence: {} };
  const f = fake([scope("p1")], { known: { p1: [lh] }, pages: { [SITE]: { url: SITE, findings: [lhIssue] } } });
  const summary = await runMonitorAudit(f.ports, NOW, budget);
  assert.equal(f.upserts.length, 0);
  assert.equal(summary.newIssues, 0);
  assert.equal(summary.regressions, 0);
  assert.equal(f.store.get(identity(lh))?.status, "verified");
});

test("every page audit times out: no marker, so the project is still due and a later run audits it", async () => {
  const f = fake([scope("p1")], { hang: true });
  const first = await runMonitorAudit(f.ports, NOW, { budgetMs: 400, maxAudits: 10, auditTimeoutMs: 50, minAuditMs: 20, clock: () => 0 });
  assert.equal(first.skippedPages, 1);
  assert.equal(first.audited, 0);
  assert.deepEqual(f.markers, []);

  f.ports.audit = async (_scope, url) => ({ url, findings: [] });
  const second = await runMonitorAudit(f.ports, NOW, { budgetMs: 60_000, maxAudits: 10, clock: () => 0 });
  assert.equal(second.audited, 1);
  assert.deepEqual(f.markers, ["p1"]);
});

test("a first page that times out does not block the marker: a later page that completes writes it once", async () => {
  const known = { p1: [finding(new Map(), SITE + "/a", "meta-title-too-long", "new", "meta-title", DAY)] };
  const f = fake([scope("p1")], { known });
  let calls = 0;
  f.ports.audit = async (s, url) => {
    calls += 1;
    if (calls === 1) return new Promise<AuditLike>(() => {});
    f.audits.push(`${s.projectId}:${url}`);
    return { url, findings: [] };
  };
  const summary = await runMonitorAudit(f.ports, NOW, { budgetMs: 400, maxAudits: 10, auditTimeoutMs: 50, minAuditMs: 20, clock: () => 0 });
  assert.equal(summary.skippedPages, 1);
  assert.equal(summary.audited, 1);
  assert.deepEqual(f.markers, ["p1"]);
});

test("page audits that throw leave no marker either", async () => {
  const f = fake([scope("p1")], { failProject: "p1" });
  const summary = await runMonitorAudit(f.ports, NOW, { budgetMs: 60_000, maxAudits: 10, clock: () => 0 });
  assert.equal(summary.skippedPages, 1);
  assert.deepEqual(f.markers, []);
});
