import { LIMITS } from "../leads/leadProfile.ts";

/**
 * The Offer Model: what a project sells and who buys it, read from the project's own website.
 *
 * Every claim that names a buyer (what is sold, who pays, roles, kinds of customer, places, the problem
 * solved) carries a quote from a page Marlo actually read. A field whose quote is not found in the source
 * text is dropped, so an unknown stays empty instead of becoming a guess. The model never decides a
 * lead; it only pre-fills the lead profile the user then edits and confirms.
 *
 * Pure: no fetch, no database, no model call.
 */

export const ARCHETYPES = ["service", "saas", "creator", "local", "ecommerce", "other"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const CLIENT_KINDS = ["people", "companies", "both"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

/** Fields that must be backed by a quote from the site. */
export const EVIDENCE_FIELDS = ["sells", "whoPays", "roles", "industries", "locations", "problem"] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

export type Evidence = { quote: string; url: string };

export type OfferModel = {
  version: 1;
  /** A classification, not a quoted fact, so it needs no evidence. Null when the site does not make it clear. */
  archetype: Archetype | null;
  /** What the business sells, in one short phrase. */
  sells: string;
  /** Who pays for it, in plain words ("small clinics", "indie founders"). */
  whoPays: string;
  clientKind: ClientKind | null;
  /** Job titles of the buyers, when the site names them. */
  roles: string[];
  /** Kinds of company or customer the site says it serves. */
  industries: string[];
  locations: string[];
  /** The problem the offer solves, from the site's own words. */
  problem: string;
  /** Whether the offer is about websites, marketing or search, so checking a lead's site is a useful hook. */
  webRelated: boolean;
  evidence: Partial<Record<EvidenceField, Evidence>>;
  /** Pages the model was shown (URLs only). */
  sources: string[];
  derivedAt: string;
};

export type SourceText = { url: string; text: string };

const ITEM_MAX = LIMITS.itemLength;
const SHORT_MAX = 160;

export function emptyOfferModel(now: Date = new Date()): OfferModel {
  return {
    version: 1,
    archetype: null,
    sells: "",
    whoPays: "",
    clientKind: null,
    roles: [],
    industries: [],
    locations: [],
    problem: "",
    webRelated: false,
    evidence: {},
    sources: [],
    derivedAt: now.toISOString(),
  };
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, ITEM_MAX);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function cleanEvidence(value: unknown): Partial<Record<EvidenceField, Evidence>> {
  const out: Partial<Record<EvidenceField, Evidence>> = {};
  if (!value || typeof value !== "object") return out;
  const src = value as Record<string, unknown>;
  for (const field of EVIDENCE_FIELDS) {
    const e = src[field];
    if (!e || typeof e !== "object") continue;
    const quote = cleanText((e as Record<string, unknown>).quote, 280);
    const url = cleanText((e as Record<string, unknown>).url, 300);
    if (quote) out[field] = { quote, url };
  }
  return out;
}

/** Coerces anything (model output or stored JSON) into a valid OfferModel. Never throws. */
export function normalizeOfferModel(input: unknown, now: Date = new Date()): OfferModel {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const archetype = ARCHETYPES.find((a) => a === o.archetype) ?? null;
  const clientKind = CLIENT_KINDS.find((c) => c === o.clientKind) ?? null;
  return {
    version: 1,
    archetype,
    sells: cleanText(o.sells, SHORT_MAX),
    whoPays: cleanText(o.whoPays, SHORT_MAX),
    clientKind,
    roles: cleanList(o.roles, LIMITS.roles),
    industries: cleanList(o.industries, LIMITS.industries),
    locations: cleanList(o.locations, LIMITS.locations),
    problem: cleanText(o.problem, LIMITS.problemLength),
    webRelated: o.webRelated === true,
    evidence: cleanEvidence(o.evidence),
    sources: cleanList(o.sources, 8).map((s) => s.slice(0, 300)),
    derivedAt: typeof o.derivedAt === "string" && o.derivedAt ? o.derivedAt : now.toISOString(),
  };
}

/** Lowercase, one space, straight quotes removed, so a quote matches despite whitespace and punctuation drift. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ \s]+/g, " ")
    .replace(/[‘’“”"'`]/g, "")
    .trim();
}

const MIN_QUOTE_PART = 10;

/**
 * True when every non-trivial part of the quote (split at an ellipsis) appears in one of the sources.
 * A quote must come from a page that was actually read; it may be shortened with "..." but not rewritten.
 */
export function quoteInSources(quote: string, sources: readonly SourceText[]): boolean {
  return locateQuote(quote, sources) !== null;
}

/**
 * The URL of the page a quote was found in, or null when it is not found. The URL always comes from the sources
 * Marlo read, never from the model, so a model (or a hostile page steering it) cannot plant a link.
 */
export function locateQuote(quote: string, sources: readonly SourceText[]): string | null {
  const parts = quote
    .split(/\.\.\.|…/)
    .map(normalizeForMatch)
    .filter((p) => p.length > 0);
  if (parts.length === 0 || parts.every((p) => p.length < MIN_QUOTE_PART)) return null;
  const haystacks = sources.map((s) => ({ url: s.url, text: normalizeForMatch(s.text) }));
  const long = parts.filter((p) => p.length >= MIN_QUOTE_PART);
  // Prefer one page that holds every part; otherwise accept parts spread over pages and name the first part's page.
  const single = haystacks.find((h) => long.every((p) => h.text.includes(p)));
  if (single) return single.url;
  const each = long.map((p) => haystacks.find((h) => h.text.includes(p)));
  return each.every(Boolean) ? each[0]!.url : null;
}

export type EvidenceCheck = { offer: OfferModel; dropped: EvidenceField[] };

function hasValue(offer: OfferModel, field: EvidenceField): boolean {
  const v = offer[field];
  return Array.isArray(v) ? v.length > 0 : v.length > 0;
}

function clearField(offer: OfferModel, field: EvidenceField): void {
  if (field === "roles" || field === "industries" || field === "locations") offer[field] = [];
  else offer[field] = "";
}

/**
 * Drops every evidenced field whose quote is missing or not found in the sources, and removes its
 * evidence entry. A field with no value but a leftover quote also loses the quote.
 */
export function enforceEvidence(offer: OfferModel, sources: readonly SourceText[]): EvidenceCheck {
  const next: OfferModel = { ...offer, evidence: { ...offer.evidence }, sources: sources.map((s) => s.url).slice(0, 8) };
  const dropped: EvidenceField[] = [];
  for (const field of EVIDENCE_FIELDS) {
    const ev = next.evidence[field];
    if (!hasValue(next, field)) {
      delete next.evidence[field];
      continue;
    }
    const foundAt = ev ? locateQuote(ev.quote, sources) : null;
    if (!ev || !foundAt) {
      clearField(next, field);
      delete next.evidence[field];
      dropped.push(field);
    } else {
      next.evidence[field] = { quote: ev.quote, url: foundAt };
    }
  }
  return { offer: next, dropped };
}

/** True when the model learned nothing about who buys (all buyer fields empty). */
export function isEmptyOffer(offer: OfferModel): boolean {
  return !offer.whoPays && offer.roles.length === 0 && offer.industries.length === 0 && !offer.sells;
}

/** Plain-language label for the archetype, for the wizard header. */
export function archetypeLabel(archetype: Archetype | null): string {
  switch (archetype) {
    case "service":
      return "A service business";
    case "saas":
      return "A software product";
    case "creator":
      return "A creator or publisher";
    case "local":
      return "A local business";
    case "ecommerce":
      return "An online shop";
    case "other":
      return "Something else";
    default:
      return "Not clear from your site";
  }
}
