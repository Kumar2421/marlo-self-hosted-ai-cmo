import test from "node:test";
import assert from "node:assert/strict";
import { createAction, transitionAction, type ActionRepository } from "../lib/domain/actions/actionService.ts";
import { ActionLifecycleError, staleActionError, type Action } from "../lib/domain/actions/actionTypes.ts";

function makeAction(status: Action["status"] = "proposed"): Action {
  return {
    id: "action_1", projectId: "project_1", findingId: "finding_1", recommendationId: "finding_1:noindex",
    type: "remove_noindex", status, title: "Remove noindex", target: { url: "https://example.com/page" },
    parameters: {}, result: null, createdAt: "2026-01-01T00:00:00.000Z", startedAt: null, completedAt: null,
  };
}

function repository(initial: Action) {
  let current = initial;
  const repo: ActionRepository = {
    get: () => current,
    list: () => [current],
    create: (input) => {
      current = { ...current, ...input, id: "action_new", status: "proposed", result: null, createdAt: current.createdAt, startedAt: null, completedAt: null };
      return current;
    },
    transition: (_projectId, _id, status, result = null, from) => {
      if (from && current.status !== from) throw staleActionError();
      current = { ...current, status, result };
      return current;
    },
  };
  return { repo, get current() { return current; } };
}

test("creates proposed actions through the service boundary", async () => {
  const state = repository(makeAction());
  const action = await createAction(state.repo, {
    projectId: "project_1", findingId: "finding_1", recommendationId: "finding_1:noindex",
    type: "remove_noindex", title: "Remove noindex", target: { url: "https://example.com/page" }, parameters: {},
  });
  assert.equal(action.status, "proposed");
});

test("enforces action lifecycle transitions", async () => {
  const state = repository(makeAction());
  await transitionAction(state.repo, "project_1", "action_1", "approved");
  await transitionAction(state.repo, "project_1", "action_1", "running");
  await transitionAction(state.repo, "project_1", "action_1", "completed", { ok: true });
  assert.equal(state.current.status, "completed");
  await assert.rejects(() => transitionAction(state.repo, "project_1", "action_1", "running"), /Invalid action status transition/);
});

test("illegal action edges are lifecycle errors (409), not generic failures", async () => {
  const state = repository(makeAction("completed"));
  await assert.rejects(
    () => transitionAction(state.repo, "project_1", "action_1", "running"),
    (err: unknown) => err instanceof ActionLifecycleError && err.kind === "invalid",
  );
});

test("two concurrent approvals from the same read: one wins, the other conflicts", async () => {
  const state = repository(makeAction("proposed"));
  const stale = { ...state.current };
  const racing: ActionRepository = { ...state.repo, get: () => stale };
  const results = await Promise.allSettled([
    transitionAction(racing, "project_1", "action_1", "approved"),
    transitionAction(racing, "project_1", "action_1", "approved"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(lost.reason instanceof ActionLifecycleError && lost.reason.kind === "conflict");
});
