import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { doneLineType, lineType, stripWarning } from "../lib/domain/integrations/logLine.ts";
import { headerStatus, statusExpiresAt, STATUS_TTL_MS } from "../lib/headerStatus.ts";
import { plainError } from "../lib/plainError.ts";
import { ApiError } from "../lib/query/fetchJson.ts";
import type { LogLine } from "../lib/mock-terminal.ts";

test("warning-prefixed text is an error line for both log and logDone", () => {
  assert.equal(lineType("⚠ Failed to crawl site.", "cmd"), "error");
  assert.equal(lineType("  ⚠ Failed", "done"), "error");
  assert.equal(lineType("Searching leads...", "cmd"), "cmd");
  assert.equal(lineType("Traffic data loaded", "done"), "done");
  assert.equal(doneLineType("⚠ x"), "error");
  assert.equal(doneLineType("fine"), "done");
});

test("the store decides line types only through lineType (log, logDone, logError)", () => {
  const src = readFileSync(new URL("../lib/terminal-log-store.tsx", import.meta.url), "utf8");
  assert.match(src, /lineType\(text, "cmd"\)/);
  assert.match(src, /lineType\(text, "done"\)/);
  assert.match(src, /logError/);
  assert.doesNotMatch(src, /type: "cmd", text/);
});

test("stripWarning removes the leading sign and spaces, and the TerminalLog regex has its backslashes", () => {
  assert.equal(stripWarning("⚠ Failed to crawl"), "Failed to crawl");
  assert.equal(stripWarning("  ⚠Failed"), "Failed");
  assert.equal(stripWarning("Plain"), "Plain");
  assert.equal(stripWarning("⚠ a ⚠ b"), "a ⚠ b");
  const ui = readFileSync(new URL("../components/dashboard/TerminalLog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /\/\^s\*⚠s\*\//);
  assert.match(ui, /stripWarning\(line\.text\)/);
});

test("plainError returns ApiError text only; raw exception text never leaks", () => {
  assert.equal(plainError(new ApiError("Google isn't connected.", 400), "Failed."), "Google isn't connected.");
  assert.equal(plainError(new TypeError("Cannot read properties of null (reading 'x')"), "Failed to load."), "Failed to load.");
  assert.equal(plainError("boom", "Failed."), "Failed.");
  assert.equal(plainError(null, "Failed."), "Failed.");
  assert.equal(plainError(new ApiError("  ", 500), "Failed."), "Failed.");
});

test("done and error lines leave the bar after the TTL; running lines and history stay", () => {
  const t0 = 1_000_000;
  const done: LogLine[] = [{ type: "cmd", text: "a", at: t0 }, { type: "done", text: "ok", at: t0 }];
  assert.deepEqual(headerStatus(done, t0 + STATUS_TTL_MS - 1), { kind: "done", text: "ok" });
  assert.deepEqual(headerStatus(done, t0 + STATUS_TTL_MS), { kind: "idle" });
  const err: LogLine[] = [{ type: "error", text: "⚠ no", at: t0 }];
  assert.deepEqual(headerStatus(err, t0 + 60_000), { kind: "idle" });
  // a newer running line always shows, and a line without a timestamp never expires
  assert.deepEqual(headerStatus([...err, { type: "cmd", text: "next", at: t0 + 59_000 }], t0 + 60_000), { kind: "running", text: "next" });
  assert.deepEqual(headerStatus([{ type: "done", text: "ok" }], t0 + 999_999), { kind: "done", text: "ok" });
  // no clock passed: unchanged behaviour
  assert.deepEqual(headerStatus(err), { kind: "error", text: "⚠ no" });
  assert.equal(done.length, 2);
});

test("statusExpiresAt gives the latest finished line's deadline, null otherwise", () => {
  assert.equal(statusExpiresAt([]), null);
  assert.equal(statusExpiresAt([{ type: "cmd", text: "a", at: 5 }]), null);
  assert.equal(statusExpiresAt([{ type: "done", text: "a", at: 5 }, { type: "divider", text: "-" }]), 5 + STATUS_TTL_MS);
  assert.equal(statusExpiresAt([{ type: "done", text: "a" }]), null);
});
