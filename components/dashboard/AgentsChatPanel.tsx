"use client";

import { plainError } from "@/lib/plainError";
import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Plus, Zap, Users, Mail, FileText } from "lucide-react";
import { useToast } from "./Toast";
import { useProviders, findProviderForModel } from "@/lib/providers-store";

type SendOutcome = { status: string };
type LeadRef = { id: string; name?: string; company?: string; title?: string };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  action?: "search_leads" | "draft_email" | "send_email";
  data?: Record<string, unknown>;
};

type Agent = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  capabilities: string[];
};

const AGENTS: Agent[] = [
  {
    id: "lead-finder",
    name: "Lead Finder",
    description: "Search & discover leads by role, company, location",
    icon: <Users size={16} />,
    capabilities: ["Search leads", "Filter by criteria", "Export results"],
  },
  {
    id: "email-agent",
    name: "Email Agent",
    description: "Draft & send personalized emails to leads",
    icon: <Mail size={16} />,
    capabilities: ["Draft emails", "Merge tags", "Batch send", "Track replies"],
  },
  {
    id: "research-agent",
    name: "Research Agent",
    description: "Deep dive into lead companies & market research",
    icon: <FileText size={16} />,
    capabilities: ["Company research", "Market analysis", "Competitor intel"],
  },
];

