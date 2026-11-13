import { signalsFromReason } from "./company/buyingSignals.ts";
import { isLinkedInProfileUrl, normalizeWhatsapp } from "./qualify.ts";

/**
 * Reaching a lead on WhatsApp or LinkedIn. Marlo never sends on these channels: it writes a short, honest
 * message from facts it already holds, and the user sends it from their own account (a wa.me link, or copy and
 * open the profile). Pure, so every rule is unit-tested.
 */

export type ReachChannel = "whatsapp" | "linkedin";

/** LinkedIn connection notes are capped at 300 characters; WhatsApp has room but short messages get answered. */
export const REACH_LIMITS: Record<ReachChannel, number> = { whatsapp: 600, linkedin: 300 };

export type ReachLead = {
  name: string;
  company?: string | null;
  title?: string | null;
  lead_type?: string | null;
  website?: string | null;
  /** The saved fit reason; a "Signals: ..." sentence in it gives the opener. */
  fit_reason?: string | null;
};

export type ReachContext = {
  lead: ReachLead;
  /** The sender's name and business, as typed in the outreach sender profile. Either may be empty. */
  sender: { name?: string; company?: string };
  /** The project's own name, used when the sender gave no business name. */
  projectName: string;
  /** What the user's site says they sell and to whom, when Marlo read it (Offer Model). */
  offer?: { sells?: string; whoPays?: string } | null;
};

/** https://wa.me/<digits>?text=<message>, or null when the number is not a usable phone number. */
export function waLink(number: string | null | undefined, text: string): string | null {
  const digits = normalizeWhatsapp(number);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** A clean https LinkedIn profile URL, or null. Never returns a javascript: or non-LinkedIn address. */
export function linkedInProfileUrl(url: string | null | undefined): string | null {
  if (!isLinkedInProfileUrl(url)) return null;
  const u = new URL((url ?? "").trim());
  return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function hostOf(website: string | null | undefined): string {
  try {
    return new URL((website ?? "").trim()).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * A short message in the sender's voice. Required: greeting, who is writing, a closing question. Optional, dropped
 * (the offer line first, then the hook) when the channel's length limit would be exceeded. Never states a fact that
 * is not in the lead, the sender profile or the Offer Model.
 */
export function buildReachMessage(channel: ReachChannel, ctx: ReachContext): string {
  const { lead, sender } = ctx;
  const isCompany = lead.lead_type === "company" || lead.lead_type === "business";
  const business = (sender.company ?? "").trim() || ctx.projectName.trim();
  const me = (sender.name ?? "").trim();

  const greeting = isCompany ? `Hi ${lead.name} team,` : firstName(lead.name) ? `Hi ${firstName(lead.name)},` : "Hi,";
  const intro = me ? `I'm ${me}${business ? ` from ${business}` : ""}.` : business ? `This is ${business}.` : "";

  let hook = "";
  if (isCompany) {
    const host = hostOf(lead.website);
    const signals = signalsFromReason(lead.fit_reason);
    // A signal the site itself states is a better, checkable opener than "I came across your site".
    const noticed = signals.includes("hiring") ? "you're hiring" : signals.includes("new_location") ? "your new location" : "";
    hook = noticed ? `I noticed ${noticed}${host ? ` on ${host}` : ""}.` : host ? `I came across ${host}.` : "";
  } else if (lead.title && lead.company) {
    hook = `I saw you're ${lead.title} at ${lead.company}.`;
  } else if (lead.company) {
    hook = `I saw you work at ${lead.company}.`;
  }

  const sells = (ctx.offer?.sells ?? "").trim();
  const whoPays = (ctx.offer?.whoPays ?? "").trim();
  const offer = sells ? `We offer ${sells}${whoPays ? ` for ${whoPays}` : ""}.` : "";

  const close = "Would a quick chat be useful?";
  const limit = REACH_LIMITS[channel];
  // The greeting stands alone on the first line; the rest reads as one short paragraph.
  const join = (parts: string[]) => parts[0] + "\n\n" + parts.slice(1).filter(Boolean).join(" ");

  for (const optional of [[hook, offer], [hook], []]) {
    const text = join([greeting, intro, ...optional, close]);
    if (text.length <= limit) return text;
  }
  const bare = join([greeting, intro, close]);
  return bare.length <= limit ? bare : `${bare.slice(0, limit - 1).trimEnd()}…`;
}
