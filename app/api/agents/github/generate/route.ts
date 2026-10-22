import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { GitHubAgent } from "@/lib/domain/github/GitHubAgent";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { repo, providerId, model } = body as {
    repo: string;
    providerId?: string;
    model?: string;
  };

  if (!repo) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

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

    // Needs a real SEO audit to base the PR on — read the active project's
    // URL, then whatever audit is already stored for it (run one first via
    // the SEO Agent / Analytics tab if none exists yet). Same two-step
    // lookup as self-host (project_url setting -> seo_audits row), scoped
    // to this user's active project instead of a single global setting.
    const { data: projSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projSetting?.value;

    const { data: project } = projectId
      ? await db.from("projects").select("url").eq("id", projectId).eq("owner_id", user.id).maybeSingle()
      : { data: null };

    if (!project?.url) {
      return NextResponse.json(
        { error: "No project website linked yet. Add one in the Context panel first." },
        { status: 422 }
      );
    }

    const { data: auditRow } = await db
      .from("seo_audits")
      .select("payload")
      .eq("project_id", projectId)
      .eq("url", project.url)
      .maybeSingle();

    if (!auditRow) {
      return NextResponse.json(
        { error: "No SEO audit found for your linked site yet. Run one in Analytics → SEO first." },
        { status: 422 }
      );
    }

    // payload is jsonb — already parsed by the Supabase client, no JSON.parse().
    const audit: SEOAuditPayload = auditRow.payload;

    // BYOK first — user's own key, no credit charge. Platform-key fallback
    // stays free too: no credit_costs row for this agent yet.
    const { data: conn } = await db
      .from("provider_connections")
      .select("api_key_secret_id, base_url")
      .eq("user_id", user.id)
      .eq("provider_id", providerId)
      .maybeSingle();

    let apiKey = "";
    let baseUrl: string | undefined;

    if (conn?.api_key_secret_id) {
      const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
      apiKey = (secret as string) ?? "";
      baseUrl = conn.base_url ?? undefined;
    } else if (platformKeyFor(providerId)) {
      // free in platform mode for now — no credit_costs entry yet
      apiKey = resolveLlmCredential({ providerId }).apiKey; // platform key: baseUrl intentionally not set
    } else {
      return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
    }

    try {
      const agent = new GitHubAgent(driver, apiKey, baseUrl);
      const result = await agent.draftFix({ repo, audit, model });

      if (result.stream) {
        return new NextResponse(result.stream, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      return NextResponse.json({ text: result.text });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 502 });
    }
  }

  const db = getDb();
  const keyRow = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;

  if (!keyRow) {
    return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
  }

  // Needs a real SEO audit to base the PR on — read the shared project URL,
  // then whatever audit is already stored for it (run one first via the SEO
  // Agent / Analytics tab if none exists yet).
  const urlRow = db.prepare("SELECT value FROM settings WHERE key = 'project_url'").get() as
    | { value: string }
    | undefined;

  if (!urlRow) {
    return NextResponse.json(
      { error: "No project website linked yet. Add one in the Context panel first." },
      { status: 422 }
    );
  }

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(urlRow.value) as
    | { payload: string }
    | undefined;

  if (!auditRow) {
    return NextResponse.json(
      { error: "No SEO audit found for your linked site yet. Run one in Analytics → SEO first." },
      { status: 422 }
    );
  }

  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);

  try {
    const agent = new GitHubAgent(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const result = await agent.draftFix({ repo, audit, model });

    if (result.stream) {
      return new NextResponse(result.stream, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return NextResponse.json({ text: result.text });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
