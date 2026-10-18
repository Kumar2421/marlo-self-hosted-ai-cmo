"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import { findProviderForModel, useProviders } from "@/lib/providers-store";
import type { FixChange } from "@/lib/domain/codefix/catalogFix";
import type { GithubStatus } from "@/app/api/github/app/status/route";

export type { GithubStatus };

export type PreparedFix =
  | { mode: "manual"; reason: string; recommendation: string }
  | { mode: "auto"; label: string; repoFullName: string; explanation: string; changes: FixChange[]; ticket: string };

/** Whether GitHub is connected for the active project (hosted App, or the self-host token). */
export function useGithubStatus(enabled = true, withRepos = false) {
  const { project } = useProject();
  return useQuery({
    queryKey: [...qk.githubStatus(project?.id), withRepos ? "repos" : "basic"],
    queryFn: () => fetchJson<GithubStatus>(`/api/github/app/status${withRepos ? "?repos=1" : ""}`),
    enabled: enabled && Boolean(project),
    staleTime: 30_000,
  });
}

/** Saves the one repository this project's fixes go to. Shared by the settings card and the finding's inline picker. */
export function useSaveGithubRepo() {
  const { project } = useProject();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repo: string) =>
      fetchJson<{ repoFullName: string }>("/api/github/app/repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
      }),
    // Invalidates every github-status variant (basic and repo list) for this project.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.githubStatus(project?.id) }),
  });
}

/** Prepare (preview only, nothing is written) and approve (opens the PR) for one finding. */
export function useCodeFix(findingId: string) {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const { primaryModel } = useProviders();

  const prepare = useMutation({
    mutationFn: () => {
      const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
      return fetchJson<PreparedFix>("/api/agents/codefix/finding/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, model: primaryModel ?? undefined, providerId: providerId ?? undefined }),
      });
    },
  });

  const approve = useMutation({
    mutationFn: async (input: { ticket: string; changes: FixChange[]; explanation: string; edited: boolean }) => {
      let ticket = input.ticket;
      if (input.edited) {
        // An edited preview needs a fresh ticket bound to the edit before it can be applied.
        const revised = await fetchJson<{ ticket: string }>("/api/agents/codefix/finding/revise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ findingId, ticket, changes: input.changes }),
        });
        ticket = revised.ticket;
      }
      return fetchJson<{ prUrl: string; branch: string; files: string[] }>("/api/agents/codefix/finding/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, ticket, changes: input.changes, explanation: input.explanation }),
      });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.findingActions(project?.id, findingId) }),
        queryClient.invalidateQueries({ queryKey: qk.findings(project?.id) }),
      ]),
  });

  return { prepare, approve, hasModel: Boolean(primaryModel && findProviderForModel(primaryModel)) };
}
