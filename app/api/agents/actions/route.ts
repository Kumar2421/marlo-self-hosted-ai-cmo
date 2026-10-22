import { after, NextRequest, NextResponse } from "next/server";
import { createAction, getProjectAction, listProjectActions, transitionAction } from "@/lib/domain/actions/actionStore";
import { createAction as createActionSupabase, getProjectAction as getProjectActionSupabase, listProjectActions as listProjectActionsSupabase, transitionAction as transitionActionSupabase } from "@/lib/domain/actions/actionStoreSupabase";
import { ActionLifecycleError, isActionStatus, isActionType } from "@/lib/domain/actions/actionTypes";
import { deriveActionType } from "@/lib/domain/actions/deriveActionType";
import { getProjectFinding } from "@/lib/domain/findings/findingStore";
import { getProjectFinding as getProjectFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { implementAction, readOutcomes, undoImplementation, type OutcomePorts } from "@/lib/domain/search/outcomeService";
import { platformOutcomePorts, selfHostOutcomePorts } from "@/lib/domain/search/outcomePorts";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { reconcileFixPullRequests } from "@/lib/domain/fixes/reconcileFixPullRequests";
import { tokenForPendingPullRequests } from "@/lib/domain/fixes/reconcileAllProjects";
import { fixDeliveryGithub } from "@/lib/domain/fixes/fixDeliveryGithub";
import { hostedGithubToken } from "@/lib/githubAppServer";

async function platformPorts(db: ReturnType<typeof createServiceClient>, userId: string, projectId: string): Promise<OutcomePorts> {
  const { data: project } = await db.from("projects").select("url").eq("id", projectId).eq("owner_id", userId).maybeSingle();
  return platformOutcomePorts(db, userId, projectId, project?.url ?? null);
}

function selfHostPorts(projectId: string): OutcomePorts {
  const project = getDb().prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string | null } | undefined;
  return selfHostOutcomePorts(projectId, project?.url ?? null);
}

/** Lifecycle errors are the caller's to resolve (409); anything else never leaks its raw message. */
function lifecycleOrGeneric(err: unknown, fallback: string) {
  if (err instanceof ActionLifecycleError) return NextResponse.json({ error: err.message }, { status: 409 });
  return NextResponse.json({ error: fallback }, { status: 502 });
}

