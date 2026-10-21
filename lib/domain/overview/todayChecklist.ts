/** Pure "N of M done" checklist for the Today overview. Counts in, items out; no clock or storage. */
import { CHECKLIST_COPY } from "./copy.ts";

export type ChecklistInput = {
  /** Fix pull requests still waiting for review, and how many were reviewed today. */
  openFixPullRequests: number;
  pullRequestsReviewedToday?: number;
  /** Findings still new, and how many were looked at today. */
  newFindings: number;
  findingsCheckedToday?: number;
  /** Suggested changes still waiting for approval, and how many were handled today. */
  pendingActions?: number;
  actionsHandledToday?: number;
  /** Outreach emails still queued, and how many were sent today. */
  queuedOutreach: number;
  outreachSentToday?: number;
};

export type ChecklistItem = { id: string; label: string; done: boolean };
export type TodayChecklist = { done: number; total: number; items: ChecklistItem[] };

function count(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function buildTodayChecklist(input: ChecklistInput): TodayChecklist {
  const items: ChecklistItem[] = [];
  const add = (id: string, remaining: number | undefined, handled: number | undefined, label: (total: number) => string) => {
    const left = count(remaining);
    const total = left + count(handled);
    if (total > 0) items.push({ id, label: label(total), done: left === 0 });
  };

  add("review-prs", input.openFixPullRequests, input.pullRequestsReviewedToday, CHECKLIST_COPY.reviewPrs);
  add("review-actions", input.pendingActions, input.actionsHandledToday, CHECKLIST_COPY.reviewActions);
  add("check-findings", input.newFindings, input.findingsCheckedToday, () => CHECKLIST_COPY.checkFindings);
  add("send-outreach", input.queuedOutreach, input.outreachSentToday, () => CHECKLIST_COPY.sendOutreach);

  return { done: items.filter((i) => i.done).length, total: items.length, items };
}

/** "2 of 3 done", or a calm line when there is nothing to do. */
export function checklistProgressText(checklist: Pick<TodayChecklist, "done" | "total">): string {
  return CHECKLIST_COPY.progress(checklist.done, checklist.total);
}
