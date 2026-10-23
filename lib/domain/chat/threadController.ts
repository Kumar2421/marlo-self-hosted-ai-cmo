/**
 * Side-effect logic of the chat History, free of React so node tests drive it with a fake api.
 * One controller per project: switching project disposes it and creates a new one, so a late answer for the old
 * project can never touch the new chat. Within a controller, any user action bumps `epoch`, which cancels the
 * automatic "restore the last chat" that may still be in flight.
 */
import type { ChatMsg } from "./chatSessionState.ts";
import {
  messagesFromStored, threadToRestore, type ThreadListAction,
} from "./threadListState.ts";
import type { ListResult, OpenResult } from "../../query/threadTransport.ts";

export type ThreadsApi = {
  list(projectId: string): Promise<ListResult>;
  open(projectId: string, id: string): Promise<OpenResult>;
  remove(projectId: string, id: string): Promise<boolean>;
  removeAll(projectId: string): Promise<boolean>;
};

export type ThreadsController = ReturnType<typeof createThreadsController>;

export function createThreadsController(args: {
  projectId: string | null;
  api: ThreadsApi;
  dispatch: (a: ThreadListAction) => void;
  /** Replace the visible conversation (aborts anything in flight on the session side). */
  loadMessages: (messages: ChatMsg[]) => void;
  getActiveId: () => string | null;
}) {
  const { projectId, api, dispatch, loadMessages, getActiveId } = args;
  let epoch = 0;
  let disposed = false;
  const live = (e?: number) => !disposed && (e === undefined || e === epoch);

  async function refresh(): Promise<void> {
    if (!projectId) return;
    const res = await api.list(projectId);
    if (!live()) return;
    if (res.kind === "ok") dispatch({ type: "refreshed", threads: res.threads });
    else if (res.kind === "unavailable") dispatch({ type: "unavailable" });
  }

  /** Initial load for this project: fetch the list, then restore the most recent chat if the user has not started anything. */
  async function start(): Promise<void> {
    if (!projectId) {
      dispatch({ type: "loaded", threads: [] });
      return;
    }
    const e = epoch;
    const res = await api.list(projectId);
    if (!live()) return;
    if (res.kind === "unavailable") return void dispatch({ type: "unavailable" });
    if (res.kind === "error") return void dispatch({ type: "failed" });
    dispatch({ type: "loaded", threads: res.threads });
    const last = threadToRestore(res.threads);
    if (!last) return;
    const opened = await api.open(projectId, last.id);
    if (!live(e) || opened.kind !== "ok") return;
    dispatch({ type: "activate", id: last.id });
    loadMessages(messagesFromStored(opened.messages));
  }

  async function open(id: string): Promise<boolean> {
    if (!projectId) return false;
    epoch += 1;
    const e = epoch;
    const opened = await api.open(projectId, id);
    if (!live(e)) return false;
    if (opened.kind === "missing") {
      dispatch({ type: "removed", id });
      void refresh();
      return false;
    }
    if (opened.kind !== "ok") return false;
    dispatch({ type: "activate", id });
    loadMessages(messagesFromStored(opened.messages));
    return true;
  }

  function startNew(): void {
    epoch += 1;
    dispatch({ type: "activate", id: null });
    loadMessages([]);
  }

  /** The current thread is gone on the server: keep the visible messages, stop sending its id. */
  function detach(): void {
    epoch += 1;
    dispatch({ type: "activate", id: null });
    void refresh();
  }

  async function remove(id: string): Promise<boolean> {
    if (!projectId) return false;
    const ok = await api.remove(projectId, id);
    if (!live() || !ok) return false;
    const wasActive = getActiveId() === id;
    dispatch({ type: "removed", id });
    if (wasActive) {
      epoch += 1;
      loadMessages([]);
    }
    return true;
  }

  async function removeAll(): Promise<boolean> {
    if (!projectId) return false;
    const ok = await api.removeAll(projectId);
    if (!live() || !ok) return false;
    epoch += 1;
    dispatch({ type: "clearedAll" });
    loadMessages([]);
    return true;
  }

  /** A turn finished and the server stored it under `threadId`. */
  function noteTurn(threadId: string | undefined): void {
    if (!threadId) return;
    epoch += 1;
    dispatch({ type: "activate", id: threadId });
    void refresh();
  }

  /** The user acted on the conversation (sent a message): cancels an automatic restore still in flight. */
  function touch(): void {
    epoch += 1;
  }

  return { start, open, startNew, detach, remove, removeAll, noteTurn, refresh, touch, dispose: () => { disposed = true; } };
}
