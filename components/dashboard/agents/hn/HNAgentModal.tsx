"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";
import { CloseButton } from "@/components/shared/CloseButton";
import { useModal } from "@/components/shared/useModal";

/** LLM output isn't guaranteed to be "title on line 1, body after" — models
 * sometimes prefix a "Title:" label, or leave a blank line first. Handle those
 * cases instead of blindly trusting line 0, and never save an empty title. */
function parseHnDraft(raw: string): { title: string; body: string } {
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  let titleLine = lines[i] ?? "";
  titleLine = titleLine.replace(/^(title|show hn|ask hn)\s*:\s*/i, "").trim();

  const body = lines
    .slice(i + 1)
    .join("\n")
    .trim();

  return {
    title: titleLine || "Untitled draft",
    body: body || raw.trim(),
  };
}

export default function HNAgentModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [highlights, setHighlights] = useState("");
  
  const [draft, setDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { primaryModel } = useProviders();
  const { show } = useToast();

  const handleGenerate = async () => {
    if (!description || !highlights) {
      show("Please fill out all fields.");
      return;
    }

    if (!primaryModel) {
      show("No primary model selected. Please configure LLM Providers in Settings.");
      return;
    }

    const providerId = findProviderForModel(primaryModel);
    if (!providerId) {
      show("Could not determine provider for the selected model.");
      return;
    }

    setIsGenerating(true);
    setDraft("");

    try {
      const res = await fetch("/api/agents/hn/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          highlights,
          model: primaryModel,
          providerId,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        show(errorData.error || "Generation failed.");
        setIsGenerating(false);
        return;
      }

      if (!res.body) {
        show("No response body received.");
        setIsGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let finalContent = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          finalContent += chunk;
          setDraft((prev) => prev + chunk);
        }
      }

      setIsSaving(true);

      const { title, body } = parseHnDraft(finalContent);

      const saveRes = await fetch("/api/agents/hn/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          title,
          body,
          status: "ready",
        }),
      });

      if (!saveRes.ok) {
        const errorData = await saveRes.json().catch(() => ({}));
        show(errorData.error || "Draft generated but failed to save. Copy it before closing.");
      }
    } catch {
      show("An error occurred during generation.");
    } finally {
      setIsGenerating(false);
      setIsSaving(false);
    }
  };

  const { backdropProps, panelProps } = useModal(onClose, "Hacker News Agent", { open: isOpen });

  if (!isOpen) return null;

  return (
    <div {...backdropProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div {...panelProps} className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Hacker News Agent</h2>
          <CloseButton onClick={onClose} />
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Settings Sidebar */}
          <div className="w-80 border-r border-gray-200 bg-gray-50 p-6 overflow-y-auto">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Product Description</label>
                <textarea
                  placeholder="e.g. Marlo is an AI-powered content marketing platform..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black h-32 resize-none"
                />
              </div>
              
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Technical Highlights</label>
                <textarea
                  placeholder="e.g. Next.js 14, Turso SQLite, local persistent agents..."
                  value={highlights}
                  onChange={(e) => setHighlights(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black h-32 resize-none"
                />
              </div>

              <div className="pt-4">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-[#ff6600] px-4 py-2 text-sm font-medium text-white hover:bg-[#e55c00] disabled:opacity-70"
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <span className="font-bold border px-1">Y</span>}
                  {isGenerating ? "Drafting..." : "Generate HN Post"}
                </button>
              </div>
            </div>
          </div>

          {/* Preview Area */}
          <div className="flex-1 bg-white p-6 overflow-y-auto">
            {draft ? (
              <div className="prose prose-sm max-w-none text-gray-800">
                <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{draft}</div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={24} className="animate-spin text-gray-400" />
                    <p>Channeling Paul Graham and drafting your Show HN...</p>
                  </div>
                ) : (
                  <p>Fill out your product details on the left and click Generate.</p>
                )}
              </div>
            )}
            
            {isSaving && (
              <div className="mt-4 text-xs text-green-600 flex items-center justify-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Saving draft...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
