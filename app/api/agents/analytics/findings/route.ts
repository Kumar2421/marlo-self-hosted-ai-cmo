import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { upsertFinding } from "@/lib/domain/findings/findingStore";
import { upsertFinding as upsertFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { sqliteFindingRepository, supabaseFindingRepository } from "@/lib/domain/findings/findingRepositories";
import { deriveSearchFinding } from "@/lib/domain/findings/findingRules";
import { applyRecheck, getFinding, listFindings, transitionFinding, type FindingRepository } from "@/lib/domain/findings/findingService";
import { findingErrorResponse } from "@/lib/domain/findings/findingHttp";
import { isFindingStatus, type Finding } from "@/lib/domain/findings/findingTypes";
import { checkedDecision, decideRecheck, type RecheckDecision } from "@/lib/domain/findings/recheckDecision";
import { checkReadiness } from "@/lib/domain/geo/geoService";
import {
  findExistingFinding,
  isOpportunityType,
  opportunityEvidenceOf,
  opportunityFindingFromSnapshot,
  recheckOpportunityFinding,
} from "@/lib/domain/search/opportunityFinding";
import type { OpportunityType } from "@/lib/domain/search/searchOpportunities";
import { getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase } from "@/lib/domain/search/searchSnapshotStoreSupabase";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { resolvePlatformApiKey } from "@/lib/domain/shared/resolvePlatformApiKey";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;

function auditEvidence(audit: Awaited<ReturnType<SEOAgent["audit"]>>, metrics: Record<string, unknown>) {
  return {
    ...metrics,
    page: {
      meta: audit.meta,
      headings: audit.headings,
      contentRelevance: audit.contentRelevance,
      technical: { status: audit.technical.status, redirectCount: audit.technical.redirectCount },
      serverTiming: audit.serverTiming,
      links: {
        internal: audit.links.filter((link) => link.internal).length,
        external: audit.links.filter((link) => !link.internal).length,
      },
    },
  };
}

function projectPageUrl(projectUrl: string, pageUrl: string): URL | null {
  try {
    const project = new URL(projectUrl);
    const target = new URL(pageUrl);
    if (target.protocol !== project.protocol || target.hostname !== project.hostname) return null;
    return target;
  } catch {
    return null;
  }
}

async function runRecheck(finding: { url: string | null; evidence: Record<string, unknown> }, pageSpeedApiKey: string | undefined) {
  if (!finding.url) throw new Error("Finding has no ranking page URL.");
  const metrics = {
    query: finding.evidence.query ?? null,
    clicks: finding.evidence.clicks ?? null,
    impressions: finding.evidence.impressions ?? null,
    ctr: finding.evidence.ctr ?? null,
    position: finding.evidence.position ?? null,
    score: finding.evidence.score ?? null,
  };
  const audit = await new SEOAgent(pageSpeedApiKey).audit(finding.url);
  const rule = deriveSearchFinding(audit);
  return {
    audit,
    rule,
    evidence: auditEvidence(audit, metrics),
  };
}

async function resolvePlatformPageSpeedKey(db: ReturnType<typeof createServiceClient>, userId: string): Promise<string | undefined> {
  return (await resolvePlatformApiKey(db, userId, "pagespeed_api_key")) || process.env.PAGESPEED_API_KEY || undefined;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    if (id) {
      const finding = await getFinding(supabaseFindingRepository(db, user.id), projectId, id);
      return finding ? NextResponse.json({ finding }) : NextResponse.json({ error: "Finding not found." }, { status: 404 });
    }
    return NextResponse.json({ findings: await listFindings(supabaseFindingRepository(db, user.id), projectId) });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  if (id) {
    const finding = await getFinding(sqliteFindingRepository(), projectId, id);
    return finding ? NextResponse.json({ finding }) : NextResponse.json({ error: "Finding not found." }, { status: 404 });
  }
  return NextResponse.json({ findings: await listFindings(sqliteFindingRepository(), projectId) });
}

/**
 * Track a search opportunity as a finding. The evidence is rebuilt from the
 * latest saved snapshot, so it cannot be forged and matches what the panel
 * showed. Creating one that is already tracked returns the existing finding
 * unchanged, which also keeps its original numbers as the baseline.
 */
async function createFromOpportunity(type: OpportunityType, query: string) {
  if (!query.trim()) return NextResponse.json({ error: "A search term is required." }, { status: 400 });

  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value;
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
      const { data: project } = await db.from("projects").select("name, url").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
      if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

      const snapshot = await getLatestSnapshotSupabase(db, user.id, projectId);
      const built = opportunityFindingFromSnapshot({ type, query, payload: snapshot?.payload ?? null, projectId, brand: project.name, projectUrl: project.url });
      if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status });

      const existing = findExistingFinding(await supabaseFindingRepository(db, user.id).list(projectId), built.input);
      if (existing) return NextResponse.json({ finding: existing, existing: true });
      return NextResponse.json({ finding: await upsertFindingSupabase(db, user.id, built.input), existing: false });
    }

    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const db = getDb();
    const project = db.prepare("SELECT name, url FROM projects WHERE id = ?").get(projectId) as { name: string; url: string | null } | undefined;
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const snapshot = getLatestSnapshot(db, projectId);
    const built = opportunityFindingFromSnapshot({ type, query, payload: snapshot?.payload ?? null, projectId, brand: project.name, projectUrl: project.url });
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status });

    const existing = findExistingFinding(await sqliteFindingRepository().list(projectId), built.input);
    if (existing) return NextResponse.json({ finding: existing, existing: true });
    return NextResponse.json({ finding: upsertFinding(built.input), existing: false });
  } catch (err) {
    const { status, error } = findingErrorResponse(err, "The page could not be audited right now. Try again.");
    return NextResponse.json({ error }, { status });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (isOpportunityType(body?.opportunityType)) {
    return createFromOpportunity(body.opportunityType, typeof body.query === "string" ? body.query : "");
  }
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const pageUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!query || !pageUrl) return NextResponse.json({ error: "Query and ranking page URL are required." }, { status: 400 });

  const metrics = {
    query,
    clicks: typeof body?.clicks === "number" ? body.clicks : null,
    impressions: typeof body?.impressions === "number" ? body.impressions : null,
    ctr: typeof body?.ctr === "number" ? body.ctr : null,
    position: typeof body?.position === "number" ? body.position : null,
    score: typeof body?.score === "number" ? body.score : null,
  };

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
      if (!project?.url) return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });
      const target = projectPageUrl(project.url, pageUrl);
      if (!target) return NextResponse.json({ error: "Ranking page must belong to the active project website." }, { status: 403 });
      const audit = await new SEOAgent(await resolvePlatformPageSpeedKey(db, user.id)).audit(target.toString());
      const rule = deriveSearchFinding(audit);
      if (!rule) return NextResponse.json({ finding: null, message: "No actionable issue found on this ranking page." });
      const finding = await upsertFindingSupabase(db, user.id, {
        projectId, source: "search-console", category: "search-visibility", severity: rule.severity,
        entityType: "query", entityId: query, url: target.toString(),
        evidence: auditEvidence(audit, metrics), recommendation: rule.recommendation,
      });
      return NextResponse.json({ finding });
    }

    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const db = getDb();
    const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string } | undefined;
    if (!project?.url) return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });
    const target = projectPageUrl(project.url, pageUrl);
    if (!target) return NextResponse.json({ error: "Ranking page must belong to the active project website." }, { status: 403 });
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as { value: string } | undefined;
    const audit = await new SEOAgent(stored?.value || process.env.PAGESPEED_API_KEY || undefined).audit(target.toString());
    const rule = deriveSearchFinding(audit);
    if (!rule) return NextResponse.json({ finding: null, message: "No actionable issue found on this ranking page." });
    const finding = upsertFinding({
      projectId, source: "search-console", category: "search-visibility", severity: rule.severity,
      entityType: "query", entityId: query, url: target.toString(),
      evidence: auditEvidence(audit, metrics), recommendation: rule.recommendation,
    });
    return NextResponse.json({ finding });
  } catch (err) {
    const { status, error } = findingErrorResponse(err, "The page could not be audited right now. Try again.");
    return NextResponse.json({ error }, { status });
  }
}

