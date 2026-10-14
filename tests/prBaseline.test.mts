import test from "node:test";
import assert from "node:assert/strict";
import { implementAction, type OutcomePorts } from "../lib/domain/search/outcomeService.ts";
import { implementationOf, outcomeForAction, shouldSaveOutcome } from "../lib/domain/search/actionOutcome.ts";
import { linkPullRequest } from "../lib/domain/fixes/linkPullRequest.ts";
import { findingForOpportunity } from "../lib/domain/search/opportunityFinding.ts";
import { snapshotRanges, type SearchSnapshotPayload } from "../lib/domain/search/searchSnapshot.ts";
import type { Action } from "../lib/domain/actions/actionTypes.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";
import type { PageFingerprint } from "../lib/domain/search/pageFingerprint.ts";
import type { OpportunityType, SearchOpportunity } from "../lib/domain/search/searchOpportunities.ts";

const DAY = 86_400_000;
const T0 = new Date("2026-10-01T00:00:00Z");
const PR = "https://github.com/o/r/pull/7";

function payload(position: number): SearchSnapshotPayload {
  const r = snapshotRanges(T0);
  return {
    version: 1, capturedAt: T0.toISOString(), siteUrl: "s",
    windows: {
      d7: { ...r.d7, queries: [] }, d90: { ...r.d90, queries: [] }, prev28: { ...r.prev28, queries: [] },
      d28: { ...r.d28, queries: [{ query: "best seo tool", impressions: 1000, clicks: 30, ctr: 0.03, position, rankingPages: [] }] },
    },
  } as unknown as SearchSnapshotPayload;
}

function makeFinding(type: OpportunityType = "ranking"): Finding {
  const opp: SearchOpportunity = { type, query: "best seo tool", pageUrl: "https://example.com/seo", score: 1, reasons: ["r"], metrics: { clicks: 30, impressions: 1000, ctr: 0.03, position: 11 }, previous: null };
  const input = findingForOpportunity(opp, { projectId: "p", brand: "Marlo", capturedAt: T0.toISOString() });
  return { ...input, id: "f1", status: "new", firstSeen: "t", lastSeen: "t", resolvedAt: null } as Finding;
}

function makeAction(result: Record<string, unknown> | null = null): Action {
  return { id: "a1", projectId: "p", findingId: "f1", type: "improve_content_relevance", status: "proposed", title: "t", target: {}, parameters: {}, result, createdAt: "t", startedAt: null, completedAt: null };
}

const fp = (title: string): PageFingerprint => ({ title, description: "d", h1: "h" });

type Snap = { snapshotDate: string; payload: SearchSnapshotPayload };

function harness(opts: { action?: Action; snapshots?: Snap[]; onOrBefore?: boolean; fingerprints?: Array<PageFingerprint | null> } = {}) {
  const state = { action: opts.action ?? makeAction(), fetched: [] as string[], datesAsked: [] as string[] };
  const snaps = opts.snapshots ?? [];
  const queue = [...(opts.fingerprints ?? [])];
  const ports: OutcomePorts = {
    projectUrl: "https://example.com",
    getAction: async () => state.action,
    getFinding: async () => makeFinding(),
    getSnapshot: async () => (snaps.length ? snaps[snaps.length - 1] : null),
    ...(opts.onOrBefore === false
      ? {}
      : {
          getSnapshotOnOrBefore: async (date: string) => {
            state.datesAsked.push(date);
            return [...snaps].reverse().find((s) => s.snapshotDate <= date) ?? null;
          },
        }),
    completeAction: async (_id, result) => (state.action = { ...state.action, status: "completed", result, completedAt: "now" }),
    saveResult: async (_id, result) => { state.action = { ...state.action, result }; },
    resetAction: async () => null,
    moveFinding: async () => {},
    fetchFingerprint: async (url) => { state.fetched.push(url); return queue.length ? queue.shift()! : null; },
  };
  return { ports, state };
}

