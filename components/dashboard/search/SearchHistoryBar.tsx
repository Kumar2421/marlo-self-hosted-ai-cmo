"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import { timeAgo } from "./intentLabels";

type Meta = { snapshot: { capturedAt: string; days: number } | null };

/** Shows how fresh the saved search history is and lets the user capture a new snapshot now. */
export default function SearchHistoryBar() {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const history = useQuery({
    queryKey: qk.searchHistory(projectId),
    queryFn: () => fetchJson<Meta>("/api/agents/analytics/search/refresh"),
    enabled: Boolean(project),
  });

  const refresh = useMutation({
    mutationFn: () => fetchJson("/api/agents/analytics/search/refresh", { method: "POST" }),
    onSuccess: () =>
      // Everything derived from the snapshot (and the live traffic numbers) is now out of date.
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.searchHistory(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.searchOpportunities(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.traffic(projectId) }),
      ]),
  });

  const meta = history.data?.snapshot;
  let status: string;
  if (history.isPending) status = "Checking saved history…";
  else if (history.isError) status = "Couldn't check saved history.";
  else if (meta) status = `Updated ${timeAgo(meta.capturedAt)} · ${meta.days} ${meta.days === 1 ? "day" : "days"} of history`;
  else status = "No search history yet. Refresh to start tracking changes over time.";

  return (
    <div className="mb-4 flex items-center justify-between gap-3 text-xs text-gray-500">
      <span>
        {status}
        {refresh.isError && <span className="ml-2 text-amber-600">⚠ {refresh.error.message}</span>}
      </span>
      <button
        type="button"
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
        className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {refresh.isPending ? "Refreshing…" : "Refresh now"}
      </button>
    </div>
  );
}
