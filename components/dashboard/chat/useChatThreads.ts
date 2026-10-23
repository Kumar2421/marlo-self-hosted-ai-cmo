"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ChatMsg } from "@/lib/domain/chat/chatSessionState";
import { createThreadsController, type ThreadsApi, type ThreadsController } from "@/lib/domain/chat/threadController";
import { initialThreadListState, threadListReducer } from "@/lib/domain/chat/threadListState";
import { fetchThreadMessages, fetchThreads, removeAllThreads, removeThread } from "@/lib/query/threadTransport";

const api: ThreadsApi = {
  list: (p) => fetchThreads(p),
  open: (p, id) => fetchThreadMessages(p, id),
  remove: removeThread,
  removeAll: removeAllThreads,
};

/** Saved chats of the active project: list, restore the last one on load, open, delete. Separate from the message reducer. */
export function useChatThreads(opts: { projectId: string | null; loadMessages: (messages: ChatMsg[]) => void }) {
  const [state, dispatch] = useReducer(threadListReducer, initialThreadListState);
  const { projectId, loadMessages } = opts;

  // Latest values for the controller's callbacks; updated after each render, read only from events and async work.
  const activeIdRef = useRef<string | null>(null);
  const loadRef = useRef(loadMessages);
  useEffect(() => {
    activeIdRef.current = state.activeId;
    loadRef.current = loadMessages;
  });

  // One controller per project; the effect cleanup disposes it so a late answer can never touch the next project's chat.
  const controllerRef = useRef<ThreadsController | null>(null);
  useEffect(() => {
    const controller = createThreadsController({
      projectId, api, dispatch,
      loadMessages: (m) => loadRef.current(m),
      getActiveId: () => activeIdRef.current,
    });
    controllerRef.current = controller;
    dispatch({ type: "loading" });
    void controller.start();
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [projectId]);

  const open = useCallback(async (id: string) => (await controllerRef.current?.open(id)) ?? false, []);
  const remove = useCallback(async (id: string) => (await controllerRef.current?.remove(id)) ?? false, []);
  const removeAll = useCallback(async () => (await controllerRef.current?.removeAll()) ?? false, []);
  const startNew = useCallback(() => {
    // Works even before a controller exists (no project yet): just clear the visible chat.
    if (controllerRef.current) controllerRef.current.startNew();
    else loadRef.current([]);
  }, []);
  const detach = useCallback(() => controllerRef.current?.detach(), []);
  const noteTurn = useCallback((id: string | undefined) => controllerRef.current?.noteTurn(id), []);
  const touch = useCallback(() => controllerRef.current?.touch(), []);
  const retry = useCallback(() => {
    dispatch({ type: "loading" });
    void controllerRef.current?.start();
  }, []);

  return { status: state.status, threads: state.threads, activeId: state.activeId, open, remove, removeAll, startNew, detach, noteTurn, touch, retry };
}

export type ChatThreads = ReturnType<typeof useChatThreads>;
