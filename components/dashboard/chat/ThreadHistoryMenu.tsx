"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { History, Plus, Trash2 } from "lucide-react";
import { relativeTime } from "@/lib/domain/chat/threadListState";
import type { ChatThreads } from "./useChatThreads";

const ITEM =
  "flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 md:min-h-9";

/**
 * History control for the chat header: a menu of saved chats with New chat, per-chat delete and Delete all (confirmed).
 * Renders nothing when the server has no chat history, so chat looks and works exactly as before.
 */
export default function ThreadHistoryMenu({ threads }: { threads: ChatThreads }) {
  const [open, setOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const items = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function close(returnFocus: boolean) {
    setOpen(false);
    setConfirmAll(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Click outside closes (focus stays where the user clicked).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Opening moves focus to the first item so the menu is keyboard-usable straight away.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  if (threads.status === "unavailable") return null;

  function onMenuKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
  }

  async function run(action: () => Promise<unknown>, closeAfter: boolean) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      if (closeAfter) close(true);
    }
  }

  const { status, threads: list, activeId } = threads;

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onBlur={(e) => {
        // Keyboard focus moved to something outside the control: close without stealing it back.
        if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        title="Chat history"
        aria-label="Chat history"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
        className="flex h-11 w-11 items-center justify-center hover:text-gray-700 md:h-6 md:w-6"
      >
        <History size={14} />
      </button>

      {open && (
        <div
          id={menuId}
          onKeyDown={onMenuKey}
          className="theme-follow absolute right-0 top-11 z-50 w-72 max-w-[calc(100vw-24px)] rounded-xl border border-gray-200 bg-white p-2 text-gray-900 shadow-xl md:top-8"
        >
          <div role="menu" aria-label="Chat history">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                threads.startNew();
                close(true);
              }}
              className={`${ITEM} font-medium`}
            >
              <Plus size={14} className="shrink-0 text-gray-500" aria-hidden="true" />
              New chat
            </button>

            {status === "loading" && (
              <p role="status" className="px-2.5 py-3 text-xs text-gray-500">Loading chats...</p>
            )}
            {status === "error" && (
              <div className="px-2.5 py-2 text-xs text-gray-600">
                <p>Couldn&apos;t load your chats.</p>
                <button type="button" role="menuitem" tabIndex={-1} onClick={threads.retry} className={`${ITEM} mt-1 font-medium underline`}>
                  Try again
                </button>
              </div>
            )}
            {status === "ready" && list.length === 0 && (
              <p className="px-2.5 py-3 text-xs text-gray-500">No saved chats yet. Your conversations will show up here.</p>
            )}

            {status === "ready" &&
              list.map((t) => (
                <div key={t.id} role="none" className="flex items-center gap-1">
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={busy}
                    aria-current={t.id === activeId ? "true" : undefined}
                    onClick={() => run(() => threads.open(t.id), true)}
                    className={`${ITEM} min-w-0 flex-1 ${t.id === activeId ? "bg-gray-50" : ""}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.title || "New chat"}</span>
                      <span className="block truncate text-xs text-gray-500">{relativeTime(t.updatedAt)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={busy}
                    aria-label={`Delete chat: ${t.title || "New chat"}`}
                    title="Delete chat"
                    onClick={() => run(() => threads.remove(t.id), false).then(() => requestAnimationFrame(() => items()[0]?.focus()))}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 md:h-9 md:w-9"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
          </div>

          {status === "ready" && list.length > 0 && (
            <>
              <div role="separator" className="my-2 border-t border-gray-100" />
              {confirmAll ? (
                <div role="group" aria-label="Confirm delete all chats" className="px-2.5 pb-1">
                  <p className="mb-2 text-xs text-gray-700">
                    Delete all {list.length} {list.length === 1 ? "chat" : "chats"} in this project? This can&apos;t be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmAll(false)}
                      className="min-h-11 flex-1 rounded-lg border border-gray-200 px-3 text-[13px] hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 md:min-h-9"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      autoFocus
                      onClick={() => run(() => threads.removeAll(), true)}
                      className="min-h-11 flex-1 rounded-lg bg-red-600 px-3 text-[13px] font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 md:min-h-9"
                    >
                      Delete all
                    </button>
                  </div>
                </div>
              ) : (
                <div role="menu" aria-label="Manage chats">
                  <button type="button" role="menuitem" tabIndex={-1} onClick={() => setConfirmAll(true)} className={`${ITEM} text-red-600`}>
                    <Trash2 size={14} className="shrink-0" aria-hidden="true" />
                    Delete all chats
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
