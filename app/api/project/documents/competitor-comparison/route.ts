import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { generateCompetitorComparison } from "@/lib/domain/documents/CompetitorComparisonGenerator";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { spendCredits, withRefund, isFailedResponse, InsufficientCreditsError, type CreditTicket } from "@/lib/credits";
import { platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

const DOC_TYPE = "competitor_comparison";

export async function GET() {
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
    const activeId = setting?.value;
    if (!activeId) return NextResponse.json({ document: null });

    const { data: row, error } = await db
      .from("project_documents")
      .select("content")
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .eq("doc_type", DOC_TYPE)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ document: row ? { content: row.content } : null });
  }

  try {
    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ document: null });

    const db = getDb();
    const row = db
      .prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = 'competitor_comparison'")
      .get(projectId) as { content: string } | undefined;

    console.log(`[competitor-comparison GET] projectId=${projectId}, found=${!!row}, length=${row?.content.length || 0}`);
    if (row) {
      console.log(`[competitor-comparison GET] First 500 chars:\n${row.content.substring(0, 500)}`);
      console.log(`[competitor-comparison GET] Contains ### sections: ${(row.content.match(/###/g) || []).length}`);
    }

    return NextResponse.json({
      document: row ? { content: row.content } : null,
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch comparison" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { model, providerId } = body ?? {};

  if (!model || !providerId) {
    return NextResponse.json(
      { error: "model and providerId required" },
      { status: 400 }
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
    const activeId = setting?.value;
    if (!activeId) {
      return NextResponse.json({ error: "No active project" }, { status: 400 });
    }

    const { data: competitors, error: compError } = await db
      .from("project_competitors")
      .select("id, url")
      .eq("user_id", user.id)
      .eq("project_id", activeId);
    if (compError) return NextResponse.json({ error: compError.message }, { status: 500 });

    if (!competitors || competitors.length === 0) {
      return NextResponse.json({
        error: "No competitors added yet. Add at least one in the Context panel first.",
      }, { status: 400 });
    }

    const driver = getDriver(providerId);
    if (!driver) {
      return NextResponse.json({ error: `${providerId} isn't wired yet.` }, { status: 400 });
    }

    // BYOK first — user's own key, no credit charge.
    const { data: conn } = await db
      .from("provider_connections")
      .select("api_key_secret_id, base_url")
      .eq("user_id", user.id)
      .eq("provider_id", providerId)
      .maybeSingle();

    let apiKey = "";
    let baseUrl: string | undefined;
    let chargedCredits = false;
    let ticket: CreditTicket | null = null;

    if (conn?.api_key_secret_id) {
      const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
      apiKey = (secret as string) ?? "";
      baseUrl = conn.base_url ?? undefined;
    } else if (platformKeyFor(providerId)) {
      try {
        ticket = await spendCredits(user.id, "competitor_comparison", { projectId: activeId, model });
        chargedCredits = true;
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
        }
        throw err;
      }
      apiKey = resolveLlmCredential({ providerId }).apiKey; // platform key: baseUrl intentionally not set
    } else {
      return NextResponse.json({
        error: `${providerId} isn't properly connected. Check Settings → LLM Providers to add your API key or base URL.`,
      }, { status: 422 });
    }

    // Refund the charge if generation throws or ends in an error response.
    return await withRefund(ticket, async () => {
      try {
        const result = await generateCompetitorComparison(competitors, model, driver, apiKey, baseUrl);
        const markdown = comparisonToMarkdown(result);

        const now = new Date().toISOString();
        const { data: existing } = await db
          .from("project_documents")
          .select("created_at")
          .eq("user_id", user.id)
          .eq("project_id", activeId)
          .eq("doc_type", DOC_TYPE)
          .maybeSingle();

        const { error: upsertError } = await db.from("project_documents").upsert(
          {
            user_id: user.id,
            project_id: activeId,
            doc_type: DOC_TYPE,
            status: "ready",
            content: markdown,
            created_at: existing?.created_at ?? now,
            updated_at: now,
          },
          { onConflict: "project_id,doc_type" }
        );
        if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(markdown));
            controller.close();
          },
        });

        return new NextResponse(stream, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: raw, chargedCredits }, { status: 502 });
      }
    }, isFailedResponse);
  }

  try {
    const projectId = getActiveProjectId();
    if (!projectId) {
      return NextResponse.json({ error: "No active project" }, { status: 400 });
    }

    const db = getDb();

    // Fetch all competitors for this project
    const competitors = db
      .prepare("SELECT id, url FROM project_competitors WHERE project_id = ?")
      .all(projectId) as { id: string; url: string }[];

    console.log(`[competitor-comparison POST] Found ${competitors.length} competitors for project ${projectId}:`, competitors.map(c => c.url));

    if (competitors.length === 0) {
      return NextResponse.json({
        error: "No competitors added yet. Add at least one in the Context panel first.",
      }, { status: 400 });
    }

    // Get driver + API key for this provider
    const driver = getDriver(providerId);
    if (!driver) {
      return NextResponse.json({ error: `${providerId} isn't wired yet.` }, { status: 400 });
    }

    const keyRow = db
      .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
      .get(providerId) as { api_key: string | null; base_url: string | null } | undefined;

    console.log(`[competitor-comparison] Provider ${providerId}: keyRow=${!!keyRow}, api_key=${keyRow?.api_key ? "present" : "empty/null"}, base_url=${keyRow?.base_url || "null"}`);

    if (!keyRow || (!keyRow.api_key?.trim() && !keyRow.base_url?.trim())) {
      return NextResponse.json({
        error: `${providerId} isn't properly connected. Check Settings → LLM Providers to add your API key or base URL.`
      }, { status: 422 });
    }



    // Generate comparison data
    const result = await generateCompetitorComparison(
      competitors,
      model,
      driver,
      keyRow.api_key || "",
      keyRow.base_url || undefined
    );

    // Convert to markdown for display
    const markdown = comparisonToMarkdown(result);
    console.log(`[competitor-comparison] Generated markdown (${markdown.length} chars):`);
    console.log(`[competitor-comparison] First 1000 chars:\n${markdown.substring(0, 1000)}`);
    console.log(`[competitor-comparison] Result contains ${result.competitors.length} competitors`);

    // Save to DB
    const stmt = db.prepare(`
      INSERT INTO project_documents (project_id, doc_type, content, status, created_at, updated_at)
      VALUES (?, 'competitor_comparison', ?, 'ready', datetime('now'), datetime('now'))
      ON CONFLICT(project_id, doc_type) DO UPDATE SET
        content = excluded.content,
        status = 'ready',
        updated_at = datetime('now')
    `);
    stmt.run(projectId, markdown);

    // Verify save
    const saved = db.prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = 'competitor_comparison'").get(projectId) as { content: string } | undefined;
    console.log(`[competitor-comparison] Saved for project ${projectId}. Verified: ${saved ? "yes, " + saved.content.length + " chars" : "NO"}`);
    if (saved) {
      console.log(`[competitor-comparison] Saved markdown first 1000 chars:\n${saved.content.substring(0, 1000)}`);
    }

    // Return streamed response (even though data is small, match DocumentPanel pattern)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(markdown));
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate comparison";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function comparisonToMarkdown(result: {
  competitors: Array<{ url: string; name: string; startingPrice: string; features: string[] }>;
  generatedAt: string;
}): string {
  const lines: string[] = [
    "# Competitor Comparison",
    `Generated: ${result.generatedAt}`,
    "",
    "## Competitors at a Glance",
    "",
  ];

  for (const comp of result.competitors) {
    lines.push(`### ${comp.name}`);
    lines.push(`**URL:** ${comp.url}`);
    lines.push(`**Starting Price:** ${comp.startingPrice}`);
    lines.push("**Key Features:**");
    for (const feature of comp.features) {
      lines.push(`- ${feature}`);
    }
    lines.push("");
  }

  lines.push("## Analysis");
  lines.push(
    "Pricing and features extracted from competitor websites. Regenerate anytime to refresh."
  );

  return lines.join("\n");
}
