/**
 * Pure helpers for the Leads panel list: email filtering, counts and the
 * one-line profile summary. Kept free of React so they can be tested directly.
 */

export type LeadFilter = "all" | "with" | "without";

/** The filter tabs, in display order. */
export const LEAD_FILTERS: readonly LeadFilter[] = ["all", "with", "without"];

type EmailLead = { email: string | null | undefined };

export type LeadCounts = { all: number; withEmail: number; noEmail: number };

export function hasEmail(lead: EmailLead): boolean {
  return typeof lead.email === "string" && lead.email.trim() !== "";
}

export function countLeads(leads: readonly EmailLead[]): LeadCounts {
  const withEmail = leads.filter(hasEmail).length;
  return { all: leads.length, withEmail, noEmail: leads.length - withEmail };
}

/** "With email" when at least one lead has an address, otherwise everything. */
export function defaultFilter(leads: readonly EmailLead[]): LeadFilter {
  return leads.some(hasEmail) ? "with" : "all";
}

export function filterLeads<T extends EmailLead>(leads: readonly T[], filter: LeadFilter): T[] {
  if (filter === "with") return leads.filter(hasEmail);
  if (filter === "without") return leads.filter((l) => !hasEmail(l));
  return [...leads];
}

export function filterLabel(filter: LeadFilter, counts: LeadCounts): string {
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
