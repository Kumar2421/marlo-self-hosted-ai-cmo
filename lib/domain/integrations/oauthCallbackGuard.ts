/**
 * OAuth callbacks trust the signed `state` to say which Marlo user started the
 * flow. That only holds if the browser completing the callback is signed in as
 * the same user: otherwise anyone who obtains a valid state (for example from a
 * link or a shared machine) could attach their provider account to someone
 * else's Marlo account. Fail closed when there is no session or they differ.
 */
export type OAuthCallbackOwnerDecision = { ok: true } | { ok: false; reason: "no_session" | "user_mismatch" };

export function checkOAuthCallbackOwner(
  sessionUserId: string | null | undefined,
  stateUserId: string | null | undefined,
): OAuthCallbackOwnerDecision {
  if (!sessionUserId) return { ok: false, reason: "no_session" };
  if (!stateUserId || sessionUserId !== stateUserId) return { ok: false, reason: "user_mismatch" };
  return { ok: true };
}

/** Deliberately generic: it must not reveal whether the state existed or whose it was. */
export const OAUTH_OWNER_MISMATCH_MESSAGE =
  "This authorization could not be completed for the account you are signed in with. Sign in to Marlo and start the connection again.";
