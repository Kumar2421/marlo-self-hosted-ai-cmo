import test from "node:test";
import assert from "node:assert/strict";
import { OUT_OF_CREDITS_MESSAGE, prepareCatalogFix, type CatalogPreparePorts } from "../lib/domain/codefix/prepareCatalogFix.ts";

/** Fake ports that record the order of every side effect. */
function fakePorts(overrides: Partial<CatalogPreparePorts<string>> & { proposeThrows?: boolean; paid?: boolean } = {}) {
  const log: string[] = [];
  const ports: CatalogPreparePorts<string> = {
    isByok: overrides.isByok ?? false,
    creditState: overrides.creditState ?? (async () => {
      log.push("credit-check");
      return { billingEnabled: true, balance: 10, cost: 1 };
    }),
    propose: async () => {
      log.push("propose");
      if (overrides.proposeThrows) throw new Error("model down");
      return "proposal";
    },
    charge: async () => {
      log.push("charge");
      return overrides.paid ?? true;
    },
  };
  return { ports, log };
}

test("zero credits on the platform key: refused before the LLM runs, nothing charged", async () => {
  const { ports, log } = fakePorts({
    creditState: async () => {
      return { billingEnabled: true, balance: 0, cost: 1 };
    },
  });
  const out = await prepareCatalogFix(ports);
  assert.deepEqual(out, { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE });
  assert.deepEqual(log, []);
});

test("repeated zero-credit calls never reach the model", async () => {
  let proposals = 0;
  const ports: CatalogPreparePorts<string> = {
    isByok: false,
    creditState: async () => ({ billingEnabled: true, balance: 0, cost: 1 }),
    propose: async () => {
      proposals += 1;
      return "x";
    },
    charge: async () => true,
  };
  for (let i = 0; i < 3; i += 1) await prepareCatalogFix(ports);
  assert.equal(proposals, 0);
});

test("affordable platform call: check, then propose, then charge, in that order", async () => {
  const { ports, log } = fakePorts();
  const out = await prepareCatalogFix(ports);
  assert.deepEqual(out, { ok: true, proposal: "proposal" });
  assert.deepEqual(log, ["credit-check", "propose", "charge"]);
});

test("a failed proposal is not charged and the error propagates", async () => {
  const { ports, log } = fakePorts({ proposeThrows: true });
  await assert.rejects(() => prepareCatalogFix(ports), /model down/);
  assert.deepEqual(log, ["credit-check", "propose"]);
});

test("credits that run out between the check and the charge refuse the proposal", async () => {
  const { ports, log } = fakePorts({ paid: false });
  const out = await prepareCatalogFix(ports);
  assert.deepEqual(out, { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE });
  assert.deepEqual(log, ["credit-check", "propose", "charge"]);
});

test("billing disabled lets the platform call through without a balance", async () => {
  const { ports, log } = fakePorts({
    creditState: async () => {
      log.push("credit-check");
      return { billingEnabled: false, balance: 0, cost: 0 };
    },
  });
  const out = await prepareCatalogFix(ports);
  assert.equal(out.ok, true);
  assert.deepEqual(log, ["credit-check", "propose", "charge"]);
});

test("BYOK skips the pre-check and the charge, as the other agent routes do", async () => {
  const { ports, log } = fakePorts({ isByok: true });
  const out = await prepareCatalogFix(ports);
  assert.deepEqual(out, { ok: true, proposal: "proposal" });
  assert.deepEqual(log, ["propose"]);
});

test("BYOK with zero platform credits still gets a proposal", async () => {
  const { ports } = fakePorts({
    isByok: true,
    creditState: async () => ({ billingEnabled: true, balance: 0, cost: 1 }),
  });
  assert.equal((await prepareCatalogFix(ports)).ok, true);
});
