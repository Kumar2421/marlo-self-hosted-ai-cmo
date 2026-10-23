"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { CloseButton } from "@/components/shared/CloseButton";
import { useModal } from "@/components/shared/useModal";

type Lead = { id: string; name: string; company: string; title: string; email: string | null };

export default function ComposeEmailModal({
  leads,
  onClose,
  onSent,
  initialSubject,
  initialBody,
}: {
  leads: Lead[];
  onClose: () => void;
  onSent: (results: { id: string; status: "sent" | "failed"; error?: string }[]) => void;
  /** Pre-fills from a real drafted follow-up (Leads → reply → "Draft
   * follow-up") — still a draft the user must review/edit before sending,
   * same as a blank compose. */
  initialSubject?: string;
  initialBody?: string;
}) {
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withEmail = leads.filter((l) => l.email);
  const previewLead = withEmail[0];

  function merge(template: string, lead?: Lead): string {
    if (!lead) return template;
    return template.replaceAll("{{name}}", lead.name || "").replaceAll("{{company}}", lead.company || "").replaceAll("{{title}}", lead.title || "");
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body are required.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/leads/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: withEmail.map((l) => l.id), subject, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send.");
        return;
      }
      onSent(data.results);
      onClose();
    } catch {
      setError("Failed to send.");
    } finally {
      setSending(false);
    }
  }

  const { backdropProps, panelProps } = useModal(onClose, "Compose email", { closeOnBackdrop: false });
  return (
    <div {...backdropProps} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div {...panelProps} className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <div className="text-[14px] font-semibold text-gray-900">
            Compose — {withEmail.length} recipient{withEmail.length === 1 ? "" : "s"}
            {leads.length !== withEmail.length && (
              <span className="ml-1 font-normal text-amber-600">({leads.length - withEmail.length} skipped, no email)</span>
            )}
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="okara-scroll flex-1 space-y-3 overflow-y-auto p-4">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}

          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-700">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick question about {{company}}"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-700">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder={"Hi {{name}},\n\n..."}
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Merge tags: <code className="rounded bg-gray-100 px-1">{"{{name}}"}</code>{" "}
              <code className="rounded bg-gray-100 px-1">{"{{company}}"}</code>{" "}
              <code className="rounded bg-gray-100 px-1">{"{{title}}"}</code>
            </p>
          </div>

          {previewLead && (subject || body) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Preview — {previewLead.name}
              </div>
              <div className="text-[13px] font-medium text-gray-900">{merge(subject, previewLead)}</div>
              <div className="mt-1 whitespace-pre-wrap text-[12px] text-gray-600">{merge(body, previewLead)}</div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 p-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || withEmail.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {sending ? "Sending..." : `Send to ${withEmail.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
