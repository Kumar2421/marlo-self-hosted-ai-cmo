"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, Loader2, Send, Wrench } from "lucide-react";
import type { Finding } from "@/lib/domain/findings/findingTypes";
import type { CmsChange, CmsField } from "@/lib/domain/cms/cmsFixCatalog";
import SidePanel from "@/components/shared/SidePanel";
import { useTerminalLog } from "@/lib/terminal-log-store";
import { useCmsFix, type PreparedCmsFix } from "./useCmsFix";

type AutoCmsFix = Extract<PreparedCmsFix, { mode: "auto" }>;

const box = "rounded-xl border border-gray-200 p-3";

const FIELD_LABEL: Record<CmsField, string> = {
  title: "Page title",
  meta_description: "Meta description",
  og_title: "Open Graph title",
  og_description: "Open Graph description",
  twitter_title: "Twitter card title",
  twitter_description: "Twitter card description",
  h1: "Main heading (H1)",
  canonical: "Canonical link",
  alt_text: "Image alt text",
};

function ChangeEditor({ change, onChange }: { change: CmsChange; onChange: (next: CmsChange) => void }) {
  const textarea = "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[12px] leading-5 text-gray-800 focus:border-gray-400 focus:outline-none";
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[12px]">
        <span className="font-medium text-gray-800">{FIELD_LABEL[change.field]}</span>
        {change.context && <span className="min-w-0 truncate text-[11px] text-gray-400">{change.context}</span>}
      </div>
      <div className="space-y-2 p-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Now</div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 font-sans text-[12px] leading-5 text-red-800">
            {change.before || "(empty)"}
          </pre>
        </div>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">New text (you can edit)</span>
          <textarea
            value={change.after}
            onChange={(e) => onChange({ ...change, after: e.target.value })}
            rows={Math.min(6, Math.max(2, Math.ceil(change.after.length / 70)))}
            spellCheck
            className={textarea}
          />
        </label>
      </div>
    </div>
  );
}

function PreviewPanel({ finding, fix, onClose, approve }: { finding: Finding; fix: AutoCmsFix; onClose: () => void; approve: ReturnType<typeof useCmsFix>["approve"] }) {
  const [changes, setChanges] = useState<CmsChange[]>(fix.changes);
  const { log, logDone } = useTerminalLog();
  const done = approve.data ?? null;
  const emptyEdit = changes.some((c) => !c.after.trim());

  const submit = () => {
    log(`Updating ${fix.cmsLabel} for ${finding.entityId}...`);
    approve.mutate(
      { ticket: fix.ticket, changes, edited: JSON.stringify(changes) !== JSON.stringify(fix.changes) },
      {
        onSuccess: (data) => logDone(`Applied fix: ${data.summary}.${data.tracked ? " Marlo is now measuring what it did." : ""}`),
        onError: (error) => logDone(`Couldn't update ${fix.cmsLabel}: ${error.message}`),
      },
    );
  };

  return createPortal(
    <SidePanel
      open
      onClose={onClose}
      title={`Fix in ${fix.cmsLabel}: ${fix.label}`}
      subtitle={<span>Preview for <span className="font-medium">{fix.item.title}</span>. Nothing has been changed yet.</span>}
      footer={
        done ? (
          <div className="space-y-2">
            {done.note && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{done.note}</div>}
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[12px] text-emerald-700"><Check size={14} /> Updated in {done.cmsLabel}</span>
              <a href={done.liveUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black">
                View page <ExternalLink size={12} />
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {approve.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{approve.error.message}</div>}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] leading-4 text-gray-500">Updates your {fix.cmsLabel} content directly. Disconnecting {fix.cmsLabel} in Settings stops this immediately.</p>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={onClose} disabled={approve.isPending} className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" onClick={submit} disabled={approve.isPending || emptyEdit} className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50">
                  {approve.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Approve and publish
                </button>
              </div>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-3">
        <p className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] leading-5 text-gray-700">{fix.explanation}</p>
        {changes.map((change, index) => (
          <ChangeEditor key={`${change.field}-${change.target ?? ""}`} change={change} onChange={(next) => setChanges((prev) => prev.map((c, i) => (i === index ? next : c)))} />
        ))}
        {fix.unsupported.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-4 text-amber-800" data-testid="cms-unsupported">
            <div className="mb-1 font-semibold">Not changed</div>
            <ul className="space-y-1">
              {fix.unsupported.map((u) => (
                <li key={u.field}>
                  <span className="font-medium">{FIELD_LABEL[u.field as CmsField] ?? u.field}:</span> {u.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SidePanel>,
    document.body,
  );
}

/** "Fix in your CMS": prepare a previewed fix, then approve it to update the CMS directly. */
export default function FindingCmsFix({ finding, cms, cmsLabel, label }: { finding: Finding; cms: "wordpress" | "webflow"; cmsLabel: string; label: string }) {
  const { prepare, approve, hasModel } = useCmsFix(finding.id);
  const [fix, setFix] = useState<AutoCmsFix | null>(null);
  const { log, logDone } = useTerminalLog();

  const runPrepare = () => {
    log(`Reading ${cmsLabel} to prepare: ${label}...`);
    prepare.mutate(cms, {
      onSuccess: (data) => {
        if (data.mode === "auto") {
          logDone(`Prepared a fix for ${label}. Review it before anything is changed.`);
          setFix(data);
        } else logDone("This one needs a manual change.");
      },
      onError: (error) => logDone(`Couldn't prepare a fix: ${error.message}`),
    });
  };

  return (
    <div className={box} data-testid="cmsfix-ready">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-gray-900">Fix in {cmsLabel}: {label}</div>
          <p className="mt-0.5 text-[11px] leading-4 text-gray-500">Marlo drafts the copy, shows you the before and after, and updates {cmsLabel} only after you approve.</p>
        </div>
        <button
          type="button"
          onClick={runPrepare}
          disabled={prepare.isPending || !hasModel}
          title={hasModel ? undefined : "Select a model in Settings first"}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {prepare.isPending ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
          {prepare.isPending ? "Preparing..." : "Prepare fix"}
        </button>
      </div>
      {!hasModel && <p className="mt-2 text-[11px] text-amber-700">Select a model in Settings to prepare fixes.</p>}
      {prepare.error && <p className="mt-2 text-[11px] text-red-600">{prepare.error.message}</p>}
      {fix && <PreviewPanel finding={finding} fix={fix} approve={approve} onClose={() => { setFix(null); approve.reset(); }} />}
    </div>
  );
}

/** Shown when no CMS is connected (or the connected one can't apply this fix). */
export function CmsConnectPrompt({ note }: { note?: string }) {
  return (
    <div className={`${box} flex flex-wrap items-center justify-between gap-3`} data-testid="cmsfix-connect">
      <p className="min-w-0 flex-1 text-[12px] leading-5 text-gray-700">
        {note ?? "Or connect your CMS (WordPress or Webflow) to let Marlo update titles, descriptions and alt text directly, after you approve a preview."}
      </p>
      <a href="/settings/integrations" className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-800 hover:bg-gray-50">
        Connect your CMS
      </a>
    </div>
  );
}
