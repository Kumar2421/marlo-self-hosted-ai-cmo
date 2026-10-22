// Pure helpers for the Competitor Comparison document: markdown (de)serialisation
// and the view model shown in the panel. No React / no network so node tests can import it.

export type ComparisonEntry = {
  id: string;
  url: string;
  name: string;
  startingPrice: string;
  features: string[];
};

export type StoredOwnProduct = ComparisonEntry & { extracted: boolean };

export type StoredComparison = {
  ownProduct?: StoredOwnProduct | null;
  competitors: ComparisonEntry[];
  generatedAt?: string;
};

export type ComparisonProject = { name: string; url: string };

/** missing = no usable own data stored (legacy / stale); not_extracted = own site could not be read; ready = real data. */
export type OwnStatus = "ready" | "not_extracted" | "missing";

export type ComparisonView = {
  own: ComparisonEntry & { status: OwnStatus };
  competitors: ComparisonEntry[];
  /** Features competitors list that the project does not (only when own data is ready). */
  gaps: string[];
  /** Features only the project lists (only when own data is ready). */
  differentiators: string[];
};

const OWN_HEADING = "## Your Product";
const MAX_LIST = 8;

export function comparisonToMarkdown(result: {
  ownProduct?: { url: string; name: string; startingPrice: string; features: string[]; extracted: boolean } | null;
  competitors: Array<{ url: string; name: string; startingPrice: string; features: string[] }>;
  generatedAt: string;
}): string {
  const lines: string[] = ["# Competitor Comparison", `Generated: ${result.generatedAt}`, ""];

  if (result.ownProduct) {
    const own = result.ownProduct;
    lines.push(OWN_HEADING, "", `### ${own.name}`, `**URL:** ${own.url}`);
    if (own.extracted) {
      lines.push(`**Starting Price:** ${own.startingPrice}`, "**Key Features:**");
      for (const f of own.features) lines.push(`- ${f}`);
    } else {
      lines.push("**Status:** Not extracted yet");
    }
    lines.push("");
  }

  lines.push("## Competitors at a Glance", "");
  for (const comp of result.competitors) {
    lines.push(`### ${comp.name}`);
    lines.push(`**URL:** ${comp.url}`);
    lines.push(`**Starting Price:** ${comp.startingPrice}`);
    lines.push("**Key Features:**");
    for (const feature of comp.features) lines.push(`- ${feature}`);
    lines.push("");
  }

  lines.push("## Analysis");
  lines.push("Pricing and features extracted from public websites. Regenerate anytime to refresh.");
  return lines.join("\n");
}

function parseEntries(block: string): ComparisonEntry[] {
  const out: ComparisonEntry[] = [];
  for (const section of block.split("###").slice(1)) {
    const lines = section.split("\n").filter((l) => l.trim());
    const name = lines[0]?.trim();
    if (!name) continue;
    const url = section.match(/\*\*URL:\*\* ([^\n]+)/)?.[1].trim() || `https://${name.toLowerCase().replace(/\s+/g, "")}.com`;
    const startingPrice = section.match(/\*\*Starting Price:\*\* ([^\n]+)/)?.[1].trim() || "pricing not found";
    const features = lines
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => l.replace(/^-\s*/, "").trim())
      .filter((f) => f.length > 0);
    out.push({ id: name.toLowerCase().replace(/\s+/g, "-"), url, name, startingPrice, features: features.slice(0, 4) });
  }
  return out;
}

/** Parse the stored markdown. Older documents have no "Your Product" section, so ownProduct is null. */
export function parseComparisonMarkdown(markdown: string): StoredComparison {
  let ownBlock = "";
  let rest = markdown;
  const at = markdown.indexOf(OWN_HEADING);
  if (at !== -1) {
    const after = markdown.slice(at + OWN_HEADING.length);
    const next = after.search(/\n## /);
    ownBlock = next === -1 ? after : after.slice(0, next);
    rest = markdown.slice(0, at) + (next === -1 ? "" : after.slice(next));
  }
  // Only entries before "## Analysis" are competitors.
  const analysisAt = rest.indexOf("\n## Analysis");
  if (analysisAt !== -1) rest = rest.slice(0, analysisAt);

  const [ownEntry] = parseEntries(ownBlock);
  const ownProduct: StoredOwnProduct | null = ownEntry
    ? { ...ownEntry, extracted: !/\*\*Status:\*\* Not extracted yet/.test(ownBlock) }
    : null;
  return { ownProduct, competitors: parseEntries(rest) };
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function normFeature(f: string): string {
  return f.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueByNorm(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of list) {
    const n = normFeature(f);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(f);
  }
  return out;
}

/**
 * A stored own-product record is only trusted when it is for THIS project: the legacy
 * hardcoded "Marlo" column (or a record for a different site) is treated as missing.
 */
function usableStoredOwn(project: ComparisonProject, stored: StoredOwnProduct | null | undefined): StoredOwnProduct | null {
  if (!stored) return null;
  const isMarlo = stored.id === "marlo" || stored.name.trim().toLowerCase() === "marlo";
  if (isMarlo && project.name.trim().toLowerCase() !== "marlo") return null;
  if (hostOf(stored.url) !== hostOf(project.url)) return null;
  return stored;
}

export function buildComparisonView(project: ComparisonProject, comparison: StoredComparison): ComparisonView {
  const stored = usableStoredOwn(project, comparison.ownProduct);
  const base = { id: "own", url: project.url, name: project.name };

  let own: ComparisonView["own"];
  if (!stored) {
    own = { ...base, startingPrice: "", features: [], status: "missing" };
  } else if (!stored.extracted) {
    own = { ...base, startingPrice: "", features: [], status: "not_extracted" };
  } else {
    own = { ...base, startingPrice: stored.startingPrice, features: stored.features, status: "ready" };
  }

  let gaps: string[] = [];
  let differentiators: string[] = [];
  if (own.status === "ready" && own.features.length > 0) {
    const ownSet = new Set(own.features.map(normFeature));
    const compFeatures = comparison.competitors.flatMap((c) => c.features);
    const compSet = new Set(compFeatures.map(normFeature));
    gaps = uniqueByNorm(compFeatures.filter((f) => !ownSet.has(normFeature(f)))).slice(0, MAX_LIST);
    differentiators = uniqueByNorm(own.features.filter((f) => !compSet.has(normFeature(f)))).slice(0, MAX_LIST);
  }

  return { own, competitors: comparison.competitors, gaps, differentiators };
}
