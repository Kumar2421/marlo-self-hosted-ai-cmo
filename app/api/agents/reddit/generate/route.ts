import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { RedditAgent } from "@/lib/domain/reddit/RedditAgent";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { spendCredits, withRefund, isFailedResponse, InsufficientCreditsError, type CreditTicket } from "@/lib/credits";
import { buildRedditSearchPlan, emptyRedditSettings, mergeSubreddits, type RedditSettings } from "@/lib/domain/reddit/redditSettings";
import { getRedditSettings } from "@/lib/domain/reddit/redditSettingsStore";
import { getRedditSettings as getRedditSettingsSupabase } from "@/lib/domain/reddit/redditSettingsStoreSupabase";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";
import { platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/** Saved Reddit focus for the active project. Only a bias, so any failure falls back to none. */
async function loadSavedSettings(): Promise<RedditSettings> {
  try {
    const auth = await getAuthenticatedProjectContext();
    if ("response" in auth) return emptyRedditSettings();
    const { userId, projectId, supabase } = auth.context;
    return supabase && userId ? await getRedditSettingsSupabase(supabase, userId, projectId) : getRedditSettings(getDb(), projectId);
  } catch {
    return emptyRedditSettings();
  }
}

/** Requested subreddits plus saved priorities; with neither, the long-standing defaults. */
function runSubreddits(requested: string[], saved: string[]): string[] {
  const merged = mergeSubreddits(requested, saved);
  return merged.length ? merged : ["reactjs", "SaaS"];
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { subreddits, keywords, brandVoice, providerId, model } = body as {
    subreddits?: string;
    keywords: string;
    brandVoice: string;
    providerId?: string;
    model?: string;
  };

  if (!keywords || !brandVoice) {
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

  const subList = (subreddits ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

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
      // Closed-source: platform-provided key, metered via credits. Never
      // available in self-host builds (GROQ_API_KEY/MISTRAL_API_KEY unset there).
      try {
        ticket = await spendCredits(user.id, "social_draft", { model });
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
        const saved = await loadSavedSettings();
        const agent = new RedditAgent(driver, apiKey, baseUrl);
        const { opportunities, usedMockThreads } = await agent.findOpportunities({
          subreddits: runSubreddits(subList, saved.subreddits),
          searchPlan: buildRedditSearchPlan(saved),
          keywords,
          brandVoice,
          model,
          project: await getActiveProjectContextSupabase(db, user.id),
        });

        return NextResponse.json({ opportunities, usedMockThreads });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: raw, chargedCredits }, { status: 502 });
      }
    }, isFailedResponse);
  }

  const db = getDb();
  const row = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;

  if (!row) {
    return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
  }

  try {
    const saved = await loadSavedSettings();
    const agent = new RedditAgent(driver, row.api_key, row.base_url ?? undefined);
    const { opportunities, usedMockThreads } = await agent.findOpportunities({
      subreddits: runSubreddits(subList, saved.subreddits),
      searchPlan: buildRedditSearchPlan(saved),
      keywords,
      brandVoice,
      model,
      project: getActiveProjectContext(),
    });

    return NextResponse.json({ opportunities, usedMockThreads });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
