/**
 * Input caps for one chat turn. Every turn is sent to a paid model with the
 * whole history attached, so an unbounded body is a cost and abuse vector.
 *
 * Only the new message is ever rejected for size. The client (ChatPanel) sends
 * the full conversation, including long assistant replies, so history is
 * trimmed here instead of refused: the newest entries that fit are kept.
 */
export const CHAT_MAX_MESSAGE_CHARS = 4000;
export const CHAT_MAX_HISTORY_MESSAGES = 30;
export const CHAT_MAX_HISTORY_CHARS = 20000;

export type ChatHistoryEntry = { role: "user" | "assistant"; content: string };

export type ChatInputCheck = { ok: true; history: ChatHistoryEntry[] } | { ok: false; error: string };

/**
 * Validates the new message and returns the trimmed history. A non-empty
 * message over the cap is the only rejection; history never causes a 400.
 */
export function validateChatInput(message: unknown, history: unknown): ChatInputCheck {
  if (typeof message !== "string" || !message.trim()) {
    return { ok: false, error: "message is required" };
  }
  if (message.length > CHAT_MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Message too long (max ${CHAT_MAX_MESSAGE_CHARS} characters)` };
  }
  return { ok: true, history: trimChatHistory(history) };
}

/**
 * Keeps the newest history entries that fit the caps, in their original
 * (chronological) order. Malformed entries are dropped, and an entry longer
 * than the per-message cap is cut down to its last CHAT_MAX_MESSAGE_CHARS
 * characters. Once the next-older entry does not fit, it and everything before
 * it are dropped, so the kept history is always one contiguous recent slice.
 */
export function trimChatHistory(history: unknown): ChatHistoryEntry[] {
  if (!Array.isArray(history)) return [];

  const entries: ChatHistoryEntry[] = [];
  for (const raw of history as unknown[]) {
    const role = (raw as { role?: unknown } | null)?.role;
    const content = (raw as { content?: unknown } | null)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const clipped = content.length > CHAT_MAX_MESSAGE_CHARS ? content.slice(-CHAT_MAX_MESSAGE_CHARS) : content;
    entries.push({ role, content: clipped });
  }

  const kept: ChatHistoryEntry[] = [];
  let keptChars = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (kept.length >= CHAT_MAX_HISTORY_MESSAGES) break;
    const entry = entries[i];
    if (keptChars + entry.content.length > CHAT_MAX_HISTORY_CHARS) break;
    keptChars += entry.content.length;
    kept.push(entry);
  }
  return kept.reverse();
}
