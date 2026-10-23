export type ChatRequest = {
  message: string;
  model: string;
  providerId: string;
  history: { role: "user" | "assistant"; content: string }[];
  projectId: string | null;
  /** Server-side chat to continue (history is then read from the server, not from `history`). */
  threadId?: string | null;
};

export type ChatResponseBody = { reply?: string; lookedAt?: unknown; error?: string; threadId?: string };

/** The one place the chat panel talks to the server. Throws on network failure or a non-JSON body, like fetch. */
export async function sendChatMessage(
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: ChatResponseBody }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      message: req.message,
      model: req.model,
      providerId: req.providerId,
      history: req.history,
      projectId: req.projectId,
      threadId: req.threadId ?? undefined,
    }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}
