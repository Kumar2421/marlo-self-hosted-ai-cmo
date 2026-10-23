import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { AssistantError, type TurnContext } from "@/lib/domain/assistant/assistantTypes";
import { runAssistantTurn } from "@/lib/domain/assistant/assistantService";
import { createPlatformPorts } from "@/lib/domain/assistant/platformAdapters";
import { createSelfHostPorts } from "@/lib/domain/assistant/selfHostAdapters";
import { chatLimiter, guardChatRate } from "@/lib/domain/assistant/chatRateLimit";

// Per-user request limit (12/min, shared with /api/chat/stream). In-process, so each server instance counts separately.
const limiter = chatLimiter;

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/** Thin handler: parse the body, run the assistant service, translate AssistantError. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Legacy clients may still send providerId/model: deliberately ignored. The server chooses the model and key.
  const platform = FEATURES.PLATFORM_MODE;
  const ctx: TurnContext = { mode: platform ? "platform" : "selfhost", userId: null, activeProjectId: null };

  try {
    const guard = await guardChatRate(platform ? createPlatformPorts() : createSelfHostPorts(), ctx, limiter);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: 429, headers: { "Retry-After": String(guard.retryAfterSec) } });
    }
    const out = await runAssistantTurn(guard.ports, ctx, {
      message: body.message,
      history: body.history,
      projectId: body.projectId,
    });
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof AssistantError) {
      return NextResponse.json({ ...err.body, error: err.userMessage }, { status: err.status });
    }
    throw err;
  }
}
