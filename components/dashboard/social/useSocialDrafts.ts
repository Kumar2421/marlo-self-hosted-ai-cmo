"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";

export type SocialPlatform = "x" | "linkedin" | "reddit";
export type DraftView = "current" | "archived";

export interface SocialDraft {
  id: string;
  angle: string;
  status: "draft" | "completed" | "archived" | "pending";
  edited: boolean;
  whyThisWorks: string;
  createdAt: string;
}

export interface XDraft extends SocialDraft {
  text: string;
}

export interface LinkedInDraft extends SocialDraft {
  hookLine: string;
  body: string;
}

export interface RedditDraft extends SocialDraft {
  subreddit: string;
  title: string;
  body: string;
}

export type AnyDraft = XDraft | LinkedInDraft | RedditDraft;

const ENDPOINTS: Record<SocialPlatform, string> = {
  x: "/api/agents/x/drafts",
  linkedin: "/api/agents/linkedin/drafts",
  reddit: "/api/agents/reddit/drafts",
};

function getQueryKeys(platform: SocialPlatform, projectId: string | undefined) {
  switch (platform) {
    case "x":
      return { listAll: qk.xDraftsAll(projectId), list: (view: DraftView) => qk.xDrafts(projectId, view) };
    case "linkedin":
      return { listAll: qk.linkedInDraftsAll(projectId), list: (view: DraftView) => qk.linkedInDrafts(projectId, view) };
    case "reddit":
      return { listAll: qk.redditDraftsAll(projectId), list: (view: DraftView) => qk.redditDrafts(projectId, view) };
  }
}

export function useSocialDraftList(platform: SocialPlatform, view: DraftView, enabled = true, staleTime?: number) {
  const { project } = useProject();
  const keys = getQueryKeys(platform, project?.id);
  const url = ENDPOINTS[platform];

  return useQuery({
    queryKey: keys.list(view),
    queryFn: async () => {
      const response = await fetchJson<{ drafts: AnyDraft[] }>(`${url}?view=${view}`);
      return response.drafts;
    },
    enabled: Boolean(project) && enabled,
    ...(staleTime !== undefined && { staleTime }),
  });
}

export function useSocialDraftActions(platform: SocialPlatform) {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const keys = getQueryKeys(platform, project?.id);
  const url = ENDPOINTS[platform];
  const JSON_HEADERS = { "Content-Type": "application/json" };

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.listAll });

  const generate = useMutation({
    mutationFn: (params?: { variants?: number; subreddit?: string }) =>
      fetchJson<{ drafts: AnyDraft[] }>(url, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ variants: clampVariants(params?.variants), ...(params?.subreddit && { subreddit: params.subreddit }) }),
      }),
    onSuccess: refresh,
  });

  function clampVariants(v?: number): number {
    return Math.min(3, Math.max(1, Math.floor(v ?? 3)));
  }

  const update = useMutation({
    mutationFn: (payload: { id: string; patch: Record<string, unknown> }) =>
      fetchJson<{ draft: AnyDraft }>(url, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: payload.id, ...payload.patch }),
      }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: true }>(`${url}?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return { generate, update, remove };
}
