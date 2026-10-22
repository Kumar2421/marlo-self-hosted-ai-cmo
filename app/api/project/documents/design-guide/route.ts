import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { DesignGuideGenerator } from "@/lib/domain/documents/DesignGuideGenerator";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { spendCredits, withRefund, isFailedResponse, InsufficientCreditsError, type CreditTicket } from "@/lib/credits";
import { platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

const DOC_TYPE = "design_guide";

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
      .select("status, content, updated_at")
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .eq("doc_type", DOC_TYPE)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ document: row ?? null });
  }

  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ document: null });

  const db = getDb();
  const row = db
    .prepare("SELECT status, content, updated_at FROM project_documents WHERE project_id = ? AND doc_type = ?")
    .get(activeId, DOC_TYPE) as { status: string; content: string; updated_at: string } | undefined;

  return NextResponse.json({ document: row ?? null });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const providerId: string | undefined = body?.providerId;
  const model: string | undefined = body?.model;

  if (!model || !providerId) {
    return NextResponse.json(
      { error: "No model selected. Connect a provider in Settings → LLM Providers." },
      { status: 422 }
    );
  }

  const driver = getDriver(providerId);
  if (!driver) {
    return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
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

    const { data: project } = activeId
      ? await db.from("projects").select("name, url").eq("id", activeId).eq("owner_id", user.id).maybeSingle()
      : { data: null };
    if (!activeId || !project || !project.url) {
      return NextResponse.json(
        { error: "No project website linked yet. Add one in the project switcher first." },
        { status: 422 }
      );
    }

    const { data: auditRow } = await db
      .from("seo_audits")
      .select("payload")
      .eq("project_id", activeId)
      .eq("url", project.url)
      .maybeSingle();
    if (!auditRow) {
      return NextResponse.json(
        { error: "No crawl data for this site yet. Try refreshing the SEO audit in Analytics." },
        { status: 422 }
      );
    }
    const audit = auditRow.payload as SEOAuditPayload;
    // Older audits saved before design-token extraction existed won't have this
    // field — treat as "nothing found" rather than crashing.
    const design = audit.design ?? { fonts: [] };
    const ogImageUrl = audit.openGraph?.find((t) => t.key === "og:image")?.value;

    const { data: marketingStrategyRow } = await db
      .from("project_documents")
      .select("content")
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .eq("doc_type", "marketing_strategy")
      .maybeSingle();

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
        ticket = await spendCredits(user.id, "design_guide", { projectId: activeId, model });
        chargedCredits = true;
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
        }
        throw err;
      }
      apiKey = resolveLlmCredential({ providerId }).apiKey; // platform key: baseUrl intentionally not set
    } else {
      return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
    }

    // Refund the charge if generation throws or ends in an error response.
    return await withRefund(ticket, async () => {
      try {
        const generator = new DesignGuideGenerator(driver, apiKey, baseUrl);
        const result = await generator.generate({
          projectName: project.name,
          url: project.url,
          themeColor: design.themeColor,
          fonts: design.fonts ?? [],
          logoUrl: design.logoUrl,
          faviconUrl: design.faviconUrl,
          ogImageUrl,
          marketingStrategy: marketingStrategyRow?.content,
          model,
        });

        if (!result.stream) {
          const now = new Date().toISOString();
          const { data: existing } = await db
            .from("project_documents")
            .select("created_at")
            .eq("user_id", user.id)
            .eq("project_id", activeId)
            .eq("doc_type", DOC_TYPE)
            .maybeSingle();

          const { error } = await db.from("project_documents").upsert(
            {
              user_id: user.id,
              project_id: activeId,
              doc_type: DOC_TYPE,
              status: "ready",
              content: result.text ?? "",
              created_at: existing?.created_at ?? now,
              updated_at: now,
            },
            { onConflict: "project_id,doc_type" }
          );
          if (error) return NextResponse.json({ error: error.message }, { status: 500 });
          return NextResponse.json({ text: result.text });
        }

        return new NextResponse(result.stream, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: raw, chargedCredits }, { status: 502 });
      }
    }, isFailedResponse);
  }

  const db = getDb();

  const keyRow = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;
  if (!keyRow) {
    return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
  }

  const activeId = getActiveProjectId();
  const project = activeId
    ? (db.prepare("SELECT name, url FROM projects WHERE id = ?").get(activeId) as
        | { name: string; url: string }
        | undefined)
    : undefined;
  if (!activeId || !project || !project.url) {
    return NextResponse.json(
      { error: "No project website linked yet. Add one in the project switcher first." },
      { status: 422 }
    );
  }

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(project.url) as
    | { payload: string }
    | undefined;
  if (!auditRow) {
    return NextResponse.json(
      { error: "No crawl data for this site yet. Try refreshing the SEO audit in Analytics." },
      { status: 422 }
    );
  }
  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);
  // Older audits saved before design-token extraction existed won't have this
  // field — treat as "nothing found" rather than crashing.
  const design = audit.design ?? { fonts: [] };
  const ogImageUrl = audit.openGraph?.find((t) => t.key === "og:image")?.value;

  const marketingStrategyRow = db
    .prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = 'marketing_strategy'")
    .get(activeId) as { content: string } | undefined;

  try {
    const generator = new DesignGuideGenerator(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const result = await generator.generate({
      projectName: project.name,
      url: project.url,
      themeColor: design.themeColor,
      fonts: design.fonts ?? [],
      logoUrl: design.logoUrl,
      faviconUrl: design.faviconUrl,
      ogImageUrl,
      marketingStrategy: marketingStrategyRow?.content,
      model,
    });

    if (!result.stream) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
         VALUES (?, ?, 'ready', ?, ?, ?)
         ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, status = 'ready', updated_at = excluded.updated_at`
      ).run(activeId, DOC_TYPE, result.text ?? "", now, now);
      return NextResponse.json({ text: result.text });
    }

    return new NextResponse(result.stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
