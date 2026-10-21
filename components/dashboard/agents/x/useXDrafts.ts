"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { XDraft, XDraftPatch, XDraftView } from "@/lib/domain/x/xDraftTypes";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";

const URL = "/api/agents/x/drafts";
const JSON_HEADERS = { "Content-Type": "application/json" };

/** Drafts for one tab (Current or Archived), cached per project. */
export function useXDraftList(view: XDraftView, enabled = true) {
  const { project } = useProject();
  return useQuery({
    queryKey: qk.xDrafts(project?.id, view),
    queryFn: async () => (await fetchJson<{ drafts?: XDraft[] } | null>(`${URL}?view=${view}`))?.drafts ?? [],
    enabled: Boolean(project) && enabled,
  });
}

export function useXDraftActions() {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.xDraftsAll(project?.id) });

  const generate = useMutation({
    mutationFn: () => fetchJson<{ drafts: XDraft[] }>(URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ variants: 3 }) }),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: XDraftPatch }) =>
      fetchJson<{ draft: XDraft }>(URL, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ id, ...patch }) }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => fetchJson<{ success: true }>(`${URL}?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return { generate, update, remove };
}
