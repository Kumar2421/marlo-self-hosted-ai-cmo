import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_LIMIT_FALLBACK_MESSAGE, OUT_OF_CREDITS_MESSAGE, runPaidLeadSearch, type PaidLeadSearchPorts } from "../lib/domain/leads/paidLeadSearch.ts";

type Overrides = {
  limit?: { allowed: boolean; message?: string };
  credits?: boolean;
  omitCredits?: boolean;
  leads?: string[] | Error;
  save?: "ok" | "empty" | "error" | "throw";
  charged?: boolean;
};

function recorder(overrides: Overrides) {
  const calls: string[] = [];
  const ports: PaidLeadSearchPorts<string, string> = {
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
    save: async (leads) => {
      calls.push("save");
      if (overrides.save === "throw") throw new Error("verify crashed");
      if (overrides.save === "error") return { ok: false, status: 500, error: "insert failed" };
      if (overrides.save === "empty") return { ok: true, rows: [] };
      return { ok: true, rows: leads.map((l) => `row:${l}`) };
    },
    charge: async () => {
      calls.push("charge");
      return overrides.charged ?? true;
    },
  };
  if (overrides.omitCredits) delete ports.hasCredits;
  return { ports, calls };
}

test("order is limit, credit pre-check, search, save, then charge", async () => {
  const { ports, calls } = recorder({});
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits", "search", "save", "charge"]);
  assert.deepEqual(out, { ok: true, leads: ["row:Jane Doe"], charged: true });
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

test("an empty search is neither saved nor charged", async () => {
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

test("a failed insert returns 500 and is never charged", async () => {
  const { ports, calls } = recorder({ save: "error" });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits", "search", "save"]);
  assert.deepEqual(out, { ok: false, status: 500, error: "insert failed" });
});

test("a save that throws (e.g. email verification) is a 502 and is never charged", async () => {
  const { ports, calls } = recorder({ save: "throw" });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits", "search", "save"]);
  assert.deepEqual(out, { ok: false, status: 502, error: "verify crashed" });
});

test("a save that stores zero rows is not charged", async () => {
  const { ports, calls } = recorder({ save: "empty" });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits", "search", "save"]);
  assert.deepEqual(out, { ok: true, leads: [], charged: false });
});

test("a charge refused after the save keeps the saved leads and reports charged=false", async () => {
  const { ports, calls } = recorder({ charged: false });
  const out = await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "credits", "search", "save", "charge"]);
  assert.deepEqual(out, { ok: true, leads: ["row:Jane Doe"], charged: false });
});

test("no pre-check port: search, save and charge still run in order", async () => {
  const { ports, calls } = recorder({ omitCredits: true });
  await runPaidLeadSearch(ports);
  assert.deepEqual(calls, ["limit", "search", "save", "charge"]);
});
