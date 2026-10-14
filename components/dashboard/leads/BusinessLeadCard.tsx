"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Globe, Mail, MapPin, MessageCircle, Phone, Star, X } from "lucide-react";
import {
  STATUS_LABEL,
  LEAD_STATUSES,
  categoryFromQuery,
  emailLabel,
  enrichmentNote,
  leadChips,
  ratingLabel,
  statusFromTags,
  telLink,
  websiteHref,
  whatsappLink,
  type LeadChip,
  type LeadStatus,
} from "@/lib/domain/leads/local/businessLead";

export type BusinessLead = {
  id: string;
  name: string;
  query: string;
  location: string;
  email: string | null;
  email_quality?: string | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  rating?: number | null;
  review_count?: number | null;
  whatsapp?: string | null;
  contact_url?: string | null;
  description?: string | null;
  maps_url?: string | null;
  fit_reason?: string | null;
  enrichment_status?: string | null;
  tags?: string[] | null;
};

const ACTION =
  "inline-flex min-h-9 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50";

const CHIP_CLASS: Record<LeadChip["key"], string> = {
  phone: "bg-gray-100 text-gray-700",
  whatsapp: "bg-[#e6f7f4] text-[#00846f]",
  email: "bg-[#e6f7f4] text-[#00846f]",
  website: "bg-gray-100 text-gray-700",
  contact: "bg-gray-100 text-gray-700",
};

export default function BusinessLeadCard({
  lead,
  showStatus,
  canEmail,
  onRemove,
  onEmail,
  onStatusChange,
}: {
  lead: BusinessLead;
  /** The status control needs hosted storage, so self-host builds hide it. */
  showStatus: boolean;
  /** Sending needs a connected Gmail account. */
  canEmail: boolean;
  onRemove: (id: string) => void;
  onEmail: (lead: BusinessLead) => void;
  onStatusChange: (id: string, status: LeadStatus) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const status = statusFromTags(lead.tags);
  const wa = whatsappLink(lead.whatsapp);
  const tel = telLink(lead.phone);
  const site = websiteHref(lead.website);
  const contact = websiteHref(lead.contact_url);
  const maps = websiteHref(lead.maps_url);
  const rating = ratingLabel(lead.rating, lead.review_count);
  const note = enrichmentNote(lead.enrichment_status);
  const emailText = lead.email ? emailLabel(lead.email_quality) : null;
  const chips = leadChips(lead);
  const category = categoryFromQuery(lead.query);

  async function copyPhone() {
    if (!lead.phone) return;
    try {
      await navigator.clipboard.writeText(lead.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the number is still visible and selectable.
    }
  }

  async function changeStatus(next: LeadStatus) {
    setStatusBusy(true);
    try {
      await onStatusChange(lead.id, next);
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div className="group flex gap-2.5 rounded-xl border border-gray-200 bg-white p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-gray-900">{lead.name}</div>
            <div className="truncate text-[11px] text-gray-500">
              {[category, lead.location].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(lead.id)}
            aria-label={`Remove ${lead.name}`}
            title="Remove"
            className="flex h-9 w-9 shrink-0 items-center justify-center text-gray-400 hover:text-gray-700 md:opacity-0 md:group-hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>

        {lead.address && (
          <div className="mt-1 flex items-start gap-1 text-[11px] text-gray-500">
            <MapPin size={11} className="mt-0.5 shrink-0" />
            <span className="break-words">{lead.address}</span>
          </div>
        )}

        {rating && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-700">
            <Star size={11} className="fill-amber-400 text-amber-400" />
            {rating}
          </div>
        )}

        {lead.fit_reason && <p className="mt-1.5 text-[12px] leading-4 text-gray-700">{lead.fit_reason}</p>}
        {lead.description && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500">{lead.description}</p>}

        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span key={chip.key} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CHIP_CLASS[chip.key]}`}>
                {chip.label}
              </span>
            ))}
          </div>
        )}

        {lead.email && (
          <p className="mt-1.5 break-all text-[11px] text-gray-700">
            {lead.email}
            {emailText && <span className="text-gray-400"> · {emailText}</span>}
          </p>
        )}
        {note && <p className="mt-1 text-[11px] text-gray-400">{note}</p>}

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tel && (
            <a href={tel} className={ACTION}>
              <Phone size={12} /> Call
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={ACTION}>
              <MessageCircle size={12} /> WhatsApp
            </a>
          )}
          {lead.email && (
            <button
              type="button"
              onClick={() => onEmail(lead)}
              disabled={!canEmail}
              title={canEmail ? "Compose an outreach email" : "Connect Gmail above first"}
              className={`${ACTION} disabled:text-gray-400`}
            >
              <Mail size={12} /> Email
            </button>
          )}
          {site && (
            <a href={site} target="_blank" rel="noopener noreferrer" className={ACTION}>
              <Globe size={12} /> Website
            </a>
          )}
          {contact && (
            <a href={contact} target="_blank" rel="noopener noreferrer" className={ACTION}>
              <ExternalLink size={12} /> Contact page
            </a>
          )}
          {maps && (
            <a href={maps} target="_blank" rel="noopener noreferrer" className={ACTION}>
              <MapPin size={12} /> Open in Maps
            </a>
          )}
          {lead.phone && (
            <button type="button" onClick={copyPhone} className={ACTION}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy phone"}
            </button>
          )}
        </div>

        {showStatus && (
          <label className="mt-2.5 flex items-center gap-2 text-[11px] text-gray-500">
            Status
            <select
              value={status}
              disabled={statusBusy}
              onChange={(e) => changeStatus(e.target.value as LeadStatus)}
              className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[12px] text-gray-800 disabled:opacity-50"
            >
              {LEAD_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
