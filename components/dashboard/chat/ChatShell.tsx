"use client";

import type { ReactNode } from "react";
import { Plus, Search, MessageSquare } from "lucide-react";
import CollapsedRail, { RailButton } from "../CollapsedRail";
import UnlockPanel from "../UnlockPanel";

/** Panel chrome only: collapsed rail, unlock slot, header. Children are the body (list + composer). */
export default function ChatShell({
  open,
  onToggle,
  title,
  onNewChat,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  onNewChat: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return (
      <CollapsedRail onExpand={onToggle} dark>
        <RailButton
          icon={<MessageSquare size={15} className="text-white" />}
          label="Chat"
          onClick={onToggle}
        />
      </CollapsedRail>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <UnlockPanel />

      <div className="dash-panel-header">
        <h2 className="dash-title">
          <Search size={13} className="shrink-0 text-ui-faint" />
          <span className="min-w-0 truncate">{title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-3 text-ui-subtle">
          <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />
          <button title="New chat" aria-label="New chat" onClick={onNewChat} className="hover:text-gray-700">
            <Plus size={14} />
          </button>
          <button title="Collapse" onClick={onToggle} className="hidden text-lg leading-none hover:text-gray-700 md:block">
            –
          </button>
        </div>
      </div>

      {children}
    </div>
  );
}
