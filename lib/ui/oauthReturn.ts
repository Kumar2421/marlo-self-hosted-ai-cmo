/** Pure rules for un-sticking a "Opening Google..." button after the user comes back from a redirect. */

/** How long the button may stay busy before it resets itself. */
export const OAUTH_BUSY_TIMEOUT_MS = 15_000;
/** Focus/visibility events sooner than this after the click are the redirect itself, not a return. */
export const OAUTH_RETURN_DELAY_MS = 1_500;

/** A page restored from the back/forward cache keeps its React state, so it must reset. */
export function resetOnPageShow(persisted: boolean): boolean {
  return persisted;
}

/** Window focus or the tab becoming visible again, once the redirect has had time to start. */
export function resetOnReturn(startedAt: number, now: number, visible: boolean): boolean {
  return visible && now - startedAt >= OAUTH_RETURN_DELAY_MS;
}
