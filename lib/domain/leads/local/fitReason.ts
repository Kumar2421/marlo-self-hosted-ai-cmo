import type { LocalPlace } from "./placesSearch.ts";
import type { ContactExtract } from "./websiteContact.ts";

/**
 * Fit score (for sorting) and one plain-English reason. Both use only fields that were actually
 * observed (rating, review count, website, scraped contact facts). Nothing is inferred.
 */

export type FitWanted = { category: string; location?: string };

export type FitEnrichment = Pick<ContactExtract, "emails" | "whatsapp" | "contactUrl" | "description">;

export type FitResult = { score: number; reason: string };

function capitalize(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

function ratingPart(place: LocalPlace): string | null {
  if (place.rating === null) return null;
  const stars = `${place.rating.toFixed(1)} stars`;
  if (place.reviewCount === null || place.reviewCount <= 0) return stars;
  const reviews = place.reviewCount === 1 ? "1 review" : `${place.reviewCount} reviews`;
  return `${stars} from ${reviews}`;
}

function contactPart(hasWebsite: boolean, hasEmail: boolean): string {
  if (hasWebsite && hasEmail) return "has a website and a public email";
  if (hasWebsite) return "has a website";
  if (hasEmail) return "has a public email";
  return "no website listed";
}

export function scoreLocalLead(place: LocalPlace, enrichment: FitEnrichment, wanted: FitWanted): FitResult {
  const hasWebsite = place.website !== null;
  const hasEmail = enrichment.emails.length > 0;
  const hasWhatsapp = enrichment.whatsapp !== null;

  let score = 0;
  if (hasWebsite) score += 20;
  if (hasEmail) score += 25;
  if (hasWhatsapp) score += 10;
  if (enrichment.contactUrl) score += 5;
  if (enrichment.description) score += 5;
  if (place.rating !== null) score += Math.round(Math.min(5, Math.max(0, place.rating)) * 4);
  if (place.reviewCount !== null && place.reviewCount > 0) score += Math.min(15, Math.round(Math.log10(place.reviewCount + 1) * 5));
  const firstWord = wanted.category.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (firstWord && place.primaryType && place.primaryType.toLowerCase().includes(firstWord)) score += 5;

  const head = `${capitalize(wanted.category.trim())}${wanted.location?.trim() ? ` in ${wanted.location.trim()}` : ""}`;
  const parts: string[] = [];
  const rating = ratingPart(place);
  if (rating) parts.push(rating);
  parts.push(contactPart(hasWebsite, hasEmail));
  if (hasWhatsapp) parts.push("WhatsApp listed");

  return { score, reason: `${head}, ${parts.join(", ")}` };
}

/** Highest fit first; ties keep their original order. */
export function sortByFit<T extends { score: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.score - a.item.score || a.index - b.index)
    .map((x) => x.item);
}
