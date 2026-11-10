import type { CompanyLeadDraft } from "./companyLeads.ts";

/** The columns a saved company lead (lead_type "company") carries, shared by the manual search and the daily job. */
export function companyLeadFields(d: CompanyLeadDraft, query: string, now: string) {
  return {
    name: d.name,
    title: "",
    company: d.name,
    lead_type: "company",
    email: d.email,
    email_verified: false,
    email_quality: d.emailQuality,
    whatsapp: d.whatsapp,
    contact_url: d.contactUrl,
    website: d.website,
    description: d.description,
    source_url: d.sourceUrl,
    fit_reason: d.fitReason,
    query,
    created_at: now,
  };
}
