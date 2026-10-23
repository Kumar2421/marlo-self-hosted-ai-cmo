import { normalizeEmail } from "./outreachPlan.ts";
import { OutreachNotSetUpError, type OutreachStore } from "./outreachStore.ts";
import { isStopRequest } from "./replyStop.ts";
import { verifyToken } from "../notifications/tokens.ts";

export type UnsubscribeOutcome = "ok" | "invalid" | "unavailable";

/** Checks a lead-unsubscribe token without changing anything (used by the confirm page). */
export function checkUnsubscribeToken(token: string | null | undefined, secret: string | null | undefined): boolean {
  const claims = verifyToken(token, "lead-unsubscribe", secret);
  return Boolean(claims && normalizeEmail(claims.email));
}

/** Verifies the token and puts the address on that user's stop list. Idempotent. Only POST handlers call this. */
export async function applyUnsubscribe(
  store: OutreachStore,
  token: string | null | undefined,
  secret: string | null | undefined,
): Promise<UnsubscribeOutcome> {
  const claims = verifyToken(token, "lead-unsubscribe", secret);
  const email = normalizeEmail(claims?.email);
  if (!claims || !email) return "invalid";
  try {
    await store.addOptout(claims.userId, email, "unsubscribed");
    return "ok";
  } catch (err) {
    if (err instanceof OutreachNotSetUpError) return "unavailable";
    throw err;
  }
}

/**
 * Puts the lead's address on the user's stop list when any reply in the thread is a clear stop request.
 * Returns whether a stop was recorded. A missing outreach table is ignored: reply checking must keep working.
 */
export async function recordReplyStops(
  store: OutreachStore,
  userId: string,
  leadEmail: string | null | undefined,
  replyTexts: string[],
): Promise<boolean> {
  const email = normalizeEmail(leadEmail);
  if (!email || !replyTexts.some((t) => isStopRequest(t))) return false;
  try {
    await store.addOptout(userId, email, "reply_stop");
    return true;
  } catch (err) {
    if (err instanceof OutreachNotSetUpError) return false;
    throw err;
  }
}
