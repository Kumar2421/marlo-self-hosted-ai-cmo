"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { lockedFeature, type LockedFeature, type PlanInfo } from "@/lib/domain/plans/planInfo";
import type { FeatureId } from "@/lib/domain/plans/planMatrix";

/** The caller's plan. `data` is undefined while loading or on error, which never locks anything. */
export function usePlan() {
  return useQuery({
    queryKey: qk.plan(),
    queryFn: () => fetchJson<PlanInfo>("/api/plan"),
    staleTime: 60_000,
    retry: false,
  });
}

/** Lock state for one feature; unlocked until the plan is known and enforced. */
export function useLockedFeature(featureId: FeatureId): LockedFeature {
  return lockedFeature(usePlan().data, featureId);
}
