import {
  FEATURE_IDS,
  LIMIT_KEYS,
  PLAN_LABELS,
  PLAN_LIMITS,
  UNLIMITED,
  getFeature,
  type FeatureId,
  type LimitKey,
  type PlanId,
} from "./planMatrix.ts";
import { can } from "./planPolicy.ts";

/** The plan as the client sees it. "selfhost" is never gated. */
export type PlanInfoPlan = PlanId | "selfhost";

/** Response of GET /api/plan. Pure data, safe to serialize. */
export type PlanInfo = {
  plan: PlanInfoPlan;
  /** True only when billing enforcement is on for this user. Off means nothing is ever locked. */
  enforced: boolean;
  limits: Record<LimitKey, number>;
  features: Record<FeatureId, boolean>;
};

/**
 * Builds the /api/plan response. Pure.
 * - Self-host: plan "selfhost", not enforced, every limit unlimited, every feature on.
 * - Hosted, enforcement off: the stored plan is reported, but every feature is on.
 * - Hosted, enforcement on: features follow the plan matrix.
 */
export function buildPlanInfo(input: { plan: PlanInfoPlan; enforced: boolean }): PlanInfo {
  const selfHost = input.plan === "selfhost";
  const enforced = !selfHost && input.enforced;

  const limits = {} as Record<LimitKey, number>;
  for (const key of LIMIT_KEYS) limits[key] = selfHost ? UNLIMITED : PLAN_LIMITS[key][input.plan as PlanId];

  const features = {} as Record<FeatureId, boolean>;
  for (const id of FEATURE_IDS) features[id] = enforced ? can(input.plan as PlanId, id) : true;

  return { plan: input.plan, enforced, limits, features };
}

export type LockedFeature =
  | { locked: false; minPlan: null; label: string }
  | { locked: true; minPlan: PlanId; label: string };

/**
 * Whether a feature should render as locked. Never locks while the plan is
 * unknown (loading or failed fetch), not enforced, or self-host, so the
 * dark default is identical to today.
 */
export function lockedFeature(info: PlanInfo | null | undefined, featureId: FeatureId): LockedFeature {
  const feature = getFeature(featureId);
  const label = feature?.label ?? featureId;
  if (!info || !info.enforced || info.plan === "selfhost" || !feature) return { locked: false, minPlan: null, label };
  if (info.features[featureId] !== false) return { locked: false, minPlan: null, label };
  return { locked: true, minPlan: feature.minPlan, label };
}

/** "Lite" / "Pro" for upgrade copy. */
export function planLabel(plan: PlanId): string {
  return PLAN_LABELS[plan];
}
