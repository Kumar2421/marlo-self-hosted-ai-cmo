"use client";

import { useState, useRef, useEffect, useReducer } from "react";
import { useProviders } from "@/lib/providers-store";
import { useProject } from "@/lib/project-store";
import {
  chatSessionReducer,
  initialChatSessionState,
  historyForRequest,
  retryRequest,
  describeChatFailure,
} from "@/lib/domain/chat/chatSessionState";
import { streamChatMessage } from "@/lib/query/chatTransport";
import { unlockTrigger } from "@/lib/ui/unlockTrigger";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query/keys";

/** All conversation state and the send flow. UI pieces only read from / call into this. */
export function useChatSession() {
  const [{ messages, pending }, dispatch] = useReducer(chatSessionReducer, initialChatSessionState);
  const [input, setInputState] = useState("");
  // Display-only (limited-data notice); sending never depends on it - the server picks the model.
  const queryClient = useQueryClient();
  const { primaryModel } = useProviders();
  const { project } = useProject();
  const projectId = project?.id ?? null;

  // Only the newest request may touch the chat: a project switch or "New chat"
  // aborts the in-flight one and bumps the id, so a late reply is dropped.
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  // Unsent text per project, so switching projects neither leaks nor loses a draft.
  const draftsRef = useRef<Record<string, string>>({});
  const scopeRef = useRef<string | null>(projectId);

  function resetChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    dispatch({ type: "reset" });
  }

  /** Typing: also remembers the draft for the current project. */
  function setInput(value: string) {
    setInputState(value);
    if (projectId) draftsRef.current[projectId] = value;
  }

  useEffect(() => {
    if (scopeRef.current === projectId) return;
    scopeRef.current = projectId;
    resetChat();
    setInputState(projectId ? draftsRef.current[projectId] ?? "" : "");
  }, [projectId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** retryPlan: set when resending a failed turn (the user message is already in the list). */
  async function sendText(raw: string, clearInput: boolean, retryPlan?: { history: { role: "user" | "assistant"; content: string }[] }) {
    const text = raw.trim();
    if (!text || pending) return;

    const history = retryPlan ? retryPlan.history : historyForRequest(messages);

    const reqId = requestIdRef.current + 1;
    requestIdRef.current = reqId;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const isCurrent = () => requestIdRef.current === reqId;

    dispatch(retryPlan ? { type: "retry" } : { type: "send", text });
    dispatch({ type: "stream_start" });
    if (clearInput) {
      setInputState("");
      if (projectId) draftsRef.current[projectId] = "";
    }

    try {
      await streamChatMessage(
        { message: text, history, projectId },
        (ev) => {
          if (!isCurrent()) return;
          if (ev.type === "status") dispatch({ type: "status", label: ev.label });
          else if (ev.type === "delta") dispatch({ type: "delta", text: ev.text });
          else if (ev.type === "done") {
            dispatch({ type: "done", lookedAt: ev.lookedAt.length > 0 ? ev.lookedAt : undefined });
            queryClient.invalidateQueries({ queryKey: qk.chatAllowance() });
          } else {
            // Same path as the JSON endpoint: a chat_limit denial opens the unlock panel.
            const failure = describeChatFailure({ error: ev.message, code: ev.code, limit: ev.limit });
            dispatch({ type: "fail", message: failure.message });
            if (failure.limitReached) unlockTrigger.fire();
            queryClient.invalidateQueries({ queryKey: qk.chatAllowance() });
          }
        },
        ctrl.signal,
      );
    } catch {
      if (!isCurrent()) return;
      dispatch({ type: "fail", message: "⚠ Couldn't reach the server. Check your connection and try again." });
    }
  }

  /** Sends the composer text. */
  const send = () => sendText(input, true);

  /** Re-sends the user message that the trailing error bubble belongs to ("Try again"). One tap, one request. */
  const retry = () => {
    const plan = retryRequest(messages);
    return plan && !pending ? sendText(plan.text, false, { history: plan.history }) : Promise.resolve();
  };

  return { messages, pending, input, setInput, send, retry, resetChat, projectName: project?.name ?? null, primaryModel };
}
