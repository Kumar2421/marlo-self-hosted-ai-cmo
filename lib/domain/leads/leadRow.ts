import type { ExtractedLead } from "./LeadsAgent.ts";

/**
 * The columns every person-lead save path writes, in one place so manual search, auto-generation and the
 * SQLite path cannot drift. `emailGuessed` stays false unless a guessed address was deliberately kept.
 */
export function personLeadFields(lead: ExtractedLead, opts: { email: string | null; emailGuessed: boolean; query: string; now: string }) {
  return {
    name: lead.name,
    title: lead.title,
    company: lead.company,
    location: lead.location,
    email: opts.email,
    email_verified: opts.emailGuessed,
    source_url: lead.sourceUrl,
    fit_reason: lead.fitReason.trim() || null,
    query: opts.query,
    created_at: opts.now,
  };
}
