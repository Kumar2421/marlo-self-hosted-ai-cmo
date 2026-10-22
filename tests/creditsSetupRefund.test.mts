import test from "node:test";
import assert from "node:assert/strict";
import { isFirstProjectSetup, isSetupFree, SETUP_FREE_AGENT_TYPES, type SetupFacts } from "../lib/domain/credits/setupFree.ts";
import { spendOrFreeSetup, withRefund, isFailedResponse, type SpendOptions, type SpendPorts, type SpendReceipt } from "../lib/domain/credits/spend.ts";
import { InsufficientCreditsError } from "../lib/domain/credits/errors.ts";
import { InsufficientCreditsError as DraftInsufficient, generateDraftBatch } from "../lib/domain/social/draftGeneration.ts";

const NOW = new Date("2026-10-22T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const COST: Record<string, number> = {
  seo_audit: 5,
  marketing_strategy: 15,
  competitor_analysis: 15,
  competitor_comparison: 10,
  content_strategy: 15,
  design_guide: 15,
  article_generate: 20,
};

// --- isFirstProjectSetup -----------------------------------------------------

test("isFirstProjectSetup: first project inside the window", () => {
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: minutesAgo(5), now: NOW }), true);
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: new Date(NOW.getTime() - 60_000), now: NOW }), true);
});

test("isFirstProjectSetup: boundaries and rejects", () => {
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: minutesAgo(60), now: NOW }), true);
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: minutesAgo(61), now: NOW }), false);
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: minutesAgo(10), now: NOW, windowMinutes: 5 }), false);
  assert.equal(isFirstProjectSetup({ projectCount: 2, projectCreatedAt: minutesAgo(1), now: NOW }), false);
  assert.equal(isFirstProjectSetup({ projectCount: 0, projectCreatedAt: minutesAgo(1), now: NOW }), false);
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: null, now: NOW }), false);
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: "not a date", now: NOW }), false);
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: minutesAgo(1), now: NOW, otherSetupUsed: true }), false);
  // created far in the future: not a setup window
  assert.equal(isFirstProjectSetup({ projectCount: 1, projectCreatedAt: new Date(NOW.getTime() + 3_600_000), now: NOW }), false);
});

test("isSetupFree: only setup-chain agent types, once per type", () => {
  const facts: SetupFacts = { projectCount: 1, projectCreatedAt: minutesAgo(2), priorSameTypeEvents: 0, otherSetupUsed: false };
  for (const t of SETUP_FREE_AGENT_TYPES) assert.equal(isSetupFree(t, facts, NOW), true, t);
  assert.equal(isSetupFree("article_generate", facts, NOW), false);
  assert.equal(isSetupFree("chat_message", facts, NOW), false);
  assert.equal(isSetupFree("seo_audit", { ...facts, priorSameTypeEvents: 1 }, NOW), false);
});

// --- in-memory fake db mirroring spend_credits / refund_credits --------------

interface Ev {
  id: string;
  userId: string;
  projectId: string | null;
  agentType: string;
  credits: number;
  status: "ok" | "failed" | "refunded";
}

function fakeDb(
  opts: { billing?: boolean; balance?: number; projectCount?: number; projectAgeMin?: number; otherSetupUsed?: boolean } = {}
) {
  const st = {
    balance: opts.balance ?? 20,
    events: [] as Ev[],
    ledger: [] as { delta: number; reason: string; eventId: string }[],
    refundRpcCalls: 0,
    factsReads: 0,
  };
  let n = 0;
  const billing = opts.billing ?? true;
  const ports: SpendPorts = {
    async billingEnabled() {
      return billing;
    },
    async setupFacts(userId, projectId, agentType) {
      st.factsReads++;
      return {
        projectCount: opts.projectCount ?? 1,
        projectCreatedAt: minutesAgo(opts.projectAgeMin ?? 3),
        priorSameTypeEvents: st.events.filter(
          (e) => e.userId === userId && e.projectId === projectId && e.agentType === agentType && e.status === "ok"
        ).length,
        otherSetupUsed: opts.otherSetupUsed ?? false,
      };
    },
    async charge(userId, agentType, o: SpendOptions): Promise<SpendReceipt> {
      const cost = COST[agentType];
      if (billing && st.balance < cost) throw new InsufficientCreditsError();
      const ev: Ev = { id: `ev${++n}`, userId, projectId: o.projectId ?? null, agentType, credits: cost, status: "ok" };
      st.events.push(ev);
      st.ledger.push({ delta: -cost, reason: "agent_spend", eventId: ev.id });
      st.balance -= cost;
      return { eventId: ev.id, credits: cost };
    },
    async logFreeSetup(userId, agentType, o: SpendOptions) {
      const ev: Ev = { id: `ev${++n}`, userId, projectId: o.projectId ?? null, agentType, credits: 0, status: "ok" };
      st.events.push(ev);
      st.ledger.push({ delta: 0, reason: "setup_free", eventId: ev.id });
      return { eventId: ev.id, credits: 0 };
    },
    async refund(eventId) {
      st.refundRpcCalls++;
      const ev = st.events.find((e) => e.id === eventId);
      if (!ev) throw new Error("unknown usage_event");
      if (ev.status !== "ok") return false; // idempotent like the SQL function
      if (ev.credits > 0) {
        ev.status = "refunded";
        st.ledger.push({ delta: ev.credits, reason: "agent_refund", eventId });
        st.balance += ev.credits;
      } else {
        ev.status = "failed";
      }
      return true;
    },
    now: () => NOW,
  };
  return { st, ports };
}

