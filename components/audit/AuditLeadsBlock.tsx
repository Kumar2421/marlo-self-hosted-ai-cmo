"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readOwnerToken } from "./ShareBar";
import { trackAuditEvent } from "./trackAuditEvent";
import type { PublicLead } from "@/lib/domain/seo/publicReportShared";

const CHANNEL_LABEL: Record<PublicLead["channels"][number], string> = {
  email: "Email found",
  whatsapp: "WhatsApp found",
  form: "Contact form",
};

type Phase = "idle" | "loading" | "error";

/**
 * Under an audit: businesses that may need what the audited site sells. Anyone with the link sees the saved list;
 * only the browser that ran the audit can start the lookup. Contact details are never on the page: they come with
 * a free account.
 */
export default function AuditLeadsBlock({
  reportId,
  initialLeads,
  enabled,
  signupUrl,
}: {
  reportId: string;
  initialLeads: PublicLead[] | null;
  enabled: boolean;
  signupUrl: string;
}) {
  const [leads, setLeads] = useState<PublicLead[] | null>(initialLeads);
  const [reason, setReason] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(readOwnerToken(reportId));
  }, [reportId]);

  async function find() {
    if (!token || phase === "loading") return;
    setPhase("loading");
    setError("");
    try {
      const res = await fetch(`/api/public/audit/report/${reportId}/leads`, { method: "POST", headers: { "x-report-token": token } });
      const data = (await res.json().catch(() => ({}))) as { leads?: PublicLead[]; reason?: string | null; error?: string };
      if (!res.ok || !data.leads) throw new Error(data.error || "Could not look for businesses just now. Try again.");
      setLeads(data.leads);
      setReason(data.reason ?? null);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not look for businesses just now. Try again.");
      setPhase("error");
    }
  }

  // Nothing to show: no saved list, and either the feature is off or this is not the browser that ran the audit.
  if (leads === null && !(enabled && token)) return null;

  return (
    <section className="mt-8 rounded-xl border border-black/10 bg-white p-6" data-testid="audit-leads">
      <p className="text-xs font-semibold uppercase tracking-wider text-black/40">Who may need this</p>
      <h3 className="mt-2 text-lg font-medium">Businesses that may need what this site sells</h3>

      {leads === null && (
        <div className="mt-3">
          <p className="max-w-xl text-sm leading-6 text-black/55">
            Marlo reads the site, works out who would buy from it, and looks for businesses of that kind that show a way to contact them. This takes up to about 45 seconds.
          </p>
          <button
            type="button"
            onClick={find}
            disabled={phase === "loading"}
            className="mt-4 h-10 rounded-lg bg-[#111111] px-5 text-sm font-medium text-white disabled:opacity-60"
          >
            {phase === "loading" ? "Looking for businesses…" : "Find businesses"}
          </button>
          {phase === "error" && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}

      {leads !== null && leads.length === 0 && (
        <p className="mt-3 max-w-xl text-sm leading-6 text-black/55" data-testid="audit-leads-none">
          {reason === "no_business_buyers"
            ? "This site looks like it sells to consumers, so there is no list of businesses to show."
            : "No business that shows a way to contact it matched this site this time."}
        </p>
      )}

      {leads !== null && leads.length > 0 && (
        <>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {leads.map((lead) => (
              <li key={lead.host} className="rounded-lg border border-black/10 p-4" data-testid="audit-lead">
                <p className="font-medium">{lead.name}</p>
                <p className="text-xs text-black/40">{lead.host}</p>
                <p className="mt-2 text-sm leading-6 text-black/60">{lead.fitReason}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {lead.channels.map((c) => (
                    <span key={c} className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] text-black/60">
                      {CHANNEL_LABEL[c]}
                    </span>
                  ))}
                </div>
                <p className="mt-3 select-none text-xs text-black/35" aria-hidden="true">
                  ••••••@••••••.•••
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-3 rounded-lg bg-black/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-black/65">Their contact details and a draft message come with a free account.</p>
            <Link
              href={signupUrl}
              onClick={() => trackAuditEvent({ event: "signup_cta_clicked" })}
              className="shrink-0 rounded-lg bg-[#111111] px-4 py-2 text-sm font-medium text-white"
            >
              See their contact details
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
