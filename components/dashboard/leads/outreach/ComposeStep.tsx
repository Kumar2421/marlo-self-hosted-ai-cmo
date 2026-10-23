"use client";

import { useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send } from "lucide-react";
import type { OutreachSender } from "@/lib/domain/leads/outreachEmail";
import type { OutreachTemplateId } from "@/lib/domain/leads/outreachContract";
import {
  MERGE_TAGS,
  SUBJECT_SOFT_LIMIT,
  blankTagCount,
  bodyWarnings,
  insertAtCursor,
  subjectWarnings,
  type SenderProfile,
} from "@/lib/domain/leads/outreachCompose";
import { FOCUS_RING } from "@/components/ui/variants";
import { EmailPreview } from "./EmailPreview";
import { TemplatePicker } from "./TemplatePicker";
import { BTN_SECONDARY, FIELD, LABEL, type LeadLite } from "./ui";

export type TestResult = { kind: "ok" | "error"; message: string } | null;

type Props = {
  subject: string;
  body: string;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  templateId: OutreachTemplateId;
  onTemplate: (id: OutreachTemplateId) => void;
  sender: OutreachSender;
  senderProfile: SenderProfile;
  onSenderProfile: (patch: Partial<SenderProfile>) => void;
  sampleLeads: LeadLite[];
  onSendTest: () => void;
  testing: boolean;
  testResult: TestResult;
  canTest: boolean;
  errorMessage: string | null;
};

type Field = "subject" | "body";

export function ComposeStep(p: Props) {
  const [mobileTab, setMobileTab] = useState<"write" | "preview">("write");
  const [lastField, setLastField] = useState<Field>("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const ids = { subject: useId(), body: useId(), warn: useId(), tags: useId() };

  const warnings = subjectWarnings(p.subject, p.sampleLeads[0]);
  const bodyWarn = bodyWarnings(p.body);
  const blanks = blankTagCount(`${p.subject}\n${p.body}`, p.sampleLeads);

  function insertTag(tag: string) {
    const field = lastField;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    if (!el) return;
    const current = field === "subject" ? p.subject : p.body;
    const { text, cursor } = insertAtCursor(current, tag, el.selectionStart, el.selectionEnd);
    (field === "subject" ? p.onSubject : p.onBody)(text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  const tabBtn = (id: "write" | "preview", label: string) => (
    <button
      type="button"
      role="tab"
      id={`outreach-tab-${id}`}
      aria-selected={mobileTab === id}
      aria-controls={`outreach-pane-${id}`}
      onClick={() => setMobileTab(id)}
      className={`${FOCUS_RING} h-11 flex-1 border-b-2 text-[13px] font-medium ${mobileTab === id ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {p.errorMessage && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{p.errorMessage}</span>
        </div>
      )}

      <div role="tablist" aria-label="Write or preview" className="flex border-b border-gray-200 lg:hidden">
        {tabBtn("write", "Write")}
        {tabBtn("preview", "Preview")}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div id="outreach-pane-write" role="tabpanel" aria-labelledby="outreach-tab-write" className={`${mobileTab === "preview" ? "max-lg:hidden" : ""} min-w-0 space-y-4`}>
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label htmlFor={ids.subject} className="text-xs font-medium text-gray-700">
                Subject
              </label>
              <span className={`text-xs ${p.subject.trim().length > SUBJECT_SOFT_LIMIT ? "text-amber-700" : "text-gray-500"}`}>
                {p.subject.trim().length}/{SUBJECT_SOFT_LIMIT}
              </span>
            </div>
            <input
              id={ids.subject}
              ref={subjectRef}
              value={p.subject}
              onChange={(e) => p.onSubject(e.target.value)}
              onFocus={() => setLastField("subject")}
              placeholder="Quick question about {{company}}"
              aria-describedby={warnings.length ? ids.warn : undefined}
              className={`${FIELD} h-11 sm:h-9`}
            />
            {warnings.length > 0 && (
              <ul id={ids.warn} className="mt-1.5 space-y-1" data-testid="subject-warnings">
                {warnings.map((w) => (
                  <li key={w.id} className="flex items-start gap-1.5 text-xs text-amber-800">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {w.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label htmlFor={ids.body} className={LABEL}>
              Message
            </label>
            <textarea
              id={ids.body}
              ref={bodyRef}
              value={p.body}
              onChange={(e) => p.onBody(e.target.value)}
              onFocus={() => setLastField("body")}
              rows={9}
              placeholder={"Hi {{name}},\n\n..."}
              className={`${FIELD} resize-y py-2 leading-5`}
            />
            {bodyWarn.map((w) => (
              <p key={w.id} className="mt-1 text-xs text-amber-800">
                {w.message}
              </p>
            ))}
            <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-labelledby={ids.tags}>
              <span id={ids.tags} className="text-xs text-gray-500">
                Insert into {lastField === "subject" ? "subject" : "message"}:
              </span>
              {MERGE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertTag(tag)}
                  aria-label={`Insert ${tag.slice(2, -2)} merge tag`}
                  className={`${FOCUS_RING} inline-flex h-11 items-center rounded-md border border-gray-200 bg-gray-50 px-2.5 font-mono text-xs text-gray-700 hover:bg-gray-100 sm:h-8`}
                >
                  {tag}
                </button>
              ))}
            </div>
            {blanks > 0 && (
              <p className="mt-1.5 text-xs text-gray-500">
                {blanks} recipient{blanks === 1 ? " has" : "s have"} no value for a merge tag you used, so it will be left blank for them.
              </p>
            )}
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-gray-700">Template</legend>
            <TemplatePicker value={p.templateId} onChange={p.onTemplate} />
          </fieldset>

          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-medium text-gray-700">Your sign-off</legend>
            <p className="mb-2 text-xs text-gray-500">Saved in this browser only. Shown in the sign-off and footer of the preview.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <SenderField label="Name" value={p.senderProfile.name} onChange={(v) => p.onSenderProfile({ name: v })} autoComplete="name" />
              <SenderField label="Company" value={p.senderProfile.company} onChange={(v) => p.onSenderProfile({ company: v })} autoComplete="organization" />
              <div className="sm:col-span-2">
                <SenderField label="Postal address (optional)" value={p.senderProfile.address} onChange={(v) => p.onSenderProfile({ address: v })} autoComplete="street-address" />
              </div>
            </div>
          </fieldset>
        </div>

        <div id="outreach-pane-preview" role="tabpanel" aria-labelledby="outreach-tab-preview" className={`${mobileTab === "write" ? "max-lg:hidden" : ""} min-w-0 space-y-3 lg:sticky lg:top-0 lg:self-start`}>
          <h3 className="hidden text-xs font-semibold uppercase tracking-wide text-gray-500 lg:block">Preview</h3>
          <EmailPreview templateId={p.templateId} subject={p.subject} body={p.body} sampleLeads={p.sampleLeads} sender={p.sender} compact />
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs text-gray-500">Send one copy to your own inbox first. It does not count toward your limit.</p>
              <button type="button" onClick={p.onSendTest} disabled={!p.canTest || p.testing} className={BTN_SECONDARY} data-testid="send-test">
                {p.testing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
                {p.testing ? "Sending test..." : "Send test to me"}
              </button>
            </div>
            <div aria-live="polite" className="empty:hidden">
              {p.testResult && (
                <p
                  data-testid="test-result"
                  className={`mt-2 flex items-start gap-1.5 text-xs ${p.testResult.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}
                >
                  {p.testResult.kind === "ok" ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />}
                  {p.testResult.message}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SenderField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} maxLength={200} className={`${FIELD} h-11 sm:h-9`} />
    </div>
  );
}
