"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import { findProviderForModel, useProviders } from "@/lib/providers-store";
import { groupRequests, toRequestRows, type RequestLead, type RequestRow } from "@/lib/domain/leads/intent/redditRequestRows";

const JSON_HEADERS = { "Content-Type": "application/json" };

export type FindRequestsResult = {
  leads: unknown[];
  considered: number;
  droppedSellers: number;
  duplicates: number;
  /** Plain-words reason when nothing was saved; null when something was. */
  message: string | null;
};

/**
 * The project's Reddit requests (leads of type "intent"). Read from the same Leads list as the Leads panel, so the two
 * always agree. The Social menu reads it only for a count, so a minute-old list is fine there.
 */
export function useRedditRequests(enabled = true, staleTime?: number) {
  const { project } = useProject();
  return useQuery({
    queryKey: qk.redditRequests(project?.id),
    queryFn: async (): Promise<RequestRow[]> => {
      const res = await fetchJson<{ leads: RequestLead[] }>("/api/agents/leads/search");
      return toRequestRows(res.leads ?? []);
    },
    enabled: Boolean(project) && enabled,
    ...(staleTime !== undefined && { staleTime }),
  });
}

export function useRedditRequestCounts(enabled = true, staleTime?: number) {
  const query = useRedditRequests(enabled, staleTime);
  const groups = groupRequests(query.data ?? []);
  return { toAnswer: groups.toAnswer.length, posted: groups.posted.length, query };
}

export function useRedditRequestActions() {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const { primaryModel } = useProviders();
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.redditRequests(project?.id) });

  /** Searches Reddit for new requests now. The server drafts a reply for each one it keeps. */
  const find = useMutation({
    mutationFn: () => {
      const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
      return fetchJson<FindRequestsResult>("/api/agents/leads/intent-search", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ model: primaryModel ?? undefined, providerId: providerId ?? undefined }),
      });
    },
    onSuccess: refresh,
  });

  const saveReply = useMutation({
    mutationFn: (payload: { id: string; reply: string }) =>
      fetchJson<{ id: string; reply: string }>("/api/agents/leads/reply", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(payload) }),
    onSuccess: refresh,
  });

  /** "posted" records that the user posted the reply; "dismissed" hides the request; "new" puts it back. Hosted accounts only. */
  const setStatus = useMutation({
    mutationFn: (payload: { id: string; status: "posted" | "dismissed" | "new" }) =>
      fetchJson<{ id: string; status: string }>("/api/agents/leads/status", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: payload.id, status: payload.status === "posted" ? "contacted" : payload.status === "dismissed" ? "not_interested" : "new" }),
      }),
    onSuccess: refresh,
  });

  return { find, saveReply, setStatus };
}
