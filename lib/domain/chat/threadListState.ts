/**
 * Pure state for the chat History list. No React, no I/O, so node tests cover it.
 * components/dashboard/chat/useChatThreads.ts owns the side effects and dispatches these.
 */
import type { ChatMsg } from "./chatSessionState.ts";

export type ThreadListItem = { id: string; title: string; createdAt: string; updatedAt: string; preview: string };
export type StoredMessage = { role: "user" | "assistant"; content: string; lookedAt?: string[] };

export type ThreadListState = {
  /** loading: first fetch; unavailable: server has no chat history (hide the control); error: fetch failed. */
  status: "loading" | "ready" | "unavailable" | "error";
  threads: ThreadListItem[];
  /** The server thread the current conversation belongs to; null = a new chat not stored yet. */
  activeId: string | null;
};

export type ThreadListAction =
  | { type: "loading" }
  | { type: "loaded"; threads: ThreadListItem[] }
  | { type: "refreshed"; threads: ThreadListItem[] }
  | { type: "unavailable" }
  | { type: "failed" }
  | { type: "activate"; id: string | null }
  | { type: "removed"; id: string }
  | { type: "clearedAll" };

export const initialThreadListState: ThreadListState = { status: "loading", threads: [], activeId: null };

export function threadListReducer(state: ThreadListState, action: ThreadListAction): ThreadListState {
  switch (action.type) {
    case "loading":
      return initialThreadListState;
    case "loaded":
      return { ...state, status: "ready", threads: action.threads };
    case "refreshed":
      // A background refresh never flips an unavailable/error list back and forth.
      return state.status === "unavailable" ? state : { ...state, status: "ready", threads: action.threads };
    case "unavailable":
      return { status: "unavailable", threads: [], activeId: null };
    case "failed":
      return { ...state, status: "error" };
    case "activate":
      return { ...state, activeId: action.id };
    case "removed":
      return {
        ...state,
        threads: state.threads.filter((t) => t.id !== action.id),
        activeId: state.activeId === action.id ? null : state.activeId,
      };
    case "clearedAll":
      return { ...state, threads: [], activeId: null };
  }
}

/** Stored messages as chat bubbles. */
export function messagesFromStored(stored: StoredMessage[]): ChatMsg[] {
  return stored.map((m) => ({
    role: m.role,
    text: m.content,
    lookedAt: m.role === "assistant" && m.lookedAt && m.lookedAt.length > 0 ? m.lookedAt : undefined,
  }));
}

/** The thread to restore when the chat opens: the most recently active one. */
export function threadToRestore(threads: ThreadListItem[]): ThreadListItem | null {
  return threads[0] ?? null;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 d ago", then a short date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const secs = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
