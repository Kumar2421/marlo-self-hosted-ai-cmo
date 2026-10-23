import { test } from "node:test";
import * as assert from "node:assert";
import { checkReplyGrounding } from "../lib/domain/assistant/replyGrounding.ts";

const today = new Date("2026-10-23T12:00:00Z");
const search = JSON.stringify({
  dataDate: "2026-10-21", window: { from: "2026-09-23", to: "2026-10-20" },
  totals: { clicks: 1234, views: 45600, avgPosition: 8.4 },
  previous28Days: { clicks: 1500, views: 40000, avgPosition: 7.9 },
  topQueries: [{ query: "seo tool", clicks: 5, views: 100, position: 3.2, ctr: 0.034 }, { query: "audit", clicks: 3, views: 90, position: 9 }],
});
const audit = JSON.stringify({ url: "https://acme.io", checkedAt: "2026-10-18T09:00:00Z", errors: 4, warnings: 11, topIssues: [{ label: "Missing title" }, { label: "Slow LCP" }] });

type Row = { name: string; reply: string; results: string[]; expect: Array<[string, string]> };
const rows: Row[] = [
  { name: "grounded numbers, thousands separator", reply: "You got 1,234 clicks and 45,600 views in the last 28 days.", results: [search], expect: [] },
  { name: "1234 in tool vs 1,234 in reply", reply: "Clicks were 1,234.", results: ['{"clicks":1234}'], expect: [] },
  { name: "5 clicks vs 5", reply: "Your top query got 5 clicks.", results: [search], expect: [] },
  { name: "invented clicks", reply: "You got 2,950 clicks last month.", results: [search], expect: [["number", "2,950"]] },
  { name: "rounded position", reply: "Average position is about 8.", results: [search], expect: [] },
  { name: "rounded to one decimal", reply: "Position 3.2 for seo tool.", results: [search], expect: [] },
  { name: "k shorthand", reply: "About 45.6k views.", results: [search], expect: [] },
  { name: "ctr as percent", reply: "CTR of 3.4% on that query.", results: [search], expect: [] },
  { name: "invented percent", reply: "Traffic is down 27% this month.", results: [search], expect: [["percent", "27%"]] },
  { name: "numbered list is not flagged", reply: "1. Fix the title\n2. Fix the LCP\n3) Re-run the audit", results: [audit], expect: [] },
  { name: "small generic numbers", reply: "There is one thing to fix first, and two more after.", results: [audit], expect: [] },
  { name: "this year not flagged", reply: "Since 2026 the trend is up.", results: [search], expect: [] },
  { name: "other year flagged", reply: "Back in 2019 you ranked higher.", results: [search], expect: [["number", "2019"]] },
  { name: "ISO date grounded", reply: "Data is from 2026-10-21.", results: [search], expect: [] },
  { name: "long date grounded", reply: "The audit ran on October 18, 2026.", results: [audit], expect: [] },
  { name: "day-month date grounded", reply: "Last audited 18 Oct.", results: [audit], expect: [] },
  { name: "us slash date grounded", reply: "Checked 10/18/2026.", results: [audit], expect: [] },
  { name: "invented date", reply: "Your traffic fell on September 3.", results: [search], expect: [["date", "September 3"]] },
  { name: "invented ISO date", reply: "It was fixed on 2026-08-14.", results: [audit], expect: [["date", "2026-08-14"]] },
  { name: "today's date allowed", reply: "As of October 23, 2026 nothing changed.", results: [], expect: [] },
  { name: "month-year from data", reply: "In October 2026 the clicks dipped.", results: [search], expect: [] },
  { name: "grounded domain", reply: "Your site acme.io has 4 errors.", results: [audit], expect: [] },
  { name: "invented domain", reply: "Compare yourself with rival-seo.com and acme.io.", results: [audit], expect: [["domain", "rival-seo.com"]] },
  { name: "domain from user text", reply: "Looking at foo.dev now.", results: [], expect: [] },
  { name: "email local part is not a domain", reply: "Write to sam@acme.io.", results: [], expect: [] },
  { name: "array length counts as grounded", reply: "There are 2 top issues.", results: [audit], expect: [] },
  { name: "partially invented", reply: "You have 4 errors, 11 warnings and 37 broken links on acme.io.", results: [audit], expect: [["number", "37"]] },
  { name: "durations are generic", reply: "Over the last 28 days and 7 days before.", results: [], expect: [] },
  { name: "empty reply", reply: "", results: [audit], expect: [] },
];

for (const r of rows) {
  test(`replyGrounding: ${r.name}`, () => {
    const res = checkReplyGrounding(r.reply, r.results, { today, extraGrounded: r.name === "domain from user text" ? ["please check foo.dev"] : [] });
    assert.deepEqual(res.unverified.map((u) => [u.kind, u.text]), r.expect, JSON.stringify(res));
    assert.equal(res.ok, r.expect.length === 0);
  });
}

test("replyGrounding never throws on garbage and dedupes repeats", () => {
  assert.equal(checkReplyGrounding("x".repeat(10000), ["{bad json"]).ok, true);
  const res = checkReplyGrounding("999 and again 999", []);
  assert.equal(res.unverified.length, 1);
});
