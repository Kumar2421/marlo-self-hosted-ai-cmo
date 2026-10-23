export type ChatRequest = {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  projectId: string | null;
};

export type ChatResponseBody = { reply?: string; lookedAt?: unknown; error?: string };

/** The one place the chat panel talks to the server. Throws on network failure or a non-JSON body, like fetch. */
export async function sendChatMessage(
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<{ ok: boolean; data: ChatResponseBody }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      message: req.message,
      history: req.history,
      projectId: req.projectId,
    }),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}
