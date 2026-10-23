"use client";

import { useState } from "react";
import { Loader2, CheckCircle, Briefcase } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { CloseButton } from "@/components/shared/CloseButton";
import { useModal } from "@/components/shared/useModal";

export default function LinkedInAgentModal({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState("");
  const [brandVoice, setBrandVoice] = useState("Insightful, personal, founder-voice");
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
      const res = await fetch("/api/agents/linkedin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, brandVoice, model: primaryModel, providerId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        show(data.error || "Failed to generate post.");
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setDraft((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch {
      show("Failed to generate post.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/agents/linkedin/save", {
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
      show("Draft saved.");
    } catch {
      show("Failed to save draft.");
    } finally {
      setSaving(false);
    }
  };

  const { backdropProps, panelProps } = useModal(onClose, "LinkedIn Agent");
  return (
    <div {...backdropProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div {...panelProps} className="flex h-[80vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0a66c2] text-white">
              <Briefcase size={16} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-gray-900">LinkedIn Agent</h2>
              <p className="text-[12px] text-gray-500">Draft long-form posts for B2B positioning</p>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="flex flex-1 overflow-hidden bg-gray-50/50">
          <div className="flex w-1/3 flex-col gap-4 overflow-y-auto border-r border-gray-100 bg-white p-5">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Topic</label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="min-h-[80px] w-full rounded-lg border border-gray-200 p-2 text-[13px] outline-none focus:border-black"
                placeholder="A lesson from building an invoice automation tool..."
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Brand Voice</label>
              <textarea
                value={brandVoice}
                onChange={(e) => setBrandVoice(e.target.value)}
                className="min-h-[80px] w-full rounded-lg border border-gray-200 p-2 text-[13px] outline-none focus:border-black"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !topic}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#0a66c2] py-2 text-[13px] font-medium text-white hover:bg-[#084d92] disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Briefcase size={16} />}
              {loading ? "Drafting..." : "Draft Post"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {!draft && !loading && (
              <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
                <Briefcase size={32} className="mb-3 text-gray-300" />
                <p className="text-[14px] font-medium text-gray-900">No draft yet</p>
                <p className="text-[13px]">Enter a topic and click Draft Post</p>
              </div>
            )}

            {draft && (
              <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-[12px] font-semibold text-gray-600">
                  Draft Content
                </div>
                <textarea
                  className="w-full flex-1 resize-none bg-white p-4 text-[14px] text-gray-800 outline-none"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-white p-4">
          <div className="text-[13px] text-gray-500">
            {loading ? "Generating..." : draft ? "Draft ready for review" : "Ready"}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={!draft || saving || saved}
              className="flex items-center gap-1.5 rounded-lg bg-[#0a66c2] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#084d92] disabled:opacity-50"
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
