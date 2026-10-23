import {
  OUTREACH_DAILY_CAP,
  OUTREACH_REPEAT_DAYS,
  outreachCreditCost,
  type OutreachBlockReason,
  type OutreachPlanResponse,
  type OutreachStatus,
} from "./outreachContract.ts";

/**
 * The single decision function behind both the plan endpoint and the send endpoint (send re-runs it
 * server-side, so the client's idea of the plan is never trusted). Pure.
 *
 * Rules, applied per lead in selection order (the order of `leadIds`, duplicates ignored):
 *   1. no usable email                      -> no_email
 *   2. address on the user's stop list      -> unsubscribed
 *   3. emailed by this user in the last 30 days (exactly 30 days ago is allowed again), or the same
 *      address already appears earlier in this selection -> recent
 *   4. address was guessed by Marlo and the user has not accepted -> guessed
 *   5. the day's cap is used up (cap counts sends since 00:00 UTC today; applied in selection order) -> over_cap
 */

export type PlanLead = {
  id: string;
  email: string | null;
  /** leads.email_verified: true only when Marlo generated the address by pattern and SMTP-checked it. */
  emailVerified?: boolean | number | null;
  /** leads.email_quality (business leads). 'pattern_candidate' also means guessed. */
  emailQuality?: string | null;
};

export type PlanFacts = {
  leadIds: string[];
  leads: PlanLead[];
  acceptGuessed: boolean;
  /** Lowercased addresses this user must never email. */
  optedOut: ReadonlySet<string>;
  /** Lowercased address -> most recent send time by this user. */
  lastSent: ReadonlyMap<string, Date>;
  sentToday: number;
  now: Date;
};

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(e) ? e : null;
}

/**
 * A "guessed" address is one Marlo generated (first.last@company.com and similar) and then SMTP-checked,
 * rather than found on a page. leads.email_verified is set to true by exactly that path
 * (guessAndVerifyEmail via verifyMissingEmails: `email_verified = !lead.email && !!verifiedEmail`), and
 * never for an address printed on a page. 'pattern_candidate' (a reserved email_quality value) counts too.
 */
export function isGuessedLead(lead: Pick<PlanLead, "emailVerified" | "emailQuality">): boolean {
  return Boolean(lead.emailVerified) || lead.emailQuality === "pattern_candidate";
}

/** 00:00 UTC of the day containing `now`. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Sends at or before this instant no longer block a repeat; sends strictly newer are "recent". */
export function repeatCutoff(now: Date): Date {
  return new Date(now.getTime() - OUTREACH_REPEAT_DAYS * 24 * 3600 * 1000);
}

export function outreachStatusOf(sentToday: number): OutreachStatus {
  const sent = Math.max(0, sentToday);
  return { dailyCap: OUTREACH_DAILY_CAP, sentToday: sent, remainingToday: Math.max(0, OUTREACH_DAILY_CAP - sent) };
}

export function planOutreach(facts: PlanFacts): OutreachPlanResponse {
  const byId = new Map(facts.leads.map((l) => [l.id, l]));
  const cutoff = repeatCutoff(facts.now).getTime();
  const sendable: string[] = [];
  const blocked: OutreachPlanResponse["blocked"] = [];
  const guessedIds: string[] = [];
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  let remaining = Math.max(0, OUTREACH_DAILY_CAP - facts.sentToday);

  const block = (leadId: string, reason: OutreachBlockReason) => blocked.push({ leadId, reason });

  for (const leadId of facts.leadIds) {
    if (seenIds.has(leadId)) continue;
    seenIds.add(leadId);
    const lead = byId.get(leadId);
    const email = lead ? normalizeEmail(lead.email) : null;
    if (!lead || !email) {
      block(leadId, "no_email");
      continue;
    }
    if (facts.optedOut.has(email)) {
      block(leadId, "unsubscribed");
      continue;
    }
    const last = facts.lastSent.get(email);
    if ((last && last.getTime() > cutoff) || seenEmails.has(email)) {
      block(leadId, "recent");
      continue;
    }
    seenEmails.add(email);
    const guessed = isGuessedLead(lead);
    if (guessed) guessedIds.push(leadId);
    if (guessed && !facts.acceptGuessed) {
      block(leadId, "guessed");
      continue;
    }
    if (remaining <= 0) {
      block(leadId, "over_cap");
      continue;
    }
    remaining -= 1;
    sendable.push(leadId);
  }

  return { sendable, blocked, guessedIds, status: outreachStatusOf(facts.sentToday), creditCost: outreachCreditCost(sendable.length) };
}
