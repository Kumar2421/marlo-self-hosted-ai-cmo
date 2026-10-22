"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action } from "@/lib/domain/actions/actionTypes";
import type { ActionWithOutcome } from "@/lib/domain/search/outcomeService";
import type { Finding } from "@/lib/domain/findings/findingTypes";
import { collapseDuplicateFindings } from "@/lib/domain/findings/findingDisplay";
import type { Recommendation } from "@/lib/domain/recommendations/recommendationTypes";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";

type FindingUpdate = { finding: Finding; verification?: { status: "verified" | "failed"; changed: boolean } };

/** The project's findings, cached per project, with status changes and re-checks written straight into the cache. */
export function useFindings({ enabled = true }: { enabled?: boolean } = {}) {
  const { project } = useProject();
  const projectId = project?.id;
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: qk.findings(projectId),
    queryFn: async () => (await fetchJson<{ findings?: Finding[] }>("/api/agents/analytics/findings")).findings ?? [],
    enabled: Boolean(project) && enabled,
    // One finding per real problem (the on-page and Lighthouse heading-order checks are the same issue).
    select: (findings) => collapseDuplicateFindings(findings),
  });

  // Other parts of the app (e.g. creating a finding from search insights) announce changes this way.
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: qk.findings(projectId) });
    window.addEventListener("marlo:findings-updated", refresh);
    return () => window.removeEventListener("marlo:findings-updated", refresh);
  }, [queryClient, projectId]);

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      fetchJson<FindingUpdate>("/api/agents/analytics/findings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      }),
    onSuccess: ({ finding }) => {
      queryClient.setQueryData<Finding[]>(qk.findings(projectId), (current) =>
        current?.map((f) => (f.id === finding.id ? finding : f)),
      );
    },
  });

  return { list, update };
}

/** Recommendations and tracked actions for one finding, loaded only while its panel is open. */
export function useFindingWork(findingId: string | null) {
  const { project } = useProject();
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const enabled = Boolean(project && findingId);
  const id = findingId ?? "";

  const recommendations = useQuery({
    queryKey: qk.findingRecommendations(projectId, id),
    queryFn: async () =>
      (await fetchJson<{ recommendations?: Recommendation[] }>(`/api/agents/analytics/findings/recommendations?id=${encodeURIComponent(id)}`))
        .recommendations ?? [],
    enabled,
  });

  const actionsKey = qk.findingActions(projectId, id);
  const actions = useQuery({
    queryKey: actionsKey,
    queryFn: async () => (await fetchJson<{ actions?: ActionWithOutcome[] }>(`/api/agents/actions?findingId=${encodeURIComponent(id)}`)).actions ?? [],
    enabled,
  });

  const create = useMutation({
    mutationFn: (recommendation: Recommendation) =>
      fetchJson<{ action?: Action }>("/api/agents/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingId: id,
          recommendationId: recommendation.id,
          title: recommendation.title,
          target: recommendation.target,
          parameters: { implementation: recommendation.implementation, evidence: recommendation.evidence },
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: actionsKey }),
  });

  const cancel = useMutation({
    mutationFn: (action: Action) =>
      fetchJson<{ action?: Action }>("/api/agents/actions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action.id, status: "cancelled" }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: actionsKey }),
  });

  // "I made this change": the server saves today's numbers and the page's current title, description and
  // heading as the baseline, completes the action, and moves its finding to Fixed (so both caches change).
  const implement = useMutation({
    mutationFn: ({ action, pageUrl }: { action: Action; pageUrl?: string }) =>
      fetchJson<{ action: Action }>("/api/agents/actions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action.id, implemented: true, pageUrl }),
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: actionsKey }),
        queryClient.invalidateQueries({ queryKey: qk.findings(projectId) }),
      ]),
  });

  const undo = useMutation({
    mutationFn: (action: Action) =>
      fetchJson<{ action: Action }>("/api/agents/actions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action.id, undoImplemented: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: actionsKey }),
  });

  const busyKey = create.isPending
    ? create.variables?.id
    : cancel.isPending
      ? (cancel.variables?.recommendationId ?? cancel.variables?.id)
      : implement.isPending
        ? implement.variables?.action.id
        : undo.isPending
          ? undo.variables?.id
          : null;
  const error = [create.error, cancel.error, implement.error, undo.error].find((e): e is Error => e instanceof Error)?.message ?? null;

  return { recommendations, actions, create, cancel, implement, undo, busyKey: busyKey ?? null, error };
}
