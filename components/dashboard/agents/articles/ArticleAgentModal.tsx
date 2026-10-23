"use client";

import { useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";
import { CloseButton } from "@/components/shared/CloseButton";
import { useModal } from "@/components/shared/useModal";

/** Splits the generator's `---\ntitle:...\ndescription:...\n---\n<body>` output
 * into its parts so the meta fields render like Marlo's SEO Health signal rows
 * instead of dumping raw frontmatter into the article preview. */
function parseArticle(raw: string) {
  const match = raw.match(/^---\s*\ntitle:\s*(.*)\ndescription:\s*(.*)\n---\s*\n([\s\S]*)$/);
  if (!match) return { title: null, description: null, body: raw };
  const [, title, description, body] = match;
  return { title: title.trim(), description: description.trim(), body: body.trim() };
}

function MetaRow({ label, value, max }: { label: string; value: string; max: number }) {
  const over = value.length > max;
  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${over ? "text-amber-600" : "text-emerald-600"}`}>
        {value.length} chars
      </span>
    </div>
  );
}

function ArticlePreview({ raw }: { raw: string }) {
  const { title, description, body } = useMemo(() => parseArticle(raw), [raw]);

  return (
    <div className="space-y-4">
      {(title || description) && (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-ui-subtle">SEO META</div>
          {title && (
            <div className="border-t border-gray-100 px-3 py-2.5">
              <div className="text-xs text-ui-subtle">Meta Title</div>
              <div className="text-[13px] text-gray-800">{title}</div>
            </div>
          )}
          {title && <MetaRow label="Title length" value={title} max={60} />}
          {description && (
            <div className="border-t border-gray-100 px-3 py-2.5">
              <div className="text-xs text-ui-subtle">Meta Description</div>
              <div className="text-[13px] text-gray-800">{description}</div>
            </div>
          )}
          {description && <MetaRow label="Description length" value={description} max={160} />}
        </div>
      )}
      <div className="prose prose-sm max-w-none text-gray-800">
        <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

export default function ArticleAgentModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [brandVoice, setBrandVoice] = useState("Professional and authoritative");
  
  const [draft, setDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedArticleId, setSavedArticleId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<"wordpress" | "github" | null>(null);
  const [publishResult, setPublishResult] = useState<{ kind: "wordpress" | "github"; url: string } | null>(null);

  const { primaryModel } = useProviders();
  const { show } = useToast();

  async function handlePublish(target: "wordpress" | "github") {
    if (!savedArticleId) return;
    setPublishing(target);
    try {
      const res = await fetch(`/api/agents/articles/publish/${target}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: savedArticleId }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.error || `Failed to publish to ${target === "wordpress" ? "WordPress" : "GitHub"}.`);
        return;
      }
      const url = target === "wordpress" ? data.publishedUrl : data.prUrl;
      setPublishResult({ kind: target, url });
      show(target === "wordpress" ? "Published to WordPress." : "Pull request opened.");
    } catch {
      show(`Failed to publish to ${target === "wordpress" ? "WordPress" : "GitHub"}.`);
    } finally {
      setPublishing(null);
    }
  }

  const handleGenerate = async () => {
    if (!topic || !keywords || !brandVoice) {
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
    setSavedArticleId(null);
    setPublishResult(null);

    try {
      const res = await fetch("/api/agents/articles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          keywords,
          brandVoice,
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
      const newId = crypto.randomUUID();
      const { title: parsedTitle } = parseArticle(finalContent);
      const saveRes = await fetch("/api/agents/articles/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newId,
          topic,
          keywords,
          brandVoice,
          content: finalContent,
          title: parsedTitle ?? topic,
        }),
      });
      if (saveRes.ok) setSavedArticleId(newId);

    } catch (err) {
      show("An error occurred during generation.");
    } finally {
      setIsGenerating(false);
      setIsSaving(false);
    }
  };

  const { backdropProps, panelProps } = useModal(onClose, "Articles Agent", { open: isOpen });

  if (!isOpen) return null;

  return (
    <div {...backdropProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div {...panelProps} className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Articles Agent</h2>
          <CloseButton onClick={onClose} />
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Settings Sidebar */}
          <div className="w-80 border-r border-gray-200 bg-gray-50 p-6 overflow-y-auto">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Topic</label>
                <input
                  type="text"
                  placeholder="e.g. Benefits of Automated Invoicing"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                />
              </div>
              
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Keywords (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. b2b saas, billing, automation"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Brand Voice</label>
                <select
                  value={brandVoice}
                  onChange={(e) => setBrandVoice(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                >
                  <option>Professional and authoritative</option>
                  <option>Conversational and friendly</option>
                  <option>Technical and precise</option>
                  <option>Witty and engaging</option>
                </select>
              </div>

              <div className="pt-4">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-70"
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : "📝"}
                  {isGenerating ? "Generating..." : "Generate Article"}
                </button>
              </div>
            </div>
          </div>

          {/* Preview Area */}
          <div className="flex-1 bg-white p-6 overflow-y-auto">
            {draft ? (
              <ArticlePreview raw={draft} />
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={24} className="animate-spin text-ui-faint" />
                    <p>Drafting your article based on the latest SEO best practices...</p>
                  </div>
                ) : (
                  <p>Fill out the parameters on the left and click Generate.</p>
                )}
              </div>
            )}
            
            {isSaving && (
              <div className="mt-4 text-xs text-green-600 flex items-center justify-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Saving draft...
              </div>
            )}

            {savedArticleId && !isSaving && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                <button
                  onClick={() => handlePublish("wordpress")}
                  disabled={publishing !== null}
                  className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {publishing === "wordpress" && <Loader2 size={12} className="animate-spin" />}
                  Publish to WordPress
                </button>
                <button
                  onClick={() => handlePublish("github")}
                  disabled={publishing !== null}
                  className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {publishing === "github" && <Loader2 size={12} className="animate-spin" />}
                  Open GitHub PR
                </button>
                {publishResult && (
                  <a
                    href={publishResult.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-emerald-600 hover:underline"
                  >
                    {publishResult.kind === "wordpress" ? "View post" : "View PR"} ↗
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
