import test from "node:test";
import assert from "node:assert/strict";
import { runDag, documentConcurrency, isRateLimited } from "../lib/domain/project/docScheduler.ts";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test("never exceeds the concurrency cap", async () => {
  let active = 0;
  let max = 0;
  const nodes = ["a", "b", "c", "d", "e"].map((key) => ({ key }));
  await runDag(nodes, 2, async () => {
    active++;
    max = Math.max(max, active);
    await tick();
    active--;
  });
  assert.equal(max, 2);
});

test("dependents wait for prerequisites; independents overlap", async () => {
  const log: string[] = [];
  const nodes = [
    { key: "p" },
    { key: "ca" },
    { key: "m", after: ["p"] },
    { key: "design", after: ["m"] },
    { key: "content", after: ["m", "ca"] },
  ];
  await runDag(nodes, 3, async (k) => {
    log.push(`start:${k}`);
    await tick(k === "p" ? 10 : 2);
    log.push(`end:${k}`);
  });
  assert.ok(log.indexOf("start:ca") < log.indexOf("end:p"), "ca overlaps p");
  assert.ok(log.indexOf("start:m") > log.indexOf("end:p"));
  assert.ok(log.indexOf("start:design") > log.indexOf("end:m"));
  assert.ok(log.indexOf("start:content") > log.indexOf("end:m"));
  assert.ok(log.indexOf("start:content") > log.indexOf("end:ca"));
});

test("a throwing node does not stop the others (partial failure keeps the rest)", async () => {
  const ran: string[] = [];
  await runDag([{ key: "a" }, { key: "b", after: ["a"] }, { key: "c" }], 2, async (k) => {
    ran.push(k);
    if (k === "a") throw new Error("boom");
  });
  assert.deepEqual(ran.sort(), ["a", "b", "c"]);
});

test("noSlot nodes do not consume the cap", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const started: string[] = [];
  const p = runDag(
    [{ key: "gate", noSlot: true }, { key: "x" }, { key: "y", after: ["gate"] }],
    1,
    async (k) => {
      started.push(k);
      if (k === "gate") await gate;
      else await tick();
    }
  );
  await tick(20);
  assert.ok(started.includes("gate") && started.includes("x"));
  release();
  await p;
  assert.ok(started.includes("y"));
});

test("shouldStop skips unstarted nodes and still resolves", async () => {
  let stop = false;
  const ran: string[] = [];
  await runDag(
    [{ key: "a" }, { key: "b", after: ["a"] }],
    1,
    async (k) => {
      ran.push(k);
      stop = true;
    },
    () => stop
  );
  assert.deepEqual(ran, ["a"]);
});

test("empty graph resolves", async () => {
  await runDag([], 3, async () => {});
});

test("concurrency and rate-limit helpers", () => {
  assert.equal(documentConcurrency("mistral"), 1);
  assert.equal(documentConcurrency("groq"), 3);
  assert.equal(documentConcurrency(null), 3);
  assert.equal(isRateLimited(429, ""), true);
  assert.equal(isRateLimited(502, "Rate limit reached for model"), true);
  assert.equal(isRateLimited(502, "bad key"), false);
});
