import type { Action } from "../actions/actionTypes.ts";
import type { PageFingerprint } from "../search/pageFingerprint.ts";

/** Where a tracked action remembers the fix PR opened for it (not an implementation yet; that waits for the merge). */
export function pullRequestUrlOf(result: Action["result"]): string | null {
  const pr = (result as { pullRequest?: { url?: unknown } } | null)?.pullRequest;
  return typeof pr?.url === "string" ? pr.url : null;
}

function fingerprintValue(value: unknown): PageFingerprint | null {
  const v = value as Partial<PageFingerprint> | null | undefined;
  return v && typeof v.title === "string" && typeof v.description === "string" && typeof v.h1 === "string"
    ? { title: v.title, description: v.description, h1: v.h1 }
    : null;
}

/**
 * The page's title/description/heading as they were when the PR was OPENED (before any merge).
 * Returns undefined when the PR was linked before this was recorded, so the caller can fall back
 * to a live fetch; returns null when it was recorded but the page could not be read.
 */
export function pullRequestPageBeforeOf(result: Action["result"]): PageFingerprint | null | undefined {
  const pr = (result as { pullRequest?: Record<string, unknown> } | null)?.pullRequest;
  if (!pr || typeof pr !== "object" || !("pageBefore" in pr)) return undefined;
  return fingerprintValue(pr.pageBefore);
}

/** The note left when a linked PR was closed without merging: its URL and when we noticed. */
export function closedPullRequestOf(result: Action["result"]): { url: string; closedAt: string } | null {
  const closed = (result as { closedPullRequest?: { url?: unknown; closedAt?: unknown } } | null)?.closedPullRequest;
  return typeof closed?.url === "string" && typeof closed?.closedAt === "string" ? { url: closed.url, closedAt: closed.closedAt } : null;
}

/**
 * When a fix PR is opened for a finding, which of its tracked actions should remember it, and with what result.
 * Only open (proposed/approved) actions that don't already have a PR; completed ones are left alone.
 * A new PR also clears the note about an older PR that was closed without merging.
 */
export function linkPullRequest(
  actions: Action[],
  prUrl: string,
  pageBefore: PageFingerprint | null = null,
): Array<{ id: string; result: Record<string, unknown> }> {
  return actions
    .filter((a) => (a.status === "proposed" || a.status === "approved") && !pullRequestUrlOf(a.result))
    .map((a) => {
      const result: Record<string, unknown> = { ...(a.result ?? {}), pullRequest: { url: prUrl, pageBefore } };
      delete result.closedPullRequest;
      return { id: a.id, result };
    });
}
