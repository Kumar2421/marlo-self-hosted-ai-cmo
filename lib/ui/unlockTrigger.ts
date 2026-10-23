/**
 * Tiny event store: "show the unlock panel now". The chat fires it when the free
 * monthly cap is reached; UnlockPanel subscribes. No React, so node tests cover it.
 */
export type UnlockTrigger = {
  /** Ask every subscriber to force-show the panel and open the plans slide-over. */
  fire(): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
};

export function createUnlockTrigger(): UnlockTrigger {
  const listeners = new Set<() => void>();
  return {
    fire() {
      for (const l of [...listeners]) {
        try { l(); } catch { /* one bad listener must not stop the others */ }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The app-wide trigger. */
export const unlockTrigger = createUnlockTrigger();
