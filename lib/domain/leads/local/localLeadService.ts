import type { LocalPlace, PlacesPageResult, PlacesSearchInput } from "./placesSearch.ts";
import { scoreLocalLead, sortByFit } from "./fitReason.ts";
import type { Enrichment, EnrichmentStatus } from "./websiteContact.ts";

/**
 * One page of local business leads: search, drop businesses the project already has, enrich each
 * new business's website within a shared time budget, check the best email's mail server, score.
 * All I/O comes in through ports, so this file is pure orchestration and testable with fakes.
 */

export type EmailQuality = "source_found" | "domain_found" | "unknown";

export type LocalLeadDraft = {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  email: string | null;
  emailQuality: EmailQuality | null;
  whatsapp: string | null;
  contactUrl: string | null;
  description: string | null;
  enrichmentStatus: EnrichmentStatus | "skipped";
  score: number;
  fitReason: string;
};

export type LocalSearchPorts = {
  searchPage: (input: PlacesSearchInput) => Promise<PlacesPageResult>;
  existingPlaceIds: (projectId: string) => Promise<Set<string>>;
  enrich: (website: string) => Promise<Enrichment>;
  /** True when the email's domain has a mail server (MX). */
  emailCheck: (email: string) => Promise<boolean>;
};

export type LocalSearchInput = {
  projectId: string;
  category: string;
  location: string;
  pageToken?: string;
  regionCode?: string;
  /** Total time for enrichment of this page. Unfinished businesses are reported as skipped. */
  budgetMs?: number;
  concurrency?: number;
};

export type LocalSearchResult = {
  leads: LocalLeadDraft[];
  nextPageToken: string | null;
  /** Businesses on this page the project already had. */
  duplicates: number;
  /** New businesses whose enrichment did not finish inside the budget. */
  skipped: number;
};

export const DEFAULT_BUDGET_MS = 35_000;
export const DEFAULT_CONCURRENCY = 4;

type Bounded<T> = { done: true; value: T } | { done: false };

/** Resolves to the value, or to { done: false } when the deadline passes first. Never rejects. */
async function withinMs<T>(work: Promise<T>, ms: number): Promise<Bounded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Bounded<T>>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), Math.max(0, ms));
  });
  const value = work.then((v): Bounded<T> => ({ done: true, value: v }), (): Bounded<T> => ({ done: false }));
  try {
    return await Promise.race([value, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

const NO_CONTACT: Enrichment = { status: "no_website", emails: [], whatsapp: null, contactUrl: null, description: null };

export async function searchLocalLeads(ports: LocalSearchPorts, input: LocalSearchInput): Promise<LocalSearchResult> {
  const page = await ports.searchPage({
    category: input.category,
    location: input.location,
    pageToken: input.pageToken,
    regionCode: input.regionCode,
  });

  const existing = await ports.existingPlaceIds(input.projectId);
  const seen = new Set<string>();
  const fresh: LocalPlace[] = [];
  let duplicates = 0;
  for (const place of page.places) {
    if (existing.has(place.id)) {
      duplicates += 1;
      continue;
    }
    if (seen.has(place.id)) continue;
    seen.add(place.id);
    fresh.push(place);
  }

  const deadline = Date.now() + (input.budgetMs ?? DEFAULT_BUDGET_MS);
  const wanted = { category: input.category, location: input.location };

  const drafts = await mapPool(fresh, input.concurrency ?? DEFAULT_CONCURRENCY, async (place): Promise<LocalLeadDraft> => {
    let enrichment: Enrichment | null = null;
    if (!place.website) {
      enrichment = NO_CONTACT;
    } else if (Date.now() < deadline) {
      const result = await withinMs(ports.enrich(place.website), deadline - Date.now());
      if (result.done) enrichment = result.value;
    }

    let email: string | null = null;
    let emailQuality: EmailQuality | null = null;
    if (enrichment && enrichment.emails.length > 0) {
      email = enrichment.emails[0];
      const mx = await withinMs(
        ports.emailCheck(email).catch(() => false),
        deadline - Date.now()
      );
      emailQuality = mx.done && mx.value ? "domain_found" : "unknown";
    }

    const scored = scoreLocalLead(place, enrichment ?? { emails: [], whatsapp: null, contactUrl: null, description: null }, wanted);
    return {
      placeId: place.id,
      name: place.name,
      address: place.address,
      phone: place.phone,
      website: place.website,
      rating: place.rating,
      reviewCount: place.reviewCount,
      mapsUrl: place.mapsUrl,
      email,
      emailQuality,
      whatsapp: enrichment?.whatsapp ?? null,
      contactUrl: enrichment?.contactUrl ?? null,
      description: enrichment?.description ?? null,
      enrichmentStatus: enrichment ? enrichment.status : "skipped",
      score: scored.score,
      fitReason: scored.reason,
    };
  });

  return {
    leads: sortByFit(drafts),
    nextPageToken: page.nextPageToken,
    duplicates,
    skipped: drafts.filter((d) => d.enrichmentStatus === "skipped").length,
  };
}
