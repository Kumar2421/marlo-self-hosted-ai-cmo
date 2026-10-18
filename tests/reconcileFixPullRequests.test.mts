import test from "node:test";
import assert from "node:assert/strict";
import { reconcileFixPullRequests } from "../lib/domain/fixes/reconcileFixPullRequests.ts";
import { fixDeliveryFake } from "../lib/domain/fixes/fixDeliveryFake.ts";
import { linkPullRequest } from "../lib/domain/fixes/linkPullRequest.ts";
import { implementationOf } from "../lib/domain/search/actionOutcome.ts";
import type { OutcomePorts } from "../lib/domain/search/outcomeService.ts";
import type { Action } from "../lib/domain/actions/actionTypes.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

const T0 = new Date("2026-10-01T00:00:00Z");

let actionCounter = 0;

function makeAction(prUrl: string | null = null, status: Action["status"] = "proposed"): Action {
  const result = prUrl
    ? {
        implementation: {
          via: "manual" as const,
          change: { prUrl },
          implementedAt: T0.toISOString(),
        },
      }
    : null;
  const id = `a${++actionCounter}`;
  return {
    id,
    projectId: "p",
    findingId: "f1",
    type: "manual_fix",
    status,
    title: "Fix something",
    target: {},
    parameters: {},
    result,
    createdAt: T0.toISOString(),
    startedAt: null,
    completedAt: status === "completed" ? T0.toISOString() : null,
  };
}

function makeFinding(id = "f1"): Finding {
  return {
    id,
    projectId: "p",
    source: "seo",
    category: "test",
    severity: "warning",
    entityType: "page",
    entityId: "test",
    url: "https://example.com/test",
    evidence: {},
    recommendation: "Test",
    status: "new",
    firstSeen: T0.toISOString(),
    lastSeen: T0.toISOString(),
    resolvedAt: null,
  };
}

function harness(opts: { actions?: Action[]; finding?: Finding } = {}) {
  const actions = opts.actions ?? [];
  const finding = opts.finding ?? makeFinding();
  const ports: OutcomePorts = {
    projectUrl: "https://example.com",
    getAction: async (id) => {
      return actions.find((a) => a.id === id) ?? null;
    },
    getFinding: async () => finding,
    getSnapshot: async () => null,
    completeAction: async (id, result) => {
      const action = actions.find((a) => a.id === id);
      if (!action) return null;
      action.status = "completed";
      action.completedAt = new Date().toISOString();
      action.result = result;
      return action;
    },
    saveResult: async () => {},
    resetAction: async () => null,
    moveFinding: async () => {},
    fetchFingerprint: async () => null,
  };
  const fixDelivery = fixDeliveryFake();
  return { ports, fixDelivery, actions };
}

test("reconcileFixPullRequests: merged PR gets marked as implemented with actual merge time", async () => {
  const h = harness({
    actions: [makeAction("https://github.com/o/r/pull/1")],
  });
  const mergedAt = new Date("2026-10-05T12:00:00Z").toISOString();
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged", mergedAt);

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed.length, 0);
  const actionAfter = h.actions[0];
  assert.equal(actionAfter.status, "completed");
  const impl = implementationOf(actionAfter.result);
  assert.equal(impl?.via, "github_pr");
  assert.equal(impl?.implementedAt, mergedAt, "should use actual merge time, not current time");
});

test("reconcileFixPullRequests: open PR is not marked as implemented", async () => {
  const h = harness({
    actions: [makeAction("https://github.com/o/r/pull/1")],
  });
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "open");

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 0);
  assert.equal(result.skipped, 1);
  assert.equal(h.actions[0].status, "proposed");
});

test("reconcileFixPullRequests: closed PR is not marked as implemented", async () => {
  const h = harness({
    actions: [makeAction("https://github.com/o/r/pull/1")],
  });
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "closed");

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 0);
  assert.equal(result.skipped, 1);
  assert.equal(h.actions[0].status, "proposed");
});

