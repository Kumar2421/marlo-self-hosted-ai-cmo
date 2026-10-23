import test from "node:test";
import assert from "node:assert/strict";
import { EM_DASH, formatCompact, headerCenter, statItem, type StatsInput } from "../lib/domain/navbar/headerCenter.ts";

const ready: StatsInput = { clicks: { state: "ready", value: 1234 }, findings: { state: "ready", value: 7 }, leads: { state: "ready", value: 0 } };

test("formatCompact is compact and never invents a number", () => {
  const cases: Array<[number, string]> = [
    [0, "0"],
    [7, "7"],
    [999, "999"],
    [1000, "1K"],
    [1234, "1.2K"],
    [9949, "9.9K"],
    [12_400, "12K"],
    [999_499, "999K"],
    [999_950, "1M"],
    [1_500_000, "1.5M"],
    [25_000_000, "25M"],
    [3_200_000_000, "3.2B"],
    [Number.NaN, EM_DASH],
    [Number.POSITIVE_INFINITY, EM_DASH],
    [-3, EM_DASH],
  ];
  for (const [input, want] of cases) assert.equal(formatCompact(input), want, String(input));
});

test("busy shows the status line; idle and info show the numbers", () => {
  const cases: Array<[Parameters<typeof headerCenter>[0], "status" | "stats"]> = [
    [{ kind: "idle" }, "stats"],
    [{ kind: "info", text: "x" }, "stats"],
    [{ kind: "running", text: "Auditing" }, "status"],
    [{ kind: "done", text: "ok" }, "status"],
    [{ kind: "error", text: "no" }, "status"],
  ];
  for (const [status, mode] of cases) assert.equal(headerCenter(status, ready).mode, mode, status.kind);
  assert.deepEqual(headerCenter({ kind: "running", text: "Auditing" }, ready), { mode: "status", kind: "running", text: "Auditing" });
});

test("idle numbers: order, labels, compact display, and a real zero stays a zero", () => {
  const c = headerCenter({ kind: "idle" }, ready);
  assert.equal(c.mode, "stats");
  if (c.mode !== "stats") return;
  assert.deepEqual(c.items.map((i) => [i.key, i.label, i.display]), [
    ["clicks", "Clicks 28d", "1.2K"],
    ["findings", "Open findings", "7"],
    ["leads", "Leads", "0"],
  ]);
  assert.equal(c.items[0].title, "Search Console clicks, last 28 days: 1,234");
});

test("unavailable numbers are an em dash or a Connect Google link, never zero", () => {
  const cases: Array<[Parameters<typeof statItem>[0], Parameters<typeof statItem>[1], string, "connect-google" | null, RegExp]> = [
    ["clicks", { state: "pending" }, EM_DASH, null, /loading/],
    ["clicks", { state: "error" }, EM_DASH, null, /not available/],
    ["clicks", { state: "connect" }, "Connect Google", "connect-google", /connect Google/],
    ["findings", { state: "pending" }, EM_DASH, null, /loading/],
    ["findings", { state: "error" }, EM_DASH, null, /not available/],
    ["findings", { state: "connect" }, EM_DASH, null, /not available/],
    ["leads", { state: "error" }, EM_DASH, null, /not available/],
    ["leads", { state: "ready", value: Number.NaN }, EM_DASH, null, /not available/],
  ];
  for (const [key, input, display, action, title] of cases) {
    const item = statItem(key, input);
    assert.equal(item.display, display, `${key} ${input.state}`);
    assert.equal(item.action, action);
    assert.match(item.title, title);
  }
});
