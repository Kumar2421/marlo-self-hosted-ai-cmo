/**
 * Turns a raw SEOAgent finding into the two things a non-technical website
 * owner needs and doesn't currently get anywhere in the product: why the
 * issue matters, and a concrete next step — grounded in the finding's own
 * evidence, never an invented traffic/ranking/revenue claim.
 */

import { lighthouseAuditId, lighthouseGuide } from "./lighthouseAudits.ts";

export type FindingExplanation = {
  whyItMatters: string;
  recommendation: string;
};

type EvidenceValue = string | number | null;
type Evidence = Record<string, EvidenceValue>;

function str(evidence: Evidence, key: string): string {
  const value = evidence[key];
  return typeof value === "string" ? value : "";
}

function num(evidence: Evidence, key: string): number | undefined {
  const value = evidence[key];
  return typeof value === "number" ? value : undefined;
}

export function explainFinding(finding: { issueId: string; evidence: Evidence }): FindingExplanation {
  const { issueId, evidence } = finding;

  if (issueId.startsWith("lighthouse-")) {
    const device = str(evidence, "device") || "selected";
    const mode = str(evidence, "mode") || "diagnostic";
    const displayValue = str(evidence, "displayValue");
    const guide = lighthouseGuide(lighthouseAuditId({ entityId: issueId, evidence }));
    if (guide) {
      return {
        whyItMatters: `${guide.what} Lighthouse found this on the ${device} version of your page${displayValue ? ` (${displayValue})` : ""}.`,
        recommendation: `${guide.fix} To check it: ${guide.verify}`,
      };
    }
    return {
      whyItMatters: displayValue
        ? `Lighthouse detected a ${mode} issue on the ${device} experience (${displayValue}). It is part of the measured page experience and should be reviewed alongside the other audit findings.`
        : `Lighthouse detected a ${mode} issue on the ${device} experience. It is part of the measured page experience and should be reviewed alongside the other audit findings.`,
      recommendation: "Review the Lighthouse audit detail, address the underlying page or application issue, then re-run the audit to verify the result.",
    };
  }

  switch (issueId) {
    case "robots-txt-disallow":
      return {
        whyItMatters:
          "Search engines that follow robots.txt won't crawl or index this page, so it can't appear in search results at all.",
        recommendation: `Check robots.txt for a Disallow rule matching ${str(evidence, "path") || "this page"} and remove or narrow it if the page should be indexable.`,
      };

    case "meta-title-missing":
      return {
        whyItMatters:
          "Without a <title> tag, search engines and browser tabs fall back to the raw URL or auto-generated text instead of a title you control.",
        recommendation: "Add a <title> tag in the page's <head> with a concise, descriptive title.",
      };

    case "meta-title-too-long": {
      const length = num(evidence, "length");
      return {
        whyItMatters: `Search engines typically show only the first ~60 characters of a title in results${length ? `; yours is ${length}` : ""}, so the end gets cut off.`,
        recommendation: "Shorten the title to under 60 characters, keeping the most important words near the start.",
      };
    }

    case "meta-description-missing":
      return {
        whyItMatters:
          "Without a meta description, search engines generate their own summary for the search-result snippet — often an unrelated sentence pulled from the page.",
        recommendation: "Add a <meta name=\"description\"> tag with a 1-2 sentence summary of the page.",
      };

    case "meta-description-too-long": {
      const length = num(evidence, "length");
      return {
        whyItMatters: `Search engines typically truncate descriptions around 160 characters${length ? `; yours is ${length}` : ""}, so part of it won't show in results.`,
        recommendation: "Shorten the description to under 160 characters.",
      };
    }

    case "canonical-missing":
      return {
        whyItMatters:
          "Without a canonical tag, search engines have to guess which URL is the authoritative version of this page, which can split ranking signals across duplicate or parameterized URLs.",
        recommendation: `Add <link rel="canonical" href="${str(evidence, "url") || "this page's URL"}"> to the page's <head>.`,
      };

    case "heading-h1-missing":
      return {
        whyItMatters:
          "The H1 heading tells both users and search engines what the page is primarily about. Without one, that signal is missing.",
        recommendation: "Add a single <h1> tag containing the page's main heading.",
      };

    case "heading-h1-multiple": {
      const count = num(evidence, "h1Count");
      return {
        whyItMatters: `This page has ${count ?? "more than one"} <h1> tags. Multiple H1s dilute the single "this page is about X" signal search engines and screen readers rely on.`,
        recommendation: "Keep one <h1> for the main heading and change the others to <h2> or lower.",
      };
    }

    case "heading-order-skip": {
      const from = num(evidence, "fromLevel");
      const to = num(evidence, "toLevel");
      return {
        whyItMatters: `The heading order jumps from h${from ?? "?"} to h${to ?? "?"} with no heading level in between, which makes the page's structure harder to follow for screen readers and search engines.`,
        recommendation: `Add the missing heading level(s) between h${from ?? "?"} and h${to ?? "?"}, or renumber so the sequence doesn't skip.`,
      };
    }

    case "og-tags-missing":
      return {
        whyItMatters:
          "Without Open Graph tags, links to this page shared on Facebook, LinkedIn, or Slack show a blank or generic preview instead of a title, description, and image.",
        recommendation: `Add Open Graph meta tags (${str(evidence, "missing") || "og:title, og:description, og:image"}) to the page's <head>.`,
      };

    case "og-tags-partial":
      return {
        whyItMatters:
          "The Open Graph tags this page is missing control part of how its link preview looks when shared on Facebook, LinkedIn, or Slack.",
        recommendation: `Add the missing Open Graph tags: ${str(evidence, "missing") || "the missing ones listed above"}.`,
      };

    case "twitter-tags-missing":
      return {
        whyItMatters:
          "Without Twitter Card tags, links to this page shared on X/Twitter show a plain link instead of a rich preview card.",
        recommendation: `Add Twitter Card meta tags (${str(evidence, "missing") || "twitter:card"}) to the page's <head>.`,
      };

    default:
      // Defensive fallback for a future issueId added to SEOAgent without a
      // matching case here — still honest (no invented claim), just generic.
      return {
        whyItMatters: "This affects how search engines or link previews read this page.",
        recommendation: "Review the flagged element on the page and correct it, then re-run the audit to confirm.",
      };
  }
}
