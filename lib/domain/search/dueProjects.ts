export type SnapshotTarget = {
  projectId: string;
  userId: string;
  /** integration_connections.status, when the column exists. */
  status?: string | null;
  /** False when the project has no selected Search Console property. Undefined means unknown (not skipped). */
  hasProperty?: boolean;
};

export type SkippedTarget = { projectId: string; reason: "needs_reconnect" | "no_property" };

function skipReason(target: SnapshotTarget): SkippedTarget["reason"] | null {
  if (target.status === "needs_reconnect") return "needs_reconnect";
  if (target.hasProperty === false) return "no_property";
  return null;
}

/** Connections the cron will not try (they would only fail again), with the reason to report. */
export function skippedTargets(connected: SnapshotTarget[], snapshottedToday: Set<string>): SkippedTarget[] {
  const seen = new Set<string>();
  const out: SkippedTarget[] = [];
  for (const target of connected) {
    if (snapshottedToday.has(target.projectId) || seen.has(target.projectId)) continue;
    const reason = skipReason(target);
    if (reason) {
      seen.add(target.projectId);
      out.push({ projectId: target.projectId, reason });
    }
  }
  return out;
}

/**
 * Projects that have Search Console connected but no snapshot for today yet.
 * Deduplicates repeated connections, skips connections that need a reconnect or
 * have no property, and orders by oldest last capture (never captured first,
 * then project id) so projects that keep failing cannot starve the others and
 * a run stopped by its time budget resumes with the ones that waited longest.
 */
export function selectDueProjects(
  connected: SnapshotTarget[],
  snapshottedToday: Set<string>,
  lastCapturedAt: Map<string, string> = new Map(),
): SnapshotTarget[] {
  const seen = new Set<string>();
  const stamp = (projectId: string) => {
    const at = lastCapturedAt.get(projectId);
    const ms = at ? Date.parse(at) : Number.NaN;
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  return connected
    .filter((target) => {
      if (snapshottedToday.has(target.projectId) || seen.has(target.projectId)) return false;
      if (skipReason(target)) return false;
      seen.add(target.projectId);
      return true;
    })
    .sort((a, b) => {
      const sa = stamp(a.projectId);
      const sb = stamp(b.projectId);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.projectId.localeCompare(b.projectId);
    });
}
