"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { FileText, Copy, Pencil, Download, ChevronsLeft, X, Loader2, RefreshCw } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";
import { useTerminalLog } from "@/lib/terminal-log-store";
import { assessGeneratedDocument } from "@/lib/domain/project/setupRun";
import { useDialog } from "@/components/shared/useDialog";

// No Tailwind Typography plugin in this project (nothing else here uses
// `prose`), so style each markdown element explicitly instead of relying on
// prose-* classes that silently do nothing without the plugin.
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-3 text-[17px] font-bold text-gray-900">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mb-2 mt-6 text-[15px] font-semibold text-gray-900 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-[14px] font-semibold text-gray-900">{children}</h3>,
  p: ({ children }) => <p className="mb-3 text-[13px] leading-relaxed text-gray-700">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-[13px] text-gray-700">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px] text-gray-700">{children}</ol>,
  li: ({ children }) => <li className="text-[13px] text-gray-700">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-gray-200 px-3 py-2 text-left text-[11px] font-semibold text-gray-500">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-gray-100 px-3 py-2 align-top text-gray-700">{children}</td>,
};

export type DocumentPanelProps = {
  /** Display title in the panel header + empty/generate-button copy. */
  title: string;
  /** e.g. "product-info" — used to build /api/project/documents/<apiPath> and /save. */
  apiPath: string;
  /** Filename for the Download button, without extension. */
  downloadName: string;
  onClose: () => void;
};

/** Generic slide-over for any AI-generated strategy document (Product
 * Information, Marketing Strategy, Competitor Analysis, ...) — load existing,
 * generate (streamed) + auto-save, inline edit, copy/download. All 3
 * generate/[apiPath]/route.ts + save routes follow the same shape, so one
 * component drives all of them instead of copy-pasting per document. */
