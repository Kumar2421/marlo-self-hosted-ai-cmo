import type { Action } from "../actions/actionTypes.ts";
import type { PRInfo } from "../fixes/FixDelivery.ts";
import { pullRequestUrlOf } from "../fixes/linkPullRequest.ts";
import { branchSlugFor } from "./catalogFix.ts";

/**
 * Pure rules that stop a finding's fix from opening a second pull request, and that keep the
 * finding's recorded link from being overwritten. No I/O: callers pass GitHub lookups in as functions.
 */

export type OpenPullRequest = { url: string; headRef: string };

/** Every PR URL already tied to a finding: the code_fixes row first, then tracked actions. Deduplicated, order kept. */
export function linkedPrCandidates(codeFixPrUrl: string | null | undefined, actions: ReadonlyArray<{ result: Action["result"] }>): string[] {
  const urls: string[] = [];
  const add = (url: string | null | undefined) => {
    if (url && !urls.includes(url)) urls.push(url);
  };
  add(codeFixPrUrl);
  for (const action of actions) add(pullRequestUrlOf(action.result));
  return urls;
}

/** The first candidate GitHub reports as open. A candidate that can't be checked is skipped, not trusted. */
export async function firstOpenPr(candidates: readonly string[], status: (url: string) => Promise<PRInfo>): Promise<string | null> {
  for (const url of candidates) {
    try {
      if ((await status(url)).state === "open") return url;
    } catch {
      continue;
    }
  }
  return null;
}

/** Branch prefix Marlo gives every fix for this label; the timestamp suffix follows it (see branchNameFor). */
export function branchPrefixFor(label: string): string {
  return `marlo/${branchSlugFor(label)}-`;
}

/** True when `headRef` is the prefix plus exactly one base36 timestamp, so "marlo/missing-json-" never matches "marlo/missing-json-ld-…". */
export function matchesBranchPrefix(headRef: string, prefix: string): boolean {
  return headRef.startsWith(prefix) && /^[a-z0-9]+$/.test(headRef.slice(prefix.length));
}

export function openPrForBranchPrefix(prs: readonly OpenPullRequest[], prefix: string): OpenPullRequest | null {
  return prs.find((pr) => matchesBranchPrefix(pr.headRef, prefix)) ?? null;
}

export function openPrForHead(prs: readonly OpenPullRequest[], headRef: string): OpenPullRequest | null {
  return prs.find((pr) => pr.headRef === headRef) ?? null;
}

export type LinkDecision = {
  /** The PR URL the finding should be recorded against. */
  storePrUrl: string;
  /** Set when a different PR is already open for the finding: the new one is a duplicate and is not recorded. */
  duplicatePrUrl?: string;
};

/**
 * Which PR a finding stays linked to when a new one is recorded. Re-recording the same PR is a no-op.
 * A different link that is still open is kept, because overwriting it would orphan it. A closed or
 * merged link is replaced, since it no longer describes an open fix.
 */
export async function decideFixLink(input: {
  existingPrUrl: string | null | undefined;
  newPrUrl: string;
  isOpen: (url: string) => Promise<boolean>;
}): Promise<LinkDecision> {
  const { existingPrUrl, newPrUrl, isOpen } = input;
  if (!existingPrUrl || existingPrUrl === newPrUrl) return { storePrUrl: newPrUrl };
  if (await isOpen(existingPrUrl)) return { storePrUrl: existingPrUrl, duplicatePrUrl: newPrUrl };
  return { storePrUrl: newPrUrl };
}
