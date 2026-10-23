import { runAssistantTurn, type AssistantPorts } from "./assistantService.ts";
import { AssistantError, type AssistantTurnInput, type TurnContext } from "./assistantTypes.ts";
import type { StreamEvent } from "./sse.ts";
import { THINKING_LABEL, toolStatusLabel } from "./toolStatus.ts";

/**
 * Streaming variant of a chat turn. It does NOT fork the pipeline: it calls runAssistantTurn
 * (validate -> scope -> plan -> credentials -> credits -> prompt -> data -> answer) with
 * observer hooks, so model policy, fallback and credit timing live in exactly one place.
 *
 * What is really streamed, and what is not:
 *  - REAL token streaming: only on a driver's no-tools path (the plain call when there is no
 *    active project, and the counts-only "context" path used by Anthropic and Google, whose
 *    drivers implement `stream: true`). Deltas are forwarded as the provider produces them.
 *  - NOT streamed upstream: the tool path (OpenAI, Groq, Mistral, LM Studio, Ollama, custom).
 *    lib/llm/openai.ts runs its tool rounds non-streaming and returns the finished answer, so
 *    we show live tool-status events while it works, then type the finished text out in small
 *    chunks. That is presentation only; it does not make the model faster.
 */
export type StreamOptions = {
  /** Client disconnect. Stops work: no further attempts, no further events. */
  signal?: AbortSignal;
  /** Pause between typed-out chunks (ms). Tests pass 0. */
  chunkDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** Splits finished text into small word-aligned pieces (whitespace is kept, so joining restores the text exactly). */
export function chunkText(text: string, target = 24): string[] {
  const words = text.match(/\s*\S+\s*/g) ?? (text ? [text] : []);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    cur += w;
    if (cur.length >= target) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Same facts as the JSON error body: a chat_limit denial keeps its code and used/limit/resetsAt/plan. */
function errorEvent(err: AssistantError): StreamEvent {
  const b = err.body ?? {};
  return {
    type: "error", message: err.userMessage, code: typeof b.code === "string" ? b.code : String(err.status),
    ...(typeof b.used === "number" ? { used: b.used } : {}),
    ...(typeof b.limit === "number" ? { limit: b.limit } : {}),
    ...(typeof b.resetsAt === "string" || b.resetsAt === null ? { resetsAt: b.resetsAt as string | null } : {}),
    ...(typeof b.plan === "string" ? { plan: b.plan } : {}),
  };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Never throws. Every outcome is an event: ... done, or error. A cancelled client gets nothing more. */
export async function runAssistantTurnStream(
  ports: AssistantPorts, ctx: TurnContext, input: AssistantTurnInput,
  emit: (ev: StreamEvent) => void, opts: StreamOptions = {},
): Promise<void> {
  const { signal } = opts;
  const sleep = opts.sleep ?? defaultSleep;
  const delay = opts.chunkDelayMs ?? 12;
  let streamed = false;
  let closed = false;
  const send = (ev: StreamEvent) => {
    if (closed || signal?.aborted) return;
    try { emit(ev); } catch { closed = true; } // the sink is gone (client disconnected)
  };

  send({ type: "status", phase: "thinking", label: THINKING_LABEL });
  try {
    const out = await runAssistantTurn(ports, ctx, input, {}, {
      signal,
      onToolStart: (tool) => send({ type: "status", phase: "tool", tool, label: toolStatusLabel(tool) }),
      onDelta: (text) => { streamed = true; send({ type: "delta", text }); },
      hasStreamed: () => streamed,
    });
    if (closed || signal?.aborted) return;
    if (!streamed) {
      if (!out.reply) {
        send({ type: "error", message: "The assistant sent an empty reply. Try again.", code: "empty_reply" });
        return;
      }
      for (const piece of chunkText(out.reply)) {
        if (closed || signal?.aborted) return;
        send({ type: "delta", text: piece });
        if (delay > 0) await sleep(delay);
      }
    }
    send({ type: "done", toolsUsed: out.toolsUsed, lookedAt: out.lookedAt, ...(out.threadId ? { threadId: out.threadId } : {}) });
  } catch (err) {
    if (signal?.aborted) return;
    if (err instanceof AssistantError) send(errorEvent(err));
    else send({ type: "error", message: "Something went wrong. Try again.", code: "internal" });
  }
}
