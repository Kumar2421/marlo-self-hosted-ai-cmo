import { isQualified } from "./leadListView.ts";
import { statusFromTags, type LeadStatus } from "./local/businessLead.ts";

/**
 * Outreach progress for the top bar: how many leads qualify, how many were reached, how many replied, and where the
 * 7-day window stands. The goal is one real reply within 7 days of the first message. WhatsApp and LinkedIn replies
 * happen outside Marlo, so "replied" is whatever the user marked, plus email replies found through Gmail.
 * Pure: every rule is unit-tested.
 */

export const OUTCOME_WINDOW_DAYS = 7;

export type OutcomeLead = {
  email: string | null | undefined;
  email_verified?: number | boolean | null;
  email_quality?: string | null;
  whatsapp?: string | null;
  source_url?: string | null;
  fit_reason?: string | null;
  email_status?: string | null;
  emailed_at?: string | null;
  last_reply_at?: string | null;
  last_reply_snippet?: string | null;
  tags?: readonly string[] | null;
};

export type OutcomeSummary = {
  total: number;
  qualified: number;
  reached: number;
  replied: number;
  /** YYYY-MM-DD of the first message, or null before any. */
  startedAt: string | null;
  /** 1-based day of the window, or null before any message. Can exceed 7. */
  day: number | null;
  windowOver: boolean;
};

const REACHED_PREFIX = "reached:";
const DAY_MS = 24 * 3600 * 1000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The date a lead was first marked contacted or replied, from its `reached:YYYY-MM-DD` tag. */
export function reachedDateFromTags(tags: readonly string[] | null | undefined): string | null {
  for (const tag of tags ?? []) {
    if (tag.startsWith(REACHED_PREFIX)) {
      const value = tag.slice(REACHED_PREFIX.length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    }
  }
  return null;
}

/** Adds a `reached:` date tag the first time a lead moves to contacted or replied; never changes an existing one. */
export function stampReached(tags: readonly string[], status: LeadStatus, now: Date): string[] {
  const next = [...tags];
  if ((status === "contacted" || status === "replied") && reachedDateFromTags(next) === null) next.push(`${REACHED_PREFIX}${isoDay(now)}`);
  return next;
}

function isReached(lead: OutcomeLead): boolean {
  if (lead.email_status === "sent") return true;
  const status = statusFromTags(lead.tags);
  return status === "contacted" || status === "replied";
}

function isReplied(lead: OutcomeLead): boolean {
  return Boolean(lead.last_reply_at || lead.last_reply_snippet) || statusFromTags(lead.tags) === "replied";
}

/** The day a lead was reached: the email send date, else its reached tag. Null when neither is known. */
function reachedDay(lead: OutcomeLead): string | null {
  if (lead.email_status === "sent" && lead.emailed_at && /^\d{4}-\d{2}-\d{2}/.test(lead.emailed_at)) return lead.emailed_at.slice(0, 10);
  return reachedDateFromTags(lead.tags);
}

export function computeOutcomes(leads: readonly OutcomeLead[], now: Date = new Date()): OutcomeSummary {
  let reached = 0;
  let replied = 0;
  let start: string | null = null;
  for (const lead of leads) {
    if (isReached(lead)) {
      reached += 1;
      const day = reachedDay(lead);
      if (day && (start === null || day < start)) start = day;
    }
    if (isReplied(lead)) replied += 1;
  }
  let day: number | null = null;
  if (start) {
    const elapsed = Math.floor((Date.parse(isoDay(now)) - Date.parse(start)) / DAY_MS);
    day = Math.max(1, elapsed + 1);
  }
  return {
    total: leads.length,
    qualified: leads.filter(isQualified).length,
    reached,
    replied,
    startedAt: start,
    day,
    windowOver: day !== null && day > OUTCOME_WINDOW_DAYS,
  };
}

/** The one line for the top bar, and the full sentence for its tooltip. */
export function outcomeLine(s: OutcomeSummary): { display: string; title: string } {
  const detail = `${s.qualified} qualified, ${s.reached} reached, ${s.replied} replied.`;
  const goal = `Goal: one real reply within ${OUTCOME_WINDOW_DAYS} days of the first message.`;
  if (s.total === 0) return { display: "No leads yet", title: `Outreach: no leads yet. ${goal}` };
  if (s.reached === 0) return { display: `${s.qualified} qualified · none reached yet`, title: `Outreach: ${detail} ${goal}` };
  const counts = `${s.reached} reached · ${s.replied} replied`;
  if (s.windowOver) return { display: `${OUTCOME_WINDOW_DAYS} days done · ${counts}`, title: `Outreach: ${detail} First message ${s.startedAt ?? "earlier"}; the ${OUTCOME_WINDOW_DAYS}-day window has passed. ${goal}` };
  const when = s.day === null ? "" : `Day ${s.day} of ${OUTCOME_WINDOW_DAYS} · `;
  return { display: `${when}${counts}`, title: `Outreach: ${detail} ${s.startedAt ? `First message ${s.startedAt}. ` : ""}${goal}` };
}
