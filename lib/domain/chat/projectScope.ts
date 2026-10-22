/**
 * The chat client sends the project id it is showing. History from one project
 * must never be answered under another project's system prompt and tools, so
 * the server compares it with the project it will actually use.
 *
 * A missing id (older client) is accepted: the server's active project is used
 * as before. A present id that differs is rejected.
 */
export type ChatScopeCheck = { ok: true } | { ok: false; error: string };

export const CHAT_PROJECT_MISMATCH = "The active project changed while you were chatting. Start a new chat and ask again.";

export function checkChatProjectScope(requested: unknown, activeProjectId: string | null): ChatScopeCheck {
  if (requested === undefined || requested === null) return { ok: true };
  if (typeof requested !== "string" || !requested) return { ok: false, error: CHAT_PROJECT_MISMATCH };
  if (requested !== activeProjectId) return { ok: false, error: CHAT_PROJECT_MISMATCH };
  return { ok: true };
}
