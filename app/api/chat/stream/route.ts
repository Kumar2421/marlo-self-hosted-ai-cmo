import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import type { TurnContext } from "@/lib/domain/assistant/assistantTypes";
import { chatLimiter, guardChatRate } from "@/lib/domain/assistant/chatRateLimit";
import { runAssistantTurnStream } from "@/lib/domain/assistant/assistantStream";
import { createPlatformPorts } from "@/lib/domain/assistant/platformAdapters";
import { createSelfHostPorts } from "@/lib/domain/assistant/selfHostAdapters";
import { encodeSseEvent, SSE_KEEPALIVE } from "@/lib/domain/assistant/sse";

// Same ceiling as POST /api/chat (Hobby caps at 60s).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 10_000;

/**
 * Streaming twin of POST /api/chat (which stays as the JSON fallback). Same body, same service
 * pipeline; the answer arrives as Server-Sent Events. Every turn outcome, including 401/402/409,
 * is an in-stream `error` event; only an unreadable body is a plain 400 JSON response.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "message is required" }, { status: 400 });

  // Legacy providerId/model fields are ignored: the server chooses the model and key.
  const platform = FEATURES.PLATFORM_MODE;
  const ctx: TurnContext = { mode: platform ? "platform" : "selfhost", userId: null, activeProjectId: null };

  // Same per-user rate limit as /api/chat, answered as plain JSON BEFORE any streaming starts.
  const ports = platform ? createPlatformPorts() : createSelfHostPorts();
  const guard = await guardChatRate(ports, ctx, chatLimiter);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: 429, headers: { "Retry-After": String(guard.retryAfterSec) } });
  }

  // Aborts on client disconnect (req.signal) or when the response stream is cancelled.
  const work = new AbortController();
  const onReqAbort = () => work.abort();
  if (req.signal.aborted) work.abort();
  else req.signal.addEventListener("abort", onReqAbort, { once: true });

  const encoder = new TextEncoder();
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      keepalive = setInterval(() => { try { write(SSE_KEEPALIVE); } catch { work.abort(); } }, KEEPALIVE_MS);
      try {
        await runAssistantTurnStream(
          guard.ports, ctx,
          { message: body.message, history: body.history, projectId: body.projectId, threadId: body.threadId },
          (ev) => write(encodeSseEvent(ev)),
          { signal: work.signal },
        );
      } finally {
        clearInterval(keepalive);
        req.signal.removeEventListener("abort", onReqAbort);
        try { controller.close(); } catch { /* already closed by cancel */ }
      }
    },
    cancel() {
      clearInterval(keepalive);
      work.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
