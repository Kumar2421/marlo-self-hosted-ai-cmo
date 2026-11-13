import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

const MAX_REPLY = 1500;

/**
 * Saves the user's edit of a request's reply draft. Only requests (lead_type "intent") of the active project can be
 * changed, and only the reply text. Nothing is ever posted: the user copies the reply and posts it from their own account.
 */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const reply = typeof body?.reply === "string" ? body.reply.replace(/\r\n/g, "\n").trim() : null;
  if (!id || id.length > 64) return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  if (reply === null) return NextResponse.json({ error: "A reply is required." }, { status: 400 });
  if (reply.length > MAX_REPLY) return NextResponse.json({ error: `Keep the reply under ${MAX_REPLY} characters.` }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) {
    const auth = await getAuthenticatedProjectContext();
    if ("response" in auth) return auth.response;
    const { userId, projectId, supabase } = auth.context;
    if (!supabase || !userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { data, error } = await supabase
      .from("leads")
      .update({ description: reply || null })
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("id", id)
      .eq("lead_type", "intent")
      .select("id");
    if (error) return NextResponse.json({ error: "Couldn't save the reply. Try again." }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    return NextResponse.json({ id, reply });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  const result = getDb()
    .prepare("UPDATE leads SET description = ? WHERE id = ? AND project_id = ? AND lead_type = 'intent'")
    .run(reply || null, id, projectId);
  if (result.changes === 0) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  return NextResponse.json({ id, reply });
}