function serviceResponse(result: Awaited<ReturnType<typeof implementAction>>) {
  return result.ok ? NextResponse.json(result.warning ? { action: result.value, warning: result.warning } : { action: result.value }) : NextResponse.json({ error: result.error }, { status: result.status });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const findingId = req.nextUrl.searchParams.get("findingId") ?? undefined;
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const ports = await platformPorts(db, user.id, projectId);
    const action = id ? await getProjectActionSupabase(db, user.id, projectId, id) : null;
    if (id) {
      if (!action) return NextResponse.json({ error: "Action not found." }, { status: 404 });
      return NextResponse.json({ action: (await readOutcomes(ports, [action]))[0] });
    }
    const actions = await listProjectActionsSupabase(db, user.id, projectId, findingId);
    // Reconcile merged PRs after the response is sent (after() keeps the work alive on serverless). The daily
    // cron also sweeps every linked project, so this only makes the page fresher.
    try {
      // GitHub App installation token (short-lived, never stored), minted only when a linked PR is pending.
      const githubToken = await tokenForPendingPullRequests(actions, () => hostedGithubToken(db, user.id, projectId));
      if (githubToken) {
        const fixDelivery = fixDeliveryGithub(githubToken);
        after(async () => {
          try {
            await reconcileFixPullRequests(ports, fixDelivery, actions);
          } catch {
            // Ignore reconciliation errors: they must not affect the response, and nothing is logged with secrets.
          }
        });
      }
    } catch {
      // Silently ignore reconciliation errors
    }
    return NextResponse.json({ actions: await readOutcomes(ports, actions) });
  }
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  const ports = selfHostPorts(projectId);
  const action = id ? getProjectAction(projectId, id) : null;
  if (id) {
    if (!action) return NextResponse.json({ error: "Action not found." }, { status: 404 });
    return NextResponse.json({ action: (await readOutcomes(ports, [action]))[0] });
  }
  const actions = listProjectActions(projectId, findingId);
  // Reconcile merged PRs lazily (best effort, non-blocking)
  // Self-host would need GitHub token from settings; for now, skip if not configured
  return NextResponse.json({ actions: await readOutcomes(ports, actions) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  // type is now optional: the server derives the right ActionType from the
  // finding itself (deriveActionType) so the client doesn't have to
  // duplicate that mapping or risk sending a mismatched one. An explicit
  // client-provided type is still honored if given.
  if (!body || typeof body.findingId !== "string" || typeof body.title !== "string") {
    return NextResponse.json({ error: "findingId and title are required." }, { status: 400 });
  }
  if (body.type !== undefined && !isActionType(body.type)) {
    return NextResponse.json({ error: "Invalid action type." }, { status: 400 });
  }
  const baseInput = {
    findingId: body.findingId as string,
    recommendationId: typeof body.recommendationId === "string" ? body.recommendationId : undefined,
    title: (body.title as string).trim(),
    target: body.target && typeof body.target === "object" ? body.target : {},
    parameters: body.parameters && typeof body.parameters === "object" ? body.parameters : {},
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
      const finding = await getProjectFindingSupabase(db, user.id, projectId, baseInput.findingId);
      if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
      const type = isActionType(body.type) ? body.type : deriveActionType(finding);
      const action = await createActionSupabase(db, user.id, { projectId, type, ...baseInput });
      return NextResponse.json({ action }, { status: 201 });
    }
    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const finding = getProjectFinding(projectId, baseInput.findingId);
    if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
    const type = isActionType(body.type) ? body.type : deriveActionType(finding);
    return NextResponse.json({ action: createAction({ projectId, type, ...baseInput }) }, { status: 201 });
  } catch (err) {
    // "Finding not found." / "Project not found." are domain messages; everything else stays generic.
    const message = err instanceof Error ? err.message : "";
    if (message === "Finding not found." || message === "Project not found.") return NextResponse.json({ error: message }, { status: 404 });
    return NextResponse.json({ error: "Could not create the action. Try again." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);

  // "I made this change" / undo: the server builds the baseline and proof itself.
  if (typeof body?.id === "string" && (body.implemented === true || body.undoImplemented === true)) {
    try {
      const pageUrl = typeof body.pageUrl === "string" ? body.pageUrl : null;
      const run = (ports: OutcomePorts) =>
        body.undoImplemented === true
          ? undoImplementation(ports, { actionId: body.id })
          : implementAction(ports, { actionId: body.id, pageUrl });
      if (FEATURES.PLATFORM_MODE) {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        const db = createServiceClient();
        const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
        const projectId = setting?.value;
        if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
        return serviceResponse(await run(await platformPorts(db, user.id, projectId)));
      }
      const projectId = getActiveProjectId();
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
      return serviceResponse(await run(selfHostPorts(projectId)));
    } catch (err) {
      return lifecycleOrGeneric(err, "Could not update the change. Try again.");
    }
  }

  if (typeof body?.id !== "string" || !isActionStatus(body?.status)) return NextResponse.json({ error: "id and valid status are required." }, { status: 400 });
  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value;
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
      const action = await transitionActionSupabase(db, user.id, projectId, body.id, body.status, body.result ?? null);
      return action ? NextResponse.json({ action }) : NextResponse.json({ error: "Action not found." }, { status: 404 });
    }
    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const action = transitionAction(projectId, body.id, body.status, body.result ?? null);
    return action ? NextResponse.json({ action }) : NextResponse.json({ error: "Action not found." }, { status: 404 });
  } catch (err) {
    return lifecycleOrGeneric(err, "Could not update the action. Try again.");
  }
}
