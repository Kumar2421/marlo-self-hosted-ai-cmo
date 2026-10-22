import { FEATURES } from "./features.ts";
import { limit, resolvePlan } from "./domain/plans/planPolicy.ts";
import type { PlanId } from "./domain/plans/planMatrix.ts";

/**
 * Entitlements: thin server-side adapter over the plan matrix
 * (lib/domain/plans/planMatrix.ts + planPolicy.ts), which is the single source
 * of truth for what each plan includes.
 * Rule: logic is open, operations/scale are paid; self-host (OSS) must never be crippled.
 *
 * Enforcement is OFF by default (app_config.billing_enabled = false): every
 * hosted account is treated as "pro" (everything unlocked) and self-host is
 * always "selfhost". When enforcement is on, the plan comes from
 * profiles.plan_tier and a failed lookup fails CLOSED to "free".
 *
 * With enforcement on, the Free plan allows 1 website for NEW creates;
 * accounts that already have more projects are grandfathered (the cap only
 * blocks creating another, nothing is removed).
 */

export type Plan = PlanId | "selfhost";

type Entitlement = { plan: Plan; enforced: boolean };

const UNGATED: Entitlement = { plan: "pro", enforced: false };

/**
 * Resolves the plan and whether limits are enforced for this user.
 * Self-host: "selfhost", never enforced.
 * Hosted: enforcement is read from app_config.billing_enabled. If that flag
 * cannot be read we keep today's unlocked behavior (the flag ships dark);
 * once it reads true, a failed plan lookup resolves to "free".
 */
async function loadEntitlement(userId: string): Promise<Entitlement> {
  if (!FEATURES.PLATFORM_MODE) {
    return { plan: "selfhost", enforced: false };
  }

  try {
    // Lazy-load Supabase client to avoid import issues in tests
    const { createServiceClient } = await import("@/utils/supabase/serviceClient.ts");
    const db = createServiceClient();
    const [config, profile] = await Promise.all([
      db.from("app_config").select("billing_enabled").eq("id", true).maybeSingle(),
      db.from("profiles").select("plan_tier").eq("id", userId).maybeSingle(),
    ]);

    if (config.error) {
      console.warn("Could not read billing enforcement flag:", config.error.code);
      return UNGATED;
    }
    const enforcement = config.data?.billing_enabled === true;
    if (!enforcement) return UNGATED;

    const lookupFailed = Boolean(profile.error);
    if (lookupFailed) console.warn("Could not verify user plan tier:", profile.error?.code);
    const plan = resolvePlan({
      enforcement,
      selfHost: false,
      rawPlan: profile.data?.plan_tier,
      lookupFailed,
    });
    return { plan, enforced: true };
  } catch {
    console.warn("Entitlements lookup error");
    return UNGATED;
  }
}

/**
 * Get the plan to apply for a user. "selfhost" on self-host, "pro" while
 * enforcement is off, otherwise profiles.plan_tier (fail closed to "free").
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
  if (!enforced || plan === "selfhost") return UNLIMITED_CHECK;

  const projectLimit = limit(plan, "websites");
  if (projectLimit === -1) return UNLIMITED_CHECK;

  const blocked = (count: number): LimitCheck => ({
    allowed: false,
    remaining: 0,
    limit: projectLimit,
    message:
      count >= projectLimit
        ? `Website limit reached (${projectLimit} per plan). Upgrade your plan to add more.`
        : "Could not verify your website count. Try again.",
  });

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
      return blocked(0); // enforcement is on: fail closed
    }

    const projectCount = count || 0;
    if (projectCount >= projectLimit) return blocked(projectCount);
    return { allowed: true, remaining: Math.max(0, projectLimit - projectCount), limit: projectLimit };
  } catch {
    console.warn("Project limit check error");
    return blocked(0);
  }
}

/**
 * Check if user can fetch more leads today.
 * Unlimited while enforcement is off and on self-host.
 */
export async function canFetchLeadsToday(userId: string): Promise<LimitCheck> {
  const { plan, enforced } = await loadEntitlement(userId);
  if (!enforced || plan === "selfhost") return UNLIMITED_CHECK;

  const dailyLeadsLimit = limit(plan, "daily_leads");
  if (dailyLeadsLimit === -1) return UNLIMITED_CHECK;

  const blocked = (message: string): LimitCheck => ({ allowed: false, remaining: 0, limit: dailyLeadsLimit, message });
  if (dailyLeadsLimit === 0) {
    return blocked("Lead search is available on the Pro plan. Upgrade to find leads.");
  }

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
      return blocked("Could not verify your daily lead allowance. Try again.");
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
      return blocked("Could not verify your daily lead allowance. Try again.");
    }

    const leadsCount = count || 0;
    if (leadsCount >= dailyLeadsLimit) {
      return blocked(`Daily lead limit reached (${dailyLeadsLimit} leads). Check back tomorrow or upgrade your plan.`);
    }
    return { allowed: true, remaining: Math.max(0, dailyLeadsLimit - leadsCount), limit: dailyLeadsLimit };
  } catch {
    console.warn("Daily leads limit check error");
    return blocked("Could not verify your daily lead allowance. Try again.");
  }
}
