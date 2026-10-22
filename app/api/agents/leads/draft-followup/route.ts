import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { classifyAndDraftFollowUp } from "@/lib/domain/leads/replyAgent";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const leadId: string | undefined = body?.leadId;
  const model: string | undefined = body?.model;
  const providerId: string | undefined = body?.providerId;

  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  if (!model || !providerId) return NextResponse.json({ error: "No model selected." }, { status: 422 });

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = setting?.value ?? null;
    if (!activeId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const { data: lead } = await db
      .from("leads")
      .select("id, name, last_reply_snippet")
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .eq("id", leadId)
      .maybeSingle();
    if (!lead?.last_reply_snippet) {
      return NextResponse.json({ error: "This lead has no real reply to draft a follow-up from." }, { status: 422 });
    }

    let projectName: string | undefined;
    if (activeId) {
      const { data: project } = await db
        .from("projects")
        .select("name")
        .eq("id", activeId)
        .eq("owner_id", user.id)
        .maybeSingle();
      projectName = project?.name;
    }

    const driver = getDriver(providerId);
    if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });

    const { data: conn } = await db
      .from("provider_connections")
      .select("api_key_secret_id, base_url")
      .eq("user_id", user.id)
      .eq("provider_id", providerId)
      .maybeSingle();

    let byokKey = "";
    if (conn?.api_key_secret_id) {
      const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
      byokKey = (secret as string) ?? "";
    }
    const { apiKey, baseUrl: llmBaseUrl } = resolveLlmCredential({ providerId, byokKey, byokBaseUrl: conn?.base_url });
    if (!apiKey) {
      return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
    }

    try {
      await chargeCredits(user.id, "email_draft", { projectId: activeId ?? undefined, model });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
      }
      throw err;
    }

    try {
      const draft = await classifyAndDraftFollowUp(
        driver,
        apiKey,
        model,
        projectName ?? "this product",
        lead.name,
        lead.last_reply_snippet,
        llmBaseUrl
      );
      return NextResponse.json(draft);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to draft a follow-up." }, { status: 500 });
    }
  }

  const db = getDb();
  const lead = db.prepare("SELECT id, name, last_reply_snippet FROM leads WHERE id = ?").get(leadId) as
    | { id: string; name: string; last_reply_snippet: string | null }
    | undefined;
  if (!lead?.last_reply_snippet) {
    return NextResponse.json({ error: "This lead has no real reply to draft a follow-up from." }, { status: 422 });
  }

  const activeId = getActiveProjectId();
  const project = activeId ? (db.prepare("SELECT name FROM projects WHERE id = ?").get(activeId) as { name: string } | undefined) : undefined;

  const driver = getDriver(providerId);
  if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  const connRow = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
    | { api_key: string; base_url: string | null }
    | undefined;
  if (!connRow) return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });

  try {
    const draft = await classifyAndDraftFollowUp(
      driver,
      connRow.api_key,
      model,
      project?.name ?? "this product",
      lead.name,
      lead.last_reply_snippet,
      connRow.base_url ?? undefined
    );
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to draft a follow-up." }, { status: 500 });
  }
}
