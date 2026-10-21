/**
 * Every plain-language sentence the Today overview can show lives here, so the wording can be
 * reviewed in one place. Rules: no search-engine jargon, one short sentence, say what to do and
 * why it matters. `BANNED_WORDS` is enforced by tests/rankNextActions.test.mts.
 */

export const BANNED_WORDS = [
  "regex",
  "entity",
  "dimension",
  "schema",
  "canonical",
  "serp",
  "ctr",
  "json-ld",
  "structured data",
  "crawl",
  "indexability",
  "backlink",
] as const;

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const COPY = {
  reviewPr: {
    title: (prTitle?: string) => (prTitle?.trim() ? `Review the fix: ${prTitle.trim()}` : "Review a fix that is ready for you"),
    why: "Marlo already wrote this change, so it only takes a quick look to get it live.",
    cta: "Review fix",
  },
  fixFinding: {
    fixableTitle: (label: string) => `Let Marlo fix: ${label}`,
    manualTitle: (label: string) => `Fix: ${label}`,
    whyBySeverity: {
      critical: "This is hurting your site right now, so it is worth fixing first.",
      warning: "This can hold your pages back in search, and fixing it is a clear win.",
      info: "This is a small improvement that helps your pages over time.",
    },
    whyFailed: "A recheck found this is still not fixed, so it needs another look.",
    ctaFixable: "Prepare fix",
    ctaManual: "See what to do",
  },
  verifyFix: {
    title: (label: string) => `Check that the fix worked: ${label}`,
    why: "A quick check confirms the problem is really gone before you move on.",
    cta: "Check the fix",
  },
  connect: {
    gsc: {
      title: "Connect Google Search Console",
      why: "Without it Marlo cannot see how people find you on Google, so there is nothing to improve yet.",
      cta: "Connect Google",
    },
    github: {
      title: "Connect your GitHub code",
      why: "Once connected, Marlo can prepare fixes for you to approve instead of you editing code.",
      cta: "Connect GitHub",
    },
    ga4: {
      title: "Connect Google Analytics",
      why: "It shows how many visitors your changes bring in.",
      cta: "Connect Analytics",
    },
    gmail: {
      title: "Connect your email",
      why: "Marlo needs it to send your outreach and spot replies.",
      cta: "Connect email",
    },
    cms: {
      title: "Connect your website editor",
      why: "It lets Marlo publish approved content changes for you.",
      cta: "Connect website",
    },
  },
  runAudit: {
    neverTitle: "Run your first site check",
    neverWhy: "Marlo has not looked at your site yet, so there is nothing to act on.",
    staleTitle: "Run a fresh site check",
    staleWhy: (days: number) => `Your last check was ${plural(days, "day")} ago, so new problems could be hiding.`,
    cta: "Run check",
  },
  sendOutreach: {
    title: (n: number) => `Send ${plural(n, "queued email")} to your leads`,
    why: "These leads are ready to hear from you, and a quick follow-up is when replies come.",
    cta: "Review emails",
  },
  celebrate: {
    title: "You are all caught up",
    why: (nextCheck: string) => `Nothing needs your attention right now, and Marlo will look again on ${nextCheck}.`,
    cta: "View your site",
  },
} as const;

export const CHECKLIST_COPY = {
  reviewPrs: (n: number) => `Review ${plural(n, "fix PR")}`,
  checkFindings: "Check new findings",
  reviewActions: (n: number) => `Approve ${plural(n, "suggested change")}`,
  sendOutreach: "Send queued outreach",
  progress: (done: number, total: number) => (total === 0 ? "Nothing to do today" : `${done} of ${total} done`),
} as const;
