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
  | { type: "load"; messages: ChatMsg[] }
  | { type: "reset" };

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
    case "fail":
      return {
        messages: [...state.messages, { role: "assistant", text: action.message, error: true }],
        pending: false,
      };
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
