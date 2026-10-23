"use client";

import { useState, useRef, useEffect, useReducer } from "react";
import { useProviders } from "@/lib/providers-store";
import { useProject } from "@/lib/project-store";
import {
  chatSessionReducer,
  initialChatSessionState,
  historyForRequest,
  lastFailedUserText,
  describeChatFailure,
} from "@/lib/domain/chat/chatSessionState";
import { sendChatMessage } from "@/lib/query/chatTransport";
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

  async function sendText(raw: string, clearInput: boolean) {
    const text = raw.trim();
    if (!text || pending) return;

    const history = historyForRequest(messages);

    const reqId = requestIdRef.current + 1;
    requestIdRef.current = reqId;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const isCurrent = () => requestIdRef.current === reqId;

    dispatch({ type: "send", text });
    if (clearInput) {
      setInputState("");
      if (projectId) draftsRef.current[projectId] = "";
    }

    try {
      const { ok, data } = await sendChatMessage(
        { message: text, history, projectId },
        ctrl.signal,
      );
      if (!isCurrent()) return;

      if (!ok) {
        const failure = describeChatFailure(data);
        dispatch({ type: "fail", message: failure.message });
        if (failure.limitReached) unlockTrigger.fire();
        queryClient.invalidateQueries({ queryKey: qk.chatAllowance() });
        return;
      }
      queryClient.invalidateQueries({ queryKey: qk.chatAllowance() });

      dispatch({
        type: "reply",
        text: data.reply as string,
        lookedAt: Array.isArray(data.lookedAt) ? (data.lookedAt as string[]) : undefined,
      });
    } catch {
      if (!isCurrent()) return;
      dispatch({ type: "fail", message: "⚠ Couldn't reach the server. Check your connection and try again." });
    }
  }

  /** Sends the composer text. */
  const send = () => sendText(input, true);

  /** Re-sends the user message that the trailing error bubble belongs to. Not wired to any UI yet. */
  const retry = () => {
    const text = lastFailedUserText(messages);
    return text ? sendText(text, false) : Promise.resolve();
  };

  return { messages, pending, input, setInput, send, retry, resetChat, projectName: project?.name ?? null, primaryModel };
}
