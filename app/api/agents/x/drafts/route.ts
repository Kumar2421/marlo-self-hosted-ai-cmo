import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { FEATURES } from "@/lib/features";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import type { ProjectContext } from "@/lib/domain/shared/ProjectContext";
import { buildDraftPrompt, clampVariants, isWithinLimit } from "@/lib/domain/x/draftPost";
import { isXDraftStatus, type XDraftPatch, type XDraftView } from "@/lib/domain/x/xDraftTypes";
import * as sqliteStore from "@/lib/domain/x/xDraftStore";
import * as supabaseStore from "@/lib/domain/x/xDraftStoreSupabase";
import {
  draftLimitFor, generateForPlatform, resolvePlatformModelAccess, selfHostModelAccess,
  type DraftScope, type ModelAccess,
} from "@/lib/domain/social/draftPorts";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;

const NO_PROJECT = { error: "No active project." };

function viewOf(req: NextRequest): XDraftView {
  return req.nextUrl.searchParams.get("view") === "archived" ? "archived" : "current";
}

/** Resolve who is asking and which project; a NextResponse means "stop here". */
async function resolveScope(): Promise<DraftScope | NextResponse> {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value as string | undefined;
    if (!projectId) return NextResponse.json(NO_PROJECT, { status: 422 });
    return { mode: "platform", db, userId: user.id, projectId };
  }
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json(NO_PROJECT, { status: 422 });
  return { mode: "selfhost", projectId };
}

function fail(err: unknown, status = 500) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}

export async function GET(req: NextRequest) {
  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const view = viewOf(req);
    const drafts = scope.mode === "platform"
      ? await supabaseStore.listXDrafts(scope.db, scope.userId, scope.projectId, view)
      : sqliteStore.listXDrafts(getDb(), scope.projectId, view);
    return NextResponse.json({ drafts });
  } catch (err) {
    return fail(err);
  }
}

/** Generate a batch of 1 to 3 drafts from the project's product info. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { variants?: number } | null;
  const variants = clampVariants(body?.variants);
  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;

  if (!getDriver("groq")) return NextResponse.json({ error: "Groq isn't wired to a real model yet." }, { status: 501 });

  let access: ModelAccess;
  let project: ProjectContext;
  try {
    if (scope.mode === "platform") {
      access = await resolvePlatformModelAccess(scope.db, scope.userId);
      project = await getActiveProjectContextSupabase(scope.db, scope.userId);
    } else {
      access = selfHostModelAccess();
      project = getActiveProjectContext();
    }
  } catch (err) {
    return fail(err);
  }

  if (!access.apiKey) {
    return NextResponse.json({ error: "Connect a free Groq key in Settings, then try again." }, { status: 422 });
  }

  const { system, prompt } = buildDraftPrompt({
    name: project.name,
    description: project.description,
    category: project.category,
    productInfo: project.productInfo,
    marketingStrategy: project.marketingStrategy,
    variants,
  });
  const limit = await draftLimitFor(scope, access);
  const result = await generateForPlatform("x", scope, { access, limit, variants, system, prompt });
  return NextResponse.json(result.body, { status: result.status });
}

/** Edit the text and/or move a draft between Current and Archived. */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; text?: unknown; status?: unknown } | null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id is required." }, { status: 400 });

  const patch: XDraftPatch = {};
  if (body.text !== undefined) {
    if (typeof body.text !== "string" || !body.text.trim()) return NextResponse.json({ error: "Text can't be empty." }, { status: 400 });
    if (!isWithinLimit(body.text)) return NextResponse.json({ error: "Text is over the 280 character limit." }, { status: 400 });
    patch.text = body.text.trim();
  }
  if (body.status !== undefined) {
    if (!isXDraftStatus(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    patch.status = body.status;
  }
  if (patch.text === undefined && patch.status === undefined) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const draft = scope.mode === "platform"
      ? await supabaseStore.updateXDraft(scope.db, scope.userId, scope.projectId, body.id, patch)
      : sqliteStore.updateXDraft(getDb(), scope.projectId, body.id, patch);
    return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: "Draft not found." }, { status: 404 });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const removed = scope.mode === "platform"
      ? await supabaseStore.deleteXDraft(scope.db, scope.userId, scope.projectId, id)
      : sqliteStore.deleteXDraft(getDb(), scope.projectId, id);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Draft not found." }, { status: 404 });
  } catch (err) {
    return fail(err);
  }
}
