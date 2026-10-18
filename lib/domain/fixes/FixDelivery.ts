/**
 * FixDelivery abstracts how fixes (e.g., code PRs, manual changes) are tracked
 * and reconciled. Different implementations handle GitHub PRs, future integrations, etc.
 */

/**
 * "open" and "merged" and "closed" are what the host said. "closed" means really closed without
 * a merge. "unknown" means we could not ask (token problem, GitHub outage, bad response): it must
 * never be treated as closed, or a transient failure would drop a live pull request.
 */
export type PRStatus = "open" | "merged" | "closed" | "unknown";

export type PRInfo = {
  state: PRStatus;
  mergedAt?: string; // ISO 8601 timestamp when PR was merged, undefined if not merged
};

export type FixDeliveryPort = {
  /** Check the status of a PR by its URL, returning state and optional merge time. Never throws. */
  status(prUrl: string): Promise<PRInfo>;
};
