"use client";

import { useRef, useEffect, type ReactNode } from "react";
import type { ChatMsg } from "@/lib/domain/chat/chatSessionState";
import MessageBubble from "./MessageBubble";

export default function MessageList({
  messages,
  pending,
  empty,
}: {
  messages: ChatMsg[];
  pending: boolean;
  /** Shown when there are no messages. */
  empty?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div ref={scrollRef} className="okara-scroll flex-1 space-y-4 overflow-y-auto p-4">
      {messages.map((msg, i) => (
        <MessageBubble key={i} msg={msg} isLast={i === messages.length - 1} />
      ))}
      {messages.length === 0 && empty}
      {pending && (
        <div className="flex items-center gap-1.5 text-[13px] text-ui-subtle">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
        </div>
      )}
    </div>
  );
}
