import {
  FEATURE_IDS,
  PLAN_IDS,
  PLAN_LIMITS,
  PLAN_RANK,
  getFeature,
  type FeatureId,
  type LimitKey,
  type PlanId,
} from "./planMatrix.ts";

/** Maps any stored value to a plan id. Unknown, missing or malformed values become "free" (never more access). */
export function normalizePlan(value: unknown): PlanId {
  if (typeof value !== "string") return "free";
  const v = value.trim().toLowerCase();
  return (PLAN_IDS as readonly string[]).includes(v) ? (v as PlanId) : "free";
}

/** True when `plan` includes `featureId`. An unknown feature id is denied. */
export function can(plan: PlanId, featureId: FeatureId): boolean {
  const feature = getFeature(featureId);
  if (!feature) return false;
  return PLAN_RANK[normalizePlan(plan)] >= PLAN_RANK[feature.minPlan];
}

/** The plan's numeric limit for `key`: -1 unlimited, 0 not included. An unknown key is 0. */
export function limit(plan: PlanId, key: LimitKey): number {
  const row = PLAN_LIMITS[key];
  return row ? row[normalizePlan(plan)] : 0;
}

/** Cheapest plan that includes the feature, for upgrade messages. Undefined for an unknown feature. */
export function minPlanFor(featureId: FeatureId): PlanId | undefined {
  return getFeature(featureId)?.minPlan;
}

export function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === "string" && (FEATURE_IDS as readonly string[]).includes(value);
}

export type ResolvePlanInput = {
  /** Billing enforcement switch (app_config.billing_enabled). Off by default. */
  enforcement: boolean;
  /** Self-hosted deployment: never gated. */
  selfHost: boolean;
  /** profiles.plan_tier as read from storage. Pass null/undefined when the row is missing. */
  rawPlan: unknown;
  /** True when reading the plan failed (error, timeout). Fails closed to "free" when enforcement is on. */
  lookupFailed?: boolean;
};

/**
 * Decides the plan to apply right now.
 * - Self-host, or enforcement off: "pro" (everything unlocked, as today).
 * - Enforcement on: the stored plan; a failed or missing lookup is "free" (fail closed).
 */
export function resolvePlan(input: ResolvePlanInput): PlanId {
  if (input.selfHost || !input.enforcement) return "pro";
  if (input.lookupFailed) return "free";
  return normalizePlan(input.rawPlan);
}