test("merge noticed 9 days late: the baseline is the snapshot from the merge day, not the newest one", async () => {
  const h = harness({
    snapshots: [{ snapshotDate: "2026-10-01", payload: payload(11) }, { snapshotDate: "2026-10-10", payload: payload(4) }],
  });
  const res = await implementAction(h.ports, { actionId: "a1", via: "github_pr", change: { prUrl: PR }, now: T0 });
  assert.equal(res.ok, true);
  assert.deepEqual(h.state.datesAsked, ["2026-10-01"]);
  const baseline = implementationOf(h.state.action.result)!.baseline!;
  assert.equal(baseline.position, 11, "pre-merge position, not the post-merge 4");
  assert.equal(baseline.snapshotDate, "2026-10-01");
  assert.equal(baseline.source, "snapshot");
  assert.equal(baseline.approximate, undefined);
});

test("no snapshot on or before the merge: fall back to the latest, flag it approximate, and never save that verdict", async () => {
  const h = harness({ snapshots: [{ snapshotDate: "2026-10-10", payload: payload(4) }] });
  await implementAction(h.ports, { actionId: "a1", via: "github_pr", change: { prUrl: PR }, now: T0 });
  const implementation = implementationOf(h.state.action.result)!;
  assert.equal(implementation.baseline?.source, "latest_snapshot");
  assert.equal(implementation.baseline?.approximate, true);
  assert.equal(implementation.baseline?.position, 4);

  const outcome = outcomeForAction({
    action: { type: "improve_content_relevance", result: h.state.action.result as Record<string, unknown> },
    finding: makeFinding(),
    snapshot: { snapshotDate: "2026-10-10", payload: payload(4) },
    now: new Date(T0.getTime() + 20 * DAY),
  });
  assert.ok(outcome);
  assert.match(outcome.headline, /baseline is approximate because the merge was noticed late/);
  assert.equal(shouldSaveOutcome(outcome), false, "an approximate verdict is not saved as final");
});

test("manual flow is unchanged: a change reported now uses the latest snapshot and asks for no earlier one", async () => {
  const h = harness({ snapshots: [{ snapshotDate: "2026-10-01", payload: payload(11) }, { snapshotDate: "2026-10-10", payload: payload(9) }] });
  await implementAction(h.ports, { actionId: "a1", now: new Date() });
  assert.deepEqual(h.state.datesAsked, []);
  const baseline = implementationOf(h.state.action.result)!.baseline!;
  assert.equal(baseline.snapshotDate, "2026-10-10");
  assert.equal(baseline.source, "snapshot");
  assert.equal(baseline.approximate, undefined);
});

test("a merged PR uses the 'before' page recorded when the PR was opened, not a live fetch after the merge", async () => {
  const linked = linkPullRequest([makeAction()], PR, fp("Before the merge"))[0];
  const h = harness({ action: makeAction(linked.result), fingerprints: [fp("After the merge")] });
  await implementAction(h.ports, { actionId: "a1", via: "github_pr", change: { prUrl: PR }, now: T0 });
  assert.deepEqual(h.state.fetched, []);
  assert.equal(implementationOf(h.state.action.result)?.pageBefore?.title, "Before the merge");
});

test("a PR linked before the before-page was recorded falls back to a live fetch", async () => {
  const h = harness({ action: makeAction({ pullRequest: { url: PR } }), fingerprints: [fp("Live")] });
  await implementAction(h.ports, { actionId: "a1", via: "github_pr", change: { prUrl: PR }, now: T0 });
  assert.equal(h.state.fetched.length, 1);
  assert.equal(implementationOf(h.state.action.result)?.pageBefore?.title, "Live");
});

test("a PR whose before-page could not be read is recorded as no comparison, never the merged page", async () => {
  const linked = linkPullRequest([makeAction()], PR, null)[0];
  const h = harness({ action: makeAction(linked.result), fingerprints: [fp("After the merge")] });
  await implementAction(h.ports, { actionId: "a1", via: "github_pr", change: { prUrl: PR }, now: T0 });
  assert.deepEqual(h.state.fetched, []);
  assert.equal(implementationOf(h.state.action.result)?.pageBefore, undefined);
});
