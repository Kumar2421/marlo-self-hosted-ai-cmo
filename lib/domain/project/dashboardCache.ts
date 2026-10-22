/**
 * Pure helpers shared by the /api/project/data route and the dashboard's
 * client cache. No imports on purpose: this file ships to the browser.
 */

/**
 * The only datasets the dashboard reads (Context panel: documents, competitors
 * and the latest audit score). Everything else the old route returned
 * (link_checks, geo_checks, site_crawls, traffic_checks, findings, code_fixes,
 * leads) is loaded by the panel that owns it through its own endpoint.
 */
export const DASHBOARD_DATASETS = ["project_documents", "project_competitors", "seo_audits"] as const;

export type DashboardDataset = (typeof DASHBOARD_DATASETS)[number];
export type DashboardRows = Record<DashboardDataset, Record<string, unknown>[]>;

export type DashboardData = {
  project: Record<string, unknown>;
  projectId: string;
  data: DashboardRows;
};

/** A response for a subset of datasets (`?datasets=`): only the requested keys are present. */
export type DashboardPatch = {
  project: Record<string, unknown>;
  projectId: string;
  data: Partial<DashboardRows>;
};

/**
 * Parses the `datasets` query param. Absent or empty means every dataset
 * (backward compatible). Returns null when any name is unknown, so a typo is
 * a 400 instead of silently returning less than the caller asked for.
 */
export function parseDatasetFilter(param: string | null | undefined): DashboardDataset[] | null {
  if (param == null || param.trim() === "") return [...DASHBOARD_DATASETS];
  const wanted = new Set<string>();
  for (const raw of param.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (!(DASHBOARD_DATASETS as readonly string[]).includes(name)) return null;
    wanted.add(name);
  }
  if (wanted.size === 0) return [...DASHBOARD_DATASETS];
  return DASHBOARD_DATASETS.filter((name) => wanted.has(name));
}

/**
 * Overlays freshly fetched datasets onto the cached dashboard data. Returns
 * the cached value untouched when there is nothing cached yet or the patch is
 * for another project (a late response must never write into the wrong
 * project's cache entry). Datasets the patch does not carry keep their rows.
 */
export function mergeDashboardData<T extends DashboardData | undefined>(prev: T, patch: DashboardPatch): T | DashboardData {
  if (!prev || prev.projectId !== patch.projectId) return prev;
  return {
    project: patch.project ?? prev.project,
    projectId: prev.projectId,
    data: { ...prev.data, ...patch.data } as DashboardRows,
  };
}

/**
 * The Context panel only needs an audit's url, timestamp and on-page score.
 * The full payload carries the crawled body text, so the server sends a
 * reduced row in the same shape `latestOnPageScore` already reads
 * (`payload.technical.onPageScore`). Accepts either a row that already has the
 * score extracted (`onPageScore`, hosted) or a full row with `payload` (an
 * object, or a JSON string on self-host).
 */
export function slimAuditRow(row: Record<string, unknown>): Record<string, unknown> {
  let score: unknown = row.onPageScore;
  if (score === undefined && "payload" in row) {
    let payload: unknown = row.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    score = (payload as { technical?: { onPageScore?: unknown } } | null)?.technical?.onPageScore;
  }
  const slim: Record<string, unknown> = { url: row.url, created_at: row.created_at };
  slim.payload = typeof score === "number" && Number.isFinite(score) ? { technical: { onPageScore: score } } : null;
  return slim;
}
