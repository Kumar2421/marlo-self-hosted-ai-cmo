import test from "node:test";
import assert from "node:assert/strict";
import { MANAGED_DAILY_CAP, reserveManagedSlot, shouldChargeSearch, type SlotStore } from "../lib/domain/leads/local/managedSearchPolicy.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, Math.random() * 3));

/** In-memory stand-in for usage_events rows: every call yields to the event loop, like a database would. */
function fakeRows(initial = 0): { rows: Set<number>; store: SlotStore<number> } {
  const rows = new Set<number>(Array.from({ length: initial }, (_, i) => -(i + 1)));
  let next = 0;
  return {
    rows,
    store: {
      reserve: async () => {
        await tick();
        next += 1;
        rows.add(next);
        return next;
      },
      count: async () => {
        await tick();
        return rows.size;
      },
      release: async (id) => {
        await tick();
        rows.delete(id);
      },
    },
  };
}

test("the managed cap is 30 searches a day", () => {
  assert.equal(MANAGED_DAILY_CAP, 30);
});

test("sequential managed searches fill the cap exactly", async () => {
  for (const existing of [0, 10, 29]) {
    const { rows, store } = fakeRows(existing);
    let accepted = 0;
    for (let i = 0; i < 40; i += 1) if ((await reserveManagedSlot(store, 30)).allowed) accepted += 1;
    assert.equal(accepted, 30 - existing, `existing=${existing}`);
    assert.equal(rows.size, 30, `rows after existing=${existing}`);
  }
});

test("concurrent managed searches never overshoot the daily cap", async () => {
  // Burst requests may be refused even with room left (each sees the others' reservations), which is
  // the safe direction. The hard guarantee tested here is that accepted searches never exceed the cap.
  for (const existing of [0, 10, 29]) {
    const { rows, store } = fakeRows(existing);
    const results = await Promise.all(Array.from({ length: 60 }, () => reserveManagedSlot(store, 30)));
    const accepted = results.filter((r) => r.allowed).length;
    assert.ok(accepted <= 30 - existing, `existing=${existing} accepted=${accepted}`);
    assert.ok(rows.size <= 30, `rows after existing=${existing}: ${rows.size}`);
  }
});

test("a rejected reservation releases its own row", async () => {
  const { rows, store } = fakeRows(30);
  const result = await reserveManagedSlot(store, 30);
  assert.equal(result.allowed, false);
  assert.equal(rows.size, 30);
});

test("a charged search is not charged again and a free search is not charged at all", () => {
  // Managed, saved something, no failure: charge.
  assert.equal(shouldChargeSearch({ usingManaged: true, savedCount: 1, failed: false }), true);
  // Every Google page that saved nothing (zero results, all duplicates): no charge.
  assert.equal(shouldChargeSearch({ usingManaged: true, savedCount: 0, failed: false }), false);
  // An insert error: no charge.
  assert.equal(shouldChargeSearch({ usingManaged: true, savedCount: 2, failed: true }), false);
  // Own key: never charged.
  assert.equal(shouldChargeSearch({ usingManaged: false, savedCount: 5, failed: false }), false);
});
