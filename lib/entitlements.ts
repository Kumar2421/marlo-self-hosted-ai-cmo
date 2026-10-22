import { FEATURES } from "./features.ts";
import { limit, normalizePlan, resolvePlan } from "./domain/plans/planPolicy.ts";
import type { PlanId } from "./domain/plans/planMatrix.ts";

/**
 * Entitlements: server-side adapter over the plan matrix
 * (lib/domain/plans/planMatrix.ts + planPolicy.ts), the single source of truth
 * for what each plan includes.
 * Rule: logic is open, operations/scale are paid; self-host (OSS) must never be crippled.
 *
 * Two regimes on hosted, switched by app_config.billing_enabled (off by default):
 * - Enforcement OFF: today's behavior, unchanged. The plan is profiles.plan_tier
 *   (a lookup error fails open to "pro"; a missing profile is "free") and the
 *   caps are LEGACY_LIMITS below.
 * - Enforcement ON: the plan matrix drives everything. The plan is
 *   profiles.plan_tier and a failed lookup fails CLOSED to "free". Free gets
 *   1 website for NEW creates (existing projects are grandfathered: the cap only
 *   blocks creating another); daily leads are Pro-only.
 * Self-host is always "selfhost" and never capped. If the flag itself cannot be
 * read, enforcement stays off.
 */

export type Plan = PlanId | "selfhost";

/**
 * Caps that apply ONLY while enforcement is off (what hosted shipped with).
 * Remove once enforcement is on everywhere. -1 = unlimited.
 */
export const LEGACY_LIMITS: Record<"projects" | "daily_leads", Record<PlanId, number>> = {
  projects: { free: 4, lite: 10, pro: -1 },
  daily_leads: { free: 10, lite: 50, pro: -1 },
};

/** Project (website) cap for a hosted plan: matrix when enforced, LEGACY_LIMITS otherwise. -1 = unlimited. */
export function projectCap(plan: PlanId, enforced: boolean): number {
  return enforced ? limit(plan, "websites") : LEGACY_LIMITS.projects[plan];
}

/** Daily lead cap for a hosted plan: matrix when enforced, LEGACY_LIMITS otherwise. -1 = unlimited, 0 = none. */
export function dailyLeadsCap(plan: PlanId, enforced: boolean): number {
  return enforced ? limit(plan, "daily_leads") : LEGACY_LIMITS.daily_leads[plan];
}

type Entitlement = { plan: Plan; enforced: boolean };

const SELF_HOST: Entitlement = { plan: "selfhost", enforced: false };

/**
 * Resolves the plan and whether the plan matrix is enforced for this user.
 * Never throws.
 */
async function loadEntitlement(userId: string): Promise<Entitlement> {
  if (!FEATURES.PLATFORM_MODE) return SELF_HOST;

  try {
    // Lazy-load Supabase client to avoid import issues in tests
    const { createServiceClient } = await import("@/utils/supabase/serviceClient.ts");
    const db = createServiceClient();
    const [config, profile] = await Promise.all([
      db.from("app_config").select("billing_enabled").eq("id", true).maybeSingle(),
      db.from("profiles").select("plan_tier").eq("id", userId).maybeSingle(),
    ]);

    if (config.error) console.warn("Could not read billing enforcement flag:", config.error.code);
    const enforced = !config.error && config.data?.billing_enabled === true;

    if (profile.error) {
      console.warn("Could not verify user plan tier:", profile.error.code);
      // Enforcement on: fail closed to "free". Off: legacy fail-open to "pro".
      return { plan: enforced ? resolvePlan({ enforcement: true, selfHost: false, rawPlan: null, lookupFailed: true }) : "pro", enforced };
    }
    // A missing profile row is "free" in both regimes.
    return { plan: normalizePlan(profile.data?.plan_tier), enforced };
  } catch {
    console.warn("Entitlements lookup error");
    // Enforcement unknown: stay in the legacy regime (fail open to "pro").
    return { plan: "pro", enforced: false };
  }
}

/**
 * Get the plan to apply for a user: "selfhost" on self-host, otherwise
 * profiles.plan_tier (see the two regimes above for lookup failures).
 */
export async function getUserPlan(userId: string): Promise<Plan> {
  return (await loadEntitlement(userId)).plan;
}

