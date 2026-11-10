import type { LeadProfile } from "../leadProfile.ts";
import { searchCompanyLeads, type CompanyLeadDraft, type CompanySearchPorts } from "./companyLeads.ts";
import { companyLeadFields } from "./companyRow.ts";

/**
 * The daily free refresh for a profile that names no job title. A people search needs a role to mean anything, so
 * for a business that sells to companies the free daily leads come from the company search instead: web search, the
 * company's own site, and only companies a user can reach are kept. Needs no model. All I/O comes in through ports.
 */

/** True when the company search is the right free search for this profile: company types named, no job title. */
export function usesCompanySearch(profile: Pick<LeadProfile, "roles" | "industries">): boolean {
  return profile.roles.length === 0 && profile.industries.length > 0;
}

export type AutoCompanyReason = "none_found" | "all_duplicates" | "save_failed";

export type AutoCompanyResult = {
  added: number;
  reason: AutoCompanyReason | null;
  message: string | null;
  target: { role: string; industry: string; location: string; source: string };
};

export type AutoCompanyPorts = Pick<CompanySearchPorts, "provider" | "knownHosts" | "enrich"> & {
  /** Saves the rows; resolves to an error message on failure. */
  save: (rows: Record<string, unknown>[]) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export async function runAutoCompanyLeads(
  ports: AutoCompanyPorts,
  input: { profile: Pick<LeadProfile, "industries" | "locations" | "exclude">; ownHost?: string; limit: number; now?: Date },
): Promise<AutoCompanyResult> {
  const { profile } = input;
  const target = { role: "", industry: profile.industries.join(", "), location: profile.locations.join(", "), source: "lead-profile-companies" };
  const result = await searchCompanyLeads(ports, { profile, ownHost: input.ownHost, maxLeads: input.limit });

  if (result.leads.length === 0) {
    if (result.duplicates > 0 && result.droppedNoContact === 0) {
      return { added: 0, reason: "all_duplicates", message: "Everything found was already in your leads.", target };
    }
    const message =
      result.droppedNoContact > 0
        ? `Found ${result.droppedNoContact} matching ${result.droppedNoContact === 1 ? "company" : "companies"}, but none showed an email or WhatsApp number on their site.`
        : "The search found no matching companies this time.";
    return { added: 0, reason: "none_found", message, target };
  }

  const now = (input.now ?? new Date()).toISOString();
  const query = `${target.industry} ${target.location}`.trim();
  const rows = result.leads.map((d: CompanyLeadDraft) => ({ ...companyLeadFields(d, query, now), auto_generated: true }));
  const saved = await ports.save(rows);
  if (!saved.ok) return { added: 0, reason: "save_failed", message: `Found leads but couldn't save them. ${saved.error.slice(0, 200)}`, target };
  return { added: rows.length, reason: null, message: null, target };
}