/** The Re-check decision for one finding: search snapshots, the search-console page audit, or the verifyFinding rules for everything else. */
async function recheckDecisionFor(
  finding: Finding,
  pageSpeedApiKey: string | undefined,
  latestSnapshot: () => Promise<Parameters<typeof recheckOpportunityFinding>[1]>,
): Promise<RecheckDecision> {
  if (opportunityEvidenceOf(finding.evidence)) return checkedDecision(recheckOpportunityFinding(finding, await latestSnapshot()));
  if (finding.source === "search-console") {
    const r = await runRecheck(finding, pageSpeedApiKey);
    return checkedDecision({
      issueDetected: Boolean(r.rule),
      severity: r.rule?.severity ?? finding.severity,
      recommendation: r.rule?.recommendation ?? "Issue no longer detected. Keep the page under observation and re-check if it changes.",
      evidence: r.evidence,
    });
  }
  const agent = new SEOAgent(pageSpeedApiKey);
  return decideRecheck(
    {
      runSeoAudit: async (url) => {
        const audit = await agent.audit(url);
        return { findings: audit.findings, finalUrl: audit.finalUrl, hasPageSpeed: Boolean(audit.pageSpeed || audit.lighthouseIssues) };
      },
      runGeoReadiness: async (url) => (await checkReadiness(new URL(url).hostname)).checks,
    },
    finding,
    new Date(),
    { allowPageSpeed: Boolean(pageSpeedApiKey) },
  );
}

