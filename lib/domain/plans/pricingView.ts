/**
 * View model for the public pricing page. Everything here is derived from
 * planMatrix.ts (features, limits, prices); the only text owned by this file is
 * the plan taglines and the formatting of limit values.
 */
import {
  PLAN_IDS,
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_PRICES,
  listFeaturesForPlan,
  type FeatureId,
  type LimitKey,
  type PlanId,
  type PlanPrice,
} from "./planMatrix.ts";

/**
 * Pricing is in beta until a payment gateway is integrated. While true, the
 * pricing page shows a Beta badge and note, and paid plans only offer the
 * waitlist. Flip to false once payments are live (and swap the buttons).
 */
export const PRICING_BETA = true;

export const PRICING_BETA_NOTE =
  "Pricing is in beta: paid plans open when payments go live. Join the waitlist to get early access.";

export const PLAN_TAGLINES: Record<PlanId, string> = {
  free: "Website analysis and strategy to get you started.",
  lite: "SEO, AI search and X, monitored and fixed for you.",
  pro: "The full agent suite: leads, outreach and content.",
};

const PREVIOUS_PLAN: Record<PlanId, PlanId | null> = { free: null, lite: "free", pro: "lite" };

/** Short display text for a numeric limit, or null when the plan does not include the feature. */
export function formatLimit(key: LimitKey, value: number): string | null {
  if (value === 0) return null;
  switch (key) {
    case "credits_per_month":
      return `${value} / month`;
    case "geo_prompts":
      return `${value} prompts`;
    case "chat_messages_per_month":
      return value < 0 ? "Unlimited" : `${value} / month`;
    case "traffic_view_days":
      return value < 0 ? "Full history" : `${value} days`;
    default:
      return value < 0 ? "Unlimited" : String(value);
  }
}

export type PlanRowView = {
  id: FeatureId;
  label: string;
  description: string;
  /** Plan-specific limit text shown next to the label, when the feature has one. */
  limitText: string | null;
};

export type PlanCardView = {
  id: PlanId;
  name: string;
  tagline: string;
  price: PlanPrice;
  /** Plan this one builds on ("Everything in Free, plus"), or null for the base plan. */
  inheritsFrom: { id: PlanId; name: string } | null;
  rows: PlanRowView[];
};

/**
 * Rows a card lists: features first included at this plan, plus features from
 * earlier plans whose limit changes here (e.g. credits 20 -> 300).
 */
export function buildPlanCard(plan: PlanId): PlanCardView {
  const prev = PREVIOUS_PLAN[plan];
  const rows: PlanRowView[] = [];
  for (const row of listFeaturesForPlan(plan)) {
    if (!row.included) continue;
    const isNew = prev === null || row.minPlan === plan;
    const limitChanged = row.limit !== undefined && prev !== null && PLAN_LIMITS[row.limit.key][prev] !== row.limit.value;
    if (!isNew && !limitChanged) continue;
    rows.push({
      id: row.id,
      label: row.label,
      description: row.description,
      limitText: row.limit ? formatLimit(row.limit.key, row.limit.value) : null,
    });
  }
  return {
    id: plan,
    name: PLAN_LABELS[plan],
    tagline: PLAN_TAGLINES[plan],
    price: PLAN_PRICES[plan],
    inheritsFrom: prev ? { id: prev, name: PLAN_LABELS[prev] } : null,
    rows,
  };
}

export function buildPlanCards(): PlanCardView[] {
  return PLAN_IDS.map(buildPlanCard);
}
