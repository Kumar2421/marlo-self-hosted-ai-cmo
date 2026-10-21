"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";

export const DASHBOARD_DATASETS = [
  "project_documents",
  "project_competitors",
  "seo_audits",
  "link_checks",
  "geo_checks",
  "site_crawls",
  "traffic_checks",
  "findings",
  "code_fixes",
  "leads",
] as const;

export type DashboardDataset = (typeof DASHBOARD_DATASETS)[number];
export type DashboardRows = Record<DashboardDataset, Record<string, unknown>[]>;

export type DashboardData = {
  project: Record<string, unknown>;
  projectId: string;
  data: DashboardRows;
};

type DashboardDataState = {
  data: DashboardData | null;
  /** True only while there is nothing to show yet; a background refresh never sets it. */
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const DashboardDataContext = createContext<DashboardDataState | null>(null);

export async function fetchDashboardData(projectId?: string | null): Promise<DashboardData> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
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
  const { project, loading: projectLoading } = useProject();
  const projectId = project?.id;

  const query = useQuery({
    queryKey: qk.dashboardData(projectId),
    queryFn: () => fetchDashboardData(),
    // Wait for the project store so we don't fetch twice (once before the active project is known).
    enabled: !projectLoading,
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const value = useMemo<DashboardDataState>(
    () => ({
      data: query.data ?? null,
      loading: projectLoading || query.isPending,
      error: query.error instanceof Error ? query.error.message : null,
      refresh,
    }),
    [query.data, query.isPending, query.error, projectLoading, refresh],
  );
  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData() {
  const context = useContext(DashboardDataContext);
  if (!context) throw new Error("useDashboardData must be used within DashboardDataProvider");
  return context;
}
