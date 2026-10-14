/**
 * Turns the raw messages from the GitHub and fix routes into one plain sentence, plus the next step
 * the user can take. Pure: the UI decides how to render the action.
 */

export type FriendlyGithubError = {
  message: string;
  /** "reconnect": show a Reconnect GitHub button. "retry": the same action may work again later. */
  action: "reconnect" | "retry" | null;
};

const RULES: { match: RegExp; out: FriendlyGithubError }[] = [
  {
    match: /owner.*approv|still has to approve/i,
    out: { message: "A GitHub organization owner has to approve the Marlo app before it can open pull requests. Ask them to approve it, then try again.", action: null },
  },
  {
    match: /access was removed|isn't shared with marlo|don'?t have access to that repository|connect github again|reconnect/i,
    out: { message: "Marlo lost access to this repository on GitHub. Reconnect GitHub to choose it again.", action: "reconnect" },
  },
  {
    match: /rate limit|secondary rate|abuse detection|too many requests|http 429/i,
    out: { message: "GitHub is limiting requests right now. Wait a few minutes, then try again.", action: "retry" },
  },
  {
    match: /preview (expired|was already used)|preview expired|expired\. prepare the fix again/i,
    out: { message: "This preview has expired. Click Cancel, then Prepare fix again.", action: null },
  },
  {
    match: /no active project|select or create a project|finding not found/i,
    out: { message: "You switched to another project while this fix was open. Open the finding in the current project and try again.", action: null },
  },
];

export function friendlyGithubError(raw: string | null | undefined): FriendlyGithubError {
  const text = (raw ?? "").trim();
  if (!text) return { message: "Something went wrong with GitHub. Try again.", action: "retry" };
  const rule = RULES.find((r) => r.match.test(text));
  return rule ? { ...rule.out } : { message: text, action: null };
}