// --- zero-cost setup path -----------------------------------------------------

test("setup path: first project, billing on -> cost 0, balance untouched, usage logged as setup_free", async () => {
  const { st, ports } = fakeDb({ balance: 20 });
  const t = await spendOrFreeSetup(ports, "u1", "marketing_strategy", { projectId: "p1" });
  assert.equal(t.free, true);
  assert.equal(t.credits, 0);
  assert.equal(st.balance, 20);
  assert.equal(st.events.length, 1);
  assert.equal(st.events[0].credits, 0);
  assert.deepEqual(st.ledger, [{ delta: 0, reason: "setup_free", eventId: "ev1" }]);
});

test("setup path: the whole chain is free (75 credits at list price vs a 20 credit grant)", async () => {
  const { st, ports } = fakeDb({ balance: 20 });
  for (const t of SETUP_FREE_AGENT_TYPES) {
    const ticket = await spendOrFreeSetup(ports, "u1", t, { projectId: "p1" });
    assert.equal(ticket.free, true, t);
  }
  assert.equal(st.balance, 20);
  assert.equal(st.events.length, SETUP_FREE_AGENT_TYPES.length);
});

test("setup path: even a zero balance user is not blocked during setup", async () => {
  const { st, ports } = fakeDb({ balance: 0 });
  const t = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" });
  assert.equal(t.free, true);
  assert.equal(st.balance, 0);
});

test("setup path: re-running the same action is charged (one free run per type)", async () => {
  const { st, ports } = fakeDb({ balance: 20 });
  const first = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" });
  const second = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" });
  assert.equal(first.free, true);
  assert.equal(second.free, false);
  assert.equal(st.balance, 15);
});

test("setup path: a failed free run does not use up the free run", async () => {
  const { st, ports } = fakeDb({ balance: 20 });
  const first = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" });
  await first.refund();
  assert.equal(st.events[0].status, "failed");
  const retry = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" });
  assert.equal(retry.free, true);
  assert.equal(st.balance, 20);
});

test("setup path: not free for a 2nd project, outside the window, after another free setup, or for non-setup types", async () => {
  for (const o of [{ projectCount: 2 }, { projectAgeMin: 120 }, { otherSetupUsed: true }]) {
    const { st, ports } = fakeDb({ balance: 20, ...o });
    const t = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" });
    assert.equal(t.free, false, JSON.stringify(o));
    assert.equal(st.balance, 15);
  }
  const { st, ports } = fakeDb({ balance: 30 });
  const t = await spendOrFreeSetup(ports, "u1", "article_generate", { projectId: "p1" });
  assert.equal(t.free, false);
  assert.equal(st.balance, 10);
});

test("setup path: no project id means no free decision and no facts read", async () => {
  const { st, ports } = fakeDb({ balance: 20 });
  const t = await spendOrFreeSetup(ports, "u1", "seo_audit", {});
  assert.equal(t.free, false);
  assert.equal(st.factsReads, 0);
  assert.equal(st.balance, 15);
});

test("billing disabled: legacy path unchanged (full-cost metering, setup facts never read)", async () => {
  const { st, ports } = fakeDb({ billing: false, balance: 20 });
  const t = await spendOrFreeSetup(ports, "u1", "marketing_strategy", { projectId: "p1" });
  assert.equal(t.free, false);
  assert.equal(t.credits, 15);
  assert.equal(st.balance, 5);
  assert.equal(st.factsReads, 0);
  assert.equal(st.events[0].credits, 15);
  // still never blocks, balance may go negative like today
  await spendOrFreeSetup(ports, "u1", "marketing_strategy", { projectId: "p1" });
  assert.equal(st.balance, -10);
});