function AgentSelector({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Agents
      </div>
      {AGENTS.map((agent) => (
        <button
          key={agent.id}
          onClick={() => onSelect(agent.id)}
          className={`w-full rounded-lg px-4 py-3 text-left text-[13px] transition-colors ${
            selected === agent.id
              ? "bg-blue-50 border border-blue-200"
              : "border border-gray-100 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className={selected === agent.id ? "text-blue-600" : "text-gray-400"}
            >
              {agent.icon}
            </span>
            <span
              className={
                selected === agent.id
                  ? "font-medium text-gray-900"
                  : "text-gray-600"
              }
            >
              {agent.name}
            </span>
          </div>
          <p className="text-[12px] text-gray-500 ml-6">{agent.description}</p>
        </button>
      ))}
    </div>
  );
}

function ChatMessages({
  messages,
  onSendEmail,
}: {
  messages: Message[];
  onSendEmail?: (data: Record<string, unknown>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <div>
          <Zap size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-[14px] font-medium text-gray-600">
            Select an agent to start
          </p>
          <p className="text-[13px] text-gray-500 mt-1">
            Choose from Lead Finder, Email Agent, or Research Agent
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 p-6">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-2xl rounded-lg px-4 py-2 text-[13px] ${
              msg.role === "user"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-900"
            }`}
          >
            {/* Render markdown-like content */}
            <div className="whitespace-pre-wrap">
              {msg.content.split("\n").map((line, i) => {
                if (line.startsWith("**") && line.endsWith("**")) {
                  return (
                    <div key={i} className="font-medium mt-2 mb-1">
                      {line.slice(2, -2)}
                    </div>
                  );
                }
                return (
                  <div key={i}>
                    {line}
                  </div>
                );
              })}
            </div>

            {/* Show send button for drafted emails */}
            {msg.action === "draft_email" && msg.data && onSendEmail && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => onSendEmail(msg.data!)}
                  className="rounded-lg bg-green-600 text-white px-3 py-1 text-[12px] hover:bg-green-700"
                >
                  Send Email
                </button>
                <button className="rounded-lg border border-gray-300 text-gray-700 px-3 py-1 text-[12px] hover:bg-gray-50">
                  Edit Template
                </button>
              </div>
            )}

            {msg.action && msg.action !== "draft_email" && (
              <div className="mt-2 text-[11px] opacity-75">
                {msg.action.replace(/_/g, " ")}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2 border-t border-gray-200 bg-white p-4">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask me to find leads, draft emails..."
        className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-[13px] focus:border-blue-400 focus:outline-none"
        disabled={disabled}
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className="flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {disabled ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      </button>
    </div>
  );
}

export default function AgentsChatPanel() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>("lead-finder");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const { show } = useToast();
  const { primaryModel } = useProviders();

  const handleSendEmail = async (data: Record<string, unknown>) => {
    setSending(true);
    try {
      const template = (data.template as { subject: string; body: string }) || {};
      const leadIds = (
        (data.sampleLeads as Array<{ id: string }>) || []
      ).map((l) => l.id);

      if (!template.subject || !template.body || leadIds.length === 0) {
        show("Missing template or lead data");
        return;
      }

      const res = await fetch("/api/agents/leads/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds,
          subject: template.subject,
          body: template.body,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to send emails");
      }

      const result = await res.json();
      const sent = result.results.filter(
        (r: SendOutcome) => r.status === "sent"
      ).length;
      const failed = result.results.filter(
        (r: SendOutcome) => r.status === "failed"
      ).length;

      const statusMsg: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: `✅ **Emails Sent**\n\nSuccessfully sent: ${sent}\nFailed: ${failed}\n\nCheck your Gmail for sent messages.`,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, statusMsg]);
      show(`Sent ${sent} emails`);
    } catch (err) {
      console.error("Send emails failed", err);
      show(plainError(err, "Failed to send emails"));
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !selectedAgent || !primaryModel) {
      if (!primaryModel) show("No LLM provider connected");
      return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      let response: string;
      let action: Message["action"];
      let data: Record<string, unknown> | undefined;

      if (selectedAgent === "lead-finder") {
        // Query leads
        const res = await fetch("/api/agents/chat/query-leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: input,
            model: primaryModel,
            providerId: findProviderForModel(primaryModel),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to search leads");
        }

        const result = await res.json();
        data = result;

        response =
          result.leads.length > 0
            ? `Found ${result.leads.length} lead${result.leads.length !== 1 ? "s" : ""}:\n\n${result.leads
                .slice(0, 5)
                .map((l: LeadRef) => `• ${l.name} at ${l.company} (${l.title})`)
                .join("\n")}${result.leads.length > 5 ? `\n\n... and ${result.leads.length - 5} more` : ""}`
            : "No leads found matching your criteria.";

        action = "search_leads";
      } else if (selectedAgent === "email-agent") {
        // Draft email from context or input
        // Check if previous message had leads data
        const prevMsg = messages.filter((m) => m.role === "assistant").pop();
        const leads = (prevMsg?.data?.leads as Array<{ id: string }>) || [];

        if (leads.length === 0) {
          response = `I'll help you draft an email. First, search for leads using the Lead Finder agent, then ask me to draft an email for them.`;
          action = "draft_email";
        } else {
          // Draft email for found leads
          const providerId = findProviderForModel(primaryModel);
          const draftRes = await fetch("/api/agents/chat/draft-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              leadIds: leads.map((l: LeadRef) => l.id),
              context: input,
              tone: "professional",
              model: primaryModel,
              providerId,
            }),
          });

          if (!draftRes.ok) {
            throw new Error("Failed to draft email");
          }

          const draft = await draftRes.json();
          data = draft;

          response =
            `📧 **Email Template**\n\n` +
            `**Subject:** ${draft.template.subject}\n\n` +
            `**Body:**\n${draft.template.body}\n\n` +
            `Ready to send to ${draft.leadCount} leads? Say "send" to proceed.`;

          action = "draft_email";
        }
      } else if (selectedAgent === "research-agent") {
        // Research (placeholder)
        response = `I can help research companies and market trends. What would you like me to look into?`;
        action = undefined;
      } else {
        response = "Unknown agent";
      }

      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response,
        timestamp: new Date(),
        action,
        data,
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      console.error("Agent request failed", err);
      const errorMsg = plainError(err, "Failed to reach agent");
      show(errorMsg);

      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: ${errorMsg}`,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h2 className="text-[16px] font-semibold text-gray-900">Agents</h2>
          <p className="text-[12px] text-gray-500">
            {selectedAgent
              ? AGENTS.find((a) => a.id === selectedAgent)?.name
              : "No agent selected"}
          </p>
        </div>
        <button className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50">
          <Plus size={14} />
          New conversation
        </button>
      </div>

      {/* Content Grid */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Agent Selector */}
        <div className="w-64 border-r border-gray-200 overflow-y-auto bg-gray-50 p-3">
          <AgentSelector selected={selectedAgent} onSelect={setSelectedAgent} />
        </div>

        {/* Middle: Chat */}
        <div className="flex-1 flex flex-col min-h-0">
          <ChatMessages messages={messages} onSendEmail={handleSendEmail} />
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            disabled={sending}
          />
        </div>

        {/* Right: Preview/Info (optional, can be hidden) */}
        <div className="w-72 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto hidden lg:block">
          <div className="text-[12px] text-gray-500">
            <p className="font-medium text-gray-600 mb-3">Agent Info</p>
            {selectedAgent && (
              <>
                <p className="mb-4">
                  {AGENTS.find((a) => a.id === selectedAgent)?.description}
                </p>
                <div>
                  <p className="font-medium text-gray-600 mb-2">Capabilities</p>
                  <ul className="space-y-1">
                    {AGENTS.find((a) => a.id === selectedAgent)?.capabilities.map(
                      (cap) => (
                        <li key={cap} className="flex items-center gap-2">
                          <span className="text-blue-500">✓</span>
                          {cap}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
