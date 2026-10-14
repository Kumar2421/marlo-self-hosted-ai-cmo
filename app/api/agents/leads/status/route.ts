import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";
import { isLeadStatus, tagsLiteral, tagsWithStatus } from "@/lib/domain/leads/local/businessLead";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Set a saved lead's pipeline status. The status lives in the existing `tags` column as a
 * `status:<value>` tag, so no column is added. Hosted only: the self-host SQLite table has no
 * tags column, and this build does not add one.
 */
export async function PUT(req: NextRequest) {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ error: "Lead status is saved on hosted accounts only." }, { status: 501 });
  }

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Unknown lead." }, { status: 400 });
  if (!isLeadStatus(body?.status)) {
    return NextResponse.json({ error: "Choose New, Contacted, Replied or Not interested." }, { status: 400 });
  }
  const status = body.status;

  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;
  if (!supabase || !userId) {
    return NextResponse.json({ error: "Lead status is saved on hosted accounts only." }, { status: 501 });
  }

  // Read, then write only if `tags` still holds the value that was read (optimistic check). A
  // concurrent tag change makes the write match nothing, so it is retried once from a fresh read
  // instead of silently overwriting the other change.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row, error: readError } = await supabase
      .from("leads")
      .select("tags")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("id", id)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: "Couldn't update the status. Try again." }, { status: 500 });
    if (!row) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

    const previous = (row.tags as string[] | null) ?? null;
    const tags = tagsWithStatus(previous, status);
    const base = supabase
      .from("leads")
      .update({ tags })
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("id", id);
    const guarded = previous === null ? base.is("tags", null) : base.eq("tags", tagsLiteral(previous));
    const { data: updated, error: writeError } = await guarded.select("id");
    if (writeError) return NextResponse.json({ error: "Couldn't update the status. Try again." }, { status: 500 });
    if (updated && updated.length > 0) return NextResponse.json({ id, status, tags });
  }
  return NextResponse.json({ error: "Couldn't update the status. Try again." }, { status: 409 });
}
