import {
  FREQUENCIES, NOTIFICATION_CATEGORIES, categoryOf,
  type Frequency, type Notification, type NotificationCategory,
} from "./types.ts";

export type NotificationPrefs = {
  /** Per category. "off" means nothing at all (no email, no in-app item). */
  categories: Record<NotificationCategory, Frequency>;
  /** Pauses every email. In-app items still appear. */
  paused: boolean;
  /** IANA name (e.g. "Europe/Berlin"), saved from the browser; UTC when unknown. */
  timezone: string | null;
};

/**
 * The digest is the only category with its own daily/weekly rhythm. For the
 * rest, "instant" means an email of its own; "daily"/"weekly" means an in-app
 * item only, which the digest rolls up. Content (social drafts) is in-app
 * only by default and is never part of the digest.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
  categories: { digest: "weekly", outcomes: "instant", credits: "instant", approvals: "daily", integrations: "instant", content: "daily" },
  paused: false,
  timezone: null,
};

export function defaultPrefs(): NotificationPrefs {
  return { ...DEFAULT_PREFS, categories: { ...DEFAULT_PREFS.categories } };
}

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Read saved or user-submitted prefs, falling back to defaults for anything missing or malformed. Never throws. */
export function normalizePrefs(raw: unknown): NotificationPrefs {
  const out = defaultPrefs();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const cats = r.categories && typeof r.categories === "object" ? (r.categories as Record<string, unknown>) : {};
  for (const category of NOTIFICATION_CATEGORIES) {
    const value = cats[category];
    if (typeof value === "string" && (FREQUENCIES as readonly string[]).includes(value)) out.categories[category] = value as Frequency;
  }
  out.paused = r.paused === true;
  out.timezone = isValidTimezone(r.timezone) ? r.timezone : null;
  return out;
}

/** The user's local hour, weekday (0 = Sunday) and calendar date at `now`. */
export function localParts(now: Date, timezone: string | null): { hour: number; weekday: number; isoDate: string } {
  const tz = timezone && isValidTimezone(timezone) ? timezone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", hour: "numeric", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    hour: Number(get("hour")) % 24,
    weekday: weekdays.indexOf(get("weekday")),
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export type EmailDecision = "send" | "skip";

/**
 * Whether this notification should go out as its own email right now.
 * "skip": never (paused, unsubscribed, category off, or left for the digest).
 * There are no quiet hours: the job runs once a day (03:00 UTC on the hosted app) and
 * cannot target a user's local hour, so a quiet-hours window could only ever block mail.
 */
export function emailDecision(
  notification: Pick<Notification, "kind" | "payload">,
  state: { prefs: NotificationPrefs; unsubscribedAll: boolean },
): EmailDecision {
  const { prefs, unsubscribedAll } = state;
  if (unsubscribedAll || prefs.paused) return "skip";
  const category = categoryOf(notification.kind);
  const frequency = prefs.categories[category];
  if (frequency === "off") return "skip";
  // Content (social drafts) is in-app only, whatever the frequency says.
  if (category === "content") return "skip";

  if (notification.kind === "outcome_measured") {
    // Only a big win interrupts; everything else waits for the digest.
    if (frequency !== "instant" || notification.payload.bigWin !== true) return "skip";
  } else if (notification.kind !== "weekly_digest" && frequency !== "instant") {
    return "skip";
  }
  return "send";
}

/** Whether an in-app item should be recorded at all. */
export function inAppEnabled(prefs: NotificationPrefs, category: NotificationCategory): boolean {
  return prefs.categories[category] !== "off";
}

/**
 * The option the settings page shows for a stored frequency. Content has one
 * in-app choice ("daily") and "off", so anything but "off" shows as "daily".
 */
export function displayedFrequency(category: NotificationCategory, value: Frequency): Frequency {
  if (category === "content") return value === "off" ? "off" : "daily";
  if (category !== "digest" && value === "weekly") return "daily";
  return value;
}
