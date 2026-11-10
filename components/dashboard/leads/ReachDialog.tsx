"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Mail, MessageCircle, RotateCcw } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { channelLabel, leadQualification } from "@/lib/domain/leads/leadListView";
import type { Channel } from "@/lib/domain/leads/qualify";
import { REACH_LIMITS, buildReachMessage, linkedInProfileUrl, waLink, type ReachChannel, type ReachLead } from "@/lib/domain/leads/reach";
import { useSenderProfile } from "./outreach/useSenderProfile";

export type ReachableLead = ReachLead & {
  id: string;
  email: string | null;
  email_verified?: number | boolean | null;
  email_quality?: string | null;
  whatsapp?: string | null;
  source_url: string | null;
  fit_reason?: string | null;
};

const ACTION_CLASS =
  "flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] px-3 text-[13px] font-medium text-white hover:bg-black md:min-h-9";

/**
 * Reach one lead on a channel they can be reached on. WhatsApp and LinkedIn are never sent by Marlo: the user gets
 * an editable draft and sends it from their own account. Email hands over to the existing outreach composer.
 */
export default function ReachDialog({
  lead,
  projectName,
  offer,
  onClose,
  onWriteEmail,
  onMarkContacted,
  contacted,
}: {
  lead: ReachableLead;
  projectName: string;
  offer?: { sells?: string; whoPays?: string } | null;
  onClose: () => void;
  onWriteEmail: () => void;
  /** Hosted accounts only; omitted where lead status cannot be saved. */
  onMarkContacted?: () => Promise<void>;
  contacted?: boolean;
}) {
  const channels = leadQualification(lead).channels;
  const [sender] = useSenderProfile();
  const [channel, setChannel] = useState<Channel>(channels[0] ?? "email");
  const [drafts, setDrafts] = useState<Partial<Record<ReachChannel, string>>>({});
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [marking, setMarking] = useState(false);

  const ctx = { lead, sender, projectName, offer };
  const draftFor = (c: ReachChannel) => drafts[c] ?? buildReachMessage(c, ctx);
  const text = channel === "email" ? "" : draftFor(channel);
  const limit = channel === "email" ? 0 : REACH_LIMITS[channel];
  const over = channel !== "email" && text.length > limit;

  const waHref = channel === "whatsapp" ? waLink(lead.whatsapp, text) : null;
  const liUrl = channel === "linkedin" ? linkedInProfileUrl(lead.source_url) : null;

  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    if (liUrl) window.open(liUrl, "_blank", "noopener,noreferrer");
    setOpened(true);
  }

  async function mark() {
    if (!onMarkContacted) return;
    setMarking(true);
    try {
      await onMarkContacted();
    } finally {
      setMarking(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`Reach ${lead.name}`} description="Marlo writes a draft. You send it from your own account, so nothing goes out without you." size="md">
        <div className="space-y-3 px-4 pb-4">
          {channels.length > 1 && (
            <SegmentedTabs
              items={channels}
              value={channel}
              onChange={(c) => {
                setChannel(c);
                setCopied(false);
                setOpened(false);
              }}
              aria-label="Channel"
              idPrefix="reach-channel-"
              panelId="reach-panel"
            />
          )}

          <div id="reach-panel" role="tabpanel" aria-label={channelLabel(channel)} className="space-y-3">
            {channel === "email" ? (
              <>
                <p className="text-[13px] leading-5 text-ui-muted">
                  Email goes through your connected Gmail with the daily limit, unsubscribe link and repeat checks already in place.
                </p>
                <button type="button" onClick={onWriteEmail} className={ACTION_CLASS}>
                  <Mail size={14} /> Write an email
                </button>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-xs font-semibold tracking-wide text-ui-subtle uppercase">
                    Message
                    <button
                      type="button"
                      onClick={() => setDrafts((d) => ({ ...d, [channel]: undefined }))}
                      className="flex items-center gap-1 font-medium normal-case text-ui-muted hover:text-ui-text"
                    >
                      <RotateCcw size={11} /> Reset
                    </button>
                  </span>
                  <textarea
                    value={text}
                    onChange={(e) => setDrafts((d) => ({ ...d, [channel]: e.target.value }))}
                    rows={7}
                    className="w-full resize-y rounded-lg border border-ui-border bg-ui-surface px-2.5 py-2 text-[13px] leading-5 text-ui-text"
                    data-testid="reach-message"
                  />
                  <span className={`mt-1 block text-right text-xs ${over ? "text-red-600" : "text-ui-subtle"}`} data-testid="reach-count">
                    {text.length} / {limit}
                    {over && channel === "linkedin" ? " — LinkedIn trims notes over 300" : ""}
                  </span>
                </label>

                {channel === "whatsapp" && waHref && (
                  <a href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className={ACTION_CLASS}>
                    <MessageCircle size={14} /> Open WhatsApp
                  </a>
                )}
                {channel === "linkedin" && liUrl && (
                  <button type="button" onClick={copyAndOpen} className={ACTION_CLASS}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied. Opening LinkedIn" : "Copy message and open LinkedIn"}
                    <ExternalLink size={12} />
                  </button>
                )}
              </>
            )}
          </div>

          {contacted ? (
            <p className="text-xs text-ui-subtle" data-testid="reach-contacted">Marked as contacted.</p>
          ) : (
            opened &&
            onMarkContacted && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-ui-border bg-ui-surface-sunken px-3 py-2">
                <span className="text-xs text-ui-muted">Sent it? Mark as contacted so you don&apos;t reach them twice.</span>
                <button
                  type="button"
                  onClick={mark}
                  disabled={marking}
                  className="shrink-0 rounded-lg border border-ui-border bg-ui-surface px-2.5 py-1 text-xs font-medium text-ui-text hover:bg-ui-surface-sunken disabled:opacity-50"
                >
                  {marking ? "Saving..." : "Mark as contacted"}
                </button>
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
