import test from "node:test";
import assert from "node:assert/strict";
import { runClaimedLeadRefresh, type LeadStampStore } from "../lib/jobs/leadRefreshClaim.ts";

const CUTOFF = "2026-10-13T00:00:00.000Z";
const NOW = "2026-10-14T10:00:00.000Z";
const OLD = "2026-10-01T00:00:00.000Z";

// In-memory stamp table that follows the same compare-and-set rules as the SQL.
function fakeStore(initial: Record<string, string | null>) {
  const stamps = new Map<string, string | null>(Object.entries(initial));
  const store: LeadStampStore = {
    async claim(projectId, cutoffIso, nowIso) {
      const cur = stamps.get(projectId) ?? null;
      if (cur === null || cur < cutoffIso) {
        stamps.set(projectId, nowIso);
        return true;
      }
      return false;
    },
    async restore(projectId, claimedIso, previousIso) {
      if ((stamps.get(projectId) ?? null) !== claimedIso) return false;
      stamps.set(projectId, previousIso);
      return true;
    },
  };
  return { store, stamps };
}

const claimOpts = (projectId: string, previousIso: string | null) => ({ projectId, cutoffIso: CUTOFF, nowIso: NOW, previousIso });

test("a due project is claimed: the stamp is written before the work runs", async () => {
  const { store, stamps } = fakeStore({ p1: OLD });
  let seenDuringWork: string | null = null;
  const out = await runClaimedLeadRefresh(store, claimOpts("p1", OLD), async () => {
    seenDuringWork = stamps.get("p1") ?? null;
    return 3;
  });
  assert.deepEqual(out, { status: "done", value: 3 });
  assert.equal(seenDuringWork, NOW);
});

test("success keeps the new stamp", async () => {
  const { store, stamps } = fakeStore({ p1: null });
  await runClaimedLeadRefresh(store, claimOpts("p1", null), async () => "ok");
  assert.equal(stamps.get("p1"), NOW);
});

test("a throw from the work restores the previous stamp and rethrows", async () => {
  const { store, stamps } = fakeStore({ p1: OLD });
  await assert.rejects(
    () => runClaimedLeadRefresh(store, claimOpts("p1", OLD), async () => {
      throw new Error("search exploded");
    }),
    /search exploded/,
  );
  assert.equal(stamps.get("p1"), OLD);
});

test("a failed run on a never-refreshed project restores null, so it is due again", async () => {
  const { store, stamps } = fakeStore({ p1: null });
  await assert.rejects(() => runClaimedLeadRefresh(store, claimOpts("p1", null), async () => Promise.reject(new Error("timeout"))));
  assert.equal(stamps.get("p1"), null);
});

test("a second claim on a freshly stamped project is refused and the work never runs", async () => {
  const { store, stamps } = fakeStore({ p1: OLD });
  let calls = 0;
  const work = async () => {
    calls += 1;
    return "x";
  };
  const first = await runClaimedLeadRefresh(store, claimOpts("p1", OLD), work);
  const second = await runClaimedLeadRefresh(store, claimOpts("p1", NOW), work);
  assert.equal(first.status, "done");
  assert.deepEqual(second, { status: "refused" });
  assert.equal(calls, 1);
  assert.equal(stamps.get("p1"), NOW);
});

test("a refused claim does not restore anything", async () => {
  const { store, stamps } = fakeStore({ p1: NOW });
  const out = await runClaimedLeadRefresh(store, claimOpts("p1", NOW), async () => "never");
  assert.deepEqual(out, { status: "refused" });
  assert.equal(stamps.get("p1"), NOW);
});

test("restore does not clobber a newer stamp written by someone else", async () => {
  const NEWER = "2026-10-14T11:00:00.000Z";
  const { store, stamps } = fakeStore({ p1: OLD });
  await assert.rejects(() =>
    runClaimedLeadRefresh(store, claimOpts("p1", OLD), async () => {
      stamps.set("p1", NEWER); // another writer moved the stamp while we worked
      throw new Error("boom");
    }),
  );
  assert.equal(stamps.get("p1"), NEWER);
});

test("when the budget runs out mid-work the stamp is restored and the error surfaces", async () => {
  const { store, stamps } = fakeStore({ p1: OLD });
  await assert.rejects(
    () => runClaimedLeadRefresh(store, { ...claimOpts("p1", OLD), timeoutMs: 5 }, () => new Promise<never>(() => {})),
    /ran out of time/,
  );
  assert.equal(stamps.get("p1"), OLD);
});

test("a failing restore does not hide the original error", async () => {
  const { store } = fakeStore({ p1: OLD });
  const broken: LeadStampStore = {
    claim: store.claim,
    restore: async () => {
      throw new Error("db down");
    },
  };
  await assert.rejects(() => runClaimedLeadRefresh(broken, claimOpts("p1", OLD), async () => Promise.reject(new Error("original"))), /original/);
});
