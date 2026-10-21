"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import type { OpportunityGroups } from "@/lib/domain/search/searchOpportunities";

export type SearchOpportunitiesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; capturedAt: string; opportunities: OpportunityGroups };

type Response = { snapshot: { capturedAt: string } | null; opportunities?: OpportunityGroups };

/**
 * Grouped opportunities from the latest saved snapshot. Shares one cache entry
 * per project, so the dashboard summary and the slide-over never double-fetch,
 * and a refresh anywhere updates both.
 */
export function useSearchOpportunities(): SearchOpportunitiesState {
  const { project } = useProject();
  const query = useQuery({
    queryKey: qk.searchOpportunities(project?.id),
    queryFn: () => fetchJson<Response>("/api/agents/analytics/search/opportunities"),
    enabled: Boolean(project),
  });

  if (query.isPending) return { status: "loading" };
  if (query.isError) return { status: "error" };
  const { snapshot, opportunities } = query.data ?? { snapshot: null };
  if (!snapshot || !opportunities) return { status: "empty" };
  return { status: "ready", capturedAt: snapshot.capturedAt, opportunities };
}