test("reconcileFixPullRequests: idempotent; merged PR marked again stays completed", async () => {
  const h = harness();
  const action = makeAction("https://github.com/o/r/pull/1");
  h.actions.push(action);
  const mergedAt = new Date("2026-10-05T12:00:00Z").toISOString();
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged", mergedAt);

  const result1 = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);
  assert.equal(result1.implemented, 1, "first run should implement");
  assert.equal(h.actions[0].status, "completed");

  // Run again — should skip since already implemented via github_pr
  const result2 = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);
  assert.equal(result2.implemented, 0);
  assert.equal(result2.skipped, 1, "already-implemented action should be skipped");
  assert.equal(h.actions[0].status, "completed");
});

test("reconcileFixPullRequests: skips actions already implemented via github_pr", async () => {
  const h = harness();
  const action = makeAction("https://github.com/o/r/pull/1", "completed");
  action.result = {
    implementation: {
      via: "github_pr",
      change: { prUrl: "https://github.com/o/r/pull/1" },
      implementedAt: T0.toISOString(),
    },
  };
  h.actions.push(action);
  const mergedAt = new Date("2026-10-05T12:00:00Z").toISOString();
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged", mergedAt);

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 0);
  assert.equal(result.skipped, 1);
  const impl = implementationOf(action.result);
  assert.equal(impl?.via, "github_pr");
});

test("reconcileFixPullRequests: skips actions with no PR URL", async () => {
  const h = harness({
    actions: [makeAction(null)],
  });

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 0);
  assert.equal(result.skipped, 1);
  assert.equal(h.actions[0].status, "proposed");
});

test("reconcileFixPullRequests: skips completed/failed/cancelled actions", async () => {
  const h = harness();
  const actions: Array<{ status: Action["status"]; action: Action }> = [];
  for (const status of ["completed", "failed", "cancelled"] as const) {
    const action = makeAction("https://github.com/o/r/pull/1", status);
    actions.push({ status, action });
    h.actions.push(action);
  }
  const mergedAt = new Date("2026-10-05T12:00:00Z").toISOString();
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged", mergedAt);

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 0);
  assert.equal(result.skipped, 3);
  for (const { status, action } of actions) {
    assert.equal(action.status, status);
  }
});

test("reconcileFixPullRequests: one failing action doesn't block others", async () => {
  const h = harness();
  const action1 = makeAction("https://github.com/o/r/pull/1");
  const action2 = makeAction("https://github.com/o/r/pull/2");
  h.actions.push(action1, action2);

  const originalGetAction = h.ports.getAction;
  h.ports.getAction = async (id) => {
    if (id === action1.id) throw new Error("Database error");
    return originalGetAction(id);
  };

  const mergedAt = new Date("2026-10-05T12:00:00Z").toISOString();
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged", mergedAt);
  h.fixDelivery.setState("https://github.com/o/r/pull/2", "merged", mergedAt);

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].actionId, action1.id);
  assert.equal(h.actions[0].status, "proposed");
  assert.equal(h.actions[1].status, "completed");
});

test("reconcileFixPullRequests: handles multiple actions with different PR states", async () => {
  const h = harness();
  const mergedAt = new Date("2026-10-05T12:00:00Z").toISOString();
  h.actions.push(
    makeAction("https://github.com/o/r/pull/1"),
    makeAction("https://github.com/o/r/pull/2"),
    makeAction("https://github.com/o/r/pull/3")
  );

  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged", mergedAt);
  h.fixDelivery.setState("https://github.com/o/r/pull/2", "open");
  h.fixDelivery.setState("https://github.com/o/r/pull/3", "closed");

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 1);
  assert.equal(result.skipped, 2);
  assert.equal(h.actions[0].status, "completed");
  assert.equal(h.actions[1].status, "proposed");
  assert.equal(h.actions[2].status, "proposed");
});

