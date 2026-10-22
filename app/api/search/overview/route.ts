import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listFindings } from "@/lib/domain/findings/findingService";
import { sqliteFindingRepository, supabaseFindingRepository } from "@/lib/domain/findings/findingRepositories";
import type { Finding } from "@/lib/domain/findings/findingTypes";
import { buildOpportunities, type OpportunityGroups } from "@/lib/domain/search/searchOpportunities";
import { getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase } from "@/lib/domain/search/searchSnapshotStoreSupabase";
import type { SearchSnapshotPayload } from "@/lib/domain/search/searchSnapshot";
import { nextActionsEmptyState, rankNextActions } from "@/lib/domain/search/nextActions";
import { computeDelta, overviewDataFlags } from "@/lib/domain/search/deltaView";
import { summaryTotals } from "@/lib/domain/search/summaryTotals";
import { weekChanges } from "@/lib/domain/search/weekChanges";
import { readOutcomes, type ActionWithOutcome, type OutcomePorts } from "@/lib/domain/search/outcomeService";
import { platformOutcomePorts, selfHostOutcomePorts } from "@/lib/domain/search/outcomePorts";
import { listProjectActions } from "@/lib/domain/actions/actionStore";
import { listProjectActions as listProjectActionsSupabase } from "@/lib/domain/actions/actionStoreSupabase";
import type { Action } from "@/lib/domain/actions/actionTypes";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

type OverviewResponse = {
  snapshot?: { capturedAt: string; snapshotDate: string } | null;
  gscNotConnected?: boolean;
  collectingData?: boolean;
  /** Snapshot has data but the previous period is empty: show no deltas. */
  noComparison?: boolean;
  /** Null for a metric means "no baseline": show no arrow. */
  deltas?: { clicks: unknown; impressions: unknown; position: unknown } | null;
  nextActionsEmpty?: unknown;
  stats?: unknown;
  weekChanges?: unknown[];
  nextActions?: unknown[];
  yourFixes?: unknown[];
  error?: string;
};

/**
 * Build the overview response from data.
 */
async function buildOverview(params: {
  latest: { capturedAt: string; snapshotDate: string; payload: SearchSnapshotPayload } | null;
  opportunities: OpportunityGroups;
  findings: Finding[];
  actions: Action[];
  ports: OutcomePorts;
}): Promise<OverviewResponse> {
  const { latest, opportunities, findings, actions, ports } = params;

  if (!latest) {
    return { snapshot: null, gscNotConnected: true };
  }

  const outcomes = await readOutcomes(ports, actions);
  const withOutcomes = outcomes.filter((a: ActionWithOutcome) => a.outcome !== null);
  const yourFixes = withOutcomes
    .filter((a: ActionWithOutcome) => a.status === "completed")
    .sort(
      (a: ActionWithOutcome, b: ActionWithOutcome) =>
        new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime(),
    )
    .slice(0, 3);

  const payload = latest.payload;
  const flags = overviewDataFlags(payload.windows);
  const usable = !flags.collectingData && !flags.noComparison;
  const now = summaryTotals(payload.windows.d28);
  const before = summaryTotals(payload.windows.prev28);
  const nextActions = flags.collectingData ? [] : rankNextActions(findings, opportunities, 3);
  return {
    snapshot: { capturedAt: latest.capturedAt, snapshotDate: latest.snapshotDate },
    ...flags,
    stats: {
      d28: payload.windows.d28,
      prev28: payload.windows.prev28,
    },
    deltas: usable
      ? {
          clicks: computeDelta(now.clicks, before.clicks),
          impressions: computeDelta(now.impressions, before.impressions),
          position: computeDelta(now.position, before.position, "position"),
        }
      : null,
    // Without a baseline there is nothing to compare, so no "lost/gained" claims either.
    weekChanges: usable ? weekChanges(payload.windows.d28, payload.windows.prev28, 5) : [],
    nextActions,
    nextActionsEmpty: nextActions.length === 0 ? nextActionsEmptyState(payload) : null,
    yourFixes,
  };
}

/**
 * Search overview: snapshot stats, week changes, next actions, completed fixes.
 */
export async function GET(): Promise<NextResponse<OverviewResponse>> {
  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value;
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

      const { data: project } = await db.from("projects").select("url").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
      const latest = await getLatestSnapshotSupabase(db, user.id, projectId);

      if (!latest) {
        return NextResponse.json({ snapshot: null, gscNotConnected: true });
      }

      const opportunities = buildOpportunities(latest.payload);
      const findings = await listFindings(supabaseFindingRepository(db, user.id), projectId);
      const actions = await listProjectActionsSupabase(db, user.id, projectId);
      const ports = await platformOutcomePorts(db, user.id, projectId, project?.url ?? null);

      return NextResponse.json(
        await buildOverview({ latest, opportunities, findings, actions, ports }),
      );
    }

    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const db = getDb();
    const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string | null } | undefined;
    const latest = getLatestSnapshot(db, projectId);

    if (!latest) {
      return NextResponse.json({ snapshot: null, gscNotConnected: true });
    }

    const opportunities = buildOpportunities(latest.payload);
    const findings = await listFindings(sqliteFindingRepository(), projectId);
    const actions = listProjectActions(projectId);
    const ports = selfHostOutcomePorts(projectId, project?.url ?? null);

    return NextResponse.json(
      await buildOverview({ latest, opportunities, findings, actions, ports }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
