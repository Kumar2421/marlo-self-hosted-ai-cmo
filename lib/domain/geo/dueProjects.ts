/** One active tracked prompt of one project. */
export type ActivePrompt = { projectId: string; userId: string; prompt: string };
/** A project with the prompts that still have no run this week. */
export type GeoWork = { projectId: string; userId: string; prompts: string[] };

/** Start of the UTC week (Monday 00:00) containing `now`, as an ISO string. */
export function utcWeekStart(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString();
}

/**
 * Work due for the weekly AI-visibility run. A project is due while ANY of its active prompts has no run
 * this week (`ranThisWeek` = prompts with a stored run since the week start, any method), and only those
 * prompts are returned, so a rerun never repeats prompts that already have this week's check. This covers
 * projects without Search Console (manual prompts). Ordered by OLDEST last run first (never run = first), so a
 * run that stops on the time budget cannot starve the projects at the end of a fixed ordering.
 */
export function selectDueGeoWork(
  active: ActivePrompt[],
  ranThisWeek: Array<{ projectId: string; prompt: string }>,
  lastRunByProject: Map<string, string>,
): GeoWork[] {
  const done = new Set(ranThisWeek.map((r) => `${r.projectId}\u0000${r.prompt}`));
  const byProject = new Map<string, GeoWork>();
  for (const a of active) {
    if (done.has(`${a.projectId}\u0000${a.prompt}`)) continue;
    const work = byProject.get(a.projectId) ?? { projectId: a.projectId, userId: a.userId, prompts: [] };
    if (!work.prompts.includes(a.prompt)) work.prompts.push(a.prompt);
    byProject.set(a.projectId, work);
  }
  return [...byProject.values()].sort((a, b) => {
    const la = lastRunByProject.get(a.projectId) ?? "";
    const lb = lastRunByProject.get(b.projectId) ?? "";
    return la === lb ? a.projectId.localeCompare(b.projectId) : la < lb ? -1 : 1;
  });
}

/**
 * Like runWithBudget but `limit` items at a time. No item is started after the budget is gone;
 * items never started count as skipped. One failing item never stops the others.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  handler: (item: T) => Promise<void>,
  options: { budgetMs: number; now?: () => number },
): Promise<{ processed: number; skipped: number; failed: Array<{ item: T; error: string }> }> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  const out = { processed: 0, skipped: 0, failed: [] as Array<{ item: T; error: string }> };
  let next = 0;
  let started = 0;
  const worker = async () => {
    while (next < items.length && now() < deadline) {
      const item = items[next];
      next += 1;
      started += 1;
      try {
        await handler(item);
        out.processed += 1;
      } catch (err) {
        out.failed.push({ item, error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  out.skipped = items.length - started;
  return out;
}
