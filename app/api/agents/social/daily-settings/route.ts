import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeDailyDraftSettings } from "@/lib/domain/social/dailyDraftSettings";
import { getDailyDraftSettings, saveDailyDraftSettings } from "@/lib/domain/social/dailyDraftSettingsStore";
import {
  getDailyDraftSettings as getDailyDraftSettingsSupabase,
  saveDailyDraftSettings as saveDailyDraftSettingsSupabase,
} from "@/lib/domain/social/dailyDraftSettingsStoreSupabase";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";

// Per-project switches for the automatic daily drafts (X, LinkedIn, Reddit). Ownership is
// checked by getAuthenticatedProjectContext, the same as the other project routes.

export async function GET() {
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;
  const settings = supabase && userId
    ? await getDailyDraftSettingsSupabase(supabase, userId, projectId).catch(() => null)
    : getDailyDraftSettings(getDb(), projectId);
  if (!settings) return NextResponse.json({ error: "Could not load daily draft settings." }, { status: 500 });
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;

  const settings = normalizeDailyDraftSettings((body as { settings?: unknown }).settings);
  try {
    if (supabase && userId) await saveDailyDraftSettingsSupabase(supabase, userId, projectId, settings);
    else saveDailyDraftSettings(getDb(), projectId, settings);
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save daily draft settings." }, { status: 500 });
  }
}
