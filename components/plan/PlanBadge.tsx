"use client";

import { Badge } from "@/components/ui/Badge";
import { PLAN_LABELS, UNLIMITED, type PlanId } from "@/lib/domain/plans/planMatrix";
import { usePlan } from "./usePlan";

/**
 * Current plan and monthly credit allowance for Settings > Credits.
 * Renders nothing unless billing enforcement is on, so the beta UI is unchanged.
 */
export function PlanBadge() {
  const { data } = usePlan();
  if (!data || !data.enforced || data.plan === "selfhost") return null;
  const allowance = data.limits.credits_per_month;
  return (
    <Badge tone="neutral" data-testid="plan-badge">
      {PLAN_LABELS[data.plan as PlanId]} plan
      {allowance !== UNLIMITED ? ` · ${allowance} credits per month` : ""}
    </Badge>
  );
}