export default function DocumentPanel({ title, apiPath, downloadName, onClose }: DocumentPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  // Text of a generation in progress. The saved `content` stays on screen
  // until the new stream completes AND saves, so a failed run loses nothing.
  const [streamText, setStreamText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const { primaryModel } = useProviders();
  const { show } = useToast();
  const { log, logDone } = useTerminalLog();
  const titleId = useId();

  const base = `/api/project/documents/${apiPath}`;

  const loadExisting = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A failed load is not "no document yet": say so and offer a retry.
        setLoadError(data.error || `Couldn't load ${title} (HTTP ${res.status}).`);
        return;
      }
      setLoadError(null);
      if (data.document?.content) setContent(data.document.content);
    } catch {
      setLoadError(`Couldn't reach the server to load ${title}.`);
    } finally {
      setLoading(false);
    }
  }, [base, title]);

  useEffect(() => {
    // Fetch-on-mount: setState runs after an await, not synchronously (pre-existing; surfaced by touching this file).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadExisting();
  }, [loadExisting]);

  async function handleGenerate() {
    if (!primaryModel) {
      show("No primary model selected. Configure LLM Providers in Settings.");
      return;
    }
    const providerId = findProviderForModel(primaryModel);
    if (!providerId) {
      show("Could not determine provider for the selected model.");
      return;
    }

    if (
      content &&
      !window.confirm(`Regenerate ${title}? This replaces the saved version, including any edits you made. The old version is kept if generation fails.`)
    ) {
      return;
    }

    setGenerating(true);
    setStreamText("");
    log(`Generating ${title} with ${primaryModel}...`);

    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: primaryModel, providerId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errText = data.error || `Failed to generate ${title}.`;
        log(`⚠ ${errText}`);
        show(errText);
        return;
      }

      // A non-streaming route answers JSON ({ text }) and saves it itself.
      if ((res.headers.get("content-type") ?? "").includes("application/json")) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.text === "string" && data.text.trim()) {
          setContent(data.text);
          logDone(`${title} saved.`);
          show(`${title} saved.`);
        } else {
          show(`${title} came back empty — your previous version was kept.`);
        }
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let finalContent = "";
      let loggedFirstToken = false;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!loggedFirstToken) {
            log(`${title}: model is writing...`);
            loggedFirstToken = true;
          }
          const chunk = decoder.decode(value, { stream: true });
          finalContent += chunk;
          setStreamText((prev) => (prev ?? "") + chunk);
        }
      }

      // Empty or cut-off output must never replace a saved document.
      const check = assessGeneratedDocument(finalContent);
      if (!check.ok) {
        const msg = `${title} wasn't saved: ${check.reason}.${content ? " Your previous version was kept." : ""}`;
        log(`⚠ ${msg}`);
        show(msg);
        return;
      }

      const saveRes = await fetch(`${base}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: finalContent }),
      });
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        const msg = `${title} was generated but couldn't be saved (${data.error ?? `HTTP ${saveRes.status}`}).${content ? " Your previous version was kept." : ""}`;
        log(`⚠ ${msg}`);
        show(msg);
        return;
      }
      setContent(finalContent);
      logDone(`${title} saved.`);
      show(`${title} saved.`);
    } catch (err) {
      const errText = err instanceof Error ? err.message : `Failed to generate ${title}.`;
      log(`⚠ ${errText}`);
      show(`Failed to generate ${title}.${content ? " Your previous version was kept." : ""}`);
    } finally {
      setStreamText(null);
      setGenerating(false);
    }
  }

  async function handleSaveEdit() {
    try {
      const res = await fetch(`${base}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setContent(draft);
      setEditing(false);
      show("Changes saved.");
    } catch {
      show("Failed to save changes.");
    }
  }

  // While a new version streams in, show it; otherwise the saved one.
  const shown = streamText ? streamText : content;
  const dirty = editing && content !== null && draft !== content;

  function handleClose() {
    if (dirty && !window.confirm("You have unsaved changes. Close and discard them?")) return;
    onClose();
  }

  // Esc, focus-in and focus-return, same as the Findings drawer. Esc goes through handleClose so unsaved edits still ask first.
  const panelRef = useDialog<HTMLDivElement>(true, handleClose);

  function handleCopy() {
    if (content) navigator.clipboard?.writeText(content);
    show("Copied to clipboard.");
  }

  function handleDownload() {
    if (!content) return;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${downloadName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={handleClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-2xl outline-none"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <div id={titleId} className="flex items-center gap-2 text-[14px] font-semibold text-gray-900">
            <FileText size={16} className="text-gray-500" />
            {title}
          </div>
          <div className="flex items-center gap-3 text-gray-400">
            {content && (
              <>
                <button onClick={handleCopy} title="Copy" className="hover:text-gray-700">
                  <Copy size={15} />
                </button>
                <button
                  onClick={() => {
                    setDraft(content);
                    setEditing((v) => !v);
                  }}
                  title="Edit"
                  className={editing ? "text-gray-900" : "hover:text-gray-700"}
                >
                  <Pencil size={15} />
                </button>
                <button onClick={handleDownload} title="Download" className="hover:text-gray-700">
                  <Download size={15} />
                </button>
              </>
            )}
            <button onClick={handleClose} title="Collapse" className="hover:text-gray-700">
              <ChevronsLeft size={16} />
            </button>
            <button onClick={handleClose} title="Close" className="hover:text-gray-700">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="okara-scroll flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center gap-2 text-[13px] text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-full min-h-[60vh] w-full resize-none rounded-lg border border-gray-200 p-3 font-mono text-[13px] text-gray-800 outline-none focus:border-black"
            />
          ) : loadError && !content ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <FileText size={28} className="text-gray-300" />
              <p className="text-[14px] font-medium text-gray-900">Couldn&apos;t load {title}</p>
              <p className="max-w-xs text-[13px] text-gray-500">{loadError}</p>
              <button
                onClick={loadExisting}
                className="mt-2 flex items-center gap-2 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black"
              >
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : shown ? (
            <article className="max-w-none text-[13px] leading-relaxed text-gray-700">
              <ReactMarkdown components={MARKDOWN_COMPONENTS}>{shown}</ReactMarkdown>
            </article>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <FileText size={28} className="text-gray-300" />
              <p className="text-[14px] font-medium text-gray-900">No {title} yet</p>
              <p className="max-w-xs text-[13px] text-gray-500">
                Generate this from your crawled website — grounded in what&apos;s actually
                there, not guesses.
              </p>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="mt-2 flex items-center gap-2 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
              >
                {generating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                {generating ? "Generating..." : `Generate ${title}`}
              </button>
            </div>
          )}

          {generating && shown && (
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-gray-400">
              <Loader2 size={11} className="animate-spin" /> Writing...
            </p>
          )}
        </div>

        {editing && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 p-3">
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              className="rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black"
            >
              Save
            </button>
          </div>
        )}

        {!editing && content && (
          <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-4 py-2.5 text-[11px] text-gray-400">
            <span>Generated from your crawled website — regenerate anytime.</span>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1 text-gray-500 hover:text-gray-800 disabled:opacity-50"
            >
              <RefreshCw size={11} className={generating ? "animate-spin" : ""} /> Regenerate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
