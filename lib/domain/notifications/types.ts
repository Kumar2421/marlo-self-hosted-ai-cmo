export const NOTIFICATION_KINDS = [
  "weekly_digest",
  "outcome_measured",
  "credits_low",
  "approval_needed",
  "integration_disconnected",
  "social_drafts_ready",
  "social_drafts_paused",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CATEGORIES = ["digest", "outcomes", "credits", "approvals", "integrations", "content"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const FREQUENCIES = ["instant", "daily", "weekly", "off"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

const CATEGORY_OF: Record<NotificationKind, NotificationCategory> = {
  weekly_digest: "digest",
  outcome_measured: "outcomes",
  credits_low: "credits",
  approval_needed: "approvals",
  integration_disconnected: "integrations",
  social_drafts_ready: "content",
  social_drafts_paused: "content",
};

export function categoryOf(kind: NotificationKind): NotificationCategory {
  return CATEGORY_OF[kind];
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** What a rule decided to tell the user, before it is stored. */
export type NotificationDraft = {
  kind: NotificationKind;
  projectId: string | null;
  /** Unique per user: storing the same key twice is a no-op, which is what makes every job safe to rerun. */
  dedupeKey: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
};

export type Notification = NotificationDraft & {
  id: string;
  userId: string;
  createdAt: string;
  readAt: string | null;
  emailedAt: string | null;
  emailError: string | null;
  /** Failed send attempts so far (retryable failures only). */
  emailAttempts: number;
  lastEmailAttemptAt: string | null;
};
