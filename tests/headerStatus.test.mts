import test from "node:test";
import assert from "node:assert/strict";
import { headerStatus } from "../lib/headerStatus.ts";

test("idle: no lines and no setup run shows nothing", () => {
  assert.deepEqual(headerStatus([]), { kind: "idle" });
  assert.deepEqual(headerStatus([{ type: "divider", text: "---" }]), { kind: "idle" });
});

test("an unfinished command is running; done and error lines are shown as such", () => {
  assert.deepEqual(headerStatus([{ type: "cmd", text: "Auditing" }]), { kind: "running", text: "Auditing" });
  assert.deepEqual(
    headerStatus([{ type: "cmd", text: "Auditing" }, { type: "done", text: "Audit complete" }]),
    { kind: "done", text: "Audit complete" },
  );
  assert.deepEqual(headerStatus([{ type: "error", text: "Couldn't load" }]), { kind: "error", text: "Couldn't load" });
});

test("trailing dividers are skipped", () => {
  assert.deepEqual(
    headerStatus([{ type: "done", text: "ok" }, { type: "divider", text: "--" }]),
    { kind: "done", text: "ok" },
  );
});