test("unreadable facts fall back to a normal charge", async () => {
  const { st, ports } = fakeDb({ balance: 20 });
  ports.setupFacts = async () => {
    throw new Error("db down");
  };
  const t = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" });
  assert.equal(t.free, false);
  assert.equal(st.balance, 15);
});

test("insufficient credits still throws the shared error on a paid action", async () => {
  const { ports } = fakeDb({ balance: 3, projectCount: 2 });
  await assert.rejects(() => spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" }), InsufficientCreditsError);
});

// --- refund on failure ---------------------------------------------------------

test("refund-on-throw: balance restored, event refunded, ledger has agent_refund, error rethrown", async () => {
  const { st, ports } = fakeDb({ balance: 20, projectCount: 2 });
  const ticket = await spendOrFreeSetup(ports, "u1", "marketing_strategy", { projectId: "p1" });
  assert.equal(st.balance, 5);
  const boom = new Error("llm exploded");
  await assert.rejects(
    () =>
      withRefund(ticket, async () => {
        throw boom;
      }),
    (e) => e === boom
  );
  assert.equal(st.balance, 20);
  assert.equal(st.events[0].status, "refunded");
  assert.deepEqual(
    st.ledger.map((l) => l.reason),
    ["agent_spend", "agent_refund"]
  );
});

test("refund on failed result (status >= 400), none on success", async () => {
  const bad = fakeDb({ balance: 20, projectCount: 2 });
  const t1 = await spendOrFreeSetup(bad.ports, "u1", "seo_audit", { projectId: "p1" });
  const res = await withRefund(t1, async () => ({ status: 502 }), isFailedResponse);
  assert.equal(res.status, 502);
  assert.equal(bad.st.balance, 20);

  const good = fakeDb({ balance: 20, projectCount: 2 });
  const t2 = await spendOrFreeSetup(good.ports, "u1", "seo_audit", { projectId: "p1" });
  await withRefund(t2, async () => ({ status: 200 }), isFailedResponse);
  assert.equal(good.st.balance, 15);
  assert.equal(good.st.events[0].status, "ok");
  assert.equal(good.st.refundRpcCalls, 0);
});

test("no double refund: ticket flag and idempotent RPC", async () => {
  const { st, ports } = fakeDb({ balance: 20, projectCount: 2 });
  const ticket = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" });
  // explicit refund AND throw AND failed-result path all hit the same ticket
  await assert.rejects(() =>
    withRefund(
      ticket,
      async () => {
        await ticket.refund();
        throw new Error("x");
      },
      () => true
    )
  );
  await ticket.refund();
  assert.equal(st.balance, 20);
  assert.equal(st.refundRpcCalls, 1);
  assert.equal(st.ledger.filter((l) => l.reason === "agent_refund").length, 1);

  // A second handler holding the same event id: the RPC itself is idempotent.
  assert.equal(await ports.refund("ev1"), false);
  assert.equal(st.balance, 20);
});

test("refund failure never masks the original error", async () => {
  const { ports } = fakeDb({ balance: 20, projectCount: 2 });
  const seen: unknown[] = [];
  const ticket = await spendOrFreeSetup(ports, "u1", "seo_audit", { projectId: "p1" }, (e) => seen.push(e));
  ports.refund = async () => {
    throw new Error("rpc missing");
  };
  const original = new Error("real failure");
  await assert.rejects(
    () =>
      withRefund(ticket, async () => {
        throw original;
      }),
    (e) => e === original
  );
  assert.equal(seen.length, 1);
});

test("null ticket (BYOK / self-host) just runs the work", async () => {
  assert.equal(await withRefund(null, async () => 42), 42);
  await assert.rejects(
    () =>
      withRefund(null, async () => {
        throw new Error("e");
      }),
    /e/
  );
});

// --- shared InsufficientCreditsError ------------------------------------------

test("draftGeneration uses the shared InsufficientCreditsError (402, not 500)", async () => {
  assert.equal(DraftInsufficient, InsufficientCreditsError);
  const res = await generateDraftBatch(
    {
      creditState: async () => ({ billingEnabled: true, balance: 100, cost: 5 }),
      reserveSlot: async () => ({ ok: true, batchId: "b1" }),
      releaseSlot: async () => {},
      callModel: async () => "{}",
      parse: () => ({ drafts: [{ text: "hi" }], errors: [] }),
      filterUsable: (d) => d,
      insertDrafts: async (b, d) => d.map((x) => ({ ...(x as object), batchId: b })),
      deleteBatch: async () => {},
      // the real chargeCredits throws the shared class on a race after the pre-check
      charge: async () => {
        throw new InsufficientCreditsError();
      },
      isByok: false,
      limit: 5,
    },
    { variants: 1 }
  );
  assert.equal(res.status, 402);
});
