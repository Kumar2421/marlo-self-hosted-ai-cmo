"use client";

import { useRef } from "react";
import { findProviderForModel } from "@/lib/providers-store";
import { limitedDataNotice } from "@/lib/llm/capabilities";
import ChatShell from "./chat/ChatShell";
import MessageList from "./chat/MessageList";
import EmptyState from "./chat/EmptyState";
import Composer from "./chat/Composer";
import { useChatSession } from "./chat/useChatSession";

export default function ChatPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { messages, pending, input, setInput, send, retry, resetChat, projectName, primaryModel } = useChatSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const dataNotice = limitedDataNotice(primaryModel ? findProviderForModel(primaryModel) : null);

  return (
    <ChatShell open={open} onToggle={onToggle} title={projectName ?? "Chat"} onNewChat={resetChat}>
      <MessageList
        messages={messages}
        pending={pending}
        onRetry={retry}
        empty={
          <EmptyState
            onPick={(p) => {
              setInput(p);
              inputRef.current?.focus();
            }}
          />
        }
      />
      <Composer value={input} onChange={setInput} onSend={send} pending={pending} notice={dataNotice} inputRef={inputRef} />
    </ChatShell>
  );
}
