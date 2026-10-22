/**
 * Plan matrix: the single source of truth for what each hosted plan includes.
 * Server gates, UI locks and the pricing page all read this file (and
 * planPolicy.ts). Pure data, no IO. Source: the Marlo pricing spec.
 *
 * Numeric limit convention: -1 = unlimited, 0 = not included.
 * Enforcement is OFF by default, so none of this changes behavior until a
 * deployment turns billing enforcement on (see planPolicy.resolvePlan).
 */

export const PLAN_IDS = ["free", "lite", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Ascending rank: a plan unlocks every feature whose minPlan has an equal or lower rank. */
export const PLAN_RANK: Record<PlanId, number> = { free: 0, lite: 1, pro: 2 };

export const PLAN_LABELS: Record<PlanId, string> = { free: "Free", lite: "Lite", pro: "Pro" };

export const UNLIMITED = -1;

/** Per-plan numeric limits. Credits are a monthly, non-rollover allowance. */
export const LIMIT_KEYS = [
  "websites",
  "credits_per_month",
  "geo_prompts",
  "geo_manual_runs_per_week",
  "chat_messages_per_month",
  "traffic_view_days",
  "daily_leads",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const PLAN_LIMITS: Record<LimitKey, Record<PlanId, number>> = {
  // New creates only; accounts that already have more projects are grandfathered.
  websites: { free: 1, lite: 1, pro: 1 },
  credits_per_month: { free: 20, lite: 300, pro: 1000 },
  geo_prompts: { free: 3, lite: 10, pro: 10 },
  // Free: manual, 1 run/week. Paid plans also run weekly automatically.
  geo_manual_runs_per_week: { free: 1, lite: UNLIMITED, pro: UNLIMITED },
  // Free: 10 messages/month at 1 credit each. Paid: spend credits.
  chat_messages_per_month: { free: 10, lite: UNLIMITED, pro: UNLIMITED },
  // Free: 28-day view. Paid: full stored history (retention policy applies).
  traffic_view_days: { free: 28, lite: UNLIMITED, pro: UNLIMITED },
  // Leads finder is Pro-only.
  daily_leads: { free: 0, lite: 0, pro: UNLIMITED },
};

export const FEATURE_IDS = [
  "websites",
  "credits",
  "website_analysis",
  "seo_audit_manual",
  "seo_daily_monitor",
  "findings_track",
  "findings_auto_verify",
  "geo_tracking",
  "geo_weekly_auto",
  "traffic_connect",
  "traffic_history",
  "competitors_strategy_docs",
  "coding_agent",
  "x_drafts",
  "notifications_in_app",
  "notifications_email_digest",
  "leads_finder",
  "outreach_email",
  "reddit_drafts",
  "linkedin_drafts",
  "hn_drafts",
  "article_writer",
  "cms_publish",
  "chat",
  "support_community",
  "support_email",
  "support_priority",
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export type Feature = {
  id: FeatureId;
  label: string;
  description: string;
  /** Lowest plan that includes this feature. */
  minPlan: PlanId;
  /** Numeric limit shown with this feature on the pricing page, if any. */
  limitKey?: LimitKey;
};

export const FEATURES: readonly Feature[] = [
  { id: "websites", label: "Websites", description: "One AI CMO per website. More websites means more subscriptions.", minPlan: "free", limitKey: "websites" },
  { id: "credits", label: "Credits per month", description: "Monthly allowance for AI actions. Does not roll over.", minPlan: "free", limitKey: "credits_per_month" },
  { id: "website_analysis", label: "Website analysis and context docs", description: "Product info, positioning and ICP. Setup of your first website is free.", minPlan: "free" },
  { id: "seo_audit_manual", label: "SEO audit (manual)", description: "Run an audit on demand (5 credits).", minPlan: "free" },
  { id: "seo_daily_monitor", label: "Daily SEO monitor", description: "Daily monitoring with automatic re-checks.", minPlan: "lite" },
  { id: "findings_track", label: "Findings and recommendations", description: "Read, track and manually verify fixes.", minPlan: "free" },
  { id: "findings_auto_verify", label: "Automatic fix verification", description: "Findings are re-checked and verified for you.", minPlan: "lite" },
  { id: "geo_tracking", label: "GEO tracking", description: "Track how AI answers mention your brand. Free: 3 prompts, manual, 1 run per week. Paid: 10 prompts, weekly auto runs.", minPlan: "free", limitKey: "geo_prompts" },
  { id: "geo_weekly_auto", label: "Weekly automatic GEO runs", description: "GEO prompts run on a weekly schedule.", minPlan: "lite" },
  { id: "traffic_connect", label: "Traffic (Search Console and GA4)", description: "Connect Google data and see the last 28 days.", minPlan: "free", limitKey: "traffic_view_days" },
  { id: "traffic_history", label: "Traffic history and opportunities", description: "History, opportunities and weekly snapshots.", minPlan: "lite" },
  { id: "competitors_strategy_docs", label: "Competitors and strategy docs", description: "Competitor analysis, marketing, content and design strategy documents.", minPlan: "lite" },
  { id: "coding_agent", label: "Coding agent", description: "Opens GitHub pull requests that fix findings (15 credits per PR).", minPlan: "lite" },
  { id: "x_drafts", label: "X (Twitter) drafts", description: "AI-drafted posts and threads for X.", minPlan: "lite" },
  { id: "notifications_in_app", label: "In-app notifications", description: "Notifications inside the dashboard.", minPlan: "free" },
  { id: "notifications_email_digest", label: "Email digest", description: "Weekly digest and notifications by email.", minPlan: "lite" },
  { id: "leads_finder", label: "Leads finder", description: "Find and refresh qualified leads.", minPlan: "pro", limitKey: "daily_leads" },
  { id: "outreach_email", label: "Outreach email", description: "Draft and send outreach emails to leads.", minPlan: "pro" },
  { id: "reddit_drafts", label: "Reddit drafts", description: "Opportunities and AI-drafted replies for Reddit.", minPlan: "pro" },
  { id: "linkedin_drafts", label: "LinkedIn drafts", description: "AI-drafted LinkedIn posts.", minPlan: "pro" },
  { id: "hn_drafts", label: "Hacker News drafts", description: "AI-drafted Hacker News posts.", minPlan: "pro" },
  { id: "article_writer", label: "AI article writer", description: "Long-form articles written from your strategy.", minPlan: "pro" },
  { id: "cms_publish", label: "CMS publishing", description: "Publish articles to your CMS after your approval.", minPlan: "pro" },
  { id: "chat", label: "AI CMO chat", description: "Free: 10 messages per month. Paid plans spend credits.", minPlan: "free", limitKey: "chat_messages_per_month" },
  { id: "support_community", label: "Community support", description: "Help from the community.", minPlan: "free" },
  { id: "support_email", label: "Email support", description: "Support by email.", minPlan: "lite" },
  { id: "support_priority", label: "Priority email support", description: "Priority support by email.", minPlan: "pro" },
];

const FEATURE_BY_ID: ReadonlyMap<string, Feature> = new Map(FEATURES.map((f) => [f.id, f]));

export function getFeature(id: string): Feature | undefined {
  return FEATURE_BY_ID.get(id);
}

/** Prices in whole US dollars. Suggestions to validate against real provider bills. */
export type PlanPrice = {
  /** Billed monthly. */
  monthly: number;
  /** Billed annually, shown per month (rounded to whole dollars). */
  annualPerMonth: number;
  /** Billed annually, charged once per year (10 months, i.e. 2 months free). */
  annualTotal: number;
};

const ANNUAL_MONTHS_CHARGED = 10;

function price(monthly: number): PlanPrice {
  const annualTotal = monthly * ANNUAL_MONTHS_CHARGED;
  return { monthly, annualTotal, annualPerMonth: Math.round(annualTotal / 12) };
}

export const PLAN_PRICES: Record<PlanId, PlanPrice> = {
  free: { monthly: 0, annualPerMonth: 0, annualTotal: 0 },
  lite: price(29),
  pro: price(79),
};

export type PlanFeatureRow = {
  id: FeatureId;
  label: string;
  description: string;
  minPlan: PlanId;
  /** True when this plan includes the feature. */
  included: boolean;
  /** The plan's numeric limit for this feature (-1 unlimited, 0 none), when the feature has one. */
  limit?: { key: LimitKey; value: number };
};

/** Every feature, in matrix order, with whether `plan` includes it. For the pricing page and UI locks. */
export function listFeaturesForPlan(plan: PlanId): PlanFeatureRow[] {
  return FEATURES.map((f) => {
    const included = PLAN_RANK[plan] >= PLAN_RANK[f.minPlan];
    const row: PlanFeatureRow = { id: f.id, label: f.label, description: f.description, minPlan: f.minPlan, included };
    if (f.limitKey) row.limit = { key: f.limitKey, value: PLAN_LIMITS[f.limitKey][plan] };
    return row;
  });
}
