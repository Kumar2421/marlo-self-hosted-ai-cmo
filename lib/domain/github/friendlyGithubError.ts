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
    match: /access was removed|isn't shared with marlo|don'?t have access to that repository|connect github again|connect github, then try again/i,
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

/** The exact messages our own GitHub routes put in ?github_error=. Anything else in the URL is not ours to display. */
const KNOWN_URL_MESSAGES: ReadonlySet<string> = new Set([
  "No authorization code returned",
  "GitHub OAuth is hosted-mode only.",
  "GitHub authorization expired or was already used. Please reconnect.",
  "This authorization could not be completed for the account you are signed in with. Sign in to Marlo and start the connection again.",
  "GitHub OAuth is available on hosted deployments; use the self-host token flow instead.",
  "Not authenticated",
  "Select or create a project before connecting GitHub.",
  "Select or create a project first.",
  "The GitHub App is available on hosted deployments only.",
  "The GitHub App isn't configured on this deployment.",
  "Couldn't start the GitHub connection.",
  "Couldn't finish the GitHub connection.",
  "Couldn't finish the GitHub connection. Please try again.",
  "The GitHub organization owner still has to approve the installation.",
  "This GitHub link expired or was not started from Marlo. Please try connecting again.",
  "This GitHub link belongs to a different Marlo account.",
  "GitHub did not return an installation.",
  "GitHub did not confirm who installed the app. Turn on \"Request user authorization during installation\" for the app.",
  "That installation isn't on your GitHub account.",
]);

export const GENERIC_GITHUB_URL_ERROR = "GitHub connection didn't finish. Try again.";

/** For text that arrived in the URL (?github_error=): only our own known messages are shown; anything else, which anyone could have typed into a link, becomes a generic line. */
export function friendlyGithubUrlError(raw: string | null | undefined): FriendlyGithubError {
  const text = (raw ?? "").trim();
  if (KNOWN_URL_MESSAGES.has(text)) return friendlyGithubError(text);
  return { message: GENERIC_GITHUB_URL_ERROR, action: "retry" };
}

export function friendlyGithubError(raw: string | null | undefined): FriendlyGithubError {
  const text = (raw ?? "").trim();
  if (!text) return { message: "Something went wrong with GitHub. Try again.", action: "retry" };
  const rule = RULES.find((r) => r.match.test(text));
  return rule ? { ...rule.out } : { message: text, action: null };
}
