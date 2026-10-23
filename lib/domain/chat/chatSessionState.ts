/**
 * Pure state machine for one chat conversation. No React, no I/O, so node tests cover it.
 * The hook (components/dashboard/chat/useChatSession.ts) owns the side effects and dispatches these.
 */
export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  list?: string[];
  goodToKnow?: string[];
  footer?: string;
  /** Which stored data the answer looked at (from the chat tools). */
  lookedAt?: string[];
  /** Error bubble: shown to the user, never sent back to the model as history. */
  error?: boolean;
  /** Assistant message still being written (streaming). Cleared by done / fail. */
  streaming?: boolean;
  /** Calm one-line status while streaming ("Checking your latest audit..."); cleared when text starts or the turn ends. */
  status?: string;
};

export type ChatSessionState = {
  messages: ChatMsg[];
  /** A request is in flight. */
  pending: boolean;
};

export type ChatSessionAction =
  | { type: "send"; text: string }
  | { type: "reply"; text: string; lookedAt?: string[] }
  | { type: "fail"; message: string }
  /** Streaming: an empty assistant message that grows. Follows "send" (or "retry"). */
  | { type: "stream_start" }
  | { type: "status"; label: string }
  | { type: "delta"; text: string }
  | { type: "done"; lookedAt?: string[] }
  /** Retry a failed turn: drops the trailing error bubble, keeps the user's message, goes pending. */
  | { type: "retry" }
  | { type: "load"; messages: ChatMsg[] }
  | { type: "reset" };

const lastIsStreaming = (m: ChatMsg[]) => m.length > 0 && m[m.length - 1].role === "assistant" && m[m.length - 1].streaming === true;
const patchLast = (m: ChatMsg[], patch: (x: ChatMsg) => ChatMsg): ChatMsg[] => [...m.slice(0, -1), patch(m[m.length - 1])];

export const initialChatSessionState: ChatSessionState = { messages: [], pending: false };

export function chatSessionReducer(state: ChatSessionState, action: ChatSessionAction): ChatSessionState {
  switch (action.type) {
    case "send":
      return { messages: [...state.messages, { role: "user", text: action.text }], pending: true };
    case "reply":
      return {
        messages: [...state.messages, { role: "assistant", text: action.text, lookedAt: action.lookedAt }],
        pending: false,
      };
    case "fail": {
      // A failure mid-stream replaces the half-written message: partial text is never kept or sent back as history.
      const base = lastIsStreaming(state.messages) ? state.messages.slice(0, -1) : state.messages;
      return { messages: [...base, { role: "assistant", text: action.message, error: true }], pending: false };
    }
    case "stream_start":
      if (lastIsStreaming(state.messages)) return state;
      return { messages: [...state.messages, { role: "assistant", text: "", streaming: true }], pending: true };
    case "status":
      if (!lastIsStreaming(state.messages)) return state;
      return { ...state, messages: patchLast(state.messages, (m) => ({ ...m, status: action.label })) };
    case "delta":
      if (!lastIsStreaming(state.messages)) return state;
      return { ...state, messages: patchLast(state.messages, (m) => ({ ...m, text: m.text + action.text, status: undefined })) };
    case "done":
      if (!lastIsStreaming(state.messages)) return state;
      return { messages: patchLast(state.messages, (m) => ({ role: "assistant", text: m.text, lookedAt: action.lookedAt })), pending: false };
    case "retry": {
      if (state.pending || !lastFailedUserText(state.messages)) return state;
      return { messages: state.messages.slice(0, -1), pending: true };
    }
    case "load":
      return { messages: action.messages, pending: false };
    case "reset":
      return initialChatSessionState;
  }
}

/** The conversation as the model should see it: error bubbles are never sent back. */
export function historyForRequest(messages: ChatMsg[]): { role: "user" | "assistant"; content: string }[] {
  return messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.text }));
}

/** Text of the most recent user message when the conversation ended in an error bubble, else null. */
export function lastFailedUserText(messages: ChatMsg[]): string | null {
  const last = messages[messages.length - 1];
  if (!last?.error) return null;
  for (let i = messages.length - 2; i >= 0; i--) if (messages[i].role === "user") return messages[i].text;
  return null;
}

/** What to resend for "Try again": the failed user text plus the history that preceded it (no duplicate user turn). */
export function retryRequest(messages: ChatMsg[]): { text: string; history: { role: "user" | "assistant"; content: string }[] } | null {
  if (!lastFailedUserText(messages)) return null;
  let idx = messages.length - 2;
  while (idx >= 0 && messages[idx].role !== "user") idx--;
  return { text: messages[idx].text, history: historyForRequest(messages.slice(0, idx)) };
}

/** What to show for a failed chat response, and whether it is the monthly free cap (which also opens the unlock panel). */
export function describeChatFailure(data: { error?: string; code?: string; limit?: number }): { message: string; limitReached: boolean } {
  if (data.code === "chat_limit") {
    const n = typeof data.limit === "number" && data.limit > 0 ? data.limit : 10;
    return { message: `You've used your ${n} free chats this month. Plans unlock more.`, limitReached: true };
  }
  return { message: `⚠ ${data.error ?? "Something went wrong."}`, limitReached: false };
}
