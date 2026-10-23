"use client";

import { useEffect, useState } from "react";
import { Loader2, Code2, ExternalLink, Check } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useTerminalLog } from "@/lib/terminal-log-store";
import type { Finding } from "@/lib/domain/seo/SEOAgent";
import type { ProposedFix } from "@/lib/domain/codefix/types";
import { CloseButton } from "@/components/shared/CloseButton";
import { useModal } from "@/components/shared/useModal";

export default function CodeFixModal({
  finding,
  onClose,
  onApplied,
}: {
  finding: Finding;
  onClose: () => void;
  onApplied: (issueId: string, prUrl: string) => void;
}) {
  const { show } = useToast();
  const { primaryModel } = useProviders();
  const { log, logDone } = useTerminalLog();
  const [proposing, setProposing] = useState(true);
  const [applying, setApplying] = useState(false);
  const [proposed, setProposed] = useState<ProposedFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  useEffect(() => {
    const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
    if (!primaryModel || !providerId) {
      setError("Select a model first — connect a provider in Settings → LLM Providers.");
      setProposing(false);
      return;
    }

    log(`Looking for the file that renders ${finding.label.toLowerCase()}...`);
    fetch("/api/agents/codefix/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueId: finding.issueId, model: primaryModel, providerId }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? "Failed to draft a fix.");
          logDone(`⚠ ${data.error ?? "Failed to draft a fix."}`);
          return;
        }
        setProposed(data.proposed);
        logDone(`Found ${data.proposed.filePath} — drafted a fix.`);
      })
      .catch(() => {
        setError("Failed to draft a fix.");
        logDone("⚠ Failed to draft a fix.");
      })
      .finally(() => setProposing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleApply() {
    if (!proposed) return;
    const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
    if (!primaryModel || !providerId) return;

    setApplying(true);
    log(`Opening a draft PR for ${finding.label.toLowerCase()}...`);
    try {
      const res = await fetch("/api/agents/codefix/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: finding.issueId, proposed, model: primaryModel, providerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.error ?? "Failed to open PR.");
        logDone(`⚠ ${data.error ?? "Failed to open PR."}`);
        return;
      }
      setPrUrl(data.prUrl);
      logDone(`PR opened: ${data.prUrl}`);
      onApplied(finding.issueId, data.prUrl);
    } catch {
      show("Failed to open PR.");
      logDone("⚠ Failed to open PR.");
    } finally {
      setApplying(false);
    }
  }

  const { backdropProps, panelProps } = useModal(onClose, "Fix in code", { closeOnBackdrop: false });
  return (
    <div {...backdropProps} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div {...panelProps} className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-gray-900">
            <Code2 size={15} className="text-gray-500" /> Fix in code — {finding.label}
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="okara-scroll flex-1 space-y-3 overflow-y-auto p-4">
          {proposing ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-gray-500">
              <Loader2 className="animate-spin text-gray-400 mb-2" size={22} />
              <p className="text-sm">Reading the repo and drafting a fix...</p>
            </div>
          ) : error ? (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>
          ) : prUrl ? (
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e6f7f4] text-[#00846f]">
                <Check size={18} />
              </span>
              <p className="text-[13px] text-gray-700">Draft PR opened — review and merge on GitHub when ready.</p>
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black"
              >
                Open PR <ExternalLink size={12} />
              </a>
            </div>
          ) : proposed ? (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
                <span className="font-medium text-gray-800">{proposed.filePath}</span>
              </div>
              <p className="text-[12px] text-gray-500">{proposed.explanation}</p>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="border-b border-red-100 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-800 whitespace-pre-wrap">
                  − {proposed.oldSnippet}
                </div>
                <div className="bg-green-50 px-3 py-2 font-mono text-[12px] text-green-800 whitespace-pre-wrap">
                  + {proposed.newSnippet}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {proposed && !prUrl && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 p-3">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applying}
              className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              {applying ? <Loader2 size={13} className="animate-spin" /> : <Code2 size={13} />}
              {applying ? "Opening PR..." : "Open draft PR"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
