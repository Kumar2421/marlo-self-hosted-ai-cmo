import { classifyFinding } from "../codefix/fixCatalog.ts";
import { LIGHTHOUSE_CATEGORY_LABEL, lighthouseAuditId, lighthouseCategoryOf, lighthouseGuide } from "../seo/lighthouseAudits.ts";
import type { Recommendation, RecommendationPriority, RecommendationType } from "./recommendationTypes.ts";

/**
 * Plain-language recommendations for the findings Marlo itself creates: the
 * SEO audit's issue ids, the AI-readiness (GEO) checks and Lighthouse audits.
 * Keyed on what the finding IS (source + entityId), never on page evidence that
 * only some sources carry. Each entry gives a title, why it matters and ONE
 * concrete next action. An id with no entry gets a generic review step, never a
 * specific recommendation that could be wrong.
 */

export type CatalogFinding = {
  source?: string;
  category?: string;
  entityId: string;
  evidence: Record<string, unknown>;
};

export type CatalogEntry = {
  type: RecommendationType;
  title: string;
  summary: string;
  priority: RecommendationPriority;
  /** Used when Marlo cannot write the change as code. */
  kind: Recommendation["implementation"]["kind"];
  action: string;
  evidence: Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

type StaticEntry = Omit<CatalogEntry, "evidence">;

const SEO_AUDIT: Record<string, (e: Record<string, unknown>) => StaticEntry> = {
  "robots-txt-disallow": (e) => ({
    type: "seo_issue",
    title: "Let search engines crawl this page",
    summary: "A robots.txt rule tells search engines to skip this page, so it cannot show up in search results.",
    priority: "high",
    kind: "manual",
    action: `Open your robots.txt, find the Disallow rule that matches ${text(e.path) || "this page"}, and remove or narrow it if the page should be found in search.`,
  }),
  "meta-title-missing": () => ({
    type: "seo_issue",
    title: "Add a page title",
    summary: "Without a title, search results and browser tabs show the bare web address instead of words you chose.",
    priority: "high",
    kind: "code",
    action: "Add a <title> tag to the page head with a short, descriptive title that names the page's topic.",
  }),
  "meta-title-too-long": () => ({
    type: "seo_issue",
    title: "Shorten the page title",
    summary: "Search results cut titles off after about 60 characters, so the end of yours is hidden.",
    priority: "medium",
    kind: "code",
    action: "Rewrite the title to under 60 characters with the most important words first.",
  }),
  "meta-description-missing": () => ({
    type: "seo_issue",
    title: "Add a meta description",
    summary: "Without one, search engines pick their own snippet, often an unrelated sentence from the page.",
    priority: "high",
    kind: "code",
    action: "Add a <meta name=\"description\"> tag with a one or two sentence summary of the page.",
  }),
  "meta-description-too-long": () => ({
    type: "seo_issue",
    title: "Shorten the meta description",
    summary: "Search results cut descriptions off around 160 characters, so part of yours is hidden.",
    priority: "medium",
    kind: "code",
    action: "Rewrite the meta description to under 160 characters.",
  }),
  "canonical-missing": () => ({
    type: "missing_canonical",
    title: "Add a canonical URL",
    summary: "Without a canonical tag, search engines have to guess which address is the main version of this page.",
    priority: "medium",
    kind: "code",
    action: "Add a <link rel=\"canonical\"> tag to the page head pointing at this page's final public address.",
  }),
  "heading-h1-missing": () => ({
    type: "seo_issue",
    title: "Add a main heading",
    summary: "The main heading (H1) tells people and search engines what the page is about, and this page has none.",
    priority: "high",
    kind: "content",
    action: "Add one H1 heading that states the page's main topic.",
  }),
  "heading-h1-multiple": () => ({
    type: "seo_issue",
    title: "Keep a single main heading",
    summary: "More than one H1 blurs which topic the page is mainly about.",
    priority: "medium",
    kind: "content",
    action: "Keep one H1 for the main topic and change the other H1 headings to H2.",
  }),
  "heading-order-skip": () => ({
    type: "seo_issue",
    title: "Fix the heading order",
    summary: "The headings jump a level (for example H1 straight to H3), which makes the page harder to follow for screen readers and search engines.",
    priority: "low",
    kind: "content",
    action: "Add the missing heading level between the two headings, or renumber so the order does not skip.",
  }),
  "og-tags-missing": (e) => ({
    type: "seo_issue",
    title: "Add link preview tags",
    summary: "Links to this page shared on social apps and chat show a blank or generic preview.",
    priority: "medium",
    kind: "code",
    action: `Add Open Graph tags (${text(e.missing) || "og:title, og:description, og:image"}) to the page head.`,
  }),
  "og-tags-partial": (e) => ({
    type: "seo_issue",
    title: "Complete the link preview tags",
    summary: "Some Open Graph tags are present, but the missing ones leave part of the shared link preview empty.",
    priority: "low",
    kind: "code",
    action: `Add the missing Open Graph tags: ${text(e.missing) || "the ones listed in the evidence"}.`,
  }),
  "twitter-tags-missing": (e) => ({
    type: "seo_issue",
    title: "Add X (Twitter) card tags",
    summary: "Links to this page shared on X show a plain link instead of a preview card.",
    priority: "low",
    kind: "code",
    action: `Add Twitter card tags (${text(e.missing) || "twitter:card"}) to the page head.`,
  }),
};

const GEO_READINESS: Record<string, StaticEntry> = {
  "llms-txt": {
    type: "geo_readiness",
    title: "Add an llms.txt file",
    summary: "AI tools look for /llms.txt to learn what your site is about. Without it they rely on guesses.",
    priority: "medium",
    kind: "manual",
    action: "Publish a short /llms.txt that says what your product does and links to your key pages.",
  },
  sitemap: {
    type: "geo_readiness",
    title: "Publish a sitemap",
    summary: "Without a sitemap, crawlers (including AI crawlers) may miss pages on your site.",
    priority: "medium",
    kind: "manual",
    action: "Publish /sitemap.xml and add a Sitemap line to robots.txt that points to it.",
  },
  schema: {
    type: "geo_readiness",
    title: "Add structured data to your homepage",
    summary: "Structured data (JSON-LD) states plainly who you are and what you offer, so AI answers can describe you correctly.",
    priority: "medium",
    kind: "manual",
    action: "Add Organization (and Product or SoftwareApplication) JSON-LD to your homepage.",
  },
  structure: {
    type: "geo_readiness",
    title: "Give your homepage a clear outline",
    summary: "AI tools quote pages that are easy to scan: one main heading, section headings and direct answers.",
    priority: "low",
    kind: "content",
    action: "Use exactly one H1, split the page into H2 sections, and add a short FAQ that answers real buyer questions.",
  },
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

/** An AI-answer gap: the action comes from who the AI named instead and which sources it read. */
function geoGapEntry(finding: CatalogFinding): StaticEntry {
  const prompt = text(finding.evidence.prompt) || finding.entityId.slice("geo-gap:".length);
  const named = strings(finding.evidence.namedInstead);
  const sources = strings(finding.evidence.sources);
  const steps: string[] = [];
  if (sources.length > 0) steps.push(`Get listed or mentioned on ${sources.join(", ")}, which the AI read for this question.`);
  steps.push("Publish a page that answers this exact question directly, with a short FAQ, and name your product in the first paragraph.");
  steps.push("Run the AI check again: this is verified when a later answer names you.");
  return {
    type: "geo_mention_gap",
    title: `Get named when AI is asked "${prompt}"`,
    summary: named.length > 0 ? `The AI named ${named.join(", ")} instead of you.` : "The AI answered this question without naming you.",
    priority: "medium",
    kind: "content",
    action: steps.join(" "),
  };
}

function geoEntry(finding: CatalogFinding): StaticEntry | null {
  const id = finding.entityId.toLowerCase();
  const known = GEO_READINESS[id];
  if (known) return known;
  if (id.startsWith("crawler-")) {
    const bot = text(finding.evidence.label).replace(/ allowed$/, "") || id.slice("crawler-".length);
    return {
      type: "geo_readiness",
      title: `Let ${bot} read your site`,
      summary: `Your robots.txt blocks ${bot}, so that AI tool cannot read your pages or mention you.`,
      priority: "medium",
      kind: "manual",
      action: `In robots.txt, remove the "Disallow: /" rule that applies to ${bot} if you want AI tools to read your site.`,
    };
  }
  const category = (finding.category ?? "").toLowerCase();
  if (category === "geo_gap" || id.startsWith("geo-gap:")) return geoGapEntry(finding);
  if (/mention|gap|visibility/.test(category) || /mention|gap/.test(id)) {
    return {
      type: "geo_mention_gap",
      title: "Get named in AI answers you are missing from",
      summary: "AI tools answered a question about your market without naming you.",
      priority: "medium",
      kind: "content",
      action: "Take the one question where you were not named and publish or update a page that answers it directly, naming your product.",
    };
  }
  return null;
}

/** Plain text for a Lighthouse audit title: PageSpeed wraps code in backticks, which would show up raw. */
function plainTitle(value: unknown): string {
  return text(value).replace(/`/g, "");
}

function lighthouseEntry(finding: CatalogFinding): StaticEntry {
  const mode = text(finding.evidence.mode) || "diagnostic";
  const device = text(finding.evidence.device) || "selected";
  const displayValue = text(finding.evidence.displayValue);
  const reported = plainTitle(finding.evidence.label);
  const score = typeof finding.evidence.score === "number" ? Math.round(finding.evidence.score * 100) : undefined;
  const priority = score !== undefined && score < 50 ? "high" : "medium";
  const category = lighthouseCategoryOf(finding);
  const guide = lighthouseGuide(lighthouseAuditId(finding));

  // A known audit: say what is wrong, how to fix it and how to check, using the finding's own evidence.
  if (guide) {
    const seen = [
      reported ? `Lighthouse reported on the ${device} version of your page: "${reported}"` : `Lighthouse measured this on the ${device} version of your page`,
      displayValue ? `(${displayValue})` : "",
    ].filter(Boolean).join(" ");
    return {
      type: "lighthouse_issue",
      title: guide.title,
      summary: `${guide.what} ${seen}.`,
      priority,
      kind: "manual",
      action: `${guide.fix} To check it: ${guide.verify}`,
    };
  }

  // An audit Marlo has no steps for: honest, neutral wording that claims no category it cannot name.
  const kindOfIssue = category ? `${LIGHTHOUSE_CATEGORY_LABEL[category]} ` : "performance, accessibility or best-practice ";
  return {
    type: "lighthouse_issue",
    title: mode === "opportunity" ? "Improve this speed opportunity" : "Address this Lighthouse check",
    summary: displayValue
      ? `${displayValue}. Lighthouse measured this on the ${device} version of your page.`
      : `Lighthouse measured a ${kindOfIssue}issue on the ${device} version of your page.`,
    priority,
    kind: "manual",
    action: "Open the audit details, make the smallest change that addresses it, then re-run the SEO audit to confirm the score improves.",
  };
}

const GENERIC: StaticEntry = {
  type: "review_finding",
  title: "Review this finding",
  summary: "Marlo has no specific steps for this kind of finding yet, so check the evidence above before changing anything.",
  priority: "low",
  kind: "manual",
  action: "Read the evidence, make the change if it applies to your site, then mark this finding as fixing and re-check it.",
};

/** The honest fallback for a finding with no specific steps: review it, never a wrong specific recommendation. */
export function genericEntry(finding: CatalogFinding): CatalogEntry {
  return { ...GENERIC, evidence: { source: finding.source, issue: finding.entityId } };
}

function isLighthouse(finding: CatalogFinding): boolean {
  return finding.entityId.startsWith("lighthouse-") || Boolean(finding.evidence.auditId && finding.evidence.device);
}

/**
 * The catalogue entry for a finding Marlo created itself (seo-audit, geo or a
 * Lighthouse audit), or null for other sources (search-console findings have
 * their own rules). An id with no entry yields the generic review step.
 */
export function catalogEntry(finding: CatalogFinding): CatalogEntry | null {
  const source = (finding.source ?? "").toLowerCase();
  const isGeo = source === "geo" || source.startsWith("geo-");
  if (source !== "seo-audit" && !isGeo && !isLighthouse(finding)) return null;

  let entry: StaticEntry | null = null;
  if (isLighthouse(finding)) entry = lighthouseEntry(finding);
  else if (isGeo) entry = geoEntry(finding);
  else entry = SEO_AUDIT[finding.entityId]?.(finding.evidence) ?? null;

  const base = entry ?? GENERIC;
  const evidence: Record<string, unknown> = { source: finding.source, issue: finding.entityId };

  // When Marlo can write this change as code, say so: the same classifier that powers "Fix in code" decides.
  const fix = classifyFinding({ source: finding.source ?? "", category: finding.category, entityId: finding.entityId, evidence: finding.evidence });
  if (fix.mode === "auto") {
    return {
      ...base,
      kind: "code",
      action: `${base.action} Or use "Fix in code" above and Marlo will prepare the ${fix.label} change for you to review.`,
      evidence: { ...evidence, fixInCode: fix.label },
    };
  }
  // "code" is only honest when the classifier agrees; otherwise it is a manual step.
  return { ...base, kind: base.kind === "code" ? "manual" : base.kind, evidence };
}