type LimitCheck = {
  allowed: boolean;
  remaining: number;
  limit: number;
  message?: string;
};

const UNLIMITED_CHECK: LimitCheck = { allowed: true, remaining: -1, limit: -1 };

/**
 * Check whether the user may create another project (website).
 * Only blocks NEW creates; existing projects are never touched (grandfathered).
 */
export async function canCreateProject(userId: string): Promise<LimitCheck> {
  const { plan, enforced } = await loadEntitlement(userId);
  if (plan === "selfhost") return UNLIMITED_CHECK;

  const projectLimit = projectCap(plan, enforced);
  if (projectLimit === -1) return UNLIMITED_CHECK;

  // Enforcement on fails closed on lookup errors; off keeps the legacy fail-open.
  const lookupFailure = (): LimitCheck =>
    enforced
      ? { allowed: false, remaining: 0, limit: projectLimit, message: "Could not verify your website count. Try again." }
      : { allowed: true, remaining: projectLimit, limit: projectLimit };

  try {
    // Lazy-load Supabase client to avoid import issues in tests
    const { createServiceClient } = await import("@/utils/supabase/serviceClient.ts");
    const db = createServiceClient();
    const { count, error } = await db
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", userId);

    if (error) {
      console.warn("Could not verify project count:", error.code);
      return lookupFailure();
    }

    const projectCount = count || 0;
    if (projectCount >= projectLimit) {
      return {
        allowed: false,
        remaining: 0,
        limit: projectLimit,
        message: enforced
          ? `Website limit reached (${projectLimit} per plan). Upgrade your plan to add more.`
          : `Project limit reached (${projectLimit} projects). Upgrade your plan to create more.`,
      };
    }
    return { allowed: true, remaining: Math.max(0, projectLimit - projectCount), limit: projectLimit };
  } catch {
    console.warn("Project limit check error");
    return lookupFailure();
  }
}

/**
 * Check if user can fetch more leads today.
 */
export async function canFetchLeadsToday(userId: string): Promise<LimitCheck> {
  const { plan, enforced } = await loadEntitlement(userId);
  if (plan === "selfhost") return UNLIMITED_CHECK;

  const dailyLeadsLimit = dailyLeadsCap(plan, enforced);
  if (dailyLeadsLimit === -1) return UNLIMITED_CHECK;

  const blocked = (message: string): LimitCheck => ({ allowed: false, remaining: 0, limit: dailyLeadsLimit, message });
  if (dailyLeadsLimit === 0) {
    return blocked("Lead search is available on the Pro plan. Upgrade to find leads.");
  }

  // Enforcement on fails closed on lookup errors; off keeps the legacy fail-open.
  const lookupFailure = (): LimitCheck =>
    enforced
      ? blocked("Could not verify your daily lead allowance. Try again.")
      : { allowed: true, remaining: dailyLeadsLimit, limit: dailyLeadsLimit };

  try {
    // Lazy-load Supabase client to avoid import issues in tests
    const { createServiceClient } = await import("@/utils/supabase/serviceClient.ts");
    const db = createServiceClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    // Count leads created by this user's projects today
    const { data: projects, error: projectsError } = await db
      .from("projects")
      .select("id")
      .eq("owner_id", userId);

    if (projectsError) {
      console.warn("Could not verify projects for lead count:", projectsError.code);
      return lookupFailure();
    }
    if (!projects || projects.length === 0) {
      return { allowed: true, remaining: dailyLeadsLimit, limit: dailyLeadsLimit };
    }

    const projectIds = projects.map((p) => p.id);

    const { count, error } = await db
      .from("leads")
      .select("*", { count: "exact", head: true })
      .in("project_id", projectIds)
      .gte("created_at", todayStr);

    if (error) {
      console.warn("Could not verify daily leads count:", error.code);
      return lookupFailure();
    }

    const leadsCount = count || 0;
    if (leadsCount >= dailyLeadsLimit) {
      return blocked(`Daily lead limit reached (${dailyLeadsLimit} leads). Check back tomorrow or upgrade your plan.`);
    }
    return { allowed: true, remaining: Math.max(0, dailyLeadsLimit - leadsCount), limit: dailyLeadsLimit };
  } catch {
    console.warn("Daily leads limit check error");
    return lookupFailure();
  }
}
