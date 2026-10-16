import type { Action } from "../actions/actionTypes.ts";
import type { OutcomePorts } from "../search/outcomeService.ts";
import type { FixDeliveryPort } from "./FixDelivery.ts";
import { pullRequestUrlOf } from "./linkPullRequest.ts";
import { reconcileFixPullRequests } from "./reconcileFixPullRequests.ts";
import { withDeadline } from "./withDeadline.ts";

/**
 * Daily sweep over every project with a GitHub App link, so a merged PR is noticed even when nobody
 * opens the finding. Pure: storage, GitHub and the clock come in through ports, so the rules are tested
 * with fakes. The cron route supplies the real ones.
 */

export type LinkedProject = { projectId: string; userId: string };

export type ReconcileAllPorts = {
  /** Every project that has a GitHub App link (any order; this function sorts and rotates them). */
  linkedProjects(): Promise<LinkedProject[]>;
  /** The project's actions. Only the ones with a linked pull request and still open are reconciled. */
  actionsFor(project: LinkedProject): Promise<Action[]>;
  /** Outcome ports and the PR status checker for one project, or null when no GitHub token is available. */
  inputsFor(project: LinkedProject): Promise<{ ports: OutcomePorts; fixDelivery: FixDeliveryPort } | null>;
};

export type ReconcileAllSummary = {
  /** Linked projects found. */
  linked: number;
  /** Projects checked against GitHub (they had at least one open linked pull request). */
  processed: number;
  /** Projects with nothing to check, no token, or no time left in the budget. */
  skipped: number;
  implemented: number;
  closed: number;
  /** Actions whose PR GitHub could not be asked about in this run (they are retried next run). */
  failedActions: number;
  /** Projects that failed as a whole. Only the project id and a generic message, never a secret. */
  failedProjects: Array<{ projectId: string; error: string }>;
  /** True when the time budget ran out before every project was looked at. */
  interrupted: boolean;
};

const DAY_MS = 86_400_000;

/** An action still waiting on its pull request to be merged or closed. */
export function hasPendingPullRequest(action: Action): boolean {
  return (action.status === "proposed" || action.status === "approved") && pullRequestUrlOf(action.result) !== null;
}

/**
 * Mint the GitHub token only when a linked pull request is actually pending. Minting is the costly step, so a
 * page load or cron run with nothing to check must not do it.
 */
export async function tokenForPendingPullRequests<T>(actions: Action[], mint: () => Promise<T | null>): Promise<T | null> {
  return actions.some(hasPendingPullRequest) ? mint() : null;
}

/** Stable order first, then a different starting project each day, so a short budget never favours the same projects. */
export function rotateForDay<T>(items: T[], dayIndex: number): T[] {
  if (items.length === 0) return [];
  const start = ((dayIndex % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

export async function reconcileAllProjects(
  ports: ReconcileAllPorts,
  options: { budgetMs: number; now?: () => number },
): Promise<ReconcileAllSummary> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  const remaining = () => deadline - now();
  const linkedAll = await withDeadline(() => ports.linkedProjects(), options.budgetMs);
  const sorted = [...linkedAll].sort((a, b) => a.projectId.localeCompare(b.projectId) || a.userId.localeCompare(b.userId));
  const ordered = rotateForDay(sorted, Math.floor(now() / DAY_MS));

  const summary: ReconcileAllSummary = {
    linked: linkedAll.length,
    processed: 0,
    skipped: 0,
    implemented: 0,
    closed: 0,
    failedActions: 0,
    failedProjects: [],
    interrupted: false,
  };

  for (let index = 0; index < ordered.length; index += 1) {
    if (remaining() <= 0) {
      summary.interrupted = true;
      summary.skipped += ordered.length - index;
      break;
    }
    const project = ordered[index];
    try {
      const actions = await withDeadline(() => ports.actionsFor(project), remaining());
      if (!actions.some(hasPendingPullRequest)) {
        summary.skipped += 1;
        continue;
      }
      const inputs = await withDeadline(() => ports.inputsFor(project), remaining());
      if (!inputs) {
        summary.skipped += 1;
        continue;
      }
      summary.processed += 1;
      const outcome = await reconcileFixPullRequests(inputs.ports, inputs.fixDelivery, actions, new Date(now()), { remainingMs: remaining });
      summary.implemented += outcome.implemented;
      summary.closed += outcome.closed;
      summary.failedActions += outcome.failed.length;
    } catch {
      summary.failedProjects.push({ projectId: project.projectId, error: "Could not reconcile this project's pull requests." });
    }
  }

  return summary;
}
