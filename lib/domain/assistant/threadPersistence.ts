import { trimChatHistory, type ChatHistoryEntry } from "../chat/chatLimits.ts";
import { AssistantError } from "./assistantTypes.ts";
import {
  THREAD_HISTORY_MESSAGES, ThreadsUnavailableError, deriveThreadTitle, type ThreadScope, type ThreadStore,
} from "./threadStore.ts";

export const THREAD_NOT_FOUND = "That chat no longer exists. Start a new chat and ask again.";

export type HistorySource =
  /** Server-owned: `threadId` is null for a brand-new thread (created after the first successful turn). */
  | { kind: "server"; threadId: string | null; history: ChatHistoryEntry[] }
  /** No store, or the tables are missing: the client's history is used exactly as before. */
  | { kind: "client" };

/**
 * Where this turn's model history comes from. With a working store the SERVER owns it: the client's `history` is
 * ignored, so it can no longer inject fake assistant turns. Throws AssistantError(404) for a thread that is not
 * the caller's. Any store failure other than that degrades to client history rather than failing the chat.
 */
export async function loadHistorySource(
  store: ThreadStore | undefined, scope: ThreadScope | null, threadId: unknown,
): Promise<HistorySource> {
  if (!store || !scope) return { kind: "client" };
  try {
    if (typeof threadId === "string" && threadId) {
      const msgs = await store.recentMessages(scope, threadId, THREAD_HISTORY_MESSAGES);
      if (!msgs) throw new AssistantError(404, THREAD_NOT_FOUND);
      return { kind: "server", threadId, history: trimChatHistory(msgs.map((m) => ({ role: m.role, content: m.content }))) };
    }
    if (!(await store.isAvailable())) return { kind: "client" };
    return { kind: "server", threadId: null, history: [] };
  } catch (err) {
    if (err instanceof AssistantError) throw err;
    if (!(err instanceof ThreadsUnavailableError)) console.warn("[chat-history] could not load history; using client history");
    return { kind: "client" };
  }
}

/**
 * After a successful turn: store the user message and the reply (creating the thread on the first message).
 * Returns the thread id, or null when nothing was stored. Never throws and never logs content.
 */
export async function persistTurn(args: {
  store: ThreadStore | undefined; scope: ThreadScope | null; source: HistorySource;
  userText: string; reply: string | undefined; toolsUsed: string[]; lookedAt: string[];
}): Promise<string | null> {
  const { store, scope, source } = args;
  if (!store || !scope || source.kind !== "server" || !args.reply) return null;
  try {
    const id = source.threadId ?? (await store.createThread(scope, deriveThreadTitle(args.userText))).id;
    const ok = await store.appendMessages(scope, id, [
      { role: "user", content: args.userText },
      { role: "assistant", content: args.reply, toolsUsed: args.toolsUsed, lookedAt: args.lookedAt },
    ]);
    return ok ? id : null;
  } catch {
    console.warn("[chat-history] could not save this turn");
    return null;
  }
}
