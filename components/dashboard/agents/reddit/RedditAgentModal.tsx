"use client";

import { useState } from "react";
import { X, Loader2, Search, CheckCircle, MessageSquare, AlertTriangle } from "lucide-react";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";

interface RedditOpportunity {
  id: string;
  subreddit: string;
  title: string;
  body: string;
  reply_draft: string;
}

export default function RedditAgentModal({ onClose }: { onClose: () => void }) {
  const [subreddits, setSubreddits] = useState("reactjs, webdev");
  const [keywords, setKeywords] = useState("seo, performance, tooling");
  const [brandVoice, setBrandVoice] = useState("Helpful, technical, non-promotional");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opportunities, setOpportunities] = useState<RedditOpportunity[]>([]);
  const [saved, setSaved] = useState(false);
  const [usedMockThreads, setUsedMockThreads] = useState(false);

  const { primaryModel } = useProviders();
  const { show } = useToast();

  const handleGenerate = async () => {
    if (!keywords.trim() || !brandVoice.trim()) {
      show("Please fill out keywords and brand voice.");
      return;
    }

    if (!primaryModel) {
      show("No primary model selected. Configure LLM Providers in Settings.");
      return;
    }

    const providerId = findProviderForModel(primaryModel);
    if (!providerId) {
      show("Could not determine provider for the selected model.");
      return;
    }

    setLoading(true);
    setSaved(false);
    try {
      const res = await fetch("/api/agents/reddit/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subreddits, keywords, brandVoice, model: primaryModel, providerId }),
      });

      const data = await res.json();
      if (!res.ok) {
        show(data.error || "Failed to find opportunities.");
        return;
      }

      setOpportunities(data.opportunities ?? []);
      setUsedMockThreads(!!data.usedMockThreads);
    } catch {
      show("An error occurred while finding opportunities.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!opportunities.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/agents/reddit/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunities }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        show(data.error || "Failed to save opportunities.");
        return;
      }
      setSaved(true);
      show("Opportunities saved.");
    } catch {
      show("Failed to save opportunities.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex h-[90vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF4500] text-white">
              <MessageSquare size={16} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-gray-900">Reddit Agent</h2>
              <p className="text-[12px] text-gray-500">Find and engage with high-intent discussions</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100 text-ui-muted">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden bg-gray-50/50">
          {/* Left Panel - Inputs */}
          <div className="w-1/3 border-r border-gray-100 bg-white p-5 flex flex-col gap-4 overflow-y-auto">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Target Subreddits (comma separated)</label>
              <input
                type="text"
                value={subreddits}
                onChange={(e) => setSubreddits(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-2 text-[13px] outline-none focus:border-black"
                placeholder="reactjs, webdev"
              />
            </div>
            
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Keywords to look for</label>
              <input
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-2 text-[13px] outline-none focus:border-black"
                placeholder="seo, nextjs, routing"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Brand Voice</label>
              <textarea
                value={brandVoice}
                onChange={(e) => setBrandVoice(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-2 text-[13px] outline-none focus:border-black min-h-[80px]"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-black py-2 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {loading ? "Scanning Reddit..." : "Find Opportunities"}
            </button>
          </div>

          {/* Right Panel - Results */}
          <div className="flex-1 overflow-y-auto p-5">
            {opportunities.length === 0 && !loading && (
              <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
                <MessageSquare size={32} className="mb-3 text-gray-300" />
                <p className="text-[14px] font-medium text-gray-900">No opportunities yet</p>
                <p className="text-[13px]">Configure your settings and click Find Opportunities</p>
              </div>
            )}
            
            {loading && (
              <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
                <Loader2 size={32} className="mb-3 animate-spin text-[#FF4500]" />
                <p className="text-[14px] font-medium text-gray-900">Analyzing Subreddits</p>
                <p className="text-[13px]">Finding relevant threads and drafting replies...</p>
              </div>
            )}

            {!loading && opportunities.length > 0 && (
              <div className="flex flex-col gap-4">
                {usedMockThreads && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      No Reddit account connected — these are <strong>sample threads</strong>, not real
                      live Reddit posts. Connect Reddit in Settings → Integrations for real opportunities.
                    </span>
                  </div>
                )}
                {opportunities.map((opp, idx) => (
                  <div key={idx} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-bold text-[#FF4500] mb-1">{opp.subreddit}</div>
                    <h3 className="text-[14px] font-semibold text-gray-900 mb-1">{opp.title}</h3>
                    <p className="text-[12px] text-gray-500 mb-3 line-clamp-2">{opp.body}</p>
                    
                    <div className="rounded-lg bg-gray-50 p-3 border border-gray-100">
                      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Draft Reply</div>
                      <textarea 
                        className="w-full bg-transparent text-[13px] text-gray-800 outline-none resize-none min-h-[80px]"
                        value={opp.reply_draft}
                        onChange={(e) => {
                          const updated = [...opportunities];
                          updated[idx].reply_draft = e.target.value;
                          setOpportunities(updated);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 bg-white p-4">
          <div className="text-[13px] text-gray-500">
            {opportunities.length > 0 ? `Found ${opportunities.length} opportunities` : "Ready"}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={opportunities.length === 0 || saving || saved}
              className="flex items-center gap-1.5 rounded-lg bg-[#FF4500] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#E03D00] disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              {saved ? "Saved" : "Approve & Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
