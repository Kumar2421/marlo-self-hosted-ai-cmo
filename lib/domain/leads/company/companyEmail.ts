/**
 * Which of the addresses found on a company's site is worth writing a first message to. The site reader returns
 * every address it sees; for outreach, press, careers, investor-relations and legal inboxes are not the person
 * to ask, so they are skipped, and a general contact address is preferred.
 */

/**
 * Words that mark an inbox as never the right place for a cold first message. Matched against each word of the
 * address (split on . _ - +), so "gap_press" and "media-enquiries" are caught but a name like "prakash" is not.
 */
const NOT_FOR_OUTREACH_WORDS = new Set([
  "noreply", "donotreply", "mailerdaemon", "postmaster", "webmaster", "abuse", "privacy", "legal", "compliance", "security",
  "career", "careers", "job", "jobs", "hr", "recruit", "recruiting", "recruitment", "press", "media", "pr", "news", "editor",
  "editorial", "correction", "corrections", "investor", "investors", "ir", "shareholder", "shareholders", "billing", "unsubscribe", "dpo", "gdpr",
]);

function words(email: string): string[] {
  return localPart(email).replace(/no[-_.]?reply/g, "noreply").replace(/do[-_.]?not[-_.]?reply/g, "donotreply").split(/[._+-]+/).filter(Boolean);
}

/** Roughly best to worst for a first message; anything not listed ranks after these. */
const PREFERRED = ["hello", "hi", "contact", "info", "enquiries", "enquiry", "inquiries", "inquiry", "sales", "team", "office", "mail", "admin", "support", "help"];

function localPart(email: string): string {
  return email.slice(0, email.lastIndexOf("@")).toLowerCase();
}

export function isOutreachInbox(email: string): boolean {
  return !words(email).some((w) => NOT_FOR_OUTREACH_WORDS.has(w));
}

function rank(email: string): number {
  const i = PREFERRED.indexOf(localPart(email));
  return i === -1 ? PREFERRED.length : i;
}

/** The best address for a first message, or null when every address found is a press, careers, legal or similar inbox. */
export function pickOutreachEmail(emails: readonly string[]): string | null {
  const usable = emails.filter(isOutreachInbox);
  if (usable.length === 0) return null;
  // Stable: the reader already puts the company's own-domain addresses first, which breaks ties.
  return [...usable].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}
