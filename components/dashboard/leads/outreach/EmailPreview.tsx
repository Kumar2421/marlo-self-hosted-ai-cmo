"use client";

import { useId, useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { renderOutreachEmail, type OutreachSender } from "@/lib/domain/leads/outreachEmail";
import type { OutreachTemplateId } from "@/lib/domain/leads/outreachContract";
import { FOCUS_RING } from "@/components/ui/variants";
import { leadLabel, type LeadLite } from "./ui";

type Props = {
  templateId: OutreachTemplateId;
  subject: string;
  body: string;
  /** Leads that will actually be emailed. The preview is rendered for one of them. */
  sampleLeads: LeadLite[];
  sender: OutreachSender;
  compact?: boolean;
};

const SEG = `${FOCUS_RING} inline-flex h-11 items-center gap-1.5 px-3 text-xs font-medium sm:h-8`;

/**
 * Exactly what will be sent: the same renderer the server uses, shown in a sandboxed iframe. `sandbox=""` turns on every
 * restriction (no scripts, no same-origin, no forms, no top navigation), so nothing in the email can run or reach the app.
 * The unsubscribe link here is a placeholder.
 */
export function EmailPreview({ templateId, subject, body, sampleLeads, sender, compact }: Props) {
  const [leadId, setLeadId] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [view, setView] = useState<"email" | "text">("email");
  const selectId = useId();

  const lead = sampleLeads.find((l) => l.id === leadId) ?? sampleLeads[0];
  const rendered = useMemo(
    () => renderOutreachEmail({ templateId, subject, body, lead: lead ?? {}, sender, unsubscribeUrl: null }),
    [templateId, subject, body, lead, sender],
  );

  if (!lead) {
    return <p className="rounded-lg border border-dashed border-gray-200 p-4 text-[13px] text-gray-500">No one to preview yet.</p>;
  }

  const empty = !subject.trim() && !body.trim();

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="email-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Preview format" className="inline-flex overflow-hidden rounded-lg border border-gray-200">
          {(["email", "text"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`${SEG} ${view === v ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              {v === "email" ? "Email" : "Plain text"}
            </button>
          ))}
        </div>
        {view === "email" && (
          <div role="group" aria-label="Preview width" className="inline-flex overflow-hidden rounded-lg border border-gray-200">
            <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={`${SEG} ${device === "desktop" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              <Monitor size={13} aria-hidden="true" /> Desktop
            </button>
            <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={`${SEG} ${device === "mobile" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              <Smartphone size={13} aria-hidden="true" /> Mobile
            </button>
          </div>
        )}
      </div>

      {sampleLeads.length > 1 && (
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className="shrink-0 text-xs text-gray-500">
            Previewing for
          </label>
          <select
            id={selectId}
            value={lead.id}
            onChange={(e) => setLeadId(e.target.value)}
            className={`${FOCUS_RING} h-11 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-[13px] text-gray-800 sm:h-9`}
          >
            {sampleLeads.slice(0, 25).map((l) => (
              <option key={l.id} value={l.id}>
                {leadLabel(l)}
                {l.company && l.name ? `, ${l.company}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
        <div className="border-b border-gray-200 px-3 py-2">
          <div className="text-xs text-gray-500">Subject</div>
          <div className="break-words text-[13px] font-medium text-gray-900" data-testid="preview-subject">
            {rendered.subject || <span className="text-gray-400">(no subject yet)</span>}
          </div>
        </div>
        {view === "email" ? (
          <div className="flex justify-center bg-gray-100 p-2">
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={rendered.html}
              data-testid="preview-frame"
              className={`${compact ? "h-72" : "h-96"} rounded-md bg-white transition-[width] ${device === "mobile" ? "w-[375px] max-w-full" : "w-full"}`}
            />
          </div>
        ) : (
          <pre
            tabIndex={0}
            data-testid="preview-text"
            className={`${FOCUS_RING} okara-scroll ${compact ? "max-h-72" : "max-h-96"} overflow-auto whitespace-pre-wrap break-words bg-white p-3 font-mono text-xs leading-5 text-gray-700`}
          >
            {rendered.text}
          </pre>
        )}
      </div>
      {empty ? (
        <p className="text-xs text-gray-500">Start writing and the preview fills in.</p>
      ) : (
        <p className="text-xs text-gray-500">The unsubscribe link here is a placeholder. Each real email gets its own working link.</p>
      )}
    </div>
  );
}
