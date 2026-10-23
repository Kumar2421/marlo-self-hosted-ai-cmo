import { MAX_TRACKED_PROMPTS } from "./types.ts";
import { normalizePrompt } from "./promptSet.ts";

export type StarterInput = {
  brand: string;
  /** The project's category / offer, e.g. "custom software, CRM and AI platforms". */
  category: string;
  /** Competitor domains or names, most important first. */
  competitors?: string[];
};

export const MAX_STARTER_PROMPTS = 5;

/** "custom software, CRM and AI platforms" -> ["custom software", "CRM"]. Max two offers, so questions stay specific. */
export function offersFromCategory(category: string): string[] {
  const parts = category
    .split(/[,;/&]|\band\b/i)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 2);
  const out: string[] = [];
  for (const p of parts) if (!out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
  return out.slice(0, 2);
}

function competitorName(value: string): string {
  const host = value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  const label = host.includes(".") ? host.split(".")[0] : host;
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
}

/**
 * Deterministic starter questions from the project's own offer and competitors. A buyer would ask
 * these without knowing the brand, except the one comparison question. Never a brand-only query.
 * Returns fewer than 3 (or none) when the project gives too little to be specific: no invented offer.
 */
export function buildStarterPrompts(input: StarterInput, max = MAX_STARTER_PROMPTS): string[] {
  const offers = offersFromCategory(input.category);
  const brandKey = normalizePrompt(input.brand);
  const comps = (input.competitors ?? [])
    .map(competitorName)
    .filter((c) => c && normalizePrompt(c) !== brandKey)
    .slice(0, 2);
  const [o1, o2] = offers;
  const ordered: string[] = [];
  if (o1) ordered.push(`What are the best ${o1} options for a small business?`);
  if (comps[0]) ordered.push(`What are the best alternatives to ${comps[0]}?`);
  if (o1) ordered.push(`How do I choose the right ${o1} provider?`);
  if (o2) ordered.push(`Which ${o2} tools or companies do people recommend?`);
  if (comps[0] && input.brand.trim()) ordered.push(`How does ${input.brand.trim()} compare to ${comps[0]}?`);
  if (comps[1]) ordered.push(`What are the best alternatives to ${comps[1]}?`);
  if (o1) ordered.push(`Who offers affordable ${o1} for startups?`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of ordered) {
    const k = normalizePrompt(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= Math.min(max, MAX_TRACKED_PROMPTS)) break;
  }
  return out;
}
