/**
 * Managed (operator-key) local search policy: the per-user daily cap and when a search is charged.
 * Pure and store-agnostic: the route supplies a SlotStore backed by usage_events.
 *
 * The cap counts Google Places calls, not charged searches: a search that calls Google costs the
 * operator money even when it saves nothing, so its slot row stays for the rest of the day.
 */

/** Searches per user per UTC day on the managed (operator) Google key. Own-key searches are not capped. */
export const MANAGED_DAILY_CAP = 30;

/**
 * A managed search is charged once, after its leads are saved, and only when at least one new lead
 * was saved. Own-key searches are never charged. A search that failed or saved nothing is free.
 */
export function shouldChargeSearch(input: { usingManaged: boolean; savedCount: number; failed: boolean }): boolean {
  return input.usingManaged && !input.failed && input.savedCount > 0;
}

/**
 * A reserved slot is released only when Google was never called (refused by the credit check, an
 * input or config failure). Once Google was called the slot is kept, whatever the outcome, so
 * zero-save, all-duplicate and failed searches still count toward the daily cap.
 */
export function shouldReleaseSlot(input: { googleCalled: boolean }): boolean {
  return !input.googleCalled;
}

export type SlotStore<H> = {
  /** Records a managed Places call for this user today. Returns a handle used to release it. */
  reserve: () => Promise<H>;
  /** Counts today's managed Places calls, reserved ones included. */
  count: () => Promise<number>;
  /** Removes a reservation whose Google call never happened. */
  release: (handle: H) => Promise<void>;
};

export type SlotResult<H> = { allowed: true; handle: H } | { allowed: false };

/**
 * Insert-then-count. A request writes its reservation before it counts, and it is accepted only if
 * the count (its own row included) is within the cap. For any two accepted requests, the later
 * count sees the earlier reservation, so accepted searches can never exceed the cap across
 * concurrent requests. A rejected request releases its own row. The route keeps the row of every
 * request that went on to call Google (see shouldReleaseSlot) and releases it otherwise.
 */
export async function reserveManagedSlot<H>(store: SlotStore<H>, cap: number = MANAGED_DAILY_CAP): Promise<SlotResult<H>> {
  const handle = await store.reserve();
  const used = await store.count();
  if (used > cap) {
    await store.release(handle);
    return { allowed: false };
  }
  return { allowed: true, handle };
}
