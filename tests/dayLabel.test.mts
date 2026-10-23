import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDaysAgo, relativeDayLabel, shortDateLabel } from "../lib/domain/shared/dayLabel.ts";
import { lastAuditedLabel } from "../lib/domain/seo/auditDisplay.ts";
import { pendingOpenRequest } from "../lib/domain/overview/fixFirst.ts";

const cases: Array<[string, string, string, string, string]> = [
  // [name, then, now, timeZone, expected]
  ["the reported bug: audited last evening UTC, now next morning (under 24h)", "2026-10-22T20:00:00Z", "2026-10-23T09:00:00Z", "UTC", "yesterday"],
  ["same UTC day", "2026-10-23T01:00:00Z", "2026-10-23T09:00:00Z", "UTC", "today"],
  ["just before midnight UTC vs just after", "2026-10-22T23:59:00Z", "2026-10-23T00:01:00Z", "UTC", "yesterday"],
  ["same local day in UTC+5:30 though UTC days differ", "2026-10-22T19:00:00Z", "2026-10-23T03:00:00Z", "Asia/Kolkata", "today"],
  ["different local day in UTC+5:30 though UTC day is the same", "2026-10-22T17:00:00Z", "2026-10-22T19:00:00Z", "Asia/Kolkata", "yesterday"],
  ["UTC+5:30 midnight boundary", "2026-10-22T18:29:00Z", "2026-10-22T18:31:00Z", "Asia/Kolkata", "yesterday"],
  ["US west coast: 8pm then, 1am now is a new local day though both are Oct 23 UTC", "2026-10-23T03:00:00Z", "2026-10-23T08:00:00Z", "America/Los_Angeles", "yesterday"],
  ["three days", "2026-10-20T12:00:00Z", "2026-10-23T09:00:00Z", "UTC", "3 days ago"],
  ["16 days across a month", "2026-10-06T08:30:00Z", "2026-10-22T12:00:00Z", "UTC", "16 days ago"],
  ["a future time reads as today", "2026-10-24T12:00:00Z", "2026-10-23T09:00:00Z", "UTC", "today"],
  ["DST end (Europe/London, 25h day) still counts calendar days", "2026-10-24T12:00:00Z", "2026-10-26T12:00:00Z", "Europe/London", "2 days ago"],
];
for (const [name, then, now, tz, expected] of cases) {
  test(`relativeDayLabel: ${name}`, () => {
    assert.equal(relativeDayLabel(new Date(then), new Date(now), tz), expected);
  });
}

test("calendarDaysAgo counts whole calendar days", () => {
  assert.equal(calendarDaysAgo(new Date("2026-10-22T23:00:00Z"), new Date("2026-10-23T01:00:00Z"), "UTC"), 1);
  assert.equal(calendarDaysAgo(new Date("2026-10-23T01:00:00Z"), new Date("2026-10-22T23:00:00Z"), "UTC"), -1);
});

test("the date shown and the age use the same calendar", () => {
  const then = new Date("2026-10-22T20:00:00Z");
  assert.equal(shortDateLabel(then, "UTC"), "Oct 22, 2026");
  assert.equal(shortDateLabel(then, "Asia/Kolkata"), "Oct 23, 2026");
  const now = new Date("2026-10-23T09:00:00Z");
  assert.equal(lastAuditedLabel(then.toISOString(), now, "UTC"), "Last audited Oct 22, 2026 (yesterday)");
  assert.equal(lastAuditedLabel(then.toISOString(), now, "Asia/Kolkata"), "Last audited Oct 23, 2026 (today)");
});

test("pendingOpenRequest: acts on a new request once, ignores none and repeats", () => {
  assert.equal(pendingOpenRequest(null, null), null);
  assert.equal(pendingOpenRequest({ id: "f1", n: 1 }, null), "f1");
  assert.equal(pendingOpenRequest({ id: "f1", n: 1 }, 1), null);
  assert.equal(pendingOpenRequest({ id: "f1", n: 2 }, 1), "f1");
  assert.equal(pendingOpenRequest({ id: "", n: 1 }, null), null);
});
