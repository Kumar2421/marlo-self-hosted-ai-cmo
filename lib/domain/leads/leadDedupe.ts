/**
 * Duplicate detection for leads already saved in a project. Used by the daily
 * auto-leads run so the same people are not added again every day.
 *
 * A candidate is a duplicate when any of these matches an existing row:
 *   - the same email (lowercased)
 *   - the same source page URL (lowercased)
 *   - the same name + company (both present)
 *   - the same name + title, when the candidate has no company
 * Name+title is only a fallback: two people can share a name, so it is not used
 * when a company is known.
 */

export type DedupeRow = {
  email?: string | null;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  source_url?: string | null;
};

export type DedupeCandidate = {
  name: string;
  company: string;
  title: string;
  email: string | null;
  sourceUrl: string | null;
};

const norm = (value: string | null | undefined): string => (value ?? "").toLowerCase().trim();

export function createLeadDedupe(existing: DedupeRow[]) {
  const emails = new Set<string>();
  const sources = new Set<string>();
  const nameCompany = new Set<string>();
  const nameTitle = new Set<string>();

  function remember(c: DedupeCandidate): void {
    const email = norm(c.email);
    const source = norm(c.sourceUrl);
    const name = norm(c.name);
    const company = norm(c.company);
    const title = norm(c.title);
    if (email) emails.add(email);
    if (source) sources.add(source);
    if (name && company) nameCompany.add(`${name}|${company}`);
    if (name && title) nameTitle.add(`${name}|${title}`);
  }

  for (const row of existing) {
    remember({
      name: row.name ?? "",
      company: row.company ?? "",
      title: row.title ?? "",
      email: row.email ?? null,
      sourceUrl: row.source_url ?? null,
    });
  }

  return {
    isDuplicate(c: DedupeCandidate): boolean {
      const email = norm(c.email);
      const source = norm(c.sourceUrl);
      const name = norm(c.name);
      const company = norm(c.company);
      const title = norm(c.title);
      if (email && emails.has(email)) return true;
      if (source && sources.has(source)) return true;
      if (name && company && nameCompany.has(`${name}|${company}`)) return true;
      if (name && !company && title && nameTitle.has(`${name}|${title}`)) return true;
      return false;
    },
    /** Record a row that is about to be saved, so a repeat later in the same batch is skipped too. */
    reserve(c: DedupeCandidate): void {
      remember(c);
    },
  };
}
