import type { PRInfo } from "../fixes/FixDelivery.ts";
import { firstOpenPr, openPrForBranchPrefix, type OpenPullRequest } from "./openPrPolicy.ts";

/** A PR the finding already has, or a freshly opened one. `branch` is "" when an existing PR's branch is not known. */
export type OpenFixOutcome =
  | { kind: "existing"; prUrl: string; branch: string }
  | { kind: "opened"; prUrl: string; branch: string; files: string[] };

export type OpenFixPorts = {
  /** PR URLs already tied to this finding (see linkedPrCandidates). */
  linkedPrUrls: () => Promise<string[]>;
  /** GitHub's view of one PR (FixDeliveryPort.status). */
  prStatus: (prUrl: string) => Promise<PRInfo>;
  /** Open PRs in the repo. A failure here must throw: guessing "none open" would duplicate a PR. */
  listOpenPullRequests: () => Promise<OpenPullRequest[]>;
  /** Creates the branch, commits and opens the PR. Cleans up its own branch when it fails. */
  openPr: () => Promise<{ prUrl: string; branch: string; files: string[] }>;
};

/**
 * Before opening a fix PR, reuse an open one the finding already has: first a linked PR that GitHub
 * still reports as open, then an open PR on this label's branch (which covers a retry after the PR was
 * created but never recorded). Only when neither exists is a new PR opened.
 */
export async function openOrReuseFixPr(ports: OpenFixPorts, opts: { branchPrefix: string }): Promise<OpenFixOutcome> {
  const linked = await firstOpenPr(await ports.linkedPrUrls(), ports.prStatus);
  if (linked) return { kind: "existing", prUrl: linked, branch: "" };

  const match = openPrForBranchPrefix(await ports.listOpenPullRequests(), opts.branchPrefix);
  if (match) return { kind: "existing", prUrl: match.url, branch: match.headRef };

  const opened = await ports.openPr();
  return { kind: "opened", ...opened };
}
