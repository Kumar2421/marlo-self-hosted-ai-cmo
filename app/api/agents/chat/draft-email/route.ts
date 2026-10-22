import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/**
 * Agent draft email endpoint.
 * Takes lead IDs and context, uses LLM to draft personalized email.
 *
 * Example:
 * POST /api/agents/chat/draft-email
 * {
 *   leadIds: ["lead1", "lead2"],
 *   context: "Software engineer at startup in SF",
 *   tone: "professional",
 *   model: "...",
 *   providerId: "..."
 * }
 */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const leadIds: string[] = Array.isArray(body?.leadIds) ? body.leadIds : [];
  const context: string = typeof body?.context === "string" ? body.context : "";
  const tone: string = typeof body?.tone === "string" ? body.tone : "professional";
  const model: string = typeof body?.model === "string" ? body.model : "";
  const providerId: string = typeof body?.providerId === "string" ? body.providerId : "";

  if (leadIds.length === 0) {
    return NextResponse.json({ error: "No leads selected" }, { status: 400 });
  }
  if (!model || !providerId) {
    return NextResponse.json(
      { error: "Model and provider required" },
      { status: 422 }
    );
  }

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
    const projectId = setting?.value ?? null;
    if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 400 });

    try {
      const driver = getDriver(providerId);
      if (!driver) return NextResponse.json({ error: `${providerId} not configured` }, { status: 422 });

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
        return NextResponse.json({ error: "LLM provider not connected" }, { status: 422 });
      }

      const { data: leads, error: leadsError } = await db
        .from("leads")
        .select("id, name, title, company, email")
        .eq("user_id", user.id)
        .in("id", leadIds.slice(0, 3));
      if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 });
      if (!leads || leads.length === 0) {
        return NextResponse.json({ error: "Leads not found" }, { status: 404 });
      }

      try {
        await chargeCredits(user.id, "email_draft", { projectId, model });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
        }
        throw err;
      }

      const draftPrompt = `Draft a ${tone} outreach email for these leads.

Context: ${context}

Sample leads:
${leads.map((l) => `- ${l.name}, ${l.title} at ${l.company}`).join("\n")}

Create an email template with merge tags {{name}}, {{company}}, {{title}}.
Make it personal but professional.

Respond with ONLY valid JSON:
{
  "subject": "email subject with {{tags}}",
  "body": "email body with {{tags}}"
}`;

      const draftRes = await driver({
        apiKey,
        model,
        baseUrl: llmBaseUrl,
        messages: [{ role: "user", content: draftPrompt }],
      });

      let template = { subject: "", body: "" };
      try {
        const jsonMatch = draftRes.text?.match(/\{[\s\S]*\}/);
        if (jsonMatch) template = JSON.parse(jsonMatch[0]);
      } catch {
        template = {
          subject: "Subject for {{company}}",
          body: "Hi {{name}},\n\nI came across your profile...",
        };
      }

      return NextResponse.json({
        leadCount: leadIds.length,
        sampleLeads: leads,
        template,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to draft email" },
        { status: 500 }
      );
    }
  }

  const projectId = getActiveProjectId();
  if (!projectId) {
    return NextResponse.json(
      { error: "No active project" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const driver = getDriver(providerId);
    if (!driver) {
      return NextResponse.json(
        { error: `${providerId} not configured` },
        { status: 422 }
      );
    }

    const keyRow = db
      .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
      .get(providerId) as { api_key: string | null; base_url: string | null } | undefined;

    if (!keyRow || (!keyRow.api_key?.trim() && !keyRow.base_url?.trim())) {
      return NextResponse.json(
        { error: "LLM provider not connected" },
        { status: 422 }
      );
    }

    // Fetch first lead as example
    const placeholders = leadIds.slice(0, 3).map(() => "?").join(",");
    const leads = db
      .prepare(
        `SELECT id, name, title, company, email FROM leads WHERE id IN (${placeholders})`
      )
      .all(...leadIds.slice(0, 3)) as Array<{
      id: string;
      name: string;
      title: string;
      company: string;
      email: string | null;
    }>;

    if (leads.length === 0) {
      return NextResponse.json({ error: "Leads not found" }, { status: 404 });
    }

    // Use LLM to draft email template
    const draftPrompt = `Draft a ${tone} outreach email for these leads.

Context: ${context}

Sample leads:
${leads.map((l) => `- ${l.name}, ${l.title} at ${l.company}`).join("\n")}

Create an email template with merge tags {{name}}, {{company}}, {{title}}.
Make it personal but professional.

Respond with ONLY valid JSON:
{
  "subject": "email subject with {{tags}}",
  "body": "email body with {{tags}}"
}`;

    const draftRes = await driver({
      apiKey: keyRow.api_key || "",
      model,
      baseUrl: keyRow.base_url || undefined,
      messages: [{ role: "user", content: draftPrompt }],
    });

    let template = { subject: "", body: "" };

    try {
      const jsonMatch = draftRes.text?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        template = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log("[draft-email] Template parse error");
      template = {
        subject: "Subject for {{company}}",
        body: "Hi {{name}},\n\nI came across your profile...",
      };
    }

    console.log("[draft-email] Drafted template for", leads.length, "leads");

    return NextResponse.json({
      leadCount: leadIds.length,
      sampleLeads: leads,
      template,
    });
  } catch (err) {
    console.error("[draft-email] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to draft email" },
      { status: 500 }
    );
  }
}
