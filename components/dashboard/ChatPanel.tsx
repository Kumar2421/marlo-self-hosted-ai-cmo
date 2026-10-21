"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bot,
  Plus,
  Clock,
  MoreHorizontal,
  Search,
  Paperclip,
  AtSign,
  ArrowUp,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  MessageSquare,
  ChevronDown,
  Cpu,
} from "lucide-react";
import Link from "next/link";
import CollapsedRail, { RailButton } from "./CollapsedRail";
import { useToast } from "./Toast";
import { useProviders, findProviderForModel } from "@/lib/providers-store";

const SUGGESTED_PROMPTS = [
  "What should I fix first on my site?",
  "Summarise my SEO findings",
  "Draft a post about my latest feature",
];

type Msg = {
  role: "user" | "assistant";
  text: string;
  list?: string[];
  goodToKnow?: string[];
  footer?: string;
  /** Which stored data the answer looked at (from the chat tools). */
  lookedAt?: string[];
};

function ModelSelector() {
  const { connectedModels, primaryModel, setPrimaryModel } = useProviders();
  const [open, setOpen] = useState(false);

  const active = primaryModel && connectedModels.some((m) => m.model === primaryModel) ? primaryModel : null;

  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
      >
        <Cpu size={12} className="shrink-0 text-gray-400" />
        <span className="min-w-0 truncate">{active ?? (connectedModels.length ? "Select model" : "No model connected")}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute bottom-9 left-0 z-50 w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
          {connectedModels.length === 0 ? (
            <Link
              href="/settings/llm-providers"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-[13px] text-gray-600 hover:bg-gray-50"
            >
              Connect a provider to select a model →
            </Link>
          ) : (
            connectedModels.map((m) => (
              <button
                key={`${m.providerId}-${m.model}`}
                onClick={() => {
                  setPrimaryModel(m.model);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] ${
                  primaryModel === m.model ? "bg-gray-100 font-medium text-gray-900" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span>{m.model}</span>
                <span className="text-[11px] text-gray-400">{m.providerName}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();
  const { primaryModel } = useProviders();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
    if (!primaryModel || !providerId) {
      show("Select a model first — connect a provider in Settings → LLM Providers.");
      return;
    }

    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.text }));

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, model: primaryModel, providerId, history }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", text: `⚠ ${data.error ?? "Something went wrong."}` }]);
        return;
      }

      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.reply, lookedAt: Array.isArray(data.lookedAt) ? data.lookedAt : undefined },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "⚠ Couldn't reach the server. Check your connection and try again." },
      ]);
    } finally {
      setSending(false);
    }
  }

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

      <div className="dash-panel-header">
        <div className="dash-title">
          <Search size={13} className="shrink-0 text-gray-400" />
          <span className="min-w-0 truncate">mlforge studio</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />
          <button title="New chat" onClick={() => setMessages([])} className="hover:text-gray-700">
            <Plus size={14} />
          </button>
          <button title="History" className="hover:text-gray-700">
            <Clock size={14} />
          </button>
          <button title="Collapse" onClick={onToggle} className="hidden text-lg leading-none hover:text-gray-700 md:block">
            –
          </button>
          <MoreHorizontal size={14} className="cursor-pointer hover:text-gray-700" />
        </div>
      </div>

      <div ref={scrollRef} className="okara-scroll flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-xl bg-[#ecedef] px-3.5 py-2 text-[13px] text-gray-800">
                {msg.text}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-3 text-[13px] leading-relaxed text-gray-700">
              <p>{msg.text}</p>
              {msg.lookedAt && msg.lookedAt.length > 0 && (
                <p className="text-[11px] text-gray-400">Looked at: {msg.lookedAt.join(", ")}</p>
              )}
              {msg.list && (
                <ol className="list-decimal space-y-1.5 pl-5">
                  {msg.list.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ol>
              )}
              {msg.goodToKnow && (
                <>
                  <p className="font-semibold text-gray-900">Good to know:</p>
                  <ul className="list-disc space-y-1.5 pl-5">
                    {msg.goodToKnow.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {msg.footer && <p>{msg.footer}</p>}
              {i === messages.length - 1 && (
                <div className="flex items-center gap-3 pt-1 text-gray-400">
                  <Copy
                    size={13}
                    className="cursor-pointer hover:text-gray-600"
                    onClick={() => navigator.clipboard?.writeText(msg.text)}
                  />
                  <ThumbsUp size={13} className="cursor-pointer hover:text-gray-600" />
                  <ThumbsDown size={13} className="cursor-pointer hover:text-gray-600" />
                  <RotateCcw size={13} className="cursor-pointer hover:text-gray-600" />
                </div>
              )}
            </div>
          )
        )}
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="space-y-1">
              <p className="dash-title justify-center">How can I help today?</p>
              <p className="dash-meta text-gray-400">Ask about your site, your data or your content.</p>
            </div>
            <div className="flex w-full max-w-[260px] flex-col gap-1.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setInput(p);
                    inputRef.current?.focus();
                  }}
                  className="dash-focus dash-body min-h-9 rounded-lg border border-gray-200 px-3 py-1.5 text-left text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {sending && (
          <div className="flex items-center gap-1.5 text-[13px] text-gray-400">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-gray-200 bg-[#f9fafb] p-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm focus-within:border-gray-400">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask me anything..."
            className="mb-3 w-full bg-transparent text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3 text-gray-400">
              <ModelSelector />
              <Paperclip size={15} className="cursor-pointer hover:text-gray-600" />
              <AtSign size={15} className="cursor-pointer hover:text-gray-600" />
            </div>
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 enabled:hover:bg-gray-200 disabled:opacity-40"
            >
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
