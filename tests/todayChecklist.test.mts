import test from "node:test";
import assert from "node:assert/strict";
import { buildTodayChecklist, checklistProgressText, type ChecklistInput } from "../lib/domain/overview/todayChecklist.ts";

const base: ChecklistInput = { openFixPullRequests: 0, newFindings: 0, queuedOutreach: 0 };

test("checklist table", () => {
  const cases: Array<{ name: string; input: ChecklistInput; labels: string[]; done: number; text: string }> = [
    { name: "nothing to do", input: base, labels: [], done: 0, text: "Nothing to do today" },
    {
      name: "all outstanding",
      input: { ...base, openFixPullRequests: 1, newFindings: 4, queuedOutreach: 3 },
      labels: ["Review 1 fix PR", "Check new findings", "Send queued outreach"],
      done: 0,
      text: "0 of 3 done",
    },
    {
      name: "plural PRs and a pending change",
      input: { ...base, openFixPullRequests: 2, pendingActions: 1 },
      labels: ["Review 2 fix PRs", "Approve 1 suggested change"],
      done: 0,
      text: "0 of 2 done",
    },
    {
      name: "PR reviewed today counts as done",
      input: { ...base, pullRequestsReviewedToday: 1, newFindings: 2, queuedOutreach: 1, outreachSentToday: 2 },
      labels: ["Review 1 fix PR", "Check new findings", "Send queued outreach"],
      done: 1,
      text: "1 of 3 done",
    },
    {
      name: "everything handled",
      input: { ...base, pullRequestsReviewedToday: 2, findingsCheckedToday: 3, outreachSentToday: 5 },
      labels: ["Review 2 fix PRs", "Check new findings", "Send queued outreach"],
      done: 3,
      text: "3 of 3 done",
    },
    {
      name: "bad numbers are ignored",
      input: { ...base, openFixPullRequests: -2, newFindings: Number.NaN, queuedOutreach: 1.9 },
      labels: ["Send queued outreach"],
      done: 0,
      text: "0 of 1 done",
    },
  ];
  for (const c of cases) {
    const list = buildTodayChecklist(c.input);
    assert.deepEqual(list.items.map((i) => i.label), c.labels, c.name);
    assert.equal(list.total, c.labels.length, c.name);
    assert.equal(list.done, c.done, c.name);
    assert.equal(list.done, list.items.filter((i) => i.done).length, c.name);
    assert.equal(checklistProgressText(list), c.text, c.name);
  }
});

test("item ids are stable and unique", () => {
  const list = buildTodayChecklist({ openFixPullRequests: 1, pendingActions: 1, newFindings: 1, queuedOutreach: 1 });
  assert.deepEqual(list.items.map((i) => i.id), ["review-prs", "review-actions", "check-findings", "send-outreach"]);
});

test("deterministic and does not mutate input", () => {
  const input: ChecklistInput = { openFixPullRequests: 1, newFindings: 2, queuedOutreach: 3, outreachSentToday: 1 };
  const before = structuredClone(input);
  assert.deepEqual(buildTodayChecklist(input), buildTodayChecklist(input));
  assert.deepEqual(input, before);
});
