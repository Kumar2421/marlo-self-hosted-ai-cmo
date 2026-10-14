/**
 * Pure helpers for the Local Business leads UI: links, chips, honest labels, status tags and
 * sorting. No I/O, no React. Everything here is derived from fields that were actually stored.
 */

export const LEAD_STATUSES = ["new", "contacted", "replied", "not_interested"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  not_interested: "Not interested",
};

const STATUS_TAG_PREFIX = "status:";

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

/** The status stored as a `status:<value>` tag. A lead with no status tag is "new". */
export function statusFromTags(tags: readonly string[] | null | undefined): LeadStatus {
  for (const tag of tags ?? []) {
    if (!tag.startsWith(STATUS_TAG_PREFIX)) continue;
    const value = tag.slice(STATUS_TAG_PREFIX.length);
    if (isLeadStatus(value)) return value;
  }
  return "new";
}

/** Replace any existing status tag with the new one, keeping every other tag as it was. */
export function tagsWithStatus(tags: readonly string[] | null | undefined, status: LeadStatus): string[] {
  const kept = (tags ?? []).filter((tag) => !tag.startsWith(STATUS_TAG_PREFIX));
  return status === "new" ? kept : [...kept, `${STATUS_TAG_PREFIX}${status}`];
}

/**
 * Postgres text[] literal for an exact-match filter on the tags column, e.g. {"status:new","x"}.
 * Quotes and backslashes inside a tag are escaped.
 */
export function tagsLiteral(tags: readonly string[]): string {
  const items = tags.map((tag) => `"${tag.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${items.join(",")}}`;
}

/** Digits only, for wa.me. Enrichment stores WhatsApp numbers as bare digits (8 to 15). */
export function whatsappLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
}

/** tel: link keeping one leading plus and the digits. Needs at least 6 digits. */
export function telLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/** Only http and https links are shown, so a stored value can never become a javascript: link. */
export function websiteHref(website: string | null | undefined): string | null {
  if (!website) return null;
  const raw = website.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Honest label for the email. "source_found" is an address printed on the business's own site.
 * The other values mean the address came from the site but the mail server check did not confirm
 * it, so the label never claims the mailbox exists.
 */
export function emailLabel(quality: string | null | undefined): string | null {
  switch (quality) {
    case "source_found":
      return "Email found on website";
    case "domain_found":
      return "Email found on website - domain accepts mail, not confirmed";
    case "unknown":
      return "Email found on website - mail server not confirmed";
    default:
      return null;
  }
}

export type LeadChip = { key: "phone" | "whatsapp" | "email" | "website" | "contact"; label: string };

export type ChipSource = {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  contact_url?: string | null;
};

/** The "what we found" chips, in a fixed order. Only fields that are present produce a chip. */
export function leadChips(lead: ChipSource): LeadChip[] {
  const chips: LeadChip[] = [];
  if (lead.phone) chips.push({ key: "phone", label: "Phone" });
  if (whatsappLink(lead.whatsapp)) chips.push({ key: "whatsapp", label: "WhatsApp" });
  if (lead.email) chips.push({ key: "email", label: "Email" });
  if (websiteHref(lead.website)) chips.push({ key: "website", label: "Website" });
  if (websiteHref(lead.contact_url)) chips.push({ key: "contact", label: "Contact page" });
  return chips;
}

/** The searched category from a stored query ("dentist in Austin, TX"). */
export function categoryFromQuery(query: string | null | undefined): string {
  const text = (query ?? "").trim();
  const at = text.toLowerCase().lastIndexOf(" in ");
  return at > 0 ? text.slice(0, at).trim() : text;
}

export function ratingLabel(rating: number | null | undefined, reviewCount: number | null | undefined): string | null {
  if (rating === null || rating === undefined || !Number.isFinite(rating)) return null;
  const stars = rating.toFixed(1);
  if (!reviewCount || reviewCount <= 0) return stars;
  return `${stars} (${reviewCount.toLocaleString("en-US")} ${reviewCount === 1 ? "review" : "reviews"})`;
}

/** A short note when the website could not be read, so an empty contact column is explained. */
export function enrichmentNote(status: string | null | undefined): string | null {
  switch (status) {
    case "skipped":
      return "Website not checked (time limit)";
    case "blocked":
      return "Website blocked the check";
    case "failed":
      return "Website could not be read";
    default:
      return null;
  }
}

/**
 * Category suggestion from the lead profile: the first industry, without generic trailing words.
 * Returns "" when there is nothing usable.
 */
export function suggestCategory(industries: readonly string[] | null | undefined): string {
  const first = (industries ?? []).map((s) => s.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  const cleaned = first.replace(/\s+(companies|company|businesses|business|firms|firm|agencies|agency|brands|brand)$/i, "").trim();
  return cleaned.slice(0, 100);
}

/** Location suggestion from the lead profile: the first location, or "". */
export function suggestLocation(locations: readonly string[] | null | undefined): string {
  const first = (locations ?? []).map((s) => s.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  return first.slice(0, 100);
}

/** Highest fit first. Missing scores count as 0. Equal scores keep their order. */
export function sortByFitScore<T extends { fit_score?: number | null }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (b.item.fit_score ?? 0) - (a.item.fit_score ?? 0) || a.index - b.index)
    .map((x) => x.item);
}
