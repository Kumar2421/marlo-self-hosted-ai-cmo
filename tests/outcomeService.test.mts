import test from "node:test";
import assert from "node:assert/strict";
import { FINDING_NOT_UPDATED_WARNING, implementAction, readOutcomes, undoImplementation, UNDO_WINDOW_MS, type OutcomePorts } from "../lib/domain/search/outcomeService.ts";
import { implementationOf, savedOutcomeOf } from "../lib/domain/search/actionOutcome.ts";
import { findingForOpportunity } from "../lib/domain/search/opportunityFinding.ts";
import { snapshotRanges, type SearchSnapshotPayload } from "../lib/domain/search/searchSnapshot.ts";
import { pathToFixed } from "../lib/domain/findings/pathToFixed.ts";
import { canTransitionAction, type Action } from "../lib/domain/actions/actionTypes.ts";
import type { Finding, FindingStatus } from "../lib/domain/findings/findingTypes.ts";
import type { PageFingerprint } from "../lib/domain/search/pageFingerprint.ts";
import type { OpportunityType, SearchOpportunity } from "../lib/domain/search/searchOpportunities.ts";

const DAY = 86_400_000;
const T0 = new Date("2026-10-01T00:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);

function payload(position: number, impressions = 1000, clicks = 30): SearchSnapshotPayload {
  const r = snapshotRanges(T0);
  return {
    version: 1, capturedAt: T0.toISOString(), siteUrl: "s",
    windows: {
      d7: { ...r.d7, queries: [] }, d90: { ...r.d90, queries: [] }, prev28: { ...r.prev28, queries: [] },
      d28: { ...r.d28, queries: [{ query: "best seo tool", impressions, clicks, ctr: clicks / impressions, position, rankingPages: [] }] },
    },
  } as unknown as SearchSnapshotPayload;
}

function makeFinding(status: FindingStatus = "new", type: OpportunityType = "ranking", url: string | null = "https://example.com/seo"): Finding {
  const opp: SearchOpportunity = { type, query: "best seo tool", pageUrl: url, score: 1, reasons: ["r"], metrics: { clicks: 30, impressions: 1000, ctr: 0.03, position: 11 }, previous: null };
  const input = findingForOpportunity(opp, { projectId: "p", brand: "Marlo", capturedAt: T0.toISOString() });
  return { ...input, id: "f1", status, firstSeen: "t", lastSeen: "t", resolvedAt: null } as Finding;
}

function makeAction(over: Partial<Action> = {}): Action {
  return { id: "a1", projectId: "p", findingId: "f1", type: "improve_content_relevance", status: "proposed", title: "t", target: {}, parameters: {}, result: null, createdAt: "t", startedAt: null, completedAt: null, ...over };
}

function harness(opts: { action?: Action; finding?: Finding; snapshot?: SearchSnapshotPayload | null; fingerprints?: Array<PageFingerprint | null>; projectUrl?: string | null } = {}) {
  const state = { action: opts.action ?? makeAction(), moves: [] as FindingStatus[], fetched: [] as string[], saved: [] as Array<Record<string, unknown>> };
  const finding = opts.finding ?? makeFinding();
  const queue = [...(opts.fingerprints ?? [])];
  const snap = opts.snapshot === undefined ? payload(11) : opts.snapshot;
  const ports: OutcomePorts = {
    projectUrl: opts.projectUrl === undefined ? "https://example.com" : opts.projectUrl,
    getAction: async () => state.action,
    getFinding: async () => finding,
    getSnapshot: async () => (snap ? { snapshotDate: "2026-10-01", payload: snap } : null),
    completeAction: async (_id, result) => (state.action = { ...state.action, status: "completed", result, completedAt: "now" }),
    saveResult: async (_id, result) => { state.saved.push(result); state.action = { ...state.action, result }; },
    resetAction: async () => (state.action = { ...state.action, status: "proposed", result: null, completedAt: null }),
    moveFinding: async (_id, status) => { state.moves.push(status); },
    fetchFingerprint: async (url) => { state.fetched.push(url); return queue.length ? queue.shift()! : null; },
  };
  return { ports, state };
}

const fp = (title: string): PageFingerprint => ({ title, description: "d", h1: "h" });

test("implementAction saves the baseline, completes the action and moves the finding to fixed", async () => {
  const { ports, state } = harness({ fingerprints: [fp("Old")] });
  const res = await implementAction(ports, { actionId: "a1", now: T0 });
  assert.equal(res.ok, true);
  assert.equal(state.action.status, "completed");
  const impl = implementationOf(state.action.result)!;
  assert.equal(impl.via, "manual");
  assert.equal(impl.baseline?.position, 11);
  assert.equal(impl.pageUrl, "https://example.com/seo");
  assert.equal(impl.pageBefore?.title, "Old");
  assert.deepEqual(state.moves, ["acknowledged", "fixing", "fixed"]);
});

test("a user-given page must be on the project's own site", async () => {
  const bad = await implementAction(harness().ports, { actionId: "a1", pageUrl: "https://evil.com/x", now: T0 });
  assert.deepEqual(bad, { ok: false, status: 400, error: "That page isn't on your website." });
  const blocked = await implementAction(harness().ports, { actionId: "a1", pageUrl: "http://127.0.0.1/x", now: T0 });
  assert.equal(blocked.ok, false);
  const good = harness({ finding: makeFinding("new", "new_query", null), fingerprints: [fp("Old")] });
  const res = await implementAction(good.ports, { actionId: "a1", pageUrl: "https://www.example.com/new-page", now: T0 });
  assert.equal(res.ok, true);
  assert.deepEqual(good.state.fetched, ["https://www.example.com/new-page"]);
});

test("a finding with no page still works, just without a page check", async () => {
  const h = harness({ finding: makeFinding("new", "lost_query", null) });
  assert.equal((await implementAction(h.ports, { actionId: "a1", now: T0 })).ok, true);
  assert.equal(h.state.fetched.length, 0);
  assert.equal(implementationOf(h.state.action.result)?.pageBefore, undefined);
});

test("implementAction refuses a done, cancelled or missing action", async () => {
  assert.equal((await implementAction(harness({ action: makeAction({ status: "completed" }) }).ports, { actionId: "a1" })).ok, false);
  const cancelled = await implementAction(harness({ action: makeAction({ status: "cancelled" }) }).ports, { actionId: "a1" });
  assert.equal(cancelled.ok === false && cancelled.status, 409);
  const missing = harness();
  missing.ports.getAction = async () => null;
  assert.equal((await implementAction(missing.ports, { actionId: "x" })).ok === false, true);
});

test("a finding already fixed or verified is left alone, and a failed move never undoes the saved action", async () => {
  const done = harness({ finding: makeFinding("verified") });
  await implementAction(done.ports, { actionId: "a1", now: T0 });
  assert.deepEqual(done.state.moves, []);

  const flaky = harness();
  flaky.ports.moveFinding = async () => { throw new Error("db down"); };
  const res = await implementAction(flaky.ports, { actionId: "a1", now: T0 });
  assert.equal(res.ok, true);
  assert.equal(flaky.state.action.status, "completed");
});

test("a GitHub PR plugs in through the same call, with proof attached", async () => {
  const h = harness();
  await implementAction(h.ports, { actionId: "a1", via: "github_pr", change: { prUrl: "https://github.com/o/r/pull/7", summary: "Title and H1" }, now: T0 });
  const impl = implementationOf(h.state.action.result)!;
  assert.equal(impl.via, "github_pr");
  assert.equal(impl.change?.prUrl, "https://github.com/o/r/pull/7");
});

test("undo works inside the window and not after it", async () => {
  const h = harness();
  await implementAction(h.ports, { actionId: "a1", now: T0 });
  const late = await undoImplementation(h.ports, { actionId: "a1", now: new Date(T0.getTime() + UNDO_WINDOW_MS + 1000) });
  assert.equal(late.ok === false && late.status, 409);
  const ok = await undoImplementation(h.ports, { actionId: "a1", now: new Date(T0.getTime() + 3_600_000) });
  assert.equal(ok.ok, true);
  assert.equal(h.state.action.status, "proposed");
  assert.equal(h.state.action.result, null);
  const again = await undoImplementation(h.ports, { actionId: "a1", now: T0 });
  assert.equal(again.ok === false && again.status, 409, "nothing left to undo");
});

async function implemented(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness(opts);
  await implementAction(h.ports, { actionId: "a1", now: T0 });
  h.state.saved.length = 0;
  return h;
}

test("readOutcomes: nothing to attach for actions that were never implemented", async () => {
  const h = harness();
  const [only] = await readOutcomes(h.ports, [h.state.action], at(20));
  assert.equal(only.outcome, null);
});

test("readOutcomes: reports whether undo is still allowed", async () => {
  const h = await implemented();
  assert.equal((await readOutcomes(h.ports, [h.state.action], new Date(T0.getTime() + 3_600_000)))[0].canUndo, true);
  assert.equal((await readOutcomes(h.ports, [h.state.action], new Date(T0.getTime() + UNDO_WINDOW_MS + 60_000)))[0].canUndo, false);
  assert.equal((await readOutcomes(harness().ports, [makeAction()], T0))[0].canUndo, false, "never implemented");
});

test("readOutcomes: waiting early, then improved", async () => {
  const h = await implemented();
  assert.equal((await readOutcomes(h.ports, [h.state.action], at(3)))[0].outcome?.status, "waiting");
  const h2 = await implemented();
  h2.ports.getSnapshot = async () => ({ snapshotDate: "2026-10-10", payload: payload(6.8, 1100, 50) });
  assert.equal((await readOutcomes(h2.ports, [h2.state.action], at(9)))[0].outcome?.status, "improved");
});

test("readOutcomes: captures the page 'after' once, past the minimum wait, and reports what changed", async () => {
  const h = await implemented({ fingerprints: [fp("Old"), fp("New")], snapshot: payload(11) });
  h.ports.getSnapshot = async () => ({ snapshotDate: "2026-10-10", payload: payload(6.8, 1100, 50) });
  const [first] = await readOutcomes(h.ports, [h.state.action], at(9));
  assert.match(first.outcome?.pageNote ?? "", /title was “Old”, now “New”/);
  assert.equal(implementationOf(h.state.action.result)?.pageAfter?.title, "New");
  const fetchedBefore = h.state.fetched.length;
  await readOutcomes(h.ports, [h.state.action], at(9));
  assert.equal(h.state.fetched.length, fetchedBefore, "the page is not fetched again");
});

test("readOutcomes: saves a solid verdict once, and a saved verdict is final", async () => {
  const h = await implemented();
  h.ports.getSnapshot = async () => ({ snapshotDate: "2026-10-15", payload: payload(6.8, 1100, 50) });
  const [first] = await readOutcomes(h.ports, [h.state.action], at(14));
  assert.equal(first.outcome?.status, "improved");
  assert.equal(savedOutcomeOf(h.state.action.result)?.status, "improved");
  assert.equal(h.state.saved.length, 1);

  h.ports.getSnapshot = async () => ({ snapshotDate: "2026-12-30", payload: payload(30, 40, 0) });
  const [later] = await readOutcomes(h.ports, [h.state.action], at(90));
  assert.equal(later.outcome?.status, "improved", "later bad data cannot rewrite it");
  assert.equal(h.state.saved.length, 1, "not saved twice");
});

test("readOutcomes: an early signal is shown but not saved", async () => {
  const h = await implemented();
  h.ports.getSnapshot = async () => ({ snapshotDate: "2026-10-10", payload: payload(6.8, 1100, 50) });
  await readOutcomes(h.ports, [h.state.action], at(9));
  assert.equal(savedOutcomeOf(h.state.action.result), null);
});

test("readOutcomes: a broken port for one action does not break the others", async () => {
  const good = await implemented();
  const broken = { ...good.state.action, id: "a2", findingId: "boom" };
  const realGet = good.ports.getFinding;
  good.ports.getFinding = async (id) => { if (id === "boom") throw new Error("x"); return realGet(id); };
  const result = await readOutcomes(good.ports, [good.state.action, broken], at(3));
  assert.equal(result[0].outcome?.status, "waiting");
  assert.equal(result[1].outcome, null);
});

test("pathToFixed gives only legal steps, ending at fixed", () => {
  assert.deepEqual(pathToFixed("new"), ["acknowledged", "fixing", "fixed"]);
  assert.deepEqual(pathToFixed("failed"), ["fixing", "fixed"]);
  assert.deepEqual(pathToFixed("fixed"), []);
  assert.deepEqual(pathToFixed("verified"), []);
});

test("completing without Marlo running the action is allowed; cancelled actions stay closed", () => {
  assert.equal(canTransitionAction("proposed", "completed"), true);
  assert.equal(canTransitionAction("approved", "completed"), true);
  assert.equal(canTransitionAction("running", "completed"), true);
  assert.equal(canTransitionAction("cancelled", "completed"), false);
  assert.equal(canTransitionAction("completed", "proposed"), false, "undo goes through the outcome service, not the generic machine");
});

test("a CMS publish starts outcome tracking with via cms_publish and the pre-change page as the baseline", async () => {
  const h = harness({ fingerprints: [fp("AFTER the publish")] });
  const res = await implementAction(h.ports, { actionId: "a1", via: "cms_publish", change: { summary: "Meta description updated in WordPress" }, pageBefore: fp("BEFORE the publish"), now: T0 });
  assert.equal(res.ok, true);
  const impl = implementationOf(h.state.action.result);
  assert.equal(impl?.via, "cms_publish");
  assert.equal(impl?.change?.summary, "Meta description updated in WordPress");
  assert.equal(impl?.pageBefore?.title, "BEFORE the publish");
  assert.deepEqual(h.state.fetched, [], "the live (already changed) page is not fetched as the baseline");
  assert.equal(h.state.action.status, "completed");
  assert.ok(h.state.moves.length > 0, "finding moves toward fixed");
  const legacy = implementationOf({ implementation: { via: "weird", implementedAt: T0.toISOString() } });
  assert.equal(legacy?.via, "manual", "unknown via values still read as manual");
});

test("implementAction warns when the finding could not be moved (D11), and the action stays saved", async () => {
  const { ports, state } = harness({ fingerprints: [fp("Old")] });
  ports.moveFinding = async () => { throw new Error("db down"); };
  const res = await implementAction(ports, { actionId: "a1", now: T0 });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.warning, FINDING_NOT_UPDATED_WARNING);
  assert.equal(state.action.status, "completed");
});

test("implementAction has no warning when the finding moved", async () => {
  const { ports } = harness({ fingerprints: [fp("Old")] });
  const res = await implementAction(ports, { actionId: "a1", now: T0 });
  assert.equal(res.ok && res.warning, undefined);
});
