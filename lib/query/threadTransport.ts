import type { StoredMessage, ThreadListItem } from "../domain/chat/threadListState.ts";

/** The one place the chat panel talks to /api/chat/threads. Every call is scoped to the project it is given. */
export type ListResult = { kind: "ok"; threads: ThreadListItem[] } | { kind: "unavailable" } | { kind: "error" };
export type OpenResult = { kind: "ok"; messages: StoredMessage[] } | { kind: "missing" } | { kind: "error" };

const q = (projectId: string) => `projectId=${encodeURIComponent(projectId)}`;

export async function fetchThreads(projectId: string, signal?: AbortSignal): Promise<ListResult> {
  try {
    const res = await fetch(`/api/chat/threads?${q(projectId)}`, { signal });
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as { available?: boolean; threads?: ThreadListItem[] };
    if (data.available === false) return { kind: "unavailable" };
    return { kind: "ok", threads: Array.isArray(data.threads) ? data.threads : [] };
  } catch {
    return { kind: "error" };
  }
}

export async function fetchThreadMessages(projectId: string, id: string, signal?: AbortSignal): Promise<OpenResult> {
  try {
    const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}?${q(projectId)}`, { signal });
    if (res.status === 404) return { kind: "missing" };
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as { messages?: StoredMessage[] };
    return { kind: "ok", messages: Array.isArray(data.messages) ? data.messages : [] };
  } catch {
    return { kind: "error" };
  }
}

/** true = deleted (or already gone). */
export async function removeThread(projectId: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}?${q(projectId)}`, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export async function removeAllThreads(projectId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/chat/threads", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, projectId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
