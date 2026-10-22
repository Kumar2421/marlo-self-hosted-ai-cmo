"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import {
  DASHBOARD_DATASETS,
  mergeDashboardData,
  type DashboardData,
  type DashboardDataset,
  type DashboardPatch,
  type DashboardRows,
} from "@/lib/domain/project/dashboardCache";

export { DASHBOARD_DATASETS };
export type { DashboardData, DashboardDataset, DashboardRows };

type DashboardDataState = {
  data: DashboardData | null;
  /** True only while there is nothing to show yet; a background refresh never sets it. */
  loading: boolean;
  error: string | null;
  /** Refetches every dataset. */
  refresh: () => Promise<void>;
  /**
   * Refetches only the named datasets and merges them into the cached entry,
   * so saving a document does not re-download competitors and audits.
   */
  refreshDatasets: (datasets: readonly DashboardDataset[]) => Promise<void>;
};

const DashboardDataContext = createContext<DashboardDataState | null>(null);

export async function fetchDashboardData(projectId?: string | null): Promise<DashboardData>;
export async function fetchDashboardData(projectId: string | null | undefined, datasets: readonly DashboardDataset[]): Promise<DashboardPatch>;
export async function fetchDashboardData(
  projectId?: string | null,
  datasets?: readonly DashboardDataset[],
): Promise<DashboardData | DashboardPatch> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (datasets && datasets.length > 0) params.set("datasets", datasets.join(","));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  // "no-cache" (not the default no-store) lets the browser revalidate with the route's ETag: an unchanged dashboard costs a 304, not the full payload.
  const payload = await fetchJson<Partial<DashboardData>>(`/api/project/data${query}`, { cache: "no-cache" });

  if (!payload.project || !payload.projectId || !payload.data) {
    throw new Error("Dashboard data response is incomplete");
  }

  return payload as DashboardData;
}

/**
 * Dashboard rows, cached per project. Switching project selects a different
 * cache entry (never the previous project's data), refreshing keeps the old
 * data on screen while the new data loads, and the same entry is shared by
 * every panel that reads it.
 */
export function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const { project, projects, projectsLoaded, loading: projectLoading } = useProject();
  const projectId = project?.id;
  const knownNoProject = projectsLoaded && projects.length === 0 && !project;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.dashboardData(projectId),
    queryFn: () => fetchDashboardData(),
    // Wait for the project store so we don't fetch twice (once before the active project is known).
    // Also skip when the list is known to be empty: a new user has no project, so /api/project/data
    // can only 404. Creating the first project changes projectId, which enables the query.
    enabled: !projectLoading && !knownNoProject,
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const refreshDatasets = useCallback(
    async (datasets: readonly DashboardDataset[]) => {
      const key = qk.dashboardData(projectId);
      try {
        const patch = await fetchDashboardData(projectId, datasets);
        queryClient.setQueryData<DashboardData>(key, (prev) => mergeDashboardData(prev, patch));
      } catch {
        // The targeted read failed: fall back to the full reload, which also surfaces the error.
        await refetch();
      }
    },
    [projectId, queryClient, refetch],
  );

  const value = useMemo<DashboardDataState>(
    () => ({
      data: query.data ?? null,
      loading: projectLoading || (query.isPending && !knownNoProject),
      error: query.error instanceof Error ? query.error.message : null,
      refresh,
      refreshDatasets,
    }),
    [query.data, query.isPending, query.error, projectLoading, knownNoProject, refresh, refreshDatasets],
  );
  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData() {
  const context = useContext(DashboardDataContext);
  if (!context) throw new Error("useDashboardData must be used within DashboardDataProvider");
  return context;
}
