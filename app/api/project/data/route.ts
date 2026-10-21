import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";
import { FEATURES } from "@/lib/features";
import { getDb } from "@/lib/db";
import { DATASETS, etagFor, etagMatches, loadPlatformDatasets, type DatasetClient } from "@/lib/domain/project/dashboardData";

export const runtime = "nodejs";

// `private, no-cache` + ETag: the browser must revalidate every time (so a
// mutation is never hidden behind a stale copy), but an unchanged dashboard
// answers 304 with no body instead of re-sending every row.
const CACHE_CONTROL = "private, no-cache";

export async function GET(request: NextRequest) {
  const requestedProjectId = request.nextUrl.searchParams.get("projectId");
  const result = await getAuthenticatedProjectContext(requestedProjectId);
  if ("response" in result) return result.response;

  const { context } = result;
  let data: Record<string, unknown[]> = {};

  if (FEATURES.PLATFORM_MODE && context.supabase) {
    // The ten dataset queries are independent, so they run concurrently.
    const loaded = await loadPlatformDatasets(context.supabase as unknown as DatasetClient, context.projectId);
    if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: 500 });
    data = loaded.data;
  } else {
    const db = getDb();
    for (const [table, orderColumn] of Object.entries(DATASETS)) {
      try {
        data[table] = db.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY ${orderColumn} DESC`).all(context.projectId) as unknown[];
      } catch {
        data[table] = [];
      }
    }
  }

  const body = JSON.stringify({ project: context.project, projectId: context.projectId, data });
  const etag = etagFor(body);
  const headers = { "Cache-Control": CACHE_CONTROL, ETag: etag, Vary: "Cookie" };
  if (etagMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}