async function handlePut(
  repo: FindingRepository,
  projectId: string,
  finding: Finding,
  body: { id: string; action: string; status: string },
  recheck: () => Promise<RecheckDecision>,
) {
  if (body.action === "recheck") {
    const decision = await recheck();
    // A check that could not prove anything changes nothing and says why.
    if (decision.kind === "skipped") return NextResponse.json({ finding, skipped: true, reason: decision.reason });
    const updated = await applyRecheck(repo, projectId, body.id, decision.result);
    return NextResponse.json({ finding: updated, verification: { status: decision.outcome, changed: decision.outcome === "verified" } });
  }
  if (!isFindingStatus(body.status)) return NextResponse.json({ error: "Invalid finding status." }, { status: 400 });
  return NextResponse.json({ finding: await transitionFinding(repo, projectId, body.id, body.status) });
}

export async function PUT(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = {
    id: typeof raw?.id === "string" ? raw.id : "",
    action: typeof raw?.action === "string" ? raw.action : "",
    status: typeof raw?.status === "string" ? raw.status : "",
  };
  if (!body.id) return NextResponse.json({ error: "Finding id is required." }, { status: 400 });

  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value;
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
      const repo = supabaseFindingRepository(db, user.id);
      const finding = await getFinding(repo, projectId, body.id);
      if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
      return await handlePut(repo, projectId, finding, body, async () =>
        recheckDecisionFor(finding, await resolvePlatformPageSpeedKey(db, user.id), () => getLatestSnapshotSupabase(db, user.id, projectId)));
    }

    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const repo = sqliteFindingRepository();
    const finding = await getFinding(repo, projectId, body.id);
    if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
    return await handlePut(repo, projectId, finding, body, async () => {
      const stored = getDb().prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as { value: string } | undefined;
      return recheckDecisionFor(finding, stored?.value || process.env.PAGESPEED_API_KEY || undefined, async () => getLatestSnapshot(getDb(), projectId));
    });
  } catch (err) {
    const { status, error } = findingErrorResponse(err, "The check could not be completed. Try again.");
    return NextResponse.json({ error }, { status });
  }
}
