import test from "node:test";
import assert from "node:assert/strict";
import { reconcileFixPullRequests } from "../lib/domain/fixes/reconcileFixPullRequests.ts";
import { fixDeliveryFake } from "../lib/domain/fixes/fixDeliveryFake.ts";
import { closedPullRequestOf, linkPullRequest, pullRequestUrlOf } from "../lib/domain/fixes/linkPullRequest.ts";
import { implementationOf } from "../lib/domain/search/actionOutcome.ts";
import type { OutcomePorts } from "../lib/domain/search/outcomeService.ts";
import type { Action } from "../lib/domain/actions/actionTypes.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

const T0 = new Date("2026-10-01T00:00:00Z");
const NOW = new Date("2026-10-06T08:00:00Z");
const PR1 = "https://github.com/o/r/pull/1";
const PR2 = "https://github.com/o/r/pull/2";

function makeAction(id: string, result: Record<string, unknown> | null = null): Action {
  return { id, projectId: "p", findingId: "f1", type: "manual_fix", status: "proposed", title: "t", target: {}, parameters: {}, result, createdAt: T0.toISOString(), startedAt: null, completedAt: null };
}

function makeFinding(): Finding {
  return { id: "f1", projectId: "p", source: "seo", category: "test", severity: "warning", entityType: "page", entityId: "x", url: "https://example.com/x", evidence: {}, recommendation: "Test", status: "new", firstSeen: T0.toISOString(), lastSeen: T0.toISOString(), resolvedAt: null } as Finding;
}

function harness(actions: Action[]) {
  const saves: Array<{ id: string; result: Record<string, unknown> }> = [];
  const ports: OutcomePorts = {
    projectUrl: "https://example.com",
    getAction: async (id) => actions.find((a) => a.id === id) ?? null,
    getFinding: async () => makeFinding(),
    getSnapshot: async () => null,
    completeAction: async (id, result) => {
      const action = actions.find((a) => a.id === id);
      if (!action) return null;
      action.status = "completed";
      action.result = result;
      return action;
    },
    saveResult: async (id, result) => {
      saves.push({ id, result });
      const action = actions.find((a) => a.id === id);
      if (action) action.result = result;
    },
    resetAction: async () => null,
    moveFinding: async () => {},
    fetchFingerprint: async () => null,
  };
  return { ports, saves, fixDelivery: fixDeliveryFake() };
}

test("an unknown PR state is a failure for that action only: nothing is changed and the link stays", async () => {
  const action = makeAction("a1", { pullRequest: { url: PR1 } });
  const h = harness([action]);
  h.fixDelivery.setState(PR1, "unknown");

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, [action], NOW);

  assert.equal(result.closed, 0);
  assert.equal(result.implemented, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].actionId, "a1");
  assert.equal(h.saves.length, 0, "an unknown state must not touch the action");
  assert.equal(pullRequestUrlOf(action.result), PR1);
  assert.equal(action.status, "proposed");
});

test("a PR closed without merging clears the link, leaves a note, and keeps the action open", async () => {
  const action = makeAction("a1", { pullRequest: { url: PR1, pageBefore: null }, keep: "yes" });
  const h = harness([action]);
  h.fixDelivery.setState(PR1, "closed");

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, [action], NOW);

  assert.equal(result.closed, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(action.status, "proposed", "the action stays open for a new fix");
  assert.equal(pullRequestUrlOf(action.result), null, "the PR link is gone");
  assert.equal((action.result as Record<string, unknown>).pullRequest, undefined);
  assert.equal((action.result as Record<string, unknown>).keep, "yes", "other saved data is kept");
  assert.deepEqual(closedPullRequestOf(action.result), { url: PR1, closedAt: NOW.toISOString() });
});

test("after a closed PR, a new PR can be linked, the old note is cleared, and the new PR merges as normal", async () => {
  const action = makeAction("a1", { pullRequest: { url: PR1 } });
  const h = harness([action]);
  h.fixDelivery.setState(PR1, "closed");
  await reconcileFixPullRequests(h.ports, h.fixDelivery, [action], NOW);
  assert.ok(closedPullRequestOf(action.result));

  const relinked = linkPullRequest([action], PR2);
  assert.equal(relinked.length, 1, "the action is eligible for a new PR");
  action.result = relinked[0].result;
  assert.equal(pullRequestUrlOf(action.result), PR2);
  assert.equal(closedPullRequestOf(action.result), null, "the closed note is shown once, then cleared");

  h.fixDelivery.setState(PR2, "merged", "2026-10-05T12:00:00.000Z");
  const second = await reconcileFixPullRequests(h.ports, h.fixDelivery, [action], NOW);
  assert.equal(second.implemented, 1);
  assert.equal(action.status, "completed");
  assert.equal(implementationOf(action.result)?.change?.prUrl, PR2);
});

test("unknown, closed and merged PRs in one run are each handled on their own", async () => {
  const unknown = makeAction("a1", { pullRequest: { url: PR1 } });
  const closed = makeAction("a2", { pullRequest: { url: PR2 } });
  const merged = makeAction("a3", { pullRequest: { url: "https://github.com/o/r/pull/3" } });
  const h = harness([unknown, closed, merged]);
  h.fixDelivery.setState(PR1, "unknown");
  h.fixDelivery.setState(PR2, "closed");
  h.fixDelivery.setState("https://github.com/o/r/pull/3", "merged", "2026-10-05T12:00:00.000Z");

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, [unknown, closed, merged], NOW);

  assert.equal(result.implemented, 1);
  assert.equal(result.closed, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(unknown.status, "proposed");
  assert.equal(closed.status, "proposed");
  assert.equal(merged.status, "completed");
});
