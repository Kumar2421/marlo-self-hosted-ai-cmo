import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { platformKeyFor } from "@/lib/llm/platformKeys";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

const GROQ_MODEL = "openai/gpt-oss-120b";

export async function GET() {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ platformMode: false, status: "platform_mode_disabled" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: setting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", user.id)
    .eq("key", "primaryModel")
    .maybeSingle();

  const groqKey = platformKeyFor("groq");
  const groqConfigured = Boolean(groqKey);

  let groqReachability: "not_configured" | "ok" | "unauthorized" | "error" = "not_configured";
  let groqModelAvailable = false;

  if (groqKey) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${groqKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });

      if (response.ok) {
        groqReachability = "ok";
        const payload = (await response.json()) as {
          data?: Array<{ id?: string }>;
        };
        groqModelAvailable = Boolean(payload.data?.some((model) => model.id === GROQ_MODEL));
      } else if (response.status === 401 || response.status === 403) {
        groqReachability = "unauthorized";
      } else {
        groqReachability = "error";
      }
    } catch {
      groqReachability = "error";
    }
  }

  return NextResponse.json({
    platformMode: true,
    primaryModel: setting?.value ?? null,
    groqConfigured,
    groqReachability,
    groqModelAvailable,
    expectedModel: GROQ_MODEL,
  });
}
