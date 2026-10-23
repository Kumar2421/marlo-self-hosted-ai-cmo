import { resendSender } from "./resendSender.ts";
import type { EmailSender } from "./ports.ts";
import type { EmailLinks } from "./render.ts";
import { signToken } from "./tokens.ts";

type Env = Record<string, string | undefined>;

export type NotificationConfig = {
  /** Both RESEND_API_KEY and NOTIFY_FROM_EMAIL are set. */
  emailConfigured: boolean;
  sender: EmailSender | null;
  appUrl: string | null;
  signingSecret: string | null;
};

/** The app's public address, for links in emails. */
function appUrlFrom(env: Env): string | null {
  const explicit = env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : null;
}

/** Everything email needs, read from the environment. The API key is only ever handed to the sender. */
export function notificationConfig(env: Env = process.env): NotificationConfig {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.NOTIFY_FROM_EMAIL?.trim();
  const emailConfigured = Boolean(apiKey && from);
  return {
    emailConfigured,
    sender: apiKey && from ? resendSender({ apiKey, from }) : null,
    appUrl: appUrlFrom(env),
    signingSecret: env.NOTIFY_SIGNING_SECRET?.trim() || null,
  };
}

/** Links for one user's emails. Null (so no email goes out) when they cannot be signed or no app address is known. */
export function emailLinksFor(userId: string, config: NotificationConfig): EmailLinks | null {
  if (!config.appUrl) return null;
  const token = signToken({ userId, scope: "unsubscribe" }, config.signingSecret);
  if (!token) return null;
  return {
    openUrl: `${config.appUrl}/dashboard`,
    unsubscribeUrl: `${config.appUrl}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
    preferencesUrl: `${config.appUrl}/settings/notifications`,
  };
}

/** Whether emails can really go out: a sender, a signing secret and an app URL (the job sends nothing without all three). */
export function emailReady(config: NotificationConfig): boolean {
  return config.emailConfigured && Boolean(config.appUrl) && Boolean(config.signingSecret);
}
