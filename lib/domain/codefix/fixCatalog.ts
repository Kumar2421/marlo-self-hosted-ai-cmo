/**
 * The catalog of fixes Marlo may write as code. Pure: decides, from a finding alone, whether a
 * fix is a small, safe copy/markup change Marlo can prepare for review (`auto`) or something a
 * person must do (`manual`: rewrites, layout, speed, server config). Nothing here touches GitHub.
 */

import { lighthouseCategoryOf } from "../seo/lighthouseAudits.ts";

export const FIX_KINDS = [
  "title",
  "meta_description",
  "open_graph",
  "twitter_card",
  "alt_text",
  "json_ld",
  "faq_schema",
  "llms_txt",
  "canonical",
  "sitemap",
] as const;

export type FixKind = (typeof FIX_KINDS)[number];

export type FixKindInfo = {
  label: string;
  /** Edits the page's own source file, or adds a brand-new file to the repo. */
  target: "page" | "new_file";
};

export const FIX_KIND_INFO: Record<FixKind, FixKindInfo> = {
  title: { label: "Page title", target: "page" },
  meta_description: { label: "Meta description", target: "page" },
  open_graph: { label: "Open Graph tags", target: "page" },
  twitter_card: { label: "Twitter card tags", target: "page" },
  alt_text: { label: "Image alt text", target: "page" },
  json_ld: { label: "JSON-LD structured data", target: "page" },
  faq_schema: { label: "FAQ structured data", target: "page" },
  canonical: { label: "Canonical link", target: "page" },
  llms_txt: { label: "llms.txt", target: "new_file" },
  sitemap: { label: "Sitemap", target: "new_file" },
};

export type FindingLike = {
  source: string;
  category?: string;
  entityId: string;
  evidence?: Record<string, unknown>;
};

export type FixClassification =
  | { mode: "auto"; kinds: FixKind[]; label: string }
  | { mode: "manual"; reason: string };

/** Hard limits for one fix, so a model mistake can never turn into a sprawling pull request. */
export const MAX_FIX_FILES = 4;
export const MAX_SOURCE_FILE_BYTES = 200_000;
export const MAX_NEW_FILE_BYTES = 60_000;
export const MAX_SNIPPET_BYTES = 20_000;

const SEO_AUDIT_KINDS: Record<string, FixKind[]> = {
  "meta-title-missing": ["title"],
  "meta-title-too-long": ["title"],
  "meta-description-missing": ["meta_description"],
  "meta-description-too-long": ["meta_description"],
  "canonical-missing": ["canonical"],
  "og-tags-missing": ["open_graph"],
  "og-tags-partial": ["open_graph"],
  "twitter-tags-missing": ["twitter_card"],
};

const MANUAL_REASON =
  "This needs a manual change: rewrites, layout, speed and server settings are not something Marlo should change in your code on its own.";

function manual(reason = MANUAL_REASON): FixClassification {
  return { mode: "manual", reason };
}

function auto(kinds: FixKind[]): FixClassification {
  const unique = [...new Set(kinds)];
  return { mode: "auto", kinds: unique, label: unique.map((k) => FIX_KIND_INFO[k].label).join(" + ") };
}

/** Why a Lighthouse finding is a manual change, worded for its own category (never "speed" for an accessibility audit). */
function lighthouseManualReason(finding: FindingLike): string {
  const category = lighthouseCategoryOf({ entityId: finding.entityId, evidence: finding.evidence });
  if (category === "accessibility") return "This needs a manual change: accessibility fixes depend on your page's markup and content, so a person should make and check them.";
  if (category === "performance") return "This needs a manual change: speed and performance fixes touch how the page is built.";
  if (category === "seo") return "This needs a manual change: it depends on how your page is written and built, so a person should decide the right fix.";
  if (category === "best-practices") return "This needs a manual change: best-practice fixes depend on how your site is built and served.";
  return "This needs a manual change: Marlo cannot tell which part of the page this audit is about, so a person should decide the right fix.";
}

function opportunityType(evidence: Record<string, unknown> | undefined): string | null {
  const opp = evidence?.opportunity as { type?: unknown } | undefined;
  return typeof opp?.type === "string" ? opp.type : null;
}

function geoKinds(text: string): FixKind[] {
  const t = text.toLowerCase();
  const kinds: FixKind[] = [];
  if (t.includes("llms")) kinds.push("llms_txt");
  if (/faq/.test(t)) kinds.push("faq_schema");
  else if (/json-?ld|schema|structured/.test(t)) kinds.push("json_ld");
  return kinds;
}

export function classifyFinding(finding: FindingLike): FixClassification {
  const id = (finding.entityId ?? "").toLowerCase();
  const source = (finding.source ?? "").toLowerCase();

  if (source === "seo-audit") {
    const known = SEO_AUDIT_KINDS[id];
    if (known) return auto(known);
    if (id.startsWith("lighthouse-") && /(^|-)image-alt$/.test(id)) return auto(["alt_text"]);
    if (id.includes("sitemap")) return auto(["sitemap"]);
    if (id.startsWith("heading-")) return manual("This needs a manual change: heading structure depends on how the page is laid out and written.");
    if (id.startsWith("lighthouse-")) return manual(lighthouseManualReason(finding));
    if (id.startsWith("robots-txt")) return manual("This needs a manual change: robots rules decide what search engines may crawl, so a person should edit them.");
    return manual();
  }

  if (source === "geo" || source.startsWith("geo-")) {
    const kinds = geoKinds(`${id} ${finding.category ?? ""}`);
    return kinds.length > 0 ? auto(kinds) : manual("This needs a manual change: it is a content or authority task, not a code change.");
  }

  if (source === "search-console") {
    const type = opportunityType(finding.evidence);
    if (type === "ctr") return auto(["title", "meta_description"]);
    if (type) return manual("This needs a manual change: ranking and content shifts can't be solved by editing a tag.");
    const page = (finding.evidence?.page ?? {}) as { meta?: { canonical?: unknown; indexable?: unknown } };
    if (page.meta && page.meta.indexable !== false && !page.meta.canonical) return auto(["canonical"]);
    return manual();
  }

  return manual();
}

export function isCodeFixable(finding: FindingLike): boolean {
  return classifyFinding(finding).mode === "auto";
}

/** Whether a catalog fix edits the page source, adds new files, or both. */
export function plannedTargets(kinds: readonly FixKind[]): { pageKinds: FixKind[]; newFileKinds: FixKind[] } {
  return {
    pageKinds: kinds.filter((k) => FIX_KIND_INFO[k].target === "page"),
    newFileKinds: kinds.filter((k) => FIX_KIND_INFO[k].target === "new_file"),
  };
}

/** A repo-relative path Marlo may write: no traversal, hidden/CI/secret files, or dependency folders. */
export function isSafeRepoPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 200) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  if (!/^[A-Za-z0-9._@()\[\]/-]+$/.test(path)) return false;
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  const lower = path.toLowerCase();
  if (parts.some((p) => p.startsWith(".") && p !== ".well-known")) return false;
  if (lower.startsWith("node_modules/") || lower.includes("/node_modules/")) return false;
  if (/(^|\/)(\.env|id_rsa)/.test(lower) || lower.endsWith(".pem") || lower.endsWith(".key")) return false;
  return true;
}
