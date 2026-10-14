import type { Action } from "../actions/actionTypes.ts";
import { implementationOf } from "../search/actionOutcome.ts";
import { implementAction, type OutcomePorts } from "../search/outcomeService.ts";
import { pullRequestUrlOf } from "./linkPullRequest.ts";
import type { FixDeliveryPort } from "./FixDelivery.ts";

export type ReconcileResult = {
  implemented: number;
  /** Linked PRs closed without merging: the link was cleared and a note left. Also counted in `skipped`. */
  closed: number;
  skipped: number;
  /** GitHub could not be asked (token, outage, bad response): nothing was changed, try again next run. */
  failed: Array<{ actionId: string; error: string }>;
};

/**
 * Extract PR URL from an action's stored data (result.implementation.change.prUrl).
 */
function extractPrUrl(action: Action): string | null {
  const linked = pullRequestUrlOf(action.result);
  if (linked) return linked;
  const prUrl = implementationOf(action.result)?.change?.prUrl;
  return typeof prUrl === "string" ? prUrl : null;
}

/**
 * Reconcile tracked actions with merged GitHub PRs.
 *
 * For each action with a PR URL that has been merged but not yet marked as
 * implemented, call implementAction() with via="github_pr" using the actual
 * merge timestamp from GitHub. Idempotent: already-implemented actions are
 * skipped, closed/unmerged PRs are ignored.
 *
 * A PR that GitHub reports as closed WITHOUT a merge has its link removed (so a new fix can be
 * prepared) and leaves a `closedPullRequest` note for the UI. A PR we could not check ("unknown")
 * changes nothing and is reported as failed.
 *
 * Returns a summary; failures are logged (without secrets) but don't block others.
 */
export async function reconcileFixPullRequests(
  ports: OutcomePorts,
  fixDelivery: FixDeliveryPort,
  actions: Action[],
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const result: ReconcileResult = { implemented: 0, closed: 0, skipped: 0, failed: [] };

  for (const action of actions) {
    // Only reconcile actions that are not yet completed
    if (action.status !== "proposed" && action.status !== "approved") {
      result.skipped += 1;
      continue;
    }

    // Skip if already implemented via GitHub
    const impl = implementationOf(action.result);
    if (impl && impl.via === "github_pr") {
      result.skipped += 1;
      continue;
    }

    // Extract PR URL from action data
    const prUrl = extractPrUrl(action);
    if (!prUrl) {
      result.skipped += 1;
      continue;
    }

    try {
      const prInfo = await fixDelivery.status(prUrl);

      if (prInfo.state === "unknown") {
        result.failed.push({ actionId: action.id, error: "Could not check the pull request on GitHub right now." });
        continue;
      }

      if (prInfo.state === "closed") {
        // Closed without merging: drop the link so a new fix can be linked, and keep a note of it for the UI.
        const kept: Record<string, unknown> = { ...(action.result ?? {}) };
        delete kept.pullRequest;
        await ports.saveResult(action.id, { ...kept, closedPullRequest: { url: prUrl, closedAt: now.toISOString() } });
        result.closed += 1;
        result.skipped += 1;
        continue;
      }

      if (prInfo.state === "merged" && prInfo.mergedAt) {
        // Mark as implemented with actual merge time
        const implementResult = await implementAction(ports, {
          actionId: action.id,
          via: "github_pr",
          change: { prUrl },
          now: new Date(prInfo.mergedAt),
        });
        if (implementResult.ok) {
          result.implemented += 1;
        } else {
          result.failed.push({
            actionId: action.id,
            error: `implementAction failed: ${implementResult.error}`,
          });
        }
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.failed.push({ actionId: action.id, error: msg });
      // Warn without revealing secrets
      console.warn(`[reconcileFixPullRequests] Failed to reconcile action ${action.id}: ${msg}`);
    }
  }

  if (result.failed.length > 0) {
    console.warn(`[reconcileFixPullRequests] ${result.failed.length} action(s) failed reconciliation`);
  }

  return result;
}
