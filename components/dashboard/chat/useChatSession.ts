"use client";

import { useState, useRef, useEffect, useReducer } from "react";
import { useToast } from "../Toast";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useProject } from "@/lib/project-store";
import {
  chatSessionReducer,
  initialChatSessionState,
  historyForRequest,
  lastFailedUserText,
  type ChatMsg,
} from "@/lib/domain/chat/chatSessionState";
import { sendChatMessage } from "@/lib/query/chatTransport";
import { useChatThreads } from "./useChatThreads";

/** All conversation state and the send flow. UI pieces only read from / call into this. */
export function useChatSession() {
  const [{ messages, pending }, dispatch] = useReducer(chatSessionReducer, initialChatSessionState);
  const [input, setInputState] = useState("");
  const { show } = useToast();
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

  /** Shows a stored conversation (restore / open a saved chat); anything in flight is dropped. */
  function showMessages(next: ChatMsg[]) {
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    dispatch({ type: "load", messages: next });
  }

  // Saved chats of this project (server-side history). Hidden by the panel when the server has none.
  const threads = useChatThreads({ projectId, loadMessages: showMessages });

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

    const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
    if (!primaryModel || !providerId) {
      show("Select a model first — connect a provider in Settings → LLM Providers.");
      return;
    }

    // With a saved chat the server owns the history; otherwise (history unavailable) the client sends it as before.
    const threadId = threads.activeId;
    const history = threadId ? [] : historyForRequest(messages);
    threads.touch();

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
      const { ok, status, data } = await sendChatMessage(
        { message: text, model: primaryModel, providerId, history, projectId, threadId },
        ctrl.signal,
      );
      if (!isCurrent()) return;

      if (!ok) {
        if (status === 404 && threadId) threads.detach(); // the saved chat was deleted elsewhere
        dispatch({ type: "fail", message: `⚠ ${data.error ?? "Something went wrong."}` });
        return;
      }

      threads.noteTurn(data.threadId);
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

  return { messages, pending, input, setInput, send, retry, resetChat, threads, projectName: project?.name ?? null, primaryModel };
}
