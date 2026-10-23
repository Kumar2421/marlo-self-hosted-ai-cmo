import { createSseDecoder, type StreamEvent } from "../domain/assistant/sse.ts";

export type ChatRequest = {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  projectId: string | null;
  /** Server-side chat to continue (history is then read from the server, not from `history`). */
  threadId?: string | null;
};

export type ChatResponseBody = {
  reply?: string; lookedAt?: unknown; error?: string; threadId?: string;
  /** "chat_limit" when the monthly cap is reached (HTTP 402); with used/limit/resetsAt/plan. */
  code?: string; used?: number; limit?: number; resetsAt?: string | null; plan?: string;
};

type FetchLike = typeof fetch;

const requestBody = (req: ChatRequest) =>
  JSON.stringify({
    message: req.message,
    history: req.history,
    projectId: req.projectId,
    threadId: req.threadId ?? undefined,
  });

/** The JSON endpoint (also the streaming fallback). Throws on network failure or a non-JSON body, like fetch. */
export async function sendChatMessage(
  req: ChatRequest,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; status: number; data: ChatResponseBody }> {
  const res = await fetchImpl("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: requestBody(req),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

/** The stream endpoint is missing or its host cannot stream: use the JSON endpoint instead. */
const STREAM_UNAVAILABLE = new Set([404, 405, 501, 502, 503, 504]);

const CONNECTION_LOST = "Connection lost before the answer finished. Try again.";
const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

/** A failed JSON body as an error event, keeping chat_limit's code and fields. */
function errorFromBody(data: ChatResponseBody): StreamEvent {
  return {
    type: "error", message: data.error ?? "Something went wrong.",
    ...(data.code ? { code: data.code } : {}),
    ...(typeof data.used === "number" ? { used: data.used } : {}),
    ...(typeof data.limit === "number" ? { limit: data.limit } : {}),
    ...(typeof data.resetsAt === "string" || data.resetsAt === null ? { resetsAt: data.resetsAt } : {}),
    ...(data.plan ? { plan: data.plan } : {}),
  };
}

/** Runs the JSON endpoint and replays its answer as stream events, so callers have one code path. */
async function viaJson(req: ChatRequest, onEvent: (ev: StreamEvent) => void, signal: AbortSignal | undefined, fetchImpl: FetchLike) {
  try {
    const { ok, data } = await sendChatMessage(req, signal, fetchImpl);
    if (signal?.aborted) return;
    if (!ok || typeof data.reply !== "string") {
      onEvent(errorFromBody(data));
      return;
    }
    onEvent({ type: "delta", text: data.reply });
    onEvent({ type: "done", toolsUsed: [], lookedAt: Array.isArray(data.lookedAt) ? data.lookedAt.filter((x): x is string => typeof x === "string") : [], ...(typeof data.threadId === "string" ? { threadId: data.threadId } : {}) });
  } catch {
    if (signal?.aborted) return;
    onEvent({ type: "error", message: UNREACHABLE });
  }
}

/**
 * The one place the chat panel talks to the server. Streams events from POST /api/chat/stream into `onEvent`
 * and always ends with exactly one terminal event (done or error), unless `signal` aborts (then it just stops).
 *
 * Falls back to the JSON endpoint only if streaming never produced a byte: the request failed, the endpoint
 * is missing/unsupported, or the response is not an event stream. After the first byte a broken stream
 * becomes an error event (never a silent re-run, which could repeat a charged turn).
 */
export async function streamChatMessage(
  req: ChatRequest,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      signal,
      body: requestBody(req),
    });
  } catch {
    if (signal?.aborted) return;
    return viaJson(req, onEvent, signal, fetchImpl);
  }

  const isStream = res.ok && !!res.body && (res.headers.get("content-type") ?? "").includes("text/event-stream");
  if (!isStream) {
    if (!res.ok && !STREAM_UNAVAILABLE.has(res.status)) {
      // A real answer from the stream route (e.g. 400): show it, do not re-run the turn.
      const data = (await res.json().catch(() => ({}))) as ChatResponseBody;
      if (!signal?.aborted) onEvent(errorFromBody(data));
      return;
    }
    return viaJson(req, onEvent, signal, fetchImpl);
  }

  const reader = res.body!.getReader();
  const decoder = createSseDecoder();
  let gotByte = false;
  let terminal = false;
  const deliver = (events: StreamEvent[]) => {
    for (const ev of events) {
      if (terminal) return;
      if (ev.type === "done" || ev.type === "error") terminal = true;
      onEvent(ev);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        gotByte = true;
        deliver(decoder.push(value));
        if (terminal) break;
      }
    }
    if (!terminal) deliver(decoder.end());
  } catch {
    if (signal?.aborted) return;
    if (!gotByte) return viaJson(req, onEvent, signal, fetchImpl);
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  if (signal?.aborted) return;
  if (!gotByte) return viaJson(req, onEvent, signal, fetchImpl);
  if (!terminal) onEvent({ type: "error", message: CONNECTION_LOST, code: "stream_interrupted" });
}
