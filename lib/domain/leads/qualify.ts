/**
 * What makes a lead "qualified": the user can actually reach them, and Marlo can say why they fit and where
 * it found them. One rule, shared by every lead source, so the Leads panel and outreach agree.
 *
 * Reachable = an email printed on a page Marlo read, a WhatsApp number, or a LinkedIn profile URL.
 * A guessed email (pattern + mail-server check) is never reachable here: it may bounce or reach nobody.
 */

import { isRedditPostUrl } from "./intent/redditPosts.ts";

export type Channel = "email" | "whatsapp" | "linkedin" | "reddit";

export type QualifyInput = {
  /** Email as stored. Only counts when it was found on a page (see emailGuessed). */
  email?: string | null;
  /** True when Marlo generated the address rather than reading it (leads.email_verified, email_quality). */
  emailGuessed?: boolean;
  whatsapp?: string | null;
  /** Any URL for the lead: a LinkedIn profile URL makes LinkedIn a channel. */
  sourceUrl?: string | null;
  linkedinUrl?: string | null;
  /** One line on why this lead fits the confirmed profile. */
  fitReason?: string | null;
};

export type Qualification = {
  qualified: boolean;
  channels: Channel[];
  /** Why not, in the user's words, when qualified is false. Empty when qualified. */
  missing: string[];
};

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function httpUrl(value: string | null | undefined): URL | null {
  try {
    const u = new URL((value ?? "").trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** A real person/company LinkedIn page, not a search, job or feed URL. */
export function isLinkedInProfileUrl(value: string | null | undefined): boolean {
  const u = httpUrl(value);
  if (!u) return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return false;
  return /^\/(in|company)\/[^/]+/i.test(u.pathname);
}

/** Digits only, 8 to 15 long (E.164 allows 15). Anything else is not a number to message. */
export function normalizeWhatsapp(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function qualifyLead(input: QualifyInput): Qualification {
  const channels: Channel[] = [];
  const email = (input.email ?? "").trim();
  if (email && EMAIL_RE.test(email) && !input.emailGuessed) channels.push("email");
  if (normalizeWhatsapp(input.whatsapp)) channels.push("whatsapp");
  if (isLinkedInProfileUrl(input.linkedinUrl) || isLinkedInProfileUrl(input.sourceUrl)) channels.push("linkedin");
  // A Reddit post someone wrote asking for help: the user can answer it, from their own account.
  if (isRedditPostUrl(input.sourceUrl)) channels.push("reddit");

  const missing: string[] = [];
  if (channels.length === 0) missing.push(input.emailGuessed && email ? "Only a guessed email, which may bounce" : "No way to reach them yet");
  if (!(input.fitReason ?? "").trim()) missing.push("No reason it fits your profile");
  if (!httpUrl(input.sourceUrl)) missing.push("No source page");

  return { qualified: missing.length === 0, channels, missing };
}
