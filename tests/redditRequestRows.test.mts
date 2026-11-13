import test from "node:test";
import assert from "node:assert/strict";
import { foundLabel, formatRepliesToAnswer, groupRequests, rulesUrl, toRequestRows } from "../lib/domain/leads/intent/redditRequestRows.ts";

const POST = "https://www.reddit.com/r/smallbusiness/comments/1xr59oi/need_a_crm/";
const lead = (over: Record<string, unknown> = {}) => ({
  id: "a", name: "Recommend a CRM for a small clinic", company: "r/smallbusiness", lead_type: "intent", source_url: POST,
  fit_reason: 'Asked on r/smallbusiness: "Recommend a CRM for a small clinic".', description: "A reply.", tags: null, created_at: "2026-11-13T08:00:00Z", ...over,
});

test("only requests with a Reddit post address become rows, with the subreddit, canonical address and quote", () => {
  const rows = toRequestRows([lead(), { ...lead({ id: "p", lead_type: "person" }) }, lead({ id: "c", lead_type: "company" })]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].subreddit, rows[0].url, rows[0].quote, rows[0].reply], ["smallbusiness", "https://www.reddit.com/r/smallbusiness/comments/1xr59oi/", "Recommend a CRM for a small clinic", "A reply."]);
});

test("the subreddit falls back to the saved company name when the address is not a post, and the address is then null", () => {
  const rows = toRequestRows([lead({ source_url: "https://www.reddit.com/r/smallbusiness/" })]);
  assert.equal(rows[0].subreddit, "smallbusiness");
  assert.equal(rows[0].url, null);
  assert.equal(toRequestRows([lead({ source_url: null, company: "" })]).length, 0);
});

test("status comes from the lead's tags: contacted or replied is posted, not interested is dismissed", () => {
  const rows = toRequestRows([lead({ id: "n" }), lead({ id: "p", tags: ["status:contacted"] }), lead({ id: "r", tags: ["status:replied"] }), lead({ id: "d", tags: ["status:not_interested"] })]);
  const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  assert.deepEqual(status, { n: "new", p: "posted", r: "posted", d: "dismissed" });
});

test("groups hide dismissed requests, and rows are newest first", () => {
  const rows = toRequestRows([lead({ id: "old", created_at: "2026-11-01T00:00:00Z" }), lead({ id: "new", created_at: "2026-11-13T00:00:00Z" }), lead({ id: "x", tags: ["status:not_interested"] }), lead({ id: "pp", tags: ["status:contacted"] })]);
  const g = groupRequests(rows);
  assert.deepEqual(g.toAnswer.map((r) => r.id), ["new", "old"]);
  assert.deepEqual(g.posted.map((r) => r.id), ["pp"]);
});

test("a missing quote or reply reads as empty text, never undefined", () => {
  const [row] = toRequestRows([lead({ fit_reason: null, description: null })]);
  assert.equal(row.quote, "");
  assert.equal(row.reply, "");
});

test("the rules link points at the subreddit's own rules page, from any spelling", () => {
  assert.equal(rulesUrl("smallbusiness"), "https://www.reddit.com/r/smallbusiness/about/rules");
  assert.equal(rulesUrl("r/startups"), "https://www.reddit.com/r/startups/about/rules");
});

test("age and count wording", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  assert.equal(foundLabel("2026-11-13T01:00:00Z", now), "Found today");
  assert.equal(foundLabel("2026-11-12T01:00:00Z", now), "Found yesterday");
  assert.equal(foundLabel("2026-11-10T01:00:00Z", now), "Found 3 days ago");
  assert.equal(foundLabel("nonsense", now), "Found recently");
  assert.equal(foundLabel("2026-11-20T00:00:00Z", now), "Found today");
  assert.deepEqual([0, 1, 4].map(formatRepliesToAnswer), ["No replies to answer", "1 reply to answer", "4 replies to answer"]);
});
