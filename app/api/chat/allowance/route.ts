import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { checkChatAllowance } from "@/lib/domain/assistant/chatEntitlements";
import { platformEntitlementPort } from "@/lib/domain/assistant/platformAdapters";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

/**
 * The caller's monthly chat allowance, for the usage meter under the composer.
 * Same object the chat returns inside its 402 body. Cheap: one plan lookup and,
 * only when enforcement is on and the plan is capped, one head-only count.
 */
export async function GET() {
  if (!FEATURES.PLATFORM_MODE) {
    const out = await checkChatAllowance(
      { entitlement: async () => ({ plan: "selfhost", enforced: false }), countPlatformChatMessages: async () => 0 },
      { mode: "selfhost", userId: null, activeProjectId: null },
    );
    return NextResponse.json(out);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const out = await checkChatAllowance(
    platformEntitlementPort(() => createServiceClient()),
    { mode: "platform", userId: user.id, activeProjectId: null },
  );
  return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
}
