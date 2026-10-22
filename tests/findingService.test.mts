import test from "node:test";
import assert from "node:assert/strict";
import { applyRecheck, transitionFinding, type FindingRepository } from "../lib/domain/findings/findingService.ts";
import { FindingLifecycleError, staleFindingError, type Finding } from "../lib/domain/findings/findingTypes.ts";

function makeFinding(status: Finding["status"] = "new"): Finding {
  return {
    id: "finding_1",
    projectId: "project_1",
    source: "search-console",
    category: "search-visibility",
    severity: "warning",
    entityType: "query",
    entityId: "example query",
    url: "https://example.com/page",
    evidence: {},
    recommendation: "Fix the issue.",
    status,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    resolvedAt: null,
  };
}

function repository(initial: Finding): { repo: FindingRepository; current: Finding } {
  let current = initial;
  const repo: FindingRepository = {
    get: () => current,
    list: () => [current],
    // Like the real stores: apply only while the row still has the status the caller read.
    transition: (_projectId, _id, status, from) => {
      if (from && current.status !== from) throw staleFindingError();
      current = { ...current, status };
      return current;
    },
    refresh: (_projectId, _id, input) => {
      if (input.expectedStatus && current.status !== input.expectedStatus) throw staleFindingError();
      const { expectedStatus: _expected, ...rest } = input;
      current = { ...current, ...rest };
      return current;
    },
  };
  return { repo, get current() { return current; } };
}

test("finding service enforces lifecycle transitions before persistence", async () => {
  const state = repository(makeFinding("new"));

  const updated = await transitionFinding(state.repo, "project_1", "finding_1", "acknowledged");
  assert.equal(updated?.status, "acknowledged");

  await assert.rejects(
    () => transitionFinding(state.repo, "project_1", "finding_1", "new"),
    /Invalid finding status transition: acknowledged -> new/,
  );
});

test("every illegal user edge is rejected as invalid (409), and the row is untouched", async () => {
  const illegal: Array<[Finding["status"], Finding["status"]]> = [
    ["new", "fixing"], ["new", "fixed"], ["acknowledged", "fixed"], ["acknowledged", "new"],
    ["fixing", "acknowledged"], ["fixed", "fixing"], ["fixed", "new"], ["verified", "fixed"],
    ["verified", "acknowledged"], ["failed", "fixed"], ["failed", "acknowledged"],
  ];
  for (const [from, to] of illegal) {
    const state = repository(makeFinding(from));
    await assert.rejects(
      () => transitionFinding(state.repo, "project_1", "finding_1", to),
      (err: unknown) => err instanceof FindingLifecycleError && err.kind === "invalid" && err.message === `Invalid finding status transition: ${from} -> ${to}`,
      `${from} -> ${to}`,
    );
    assert.equal(state.current.status, from);
  }
});

test("a direct client request for verified or failed is rejected from every status (D3)", async () => {
  for (const from of ["new", "acknowledged", "fixing", "fixed", "verified", "failed"] as const) {
    for (const to of ["verified", "failed"] as const) {
      const state = repository(makeFinding(from));
      await assert.rejects(
        () => transitionFinding(state.repo, "project_1", "finding_1", to),
        (err: unknown) => err instanceof FindingLifecycleError && err.kind === "rejected",
        `${from} -> ${to}`,
      );
      assert.equal(state.current.status, from);
      assert.equal(state.current.resolvedAt, null);
    }
  }
});

test("two concurrent transitions from the same read: one wins, the other is a conflict", async () => {
  const state = repository(makeFinding("new"));
  // Both requests read "new" before either writes.
  const stale = { ...state.current };
  const racing: FindingRepository = { ...state.repo, get: () => stale };
  const results = await Promise.allSettled([
    transitionFinding(racing, "project_1", "finding_1", "acknowledged"),
    transitionFinding(racing, "project_1", "finding_1", "acknowledged"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(lost.reason instanceof FindingLifecycleError && lost.reason.kind === "conflict");
  assert.equal(state.current.status, "acknowledged");
});

test("a recheck racing a status change is a conflict, not a silent overwrite", async () => {
  const state = repository(makeFinding("fixed"));
  const stale = { ...state.current };
  const racing: FindingRepository = { ...state.repo, get: () => stale };
  state.repo.transition("project_1", "finding_1", "failed");
  await assert.rejects(
    () => applyRecheck(racing, "project_1", "finding_1", { severity: "warning", evidence: {}, recommendation: "r", issueDetected: false }),
    (err: unknown) => err instanceof FindingLifecycleError && err.kind === "conflict",
  );
  assert.equal(state.current.status, "failed");
});

test("recheck honors the transition table: a verified finding cannot be re-failed", async () => {
  const state = repository(makeFinding("verified"));
  await assert.rejects(
    () => applyRecheck(state.repo, "project_1", "finding_1", { severity: "warning", evidence: {}, recommendation: "r", issueDetected: true }),
    /Invalid finding status transition: verified -> failed/,
  );
});

test("recheck is allowed from every open status", async () => {
  for (const from of ["new", "acknowledged", "fixing", "fixed", "failed"] as const) {
    for (const issueDetected of [true, false]) {
      const state = repository(makeFinding(from));
      const updated = await applyRecheck(state.repo, "project_1", "finding_1", { severity: "warning", evidence: {}, recommendation: "r", issueDetected });
      assert.equal(updated?.status, issueDetected ? "failed" : "verified", `${from}`);
    }
  }
});

test("recheck marks an unresolved finding failed", async () => {
  const state = repository(makeFinding("fixing"));

  const updated = await applyRecheck(state.repo, "project_1", "finding_1", {
    severity: "critical",
    evidence: { issue: true },
    recommendation: "Fix it again.",
    issueDetected: true,
  });

  assert.equal(updated?.status, "failed");
  assert.equal(updated?.severity, "critical");
  assert.deepEqual(updated?.evidence, { issue: true });
});

test("recheck marks a resolved finding verified", async () => {
  const state = repository(makeFinding("fixed"));

  const updated = await applyRecheck(state.repo, "project_1", "finding_1", {
    severity: "warning",
    evidence: { issue: false },
    recommendation: "Issue no longer detected.",
    issueDetected: false,
  });

  assert.equal(updated?.status, "verified");
  assert.equal(updated?.resolvedAt, null);
});
