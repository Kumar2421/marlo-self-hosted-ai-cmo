"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import type { OutreachPlanResponse, OutreachSendRequest, OutreachSendResult, OutreachStatus } from "@/lib/domain/leads/outreachContract";

/** Today's send count against the daily limit. */
export function useOutreachStatus(enabled = true) {
  return useQuery({
    queryKey: qk.outreachStatus(),
    queryFn: () => fetchJson<OutreachStatus>("/api/agents/leads/outreach/status"),
    enabled,
    staleTime: 15_000,
  });
}

/**
 * What would happen if these leads were emailed now. Re-runs when the selection or the guessed-address choice changes
 * and keeps showing the previous answer meanwhile, so the summary does not flash empty.
 */
export function useOutreachPlan(leadIds: string[], acceptGuessed: boolean, enabled = true) {
  return useQuery({
    queryKey: qk.outreachPlan(leadIds, acceptGuessed),
    queryFn: () =>
      fetchJson<OutreachPlanResponse>("/api/agents/leads/outreach/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds, acceptGuessed }),
        timeoutMs: 30_000,
      }),
    enabled: enabled && leadIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
}

/** Sends (or test-sends) one batch. The caller decides when; this never retries on its own. */
export function useOutreachSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: OutreachSendRequest) =>
      fetchJson<OutreachSendResult>("/api/agents/leads/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
    retry: false,
    onSuccess: (data, request) => {
      queryClient.setQueryData(qk.outreachStatus(), data.status);
      if (!request.test) void queryClient.invalidateQueries({ queryKey: ["account", "outreach-plan"] });
    },
  });
}
