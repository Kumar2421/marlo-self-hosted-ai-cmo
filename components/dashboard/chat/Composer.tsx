"use client";

import type { Ref } from "react";
import { ArrowUp } from "lucide-react";
import ChatUsageMeter from "./ChatUsageMeter";

export default function Composer({
  value,
  onChange,
  onSend,
  pending,
  notice,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  pending: boolean;
  /** Optional amber hint above the box (limited-data notice). */
  notice?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="shrink-0 border-t border-gray-200 bg-[#f9fafb] p-3">
      {notice && <p className="mb-2 px-1 text-xs text-amber-600">{notice}</p>}
      <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm focus-within:border-gray-400">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask me anything..."
          aria-label="Message to Marlo"
          className="mb-3 w-full bg-transparent text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <div className="min-w-0" />
          <button
            onClick={onSend}
            disabled={!value.trim() || pending}
            aria-label="Send message"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-ui-muted enabled:hover:bg-gray-200 disabled:opacity-40"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
      <ChatUsageMeter />
    </div>
  );
}
