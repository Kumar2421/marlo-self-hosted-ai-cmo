/**
 * Pure helpers for the Leads panel list: email filtering, counts and the
 * one-line profile summary. Kept free of React so they can be tested directly.
 */

import { qualifyLead, type Channel, type Qualification } from "./qualify.ts";

export type LeadFilter = "qualified" | "all" | "with" | "without";

/** The filter tabs, in display order. Qualified first: those are the leads worth acting on. */
export const LEAD_FILTERS: readonly LeadFilter[] = ["qualified", "all", "with", "without"];

type EmailLead = {
  email: string | null | undefined;
  email_verified?: number | boolean | null;
  email_quality?: string | null;
  whatsapp?: string | null;
  source_url?: string | null;
  fit_reason?: string | null;
};

export type LeadCounts = { all: number; withEmail: number; noEmail: number; qualified: number };

/** Qualification of a stored lead row. A guessed address (email_verified / pattern_candidate) never counts. */
export function leadQualification(lead: EmailLead): Qualification {
  return qualifyLead({
    email: lead.email,
    emailGuessed: Boolean(lead.email_verified) || lead.email_quality === "pattern_candidate",
    whatsapp: lead.whatsapp,
    sourceUrl: lead.source_url,
    fitReason: lead.fit_reason,
  });
}

export function isQualified(lead: EmailLead): boolean {
  return leadQualification(lead).qualified;
}

const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn" };
export function channelLabel(channel: Channel): string {
  return CHANNEL_LABEL[channel];
}

export function hasEmail(lead: EmailLead): boolean {
  return typeof lead.email === "string" && lead.email.trim() !== "";
}

export function countLeads(leads: readonly EmailLead[]): LeadCounts {
  const withEmail = leads.filter(hasEmail).length;
  return { all: leads.length, withEmail, noEmail: leads.length - withEmail, qualified: leads.filter(isQualified).length };
}

/** "Qualified" when any lead is, else "With email" when at least one lead has an address, otherwise everything. */
export function defaultFilter(leads: readonly EmailLead[]): LeadFilter {
  if (leads.some(isQualified)) return "qualified";
  return leads.some(hasEmail) ? "with" : "all";
}

export function filterLeads<T extends EmailLead>(leads: readonly T[], filter: LeadFilter): T[] {
  if (filter === "qualified") return leads.filter(isQualified);
  if (filter === "with") return leads.filter(hasEmail);
  if (filter === "without") return leads.filter((l) => !hasEmail(l));
  return [...leads];
}

export function filterLabel(filter: LeadFilter, counts: LeadCounts): string {
  if (filter === "qualified") return `Qualified (${counts.qualified})`;
  if (filter === "with") return `With email (${counts.withEmail})`;
  if (filter === "without") return `No email (${counts.noEmail})`;
  return `All (${counts.all})`;
}

/** "Founder at B2B SaaS": first role and first company type of a profile. */
export function profileSummary(profile: { roles: readonly string[]; industries: readonly string[] }): string {
  const role = profile.roles[0]?.trim() ?? "";
  const industry = profile.industries[0]?.trim() ?? "";
  if (role && industry) return `${role} at ${industry}`;
  return role || industry || "Lead profile";
}
