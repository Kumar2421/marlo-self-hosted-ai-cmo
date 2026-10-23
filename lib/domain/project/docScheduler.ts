/** Pure scheduling helpers for first-time document generation (used by
 * lib/project-store.tsx). No fetches, no React: the ordering and concurrency
 * rules are testable here.
 *
 * A node starts once every key in `after` has settled (succeeded or not -- the
 * caller decides what a failed prerequisite means, e.g. blockedBy) and a slot
 * is free. Nodes with `noSlot` (cheap waits such as "have competitors been
 * found?") never occupy a slot. One node failing or throwing never stops the
 * others. */

export type DagNode<K extends string> = {
  key: K;
  /** Keys that must have settled first. Unknown keys are treated as settled. */
  after?: readonly K[];
  /** Does not count against the concurrency cap. */
  noSlot?: boolean;
};

export async function runDag<K extends string>(
  nodes: readonly DagNode<K>[],
  concurrency: number,
  exec: (key: K) => Promise<void>,
  shouldStop: () => boolean = () => false
): Promise<void> {
  const cap = Math.max(1, Math.floor(concurrency));
  const known = new Set(nodes.map((n) => n.key));
  const settled = new Set<K>();
  const started = new Set<K>();
  let slots = 0;

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const n of nodes) {
          if (started.has(n.key)) continue;
          const ready = (n.after ?? []).every((a) => !known.has(a) || settled.has(a));
          if (!ready) continue;
          if (!n.noSlot && slots >= cap) continue;
          started.add(n.key);
          if (shouldStop()) {
            settled.add(n.key);
            progressed = true;
            continue;
          }
          if (!n.noSlot) slots++;
          void exec(n.key)
            .catch(() => {})
            .finally(() => {
              if (!n.noSlot) slots--;
              settled.add(n.key);
              pump();
            });
          progressed = true;
        }
      }
      if (settled.size === nodes.length) resolve();
    };
    pump();
  });
}

/** Providers with tight free-tier request limits get one document at a time;
 * everyone else gets a small cap that stays well inside typical limits. */
export function documentConcurrency(providerId: string | null): number {
  if (providerId === "mistral") return 1;
  return 3;
}

/** The route answers 502 with the provider's raw message, so a rate limit is
 * recognised by status or by wording. */
export function isRateLimited(status: number, message: string | undefined): boolean {
  if (status === 429) return true;
  return /\b429\b|rate.?limit|too many requests|quota/i.test(message ?? "");
}

/** Waits before the 1st and 2nd retry of a rate-limited document. */
export const RATE_LIMIT_BACKOFF_MS: readonly number[] = [5000, 15000];
