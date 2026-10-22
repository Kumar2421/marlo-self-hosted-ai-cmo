import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/**
 * Agent query leads endpoint.
 * Takes natural language query, uses LLM to parse filters, returns matching leads.
 *
 * Example:
 * POST /api/agents/chat/query-leads
 * { query: "Find CTOs in NYC that raised Series A", model: "...", providerId: "..." }
 */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const query: string = typeof body?.query === "string" ? body.query : "";
  const model: string = typeof body?.model === "string" ? body.model : "";
  const providerId: string = typeof body?.providerId === "string" ? body.providerId : "";

  if (!query.trim()) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
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

      // free in platform mode for now — no credit_costs entry yet
      const filterPrompt = `Parse this lead search query and suggest search keywords.
Query: "${query}"

Respond with JSON:
{
  "title": "what user searched for",
  "keywords": ["cto", "new york"],
  "limit": 20,
  "explanation": "brief explanation of filters"
}

Return short plain keywords/phrases only (no SQL) — they'll be matched with a
case-insensitive "contains" search across name/title/company/location. If
unclear, return an empty keywords array.`;

      const filterRes = await driver({
        apiKey,
        model,
        baseUrl: llmBaseUrl,
        messages: [{ role: "user", content: filterPrompt }],
      });

      let keywords: string[] = [];
      let limit = 20;
      try {
        const jsonMatch = filterRes.text?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          keywords = Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5).filter((k: unknown) => typeof k === "string") : [];
          limit = Math.min(Number(parsed.limit) || 20, 50);
        }
      } catch {
        // use defaults
      }

      // Data-layer migration only: the SQLite version builds a raw SQL
      // WHERE clause from LLM output and executes it directly. Postgrest
      // has no raw-SQL escape hatch here, so LLM-extracted keywords are
      // translated to an .or() of ilike "contains" filters across the same
      // columns instead — same intent (OR-matched free-text filters), safe
      // against injection by construction.
      let queryBuilder = db.from("leads").select("id, name, title, company, email, location").eq("user_id", user.id).eq("project_id", projectId);
      if (keywords.length > 0) {
        const orFilter = keywords
          .map((k) => k.replace(/[%,]/g, ""))
          .filter(Boolean)
          .map((k) => `name.ilike.%${k}%,title.ilike.%${k}%,company.ilike.%${k}%,location.ilike.%${k}%`)
          .join(",");
        if (orFilter) queryBuilder = queryBuilder.or(orFilter);
      }
      const { data: leads, error } = await queryBuilder.limit(limit);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({
        query,
        filters: keywords,
        count: leads?.length ?? 0,
        leads: leads ?? [],
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to query leads" },
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

    // Use LLM to understand the query and suggest SQL filters
    const filterPrompt = `Parse this lead search query and suggest SQL WHERE conditions.
Query: "${query}"

Respond with JSON:
{
  "title": "what user searched for",
  "where_conditions": ["title LIKE '%CTO%'", "location = 'New York'"],
  "limit": 20,
  "explanation": "brief explanation of filters"
}

Only return valid SQLite conditions. If unclear, return empty where_conditions.`;

    const filterRes = await driver({
      apiKey: keyRow.api_key || "",
      model,
      baseUrl: keyRow.base_url || undefined,
      messages: [{ role: "user", content: filterPrompt }],
    });

    let filters: { where_conditions: string[]; limit: number } = {
      where_conditions: [],
      limit: 20,
    };

    try {
      const jsonMatch = filterRes.text?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        filters = {
          where_conditions: Array.isArray(parsed.where_conditions)
            ? parsed.where_conditions.slice(0, 5) // max 5 conditions
            : [],
          limit: Math.min(parsed.limit || 20, 50), // max 50 results
        };
      }
    } catch {
      console.log("[query-leads] LLM filter parse error, using defaults");
    }

    // Build SQL query
    let sql = "SELECT id, name, title, company, email, location FROM leads WHERE project_id = ?";
    const params: (string | number)[] = [projectId];

    if (filters.where_conditions.length > 0) {
      sql += " AND (" + filters.where_conditions.join(" OR ") + ")";
    }

    sql += " LIMIT ?";
    params.push(filters.limit);

    console.log(
      "[query-leads] Built SQL:",
      sql.slice(0, 100),
      "with",
      filters.where_conditions.length,
      "filters"
    );

    const leads = db.prepare(sql).all(...params) as Array<{
      id: string;
      name: string;
      title: string;
      company: string;
      email: string | null;
      location: string;
    }>;

    return NextResponse.json({
      query,
      filters: filters.where_conditions,
      count: leads.length,
      leads,
    });
  } catch (err) {
    console.error("[query-leads] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to query leads" },
      { status: 500 }
    );
  }
}
