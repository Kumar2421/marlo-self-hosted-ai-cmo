/**
 * Input caps for one chat turn. Every turn is sent to a paid model with the
 * whole history attached, so an unbounded body is a cost and abuse vector.
 */
export const CHAT_MAX_MESSAGE_CHARS = 4000;
export const CHAT_MAX_HISTORY_MESSAGES = 30;
export const CHAT_MAX_HISTORY_CHARS = 20000;

export type ChatHistoryEntry = { role: "user" | "assistant"; content: string };

export type ChatInputCheck = { ok: true; history: ChatHistoryEntry[] } | { ok: false; error: string };

/**
 * Validates the new message and the client-supplied history. Returns a
 * normalized history (only role and content survive) or a message the route
 * can send back as a 400.
 */
export function validateChatInput(message: unknown, history: unknown): ChatInputCheck {
  if (typeof message !== "string" || !message.trim()) {
    return { ok: false, error: "message is required" };
  }
  if (message.length > CHAT_MAX_MESSAGE_CHARS) {
    return { ok: false, error: `message is too long (max ${CHAT_MAX_MESSAGE_CHARS} characters). Shorten it and try again.` };
  }

  if (history === undefined || history === null) return { ok: true, history: [] };
  if (!Array.isArray(history)) return { ok: false, error: "history must be a list of messages" };
  if (history.length > CHAT_MAX_HISTORY_MESSAGES) {
    return { ok: false, error: `history is too long (max ${CHAT_MAX_HISTORY_MESSAGES} messages). Start a new chat to continue.` };
  }

  const normalized: ChatHistoryEntry[] = [];
  let historyChars = 0;
  for (const entry of history as unknown[]) {
    const role = (entry as { role?: unknown } | null)?.role;
    const content = (entry as { content?: unknown } | null)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return { ok: false, error: "history entries need a role (user or assistant) and text content" };
    }
    if (content.length > CHAT_MAX_MESSAGE_CHARS) {
      return { ok: false, error: `a history message is too long (max ${CHAT_MAX_MESSAGE_CHARS} characters)` };
    }
    historyChars += content.length;
    normalized.push({ role, content });
  }
  if (historyChars > CHAT_MAX_HISTORY_CHARS) {
    return { ok: false, error: `history is too long (max ${CHAT_MAX_HISTORY_CHARS} characters in total). Start a new chat to continue.` };
  }

  return { ok: true, history: normalized };
}
