import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

type ProjectRow = { id: string; name: string; url: string };

/**
 * Real, narrow LLM job — one or two sentences describing the product,
 * grounded only in the real crawl (title/meta description/body text) just
 * done during creation. Never invents features not evidenced on the page.
 * Called right after project creation's crawl succeeds, same place
 * competitor discovery already runs from.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const model: string | undefined = body?.model;
  const providerId: string | undefined = body?.providerId;

  if (!model || !providerId) {
    return NextResponse.json({ error: "No model selected." }, { status: 422 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: project, error: projectError } = await db
      .from("projects")
      .select("id, name, url")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
    if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

    const { data: auditRow, error: auditError } = await db
      .from("seo_audits")
      .select("payload")
      .eq("project_id", id)
      .eq("url", project.url)
      .maybeSingle();
    if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });
    if (!auditRow) {
      return NextResponse.json({ error: "No crawl data for this project yet." }, { status: 422 });
    }
    // payload is jsonb — Supabase returns it already parsed, unlike SQLite's TEXT column.
    const audit: SEOAuditPayload = auditRow.payload;

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
    const { apiKey, baseUrl } = resolveLlmCredential({ providerId, byokKey, byokBaseUrl: conn?.base_url });
    if (!apiKey) {
      return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
    }

    const system = `You write a short, factual one-to-two-sentence product description from real crawled page content. Ground it only in what's actually there — never invent features, pricing, or claims the page doesn't make. Output the description text only, nothing else (no quotes, no preamble).`;
    const prompt = `Product: ${project.name} (${project.url})
Meta title: ${audit.meta.title || "(none found)"}
Meta description: ${audit.meta.description || "(none found)"}
Crawled page text: """${(audit.bodyText || "").slice(0, 2000) || "(none extracted)"}"""`;

    try {
      // free in platform mode for now — no credit_costs entry yet
      const result = await driver({
        apiKey,
        model,
        system,
        messages: [{ role: "user", content: prompt }],
        baseUrl,
      });
      const description = (result.text ?? "").trim();
      if (!description) throw new Error("Model returned an empty description.");

      const { error: updateError } = await db
        .from("projects")
        .update({ description, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("owner_id", user.id);
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

      return NextResponse.json({ description });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to generate a description." }, { status: 500 });
    }
  }

  const db = getDb();
  const project = db.prepare("SELECT id, name, url FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(project.url) as { payload: string } | undefined;
  if (!auditRow) {
    return NextResponse.json({ error: "No crawl data for this project yet." }, { status: 422 });
  }
  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);

  const driver = getDriver(providerId);
  if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  const connRow = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
    | { api_key: string; base_url: string | null }
    | undefined;
  if (!connRow) return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });

  const system = `You write a short, factual one-to-two-sentence product description from real crawled page content. Ground it only in what's actually there — never invent features, pricing, or claims the page doesn't make. Output the description text only, nothing else (no quotes, no preamble).`;
  const prompt = `Product: ${project.name} (${project.url})
Meta title: ${audit.meta.title || "(none found)"}
Meta description: ${audit.meta.description || "(none found)"}
Crawled page text: """${(audit.bodyText || "").slice(0, 2000) || "(none extracted)"}"""`;

  try {
    const result = await driver({
      apiKey: connRow.api_key,
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      baseUrl: connRow.base_url ?? undefined,
    });
    const description = (result.text ?? "").trim();
    if (!description) throw new Error("Model returned an empty description.");

    db.prepare("UPDATE projects SET description = ?, updated_at = ? WHERE id = ?").run(description, new Date().toISOString(), id);
    return NextResponse.json({ description });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to generate a description." }, { status: 500 });
  }
}
