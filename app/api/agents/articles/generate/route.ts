import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { ArticleGenerator } from "@/lib/domain/articles/ArticleGenerator";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { spendCredits, withRefund, isFailedResponse, InsufficientCreditsError, type CreditTicket } from "@/lib/credits";
import { platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { topic, keywords, brandVoice, providerId, model } = body as {
    topic: string;
    keywords: string;
    brandVoice: string;
    providerId?: string;
    model?: string;
  };

  if (!topic || !keywords || !brandVoice) {
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
    return NextResponse.json(
      { error: `${providerId} isn't wired to a real model yet.` },
      { status: 501 }
    );
  }

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
        ticket = await spendCredits(user.id, "article_generate", { model });
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
        const generator = new ArticleGenerator(driver, apiKey, baseUrl);
        const result = await generator.generate({
          topic,
          keywords,
          brandVoice,
          model,
          project: await getActiveProjectContextSupabase(db, user.id),
        });

        if (result.stream) {
          return new NextResponse(result.stream, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        return NextResponse.json({ text: result.text });
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
    return NextResponse.json(
      { error: `${providerId} isn't connected yet.` },
      { status: 422 }
    );
  }

  try {
    const generator = new ArticleGenerator(driver, row.api_key, row.base_url ?? undefined);
    const result = await generator.generate({
      topic,
      keywords,
      brandVoice,
      model,
      project: getActiveProjectContext(),
    });

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
