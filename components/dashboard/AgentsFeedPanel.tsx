"use client";

import { useState } from "react";
import { Rss, Archive, Settings, Lock, ChevronDown } from "lucide-react";
import { agents } from "@/lib/mock-data";
import CollapsedRail, { RailButton } from "./CollapsedRail";
import { useToast } from "./Toast";
import ArticleAgentModal from "./agents/articles/ArticleAgentModal";
import HNAgentModal from "./agents/hn/HNAgentModal";
import RedditAgentModal from "./agents/reddit/RedditAgentModal";
import XWriterPanel from "./agents/x/XWriterPanel";
import LinkedInAgentModal from "./agents/linkedin/LinkedInAgentModal";
import GitHubAgentModal from "./agents/github/GitHubAgentModal";

const ICONS: Record<string, string> = {
  "x-influencer": "X",
  reddit: "🤖",
  geo: "◎",
  seo: "🌐",
  x: "X",
  articles: "📝",
  linkedin: "in",
  ugc: "▶",
  hn: "Y",
  github: "⌥",
};

export default function AgentsFeedPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const [activeModal, setActiveModal] = useState<"articles" | "seo" | "hn" | "reddit" | "x" | "linkedin" | "github" | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [archived, setArchived] = useState<string[]>([]);
  const { show } = useToast();

  const visibleAgents = agents.filter((a) => !archived.includes(a.id));

  if (!open) {
    return (
      <CollapsedRail onExpand={onToggle}>
        {visibleAgents.map((agent) => (
          <RailButton
            key={agent.id}
            icon={
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: agent.color }}
              >
                {ICONS[agent.icon]}
              </span>
            }
            label={agent.name.split(" ")[0]}
            onClick={onToggle}
          />
        ))}
      </CollapsedRail>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
          <button onClick={onToggle} title="Collapse" className="text-gray-500 hover:text-gray-700">
            <Rss size={15} />
          </button>
          Agents Feed
          <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />
        </div>
        <div className="flex items-center gap-3 text-ui-subtle">
          <button
            title="Archived"
            className="hover:text-gray-700"
            onClick={() => setArchived([])}
            disabled={archived.length === 0}
          >
            <Archive size={14} className={archived.length > 0 ? "text-gray-700" : ""} />
          </button>
          <Settings size={14} className="cursor-pointer hover:text-gray-700" />
        </div>
      </div>

      <div className="okara-scroll flex-1 overflow-y-auto">
        {visibleAgents.map((agent) => {
          const isExpanded = expandedId === agent.id;
          return (
            <div key={agent.id} className="border-b border-gray-100">
              <button
                onClick={() => setExpandedId(isExpanded ? null : agent.id)}
                className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-gray-50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                    style={{ backgroundColor: agent.color }}
                  >
                    {ICONS[agent.icon]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900">{agent.name}</div>
                    <div className="truncate text-[13px] text-gray-500">{agent.status}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {agent.locked && (
                    <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                      <Lock size={10} /> Upgrade
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className={`text-gray-300 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </div>
              </button>
              {isExpanded && (
                <div className="space-y-3 bg-gray-50 px-4 py-3 text-[13px] text-gray-600">
                  <p>
                    {agent.locked
                      ? "This agent is part of a paid plan. Upgrade to unlock automated suggestions and let it start working."
                      : "This agent is active and will surface new suggestions here as they become available."}
                  </p>
                  <div className="flex gap-2">
                    {agent.locked ? (
                      <button
                        onClick={() => show("Upgrade flow coming soon — this is a UI preview.")}
                        className="rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
                      >
                        Upgrade plan
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (agent.id === "articles") {
                            setActiveModal("articles");
                          } else if (agent.id === "hn") {
                            setActiveModal("hn");
                          } else if (agent.id === "reddit") {
                            setActiveModal("reddit");
                          } else if (agent.id === "x") {
                            setActiveModal("x");
                          } else if (agent.id === "linkedin") {
                            setActiveModal("linkedin");
                          } else if (agent.id === "github") {
                            setActiveModal("github");
                          } else if (agent.id === "seo") {
                            show("Click Analytics in the sidebar to view SEO findings.");
                          } else {
                            show(`Viewing details for ${agent.name}.`);
                          }
                        }}
                        className="rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
                      >
                        View details
                      </button>
                    )}
                    <button
                      onClick={() => setArchived((a) => [...a, agent.id])}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-100"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {visibleAgents.length === 0 && (
          <div className="p-6 text-center text-[13px] text-ui-subtle">
            All agents archived.{" "}
            <button className="text-gray-700 underline" onClick={() => setArchived([])}>
              Restore
            </button>
          </div>
        )}
      </div>

      {activeModal === "articles" && <ArticleAgentModal isOpen={true} onClose={() => setActiveModal(null)} />}
      {activeModal === "hn" && <HNAgentModal isOpen={true} onClose={() => setActiveModal(null)} />}
      {activeModal === "reddit" && <RedditAgentModal onClose={() => setActiveModal(null)} />}
      {activeModal === "x" && <XWriterPanel onClose={() => setActiveModal(null)} />}
      {activeModal === "linkedin" && <LinkedInAgentModal onClose={() => setActiveModal(null)} />}
      {activeModal === "github" && <GitHubAgentModal onClose={() => setActiveModal(null)} />}
    </div>
  );
}
