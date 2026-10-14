import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { FEATURES } from "@/lib/features";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import type { ProjectContext } from "@/lib/domain/shared/ProjectContext";
import { isRedditDraftStatus, type RedditDraftPatch, type RedditDraftView } from "@/lib/domain/reddit/redditDraftStore";
import * as sqliteStore from "@/lib/domain/reddit/redditDraftStore";
import * as supabaseStore from "@/lib/domain/reddit/redditDraftStoreSupabase";
import { redditPrompt } from "@/lib/domain/social/platformPrompts";
import {
  defaultSubredditFor, draftLimitFor, generateForPlatform, resolvePlatformModelAccess, selfHostModelAccess,
  type DraftScope, type ModelAccess,
} from "@/lib/domain/social/draftPorts";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;

const NO_PROJECT = { error: "No active project." };

function viewOf(req: NextRequest): RedditDraftView {
  return req.nextUrl.searchParams.get("view") === "archived" ? "archived" : "current";
}

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
      ? await supabaseStore.listRedditDrafts(scope.db, scope.userId, scope.projectId, view)
      : sqliteStore.listRedditDrafts(getDb(), scope.projectId, view);
    return NextResponse.json({ drafts });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { variants?: number; subreddit?: string } | null;
  const variants = Math.min(3, Math.max(1, Math.floor(body?.variants ?? 1)));
  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;

  if (!getDriver("groq")) return NextResponse.json({ error: "Groq isn't wired to a real model yet." }, { status: 501 });

  let access: ModelAccess;
  let project: ProjectContext;
  let defaultSubreddit = "";
  try {
    if (scope.mode === "platform") {
      access = await resolvePlatformModelAccess(scope.db, scope.userId);
      project = await getActiveProjectContextSupabase(scope.db, scope.userId);
    } else {
      access = selfHostModelAccess();
      project = getActiveProjectContext();
    }
    defaultSubreddit = await defaultSubredditFor(scope);
  } catch (err) {
    return fail(err);
  }

  if (!access.apiKey) {
    return NextResponse.json({ error: "Connect a free Groq key in Settings, then try again." }, { status: 422 });
  }

  const requestedSubreddit = body?.subreddit ? (body.subreddit as string).replace(/^r\//, "") : defaultSubreddit;
  if (!requestedSubreddit) {
    return NextResponse.json({ error: "Specify a subreddit or configure one in Settings." }, { status: 422 });
  }

  if (!/^[A-Za-z0-9_]{2,21}$/.test(requestedSubreddit)) {
    return NextResponse.json({ error: `Invalid subreddit: '${requestedSubreddit}'. Use 2-21 alphanumeric characters and underscores.` }, { status: 400 });
  }

  const { system, prompt } = redditPrompt(project, requestedSubreddit, variants);
  const limit = await draftLimitFor(scope, access);
  const result = await generateForPlatform("reddit", scope, { access, limit, variants, system, prompt });
  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; subreddit?: unknown; title?: unknown; body?: unknown; status?: unknown } | null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id is required." }, { status: 400 });

  const patch: RedditDraftPatch = {};
  if (body.subreddit !== undefined) {
    if (typeof body.subreddit !== "string" || !body.subreddit.trim()) return NextResponse.json({ error: "Subreddit can't be empty." }, { status: 400 });
    if (!/^[A-Za-z0-9_]{2,21}$/.test(body.subreddit.trim())) {
      return NextResponse.json({ error: "Invalid subreddit name." }, { status: 400 });
    }
    patch.subreddit = body.subreddit.trim();
  }
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return NextResponse.json({ error: "Title can't be empty." }, { status: 400 });
    if (body.title.trim().length > 300) return NextResponse.json({ error: "Title is over 300 characters." }, { status: 400 });
    patch.title = body.title.trim();
  }
  if (body.body !== undefined) {
    if (typeof body.body !== "string" || !body.body.trim()) return NextResponse.json({ error: "Body can't be empty." }, { status: 400 });
    if (body.body.trim().length > 40000) return NextResponse.json({ error: "Body is over 40000 characters." }, { status: 400 });
    patch.body = body.body.trim();
  }
  if (body.status !== undefined) {
    if (!isRedditDraftStatus(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    patch.status = body.status;
  }
  if (patch.subreddit === undefined && patch.title === undefined && patch.body === undefined && patch.status === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const draft = scope.mode === "platform"
      ? await supabaseStore.updateRedditDraft(scope.db, scope.userId, scope.projectId, body.id, patch)
      : sqliteStore.updateRedditDraft(getDb(), scope.projectId, body.id, patch);
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
      ? await supabaseStore.deleteRedditDraft(scope.db, scope.userId, scope.projectId, id)
      : sqliteStore.deleteRedditDraft(getDb(), scope.projectId, id);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Draft not found." }, { status: 404 });
  } catch (err) {
    return fail(err);
  }
}
