import test from "node:test";
import assert from "node:assert/strict";
import { reconcileAllProjects, rotateForDay, type LinkedProject, type ReconcileAllPorts } from "../lib/domain/fixes/reconcileAllProjects.ts";
import { fixDeliveryFake } from "../lib/domain/fixes/fixDeliveryFake.ts";
import type { OutcomePorts } from "../lib/domain/search/outcomeService.ts";
import type { Action } from "../lib/domain/actions/actionTypes.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

const T0 = new Date("2026-10-01T00:00:00Z");

function makeAction(id: string, prUrl: string | null, status: Action["status"] = "proposed"): Action {
  return {
    id, projectId: "p", findingId: "f1", type: "manual_fix", status, title: "t", target: {}, parameters: {},
    result: prUrl ? { pullRequest: { url: prUrl } } : null, createdAt: T0.toISOString(), startedAt: null, completedAt: null,
  };
}

function outcomePorts(actions: Action[]): OutcomePorts {
  const finding = { id: "f1", projectId: "p", evidence: {}, url: "https://example.com/x" } as unknown as Finding;
  return {
    projectUrl: "https://example.com",
    getAction: async (id) => actions.find((a) => a.id === id) ?? null,
    getFinding: async () => finding,
    getSnapshot: async () => null,
    completeAction: async (id, result) => {
      const action = actions.find((a) => a.id === id);
      if (!action) return null;
      action.status = "completed";
      action.result = result;
      return action;
    },
    saveResult: async (id, result) => {
      const action = actions.find((a) => a.id === id);
      if (action) action.result = result;
    },
    resetAction: async () => null,
    moveFinding: async () => {},
    fetchFingerprint: async () => null,
  };
}

/** Three linked projects: one with a merged PR, one with nothing pending, one with no GitHub token. */
function fleet() {
  const actionsByProject: Record<string, Action[]> = {
    "p-merged": [makeAction("m1", "https://github.com/o/r/pull/1")],
    "p-idle": [makeAction("i1", null, "completed")],
    "p-notoken": [makeAction("n1", "https://github.com/o/r/pull/9")],
  };
  const delivery = fixDeliveryFake();
  delivery.setState("https://github.com/o/r/pull/1", "merged", "2026-10-05T12:00:00.000Z");
  const inputsCalls: string[] = [];
  const ports: ReconcileAllPorts = {
    linkedProjects: async () => [
      { projectId: "p-merged", userId: "u1" },
      { projectId: "p-idle", userId: "u1" },
      { projectId: "p-notoken", userId: "u2" },
    ],
    actionsFor: async ({ projectId }: LinkedProject) => actionsByProject[projectId] ?? [],
    inputsFor: async ({ projectId }: LinkedProject) => {
      inputsCalls.push(projectId);
      if (projectId === "p-notoken") return null;
      return { ports: outcomePorts(actionsByProject[projectId]), fixDelivery: delivery };
    },
  };
  return { ports, actionsByProject, inputsCalls };
}

test("every linked project is swept: the merged PR is implemented without anyone opening the finding", async () => {
  const f = fleet();
  const summary = await reconcileAllProjects(f.ports, { budgetMs: 60_000 });

  assert.equal(summary.linked, 3);
  assert.equal(summary.implemented, 1);
  assert.equal(summary.processed, 1, "only the project with an open linked PR and a token is checked");
  assert.equal(summary.skipped, 2, "idle project and project without a token are skipped");
  assert.equal(f.actionsByProject["p-merged"][0].status, "completed");
  assert.equal(f.inputsCalls.includes("p-idle"), false, "idle projects cost no GitHub token");
});

test("one project failing does not stop the others, and the error is generic", async () => {
  const f = fleet();
  const base = f.ports.actionsFor;
  f.ports.actionsFor = async (project) => {
    if (project.projectId === "p-idle") throw new Error("database says token=ghs_secret_123");
    return base(project);
  };
  const summary = await reconcileAllProjects(f.ports, { budgetMs: 60_000 });

  assert.equal(summary.implemented, 1);
  assert.deepEqual(summary.failedProjects, [{ projectId: "p-idle", error: "Could not reconcile this project's pull requests." }]);
  assert.equal(JSON.stringify(summary).includes("ghs_secret"), false, "no secret reaches the summary");
});

test("the time budget stops the sweep early and says so", async () => {
  const f = fleet();
  let clock = 0;
  const summary = await reconcileAllProjects(f.ports, { budgetMs: 5, now: () => (clock += 10) });

  assert.equal(summary.interrupted, true);
  assert.equal(summary.processed + summary.skipped, 3, "every project is either done or counted as left for the next run");
});

test("rotation starts at a different project each day, and keeps every project", () => {
  assert.deepEqual(rotateForDay(["a", "b", "c"], 0), ["a", "b", "c"]);
  assert.deepEqual(rotateForDay(["a", "b", "c"], 1), ["b", "c", "a"]);
  assert.deepEqual(rotateForDay(["a", "b", "c"], 5), ["c", "a", "b"]);
  assert.deepEqual(rotateForDay([], 3), []);
});
