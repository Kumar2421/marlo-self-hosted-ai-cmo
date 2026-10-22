/**
 * Pure validation for POST /api/waitlist. No IO, no framework imports, so it is
 * unit-tested with node --test (tests/waitlistValidate.test.mts).
 */

export const WAITLIST_PLANS = ["free", "lite", "pro", "selfhost-interest"] as const;
export type WaitlistPlan = (typeof WAITLIST_PLANS)[number];

export const WAITLIST_INTERVALS = ["monthly", "annual"] as const;
export type WaitlistInterval = (typeof WAITLIST_INTERVALS)[number];

/** marketing_leads.source for rows written by this form. */
export const WAITLIST_SOURCE = "pricing_waitlist";

export const EMAIL_MAX_LENGTH = 254;
export const WEBSITE_MAX_LENGTH = 300;
/** Name of the hidden honeypot field. Humans never see or fill it. */
export const HONEYPOT_FIELD = "company_url";

export type WaitlistInput = {
  email: string;
  website: string | null;
  plan: WaitlistPlan;
  interval: WaitlistInterval;
};

export type WaitlistField = "email" | "website" | "plan" | "interval";

export type WaitlistResult =
  | { ok: true; value: WaitlistInput }
  /** A bot filled the honeypot. The route answers with the normal success response and stores nothing. */
  | { ok: false; reason: "honeypot" }
  | { ok: false; reason: "invalid"; field: WaitlistField; message: string };

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  if (CONTROL_CHARS.test(email)) return false;
  if (!EMAIL_PATTERN.test(email)) return false;
  const at = email.lastIndexOf("@");
  if (at < 1 || at > 64) return false;
  const domain = email.slice(at + 1);
  return !domain.startsWith(".") && !domain.endsWith(".") && !domain.includes("..");
}

/**
 * Normalizes an optional website to an http(s) URL string, or null when blank.
 * Returns undefined when the value is not a usable URL. A missing scheme gets https://.
 * Syntax only: this never fetches or resolves the URL.
 */
export function normalizeWebsite(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > WEBSITE_MAX_LENGTH || CONTROL_CHARS.test(trimmed) || /\s/.test(trimmed)) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return undefined;
  const text = url.toString();
  return text.length > WEBSITE_MAX_LENGTH ? undefined : text;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function invalid(field: WaitlistField, message: string): WaitlistResult {
  return { ok: false, reason: "invalid", field, message };
}

export function validateWaitlist(body: unknown): WaitlistResult {
  const data = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  const trap = data[HONEYPOT_FIELD];
  if (typeof trap === "string" ? trap.trim() !== "" : trap !== undefined && trap !== null && trap !== false) {
    return { ok: false, reason: "honeypot" };
  }

  const rawEmail = data.email;
  if (typeof rawEmail !== "string") return invalid("email", "Enter a valid email address.");
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return invalid("email", "Enter a valid email address.");

  let website: string | null = null;
  if (data.website !== undefined && data.website !== null) {
    if (typeof data.website !== "string") return invalid("website", "Enter a valid website, like example.com.");
    const normalized = normalizeWebsite(data.website);
    if (normalized === undefined) return invalid("website", "Enter a valid website, like example.com.");
    website = normalized;
  }

  if (!oneOf(WAITLIST_PLANS, data.plan)) return invalid("plan", "Choose a plan.");

  let interval: WaitlistInterval = "monthly";
  if (data.interval !== undefined && data.interval !== null) {
    if (!oneOf(WAITLIST_INTERVALS, data.interval)) return invalid("interval", "Choose monthly or annual billing.");
    interval = data.interval;
  }

  return { ok: true, value: { email, website, plan: data.plan, interval } };
}

/** The marketing_leads.message value, e.g. "plan=lite;interval=annual". */
export function waitlistMessage(plan: WaitlistPlan, interval: WaitlistInterval): string {
  return `plan=${plan};interval=${interval}`;
}

/** SQL LIKE pattern that matches every message stored for one plan (any interval). */
export function waitlistPlanPrefix(plan: WaitlistPlan): string {
  return `plan=${plan};%`;
}
