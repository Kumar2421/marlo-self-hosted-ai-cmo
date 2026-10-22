import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver, providerSupportsTools } from "@/lib/llm";
import { CompetitorDiscoveryAgent } from "@/lib/domain/documents/CompetitorDiscoveryAgent";
import { fetchCompetitorSnippet } from "@/lib/domain/documents/CompetitorAnalysisGenerator";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/** Real automatic competitor discovery — an LLM proposes candidates (web-search-
 * grounded when Tavily is connected, context-only otherwise), then every
 * candidate is verified by an actual fetch before being saved. See
 * CompetitorDiscoveryAgent for why the no-Tavily fallback is still safe to
 * ship: a wrong guess just fails the fetch check and gets dropped. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const providerId: string | undefined = body?.providerId;
  const model: string | undefined = body?.model;
  const requestedProjectId: string | undefined = body?.projectId;

  // A model is optional: Tavily web search finds competitors on its own, and
  // a connected model only refines the result (see CompetitorDiscoveryAgent).
  const driver = providerId ? getDriver(providerId) : null;

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    // free in platform mode for now — no credit_costs entry yet
    const { data: conn } = await db
      .from("provider_connections")
      .select("api_key_secret_id, base_url")
      .eq("user_id", user.id)
      .eq("provider_id", providerId ?? "")
      .maybeSingle();

    let apiKey = "";
    let baseUrl: string | undefined;

    if (conn?.api_key_secret_id) {
      const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
      apiKey = (secret as string) ?? "";
      baseUrl = conn.base_url ?? undefined;
    } else if (providerId && platformKeyFor(providerId)) {
      // Same operator-managed free-tier key every other document generator
      // (competitor-analysis, content-strategy, etc.) already falls back to
      // — this route was the one place still requiring a BYOK connection
      // even for the platform's own default model, which made it fail for
      // every hosted user who hadn't manually connected Groq themselves.
      apiKey = resolveLlmCredential({ providerId }).apiKey; // platform key: baseUrl intentionally not set
    }
    // No model credentials is fine: discovery then runs from web search alone.

    let activeId = requestedProjectId;
    if (!activeId) {
      const { data: setting } = await db
        .from("user_settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "active_project_id")
        .maybeSingle();
      activeId = setting?.value ?? undefined;
    }

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
    // payload is jsonb — Supabase returns it already parsed, unlike SQLite's TEXT column.
    // Audit is optional here — we'll discover from URL + project metadata even without it.
    const audit: SEOAuditPayload | undefined = auditRow?.payload;

    const { data: groundingDocs } = await db
      .from("project_documents")
      .select("doc_type, content")
      .eq("project_id", activeId)
      .in("doc_type", ["product_info", "marketing_strategy"]);
    const productInfo = groundingDocs?.find((d) => d.doc_type === "product_info")?.content;
    const marketingStrategy = groundingDocs?.find((d) => d.doc_type === "marketing_strategy")?.content;

    // Tavily is queried directly (no model needed), so it no longer depends on the provider's tool support.
    const tavilyApiKey = process.env.TAVILY_API_KEY?.trim() || undefined;

    try {
      const agent = new CompetitorDiscoveryAgent(driver && model && apiKey ? driver : null, apiKey, baseUrl);
      const { candidates, usedWebSearch } = await agent.discover({
        projectName: project.name,
        url: project.url,
        bodyText: audit?.bodyText ?? "",
        metaTitle: audit?.meta?.title ?? project.name,
        metaDescription: audit?.meta?.description ?? `Visit ${project.url}`,
        productInfo,
        marketingStrategy,
        model,
        tavilyApiKey,
        llmSupportsTools: providerId ? providerSupportsTools(providerId) : false,
      });

      if (candidates.length === 0) {
        return NextResponse.json({ added: [], usedWebSearch, note: "No confident competitor candidates found." });
      }

      const verified = await Promise.all(
        candidates.map(async (c) => ({ ...c, snippet: await fetchCompetitorSnippet(`https://${c.domain}`) }))
      );
      const reachable = verified.filter((v) => v.snippet.title !== "(couldn't fetch)");

      const { data: existingRows } = await db
        .from("project_competitors")
        .select("url")
        .eq("project_id", activeId)
        .eq("user_id", user.id);
      const existingHosts = new Set(
        (existingRows ?? []).map((r) => r.url.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase())
      );

      const now = new Date().toISOString();
      const added: { id: string; url: string; reason: string }[] = [];
      for (const c of reachable) {
        if (existingHosts.has(c.domain)) continue;
        const url = `https://${c.domain}`;
        const { data: inserted, error } = await db
          .from("project_competitors")
          .insert({ user_id: user.id, project_id: activeId, url, created_at: now })
          .select("id")
          .single();
        if (error) continue;
        added.push({ id: inserted.id, url, reason: c.reason });
      }

      return NextResponse.json({ added, usedWebSearch, proposed: candidates.length, verified: reachable.length });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 502 });
    }
  }

  const db = getDb();

  const keyRow = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId ?? "") as { api_key: string | null; base_url: string | null } | undefined;
  // No model credentials is fine: discovery then runs from web search alone.
  const llmConfigured = Boolean(keyRow && (keyRow.api_key?.trim() || keyRow.base_url?.trim()));

  // Explicit projectId (passed by the post-creation background discovery
  // call) wins over "whatever's active right now" — pins this write to the
  // project it was actually triggered for, even if the user has since
  // switched to or created a different one. The manual "Find competitors"
  // button in Context panel doesn't pass one, so it still targets whatever's
  // currently active, which is the correct behavior for a direct click.
  const activeId = requestedProjectId || getActiveProjectId();
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

  // Audit is optional — we'll discover from URL + project metadata even without it
  const audit: SEOAuditPayload | undefined = auditRow ? JSON.parse(auditRow.payload) : undefined;

  const groundingDocs = db
    .prepare(
      "SELECT doc_type, content FROM project_documents WHERE project_id = ? AND doc_type IN ('product_info', 'marketing_strategy')"
    )
    .all(activeId) as { doc_type: string; content: string }[];
  const productInfo = groundingDocs.find((d) => d.doc_type === "product_info")?.content;
  const marketingStrategy = groundingDocs.find((d) => d.doc_type === "marketing_strategy")?.content;

  const tavilyKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as
    | { value: string }
    | undefined;
  // Tavily is queried directly (no model needed), so it no longer depends on the provider's tool support.
  const tavilyApiKey = tavilyKeyRow?.value || undefined;

  try {
    const agent = new CompetitorDiscoveryAgent(driver && model && llmConfigured ? driver : null, keyRow?.api_key || "", keyRow?.base_url ?? undefined);
    const { candidates, usedWebSearch } = await agent.discover({
      projectName: project.name,
      url: project.url,
      bodyText: audit?.bodyText ?? "",
      metaTitle: audit?.meta?.title ?? project.name,
      metaDescription: audit?.meta?.description ?? `Visit ${project.url}`,
      productInfo,
      marketingStrategy,
      model,
      tavilyApiKey,
      llmSupportsTools: providerId ? providerSupportsTools(providerId) : false,
    });

    if (candidates.length === 0) {
      return NextResponse.json({ added: [], usedWebSearch, note: "No confident competitor candidates found." });
    }

    // Real verification, same crawl used by Competitor Analysis — a
    // candidate that doesn't resolve is dropped, not saved as fact.
    const verified = await Promise.all(
      candidates.map(async (c) => ({ ...c, snippet: await fetchCompetitorSnippet(`https://${c.domain}`) }))
    );
    const reachable = verified.filter((v) => v.snippet.title !== "(couldn't fetch)");

    const existingRows = db
      .prepare("SELECT url FROM project_competitors WHERE project_id = ?")
      .all(activeId) as { url: string }[];
    const existingHosts = new Set(
      existingRows.map((r) => r.url.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase())
    );

    const now = new Date().toISOString();
    const added: { id: string; url: string; reason: string }[] = [];
    for (const c of reachable) {
      if (existingHosts.has(c.domain)) continue;
      const id = `comp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const url = `https://${c.domain}`;
      db.prepare("INSERT INTO project_competitors (id, project_id, url, created_at) VALUES (?, ?, ?, ?)").run(
        id,
        activeId,
        url,
        now
      );
      added.push({ id, url, reason: c.reason });
    }

    return NextResponse.json({ added, usedWebSearch, proposed: candidates.length, verified: reachable.length });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
