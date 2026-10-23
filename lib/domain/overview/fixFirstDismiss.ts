/**
 * Closing the "Fix first" suggestions. The choice is remembered per project, but only for the suggestions that were
 * on screen: when the list changes (a new top issue, or one was fixed) the strip comes back on its own, so a closed
 * strip never hides something new. A one-line "Show" link always remains.
 */

export const FIX_FIRST_DISMISS_PREFIX = "marlo-fixfirst-dismissed:";

export const fixFirstDismissKey = (projectId: string) => `${FIX_FIRST_DISMISS_PREFIX}${projectId}`;

/** Order-independent identity of the suggestions currently shown. */
export function suggestionSignature(items: ReadonlyArray<{ findingId: string }>): string {
  return items
    .map((i) => i.findingId)
    .sort()
    .join("|");
}

/** Hidden only while the stored signature still equals what would be shown now (and something is shown). */
export function isFixFirstDismissed(stored: string | null | undefined, current: string): boolean {
  return current !== "" && typeof stored === "string" && stored === current;
}
