import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getEntitlement } from "@/lib/entitlements";
import { buildPlanInfo } from "@/lib/domain/plans/planInfo";
import { createClient } from "@/utils/supabase/server";

/**
 * The caller's plan, limits and per-feature access, for UI locks only.
 * Not an enforcement point: server routes decide on their own. While billing
 * enforcement is off (or on self-host) every feature is reported as available.
 */
export async function GET() {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json(buildPlanInfo({ plan: "selfhost", enforced: false }));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const entitlement = await getEntitlement(user.id);
  return NextResponse.json(buildPlanInfo(entitlement), { headers: { "Cache-Control": "private, no-store" } });
}
