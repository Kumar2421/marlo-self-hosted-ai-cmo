"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import type { ChatMsg } from "@/lib/domain/chat/chatSessionState";
import { createThreadsController, type ThreadsApi } from "@/lib/domain/chat/threadController";
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
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = state.activeId;
  const loadRef = useRef(opts.loadMessages);
  loadRef.current = opts.loadMessages;

  const controller = useMemo(
    () => createThreadsController({
      projectId: opts.projectId, api, dispatch,
      loadMessages: (m) => loadRef.current(m),
      getActiveId: () => activeIdRef.current,
    }),
    [opts.projectId],
  );

  useEffect(() => {
    dispatch({ type: "loading" });
    void controller.start();
    return () => controller.dispose();
  }, [controller]);

  return {
    status: state.status,
    threads: state.threads,
    activeId: state.activeId,
    open: controller.open,
    startNew: controller.startNew,
    detach: controller.detach,
    remove: controller.remove,
    removeAll: controller.removeAll,
    noteTurn: controller.noteTurn,
    refresh: controller.refresh,
    touch: controller.touch,
    retry: () => {
      dispatch({ type: "loading" });
      void controller.start();
    },
  };
}

export type ChatThreads = ReturnType<typeof useChatThreads>;
