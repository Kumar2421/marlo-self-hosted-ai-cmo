import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";
import { setupStoreFor } from "@/lib/domain/project/setupStateForRequest";
import { getOrCreateSetupState, recordSetupTransition } from "@/lib/domain/project/setupStateService";
import { isSetupStatus, isSetupStepKey, summarizeSetup, type SetupState } from "@/lib/domain/project/setupState";

export const runtime = "nodejs";

function view(state: SetupState, now: Date) {
  return { state, summary: summarizeSetup(state, now), serverTime: now.toISOString() };
}

/** Setup progress for the active project (or `?projectId=`). Ownership is checked by
 * getAuthenticatedProjectContext. A project with no stored state gets one derived from
 * its existing rows and written lazily. */
export async function GET(request: NextRequest) {
  const result = await getAuthenticatedProjectContext(request.nextUrl.searchParams.get("projectId"));
  if ("response" in result) return result.response;
  try {
    const now = new Date();
    const state = await getOrCreateSetupState(setupStoreFor(result.context), now);
    return NextResponse.json(view(state, now), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read setup state" }, { status: 500 });
  }
}

/** Records one step transition: { projectId?, step, status, error?, retry? }.
 * 409 when the rules reject it (e.g. another tab is running that step). */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !isSetupStepKey(body.step) || !isSetupStatus(body.status)) {
    return NextResponse.json({ error: "step and status are required and must be known values" }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  const result = await getAuthenticatedProjectContext(projectId);
  if ("response" in result) return result.response;
  try {
    const now = new Date();
    const out = await recordSetupTransition(
      setupStoreFor(result.context),
      {
        step: body.step,
        status: body.status,
        error: typeof body.error === "string" ? body.error : undefined,
        retry: body.retry === true,
      },
      now,
    );
    if (!out.ok) {
      const status = out.reason === "invalid" ? 400 : 409;
      return NextResponse.json({ error: out.message, reason: out.reason }, { status });
    }
    return NextResponse.json(view(out.state, now));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not record setup step" }, { status: 500 });
  }
}
