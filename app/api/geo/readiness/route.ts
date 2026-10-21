import { NextRequest, NextResponse } from "next/server";
import { upsertFinding } from "@/lib/domain/findings/findingStore";
import { upsertFinding as upsertFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { resolveGeoContext } from "@/lib/domain/geo/geoContext";
import { checkReadiness, loadProject } from "@/lib/domain/geo/geoService";

export async function GET() {
  const r = await resolveGeoContext();
  if ("response" in r) return r.response;
  try {
    const project = await loadProject(r.ctx);
    if (!project) return NextResponse.json({ error: "No project website linked yet. Add one in the project switcher first." }, { status: 422 });
    return NextResponse.json({ ...(await checkReadiness(project.domain)), domain: project.domain, checkedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "The readiness check could not run. Try again in a moment.", code: "readiness_unavailable" }, { status: 502 });
  }
}

/** Turn one failing readiness check into a tracked finding. Re-evaluated server side; the client only names the check. */
export async function POST(req: NextRequest) {
  const r = await resolveGeoContext();
  if ("response" in r) return r.response;
  const { checkId } = (await req.json().catch(() => ({}))) as { checkId?: string };
  const project = await loadProject(r.ctx);
  if (!project) return NextResponse.json({ error: "No project website linked yet." }, { status: 422 });
  const result = await checkReadiness(project.domain);
  const check = result.checks.find((c) => c.id === checkId);
  if (!check) return NextResponse.json({ error: "Unknown check." }, { status: 400 });
  if (check.status !== "fail") return NextResponse.json({ finding: null, message: "That check is not failing." });

  const input = {
    projectId: r.ctx.projectId,
    source: "geo",
    category: "geo_readiness",
    severity: "warning" as const,
    entityType: "readiness_check",
    entityId: check.id,
    url: `https://${project.domain}/`,
    evidence: { method: "readiness", label: check.label, detail: check.detail, score: result.score },
    recommendation: check.fix,
  };
  const finding = r.ctx.mode === "platform" ? await upsertFindingSupabase(r.ctx.db, r.ctx.userId, input) : upsertFinding(input);
  return NextResponse.json({ finding });
}