test("apply -> merged -> implemented: a PR linked by codefix/apply is picked up on merge", async () => {
  const h = harness({ actions: [makeAction(null, "approved")] });
  const url = "https://github.com/o/r/pull/9";
  for (const link of linkPullRequest(h.actions, url)) h.actions[0].result = link.result;
  const mergedAt = "2026-10-05T12:00:00.000Z";
  h.fixDelivery.setState(url, "merged", mergedAt);

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(result.implemented, 1);
  assert.equal(h.actions[0].status, "completed");
  const impl = implementationOf(h.actions[0].result);
  assert.equal(impl?.via, "github_pr");
  assert.equal(impl?.implementedAt, mergedAt);
  assert.equal(impl?.change?.prUrl, url);
});

test("a closed PR is not written over an action that was re-linked while GitHub was being asked", async () => {
  const PR1 = "https://github.com/o/r/pull/1";
  const PR2 = "https://github.com/o/r/pull/2";
  const listed = { ...makeAction(null), result: { pullRequest: { url: PR1 } } };
  const h = harness({ actions: [listed] });
  h.fixDelivery.setState(PR1, "closed");
  // Between listing the actions and writing, a new PR was linked to the same action.
  h.ports.getAction = async () => ({ ...listed, result: { pullRequest: { url: PR2 } } });
  const writes: Array<Record<string, unknown>> = [];
  h.ports.saveResult = async (_id, result) => { writes.push(result); };

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions, T0);

  assert.deepEqual(writes, [], "the new link is left alone");
  assert.equal(result.closed, 0);
  assert.equal(result.skipped, 1);
});

test("a closed PR clears its link using the freshly read action, keeping anything written since it was listed", async () => {
  const PR1 = "https://github.com/o/r/pull/1";
  const listed = { ...makeAction(null), result: { pullRequest: { url: PR1 }, note: "stale" } };
  const h = harness({ actions: [listed] });
  h.fixDelivery.setState(PR1, "closed");
  h.ports.getAction = async () => ({ ...listed, result: { pullRequest: { url: PR1 }, note: "fresh" } });
  const writes: Array<Record<string, unknown>> = [];
  h.ports.saveResult = async (_id, result) => { writes.push(result); };

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions, T0);

  assert.equal(result.closed, 1);
  assert.deepEqual(writes, [{ note: "fresh", closedPullRequest: { url: PR1, closedAt: T0.toISOString() } }]);
});

test("a GitHub call that never answers is given up at the time budget: that action fails and the others still run", async () => {
  const PR1 = "https://github.com/o/r/pull/1";
  const PR2 = "https://github.com/o/r/pull/2";
  const h = harness();
  const hung = makeAction(PR1);
  const fine = makeAction(PR2);
  h.actions.push(hung, fine);
  h.fixDelivery.setState(PR2, "merged", "2026-10-05T12:00:00.000Z");
  const answer = h.fixDelivery.status;
  h.fixDelivery.status = (url) => (url === PR1 ? new Promise(() => {}) : answer(url));

  const started = Date.now();
  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions, T0, { remainingMs: () => 30 });

  assert.ok(Date.now() - started < 2000, "returns when the budget runs out, not when GitHub would answer");
  assert.equal(result.implemented, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].actionId, hung.id);
  assert.match(result.failed[0].error, /Ran out of time/);
  assert.equal(hung.status, "proposed", "nothing is changed for an action we could not check");
});

test("with no time left, GitHub is not asked at all and every linked PR is reported failed, not changed", async () => {
  const h = harness();
  h.actions.push(makeAction("https://github.com/o/r/pull/1"), makeAction("https://github.com/o/r/pull/2"));
  let asked = 0;
  h.fixDelivery.status = async () => { asked += 1; return { state: "open" as const }; };

  const result = await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions, T0, { remainingMs: () => 0 });

  assert.equal(asked, 0);
  assert.equal(result.failed.length, 2);
  assert.ok(h.actions.every((a) => a.status === "proposed"));
});
