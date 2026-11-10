import test from "node:test";
import assert from "node:assert/strict";
import { computeOutcomes, outcomeLine, reachedDateFromTags, stampReached } from "../lib/domain/leads/outcomes.ts";

const good = { fit_reason: "fits", source_url: "https://x.test/contact" };
const NOW = new Date("2026-11-12T10:00:00Z");

test("no leads, then leads but nothing reached, read honestly", () => {
  assert.equal(outcomeLine(computeOutcomes([], NOW)).display, "No leads yet");
  const s = computeOutcomes([{ email: "a@x.test", ...good }, { email: null }], NOW);
  assert.equal(s.qualified, 1);
  assert.equal(outcomeLine(s).display, "1 qualified · none reached yet");
});

test("a sent email counts as reached and starts the window on its send date", () => {
  const s = computeOutcomes([{ email: "a@x.test", email_status: "sent", emailed_at: "2026-11-10T08:00:00Z", ...good }], NOW);
  assert.equal(s.reached, 1);
  assert.equal(s.startedAt, "2026-11-10");
  assert.equal(s.day, 3);
  assert.equal(outcomeLine(s).display, "Day 3 of 7 · 1 reached · 0 replied");
});

test("marking contacted or replied by hand counts; replied also counts as reached", () => {
  const s = computeOutcomes(
    [
      { email: null, whatsapp: "+919876543210", tags: ["status:contacted", "reached:2026-11-11"], ...good },
      { email: null, whatsapp: "+919876543211", tags: ["status:replied", "reached:2026-11-12"], ...good },
    ],
    NOW,
  );
  assert.deepEqual([s.reached, s.replied, s.startedAt, s.day], [2, 1, "2026-11-11", 2]);
});

test("an email reply found through Gmail counts as a reply", () => {
  const s = computeOutcomes([{ email: "a@x.test", email_status: "sent", emailed_at: "2026-11-12T01:00:00Z", last_reply_at: "2026-11-12T09:00:00Z", ...good }], NOW);
  assert.equal(s.replied, 1);
  assert.equal(outcomeLine(s).display, "Day 1 of 7 · 1 reached · 1 replied");
});

test("the earliest message sets the start, and a failed or unsent email is not reached", () => {
  const s = computeOutcomes(
    [
      { email: "a@x.test", email_status: "sent", emailed_at: "2026-11-09T08:00:00Z", ...good },
      { email: "b@x.test", email_status: "sent", emailed_at: "2026-11-11T08:00:00Z", ...good },
      { email: "c@x.test", email_status: "failed", emailed_at: "2026-11-01T08:00:00Z", ...good },
    ],
    NOW,
  );
  assert.deepEqual([s.reached, s.startedAt, s.day], [2, "2026-11-09", 4]);
});

test("after seven days the line says the window is over instead of Day 9 of 7", () => {
  const s = computeOutcomes([{ email: "a@x.test", email_status: "sent", emailed_at: "2026-11-01T08:00:00Z", ...good }], NOW);
  assert.equal(s.windowOver, true);
  assert.equal(outcomeLine(s).display, "7 days done · 1 reached · 0 replied");
});

test("a reached lead with no date still counts but does not invent a start date", () => {
  const s = computeOutcomes([{ email: null, whatsapp: "+919876543210", tags: ["status:contacted"], ...good }], NOW);
  assert.deepEqual([s.reached, s.startedAt, s.day], [1, null, null]);
  assert.equal(outcomeLine(s).display, "1 reached · 0 replied");
});

test("stampReached adds the date once, only for contacted or replied, and keeps other tags", () => {
  const first = stampReached(["status:contacted", "x"], "contacted", new Date("2026-11-10T23:59:00Z"));
  assert.deepEqual(first, ["status:contacted", "x", "reached:2026-11-10"]);
  assert.deepEqual(stampReached(first, "replied", NOW), first);
  assert.deepEqual(stampReached(["status:new"], "new", NOW), ["status:new"]);
  assert.equal(reachedDateFromTags(["reached:garbage", "reached:2026-11-10"]), "2026-11-10");
  assert.equal(reachedDateFromTags(null), null);
});

test("the tooltip states the goal and the full counts", () => {
  const { title } = outcomeLine(computeOutcomes([{ email: "a@x.test", ...good }], NOW));
  assert.match(title, /1 qualified, 0 reached, 0 replied/);
  assert.match(title, /one real reply within 7 days/);
});
