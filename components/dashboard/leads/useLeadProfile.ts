"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isConfirmed, type LeadProfile } from "@/lib/domain/leads/leadProfile";
import type { OfferModel } from "@/lib/domain/offer/offerModel";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";

type ProfileResponse = { profile: LeadProfile | null; suggestion: LeadProfile | null; offer?: OfferModel | null };

/** The project's lead profile (or a suggested draft from its docs), cached per project. */
export function useLeadProfile() {
  const { project } = useProject();
  const projectId = project?.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.leadProfile(projectId),
    queryFn: () => fetchJson<ProfileResponse>("/api/agents/leads/profile"),
    enabled: Boolean(project),
  });

  const save = useMutation({
    mutationFn: ({ profile, confirm }: { profile: LeadProfile; confirm: boolean }) =>
      fetchJson<{ profile: LeadProfile }>("/api/agents/leads/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, confirm }),
      }),
    onSuccess: ({ profile }) => {
      queryClient.setQueryData<ProfileResponse>(qk.leadProfile(projectId), (previous) => ({ profile, suggestion: null, offer: previous?.offer ?? null }));
    },
  });

  const profile = query.data?.profile ?? null;
  return {
    isLoading: query.isPending && Boolean(project),
    isError: query.isError,
    profile,
    suggestion: query.data?.suggestion ?? null,
    /** What Marlo read from the site (evidence for the wizard), or null when none was derived. */
    offer: query.data?.offer ?? null,
    /** Re-reads the profile and suggestion, so an Offer Model derived after the panel loaded is picked up. */
    refresh: query.refetch,
    confirmed: isConfirmed(profile),
    save,
  };
}
