import { NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { listProjectIntegrations } from "@/lib/domain/integrations/integrationStore";
import {
  getSelectedSearchConsoleSite,
  listConnectionHealth,
  listProjectIntegrations as listProjectIntegrationsSupabase,
} from "@/lib/domain/integrations/integrationStoreSupabase";
import { buildGoogleConnectionStatus, worstHealth } from "@/lib/domain/integrations/connectionStatus";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ projectId: null, integrations: [], google: buildGoogleConnectionStatus({ connected: false, health: null, hasProperty: null, lastSyncAt: null }) });

    const integrations = await listProjectIntegrationsSupabase(db, user.id, projectId);
    const [health, site, lastSnapshot] = await Promise.all([
      listConnectionHealth(db, user.id, projectId),
      getSelectedSearchConsoleSite(db, user.id, projectId),
      db.from("search_snapshots").select("captured_at").eq("project_id", projectId).eq("user_id", user.id).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const hasGsc = integrations.some((integration) => integration.integrationType === "google-search-console");
    const google = buildGoogleConnectionStatus({
      connected: integrations.length > 0,
      health: worstHealth(health),
      hasProperty: hasGsc ? site !== null : null,
      lastSyncAt: lastSnapshot.data?.captured_at ? String(lastSnapshot.data.captured_at) : null,
    });
    return NextResponse.json({ projectId, integrations, google });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ projectId: null, integrations: [], google: buildGoogleConnectionStatus({ connected: false, health: null, hasProperty: null, lastSyncAt: null }) });
  const integrations = listProjectIntegrations(projectId);
  return NextResponse.json({
    projectId,
    integrations,
    google: buildGoogleConnectionStatus({ connected: integrations.length > 0, health: null, hasProperty: null, lastSyncAt: null }),
  });
}
