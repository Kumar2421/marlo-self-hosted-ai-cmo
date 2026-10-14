import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_LIMIT_FALLBACK_MESSAGE, OUT_OF_CREDITS_MESSAGE, runPaidLeadSearch, type PaidLeadSearchPorts } from "../lib/domain/leads/paidLeadSearch.ts";

function recorder(overrides: {
  limit?: { allowed: boolean; message?: string };
  credits?: boolean;
  omitCredits?: boolean;
  leads?: string[] | Error;
  charged?: boolean;
}) {
  const calls: string[] = [];
  const ports: PaidLeadSearchPorts<string> = {
    checkDailyLimit: async () => {
      calls.push("limit");
      return overrides.limit ?? { allowed: true };
    },
    hasCredits: async () => {
      calls.push("credits");
      return overrides.credits ?? true;
    },
    search: async () => {
      calls.push("search");
      if (overrides.leads instanceof Error) throw overrides.leads;
      return overrides.leads ?? ["Jane Doe"];
    },
    charge: async () => {
      calls.push("charge");
      return overrides.charged ?? true;
    },
  };
  if (overrides.omitCredits) delete ports.hasCredits;
  return { ports, calls };
}

test("order is limit, credit pre-check, search, then charge", async () => {
  const { ports, calls } = recorder({});
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits", "search", "charge"]);
  assert.deepEqual(out, { ok: true, leads: ["Jane Doe"], charged: true });
});

test("daily limit refuses before anything is spent, with the limit message", async () => {
  const { ports, calls } = recorder({ limit: { allowed: false, message: "You reached 20 leads today." } });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit"]);
  assert.deepEqual(out, { ok: false, status: 403, error: "You reached 20 leads today." });
});

test("daily limit without a message uses the fallback text", async () => {
  const { ports } = recorder({ limit: { allowed: false } });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(out, { ok: false, status: 403, error: DAILY_LIMIT_FALLBACK_MESSAGE });
});

test("no credits at pre-check: 402 before the search runs", async () => {
  const { ports, calls } = recorder({ credits: false });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits"]);
  assert.deepEqual(out, { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE });
});

test("an empty search is not charged", async () => {
  const { ports, calls } = recorder({ leads: [] });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits", "search"]);
  assert.deepEqual(out, { ok: true, leads: [], charged: false });
});

test("a failing search is a 502 with the message and is not charged", async () => {
  const { ports, calls } = recorder({ leads: new Error("boom") });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits", "search"]);
  assert.deepEqual(out, { ok: false, status: 502, error: "boom" });
});

test("running out of credits at charge time is a 402 and the leads are not returned", async () => {
  const { ports } = recorder({ charged: false });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(out, { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE });
});

test("no pre-check port: search and charge still run in order", async () => {
  const { ports, calls } = recorder({ omitCredits: true });
  await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "search", "charge"]);
});
