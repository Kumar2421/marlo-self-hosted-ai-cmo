/**
 * Managed (operator-key) local search policy: the per-user daily cap and when a search is charged.
 * Pure and store-agnostic: the route supplies a SlotStore backed by usage_events.
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

export type SlotStore<H> = {
  /** Records a provisional search for this user today. Returns a handle used to release it. */
  reserve: () => Promise<H>;
  /** Counts today's managed searches, provisional ones included. */
  count: () => Promise<number>;
  /** Removes a provisional search. */
  release: (handle: H) => Promise<void>;
};

export type SlotResult<H> = { allowed: true; handle: H } | { allowed: false };

/**
 * Insert-then-count. A request writes its reservation before it counts, and it is accepted only if
 * the count (its own row included) is within the cap. For any two accepted requests, the later
 * count sees the earlier reservation, so accepted searches can never exceed the cap across
 * concurrent requests. A rejected request releases its own row. Rows of searches that later
 * succeed are released by the route after the charge is written.
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
