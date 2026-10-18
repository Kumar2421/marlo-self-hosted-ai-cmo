import test from "node:test";
import assert from "node:assert/strict";
import { DeadlineExceededError, withDeadline } from "../lib/domain/fixes/withDeadline.ts";

test("a call that finishes within the budget returns its value", async () => {
  assert.equal(await withDeadline(async () => 42, 1000), 42);
});

test("a call that hangs is abandoned at the budget with DeadlineExceededError", async () => {
  const started = Date.now();
  await assert.rejects(withDeadline(() => new Promise<never>(() => {}), 30), DeadlineExceededError);
  assert.ok(Date.now() - started < 2000);
});

test("a call that fails on its own still reports its own error", async () => {
  await assert.rejects(withDeadline(async () => { throw new Error("db down"); }, 1000), /db down/);
});

test("with no time left the call is never started", async () => {
  let started = false;
  await assert.rejects(withDeadline(async () => { started = true; return 1; }, 0), DeadlineExceededError);
  assert.equal(started, false);
});

test("an infinite budget means no limit", async () => {
  assert.equal(await withDeadline(async () => "done", Infinity), "done");
});
