"use client";

import { useState } from "react";
import { Loader2, PenTool, CheckCircle, MessageSquare } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { CloseButton } from "@/components/shared/CloseButton";
import { useModal } from "@/components/shared/useModal";

export default function XAgentModal({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState("");
  const [brandVoice, setBrandVoice] = useState("Bold, concise, and developer-focused");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const { show } = useToast();
  const { primaryModel } = useProviders();

  const handleGenerate = async () => {
    if (!topic.trim()) {
      show("Please enter a topic first.");
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
    setDraft("");

    try {
      const res = await fetch("/api/agents/x/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, brandVoice, model: primaryModel, providerId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        show(data.error || "Failed to generate thread.");
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");

      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setDraft((prev) => prev + chunk);
      }
    } catch {
      show("Failed to generate thread.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/agents/x/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, content: draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        show(data.error || "Failed to save draft.");
        return;
      }
      setSaved(true);
      show("Draft saved successfully");
    } catch {
      show("Failed to save draft");
    } finally {
      setSaving(false);
    }
  };

  const { backdropProps, panelProps } = useModal(onClose, "X (Twitter) Agent");
  return (
    <div {...backdropProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div {...panelProps} className="flex h-[80vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#111111] text-white">
              <MessageSquare size={16} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-gray-900">X (Twitter) Agent</h2>
              <p className="text-[12px] text-gray-500">Draft engaging threads and tweets</p>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="flex flex-1 overflow-hidden bg-gray-50/50">
          {/* Left Panel - Inputs */}
          <div className="w-1/3 border-r border-gray-100 bg-white p-5 flex flex-col gap-4 overflow-y-auto">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Topic</label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-2 text-[13px] outline-none focus:border-black min-h-[80px]"
                placeholder="Why Next.js app router is perfect for B2B dashboards..."
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
              disabled={loading || !topic}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-black py-2 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <PenTool size={16} />}
              {loading ? "Drafting..." : "Draft Thread"}
            </button>
          </div>

          {/* Right Panel - Results */}
          <div className="flex-1 overflow-y-auto p-5">
            {!draft && !loading && (
              <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
                <MessageSquare size={32} className="mb-3 text-gray-300" />
                <p className="text-[14px] font-medium text-gray-900">No draft yet</p>
                <p className="text-[13px]">Enter a topic and click Draft Thread</p>
              </div>
            )}
            
            {draft && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col h-full">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 text-[12px] font-semibold text-gray-600">
                  Draft Content
                </div>
                <textarea 
                  className="w-full flex-1 bg-white p-4 text-[14px] text-gray-800 outline-none resize-none font-mono"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 bg-white p-4">
          <div className="text-[13px] text-gray-500">
            {loading ? "Generating..." : draft ? "Draft ready for review" : "Ready"}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={!draft || saving || saved}
              className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              {saved ? "Saved" : "Save Draft"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
