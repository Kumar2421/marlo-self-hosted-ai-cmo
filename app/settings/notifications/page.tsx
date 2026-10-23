"use client";

import { useEffect, useRef } from "react";
import { Loader2, Mail } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { SkeletonCard } from "@/components/shared/Skeleton";
import { useNotificationPrefs } from "@/components/dashboard/notifications/useNotificationPrefs";
import { FEATURES } from "@/lib/features";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, FOCUS_RING, INPUT, SettingsPageHeader } from "@/components/settings/ui";
import { displayedFrequency, type NotificationPrefs } from "@/lib/domain/notifications/preferences";
import type { Frequency, NotificationCategory } from "@/lib/domain/notifications/types";

type Option = { value: Frequency; label: string };

const EMAIL_OR_APP: Option[] = [
  { value: "instant", label: "Email me" },
  { value: "daily", label: "In the app and weekly summary only" },
  { value: "off", label: "Off" },
];

const ROWS: Array<{ category: NotificationCategory; title: string; description: string; options: Option[] }> = [
  {
    category: "digest",
    title: "Summary",
    description: "What happened on your site: fixes measured, changes made, search movement. Skipped when nothing happened. If a Monday summary is missed, it goes out on the next daily check.",
    options: [
      { value: "weekly", label: "Weekly (Mondays)" },
      { value: "daily", label: "Daily" },
      { value: "off", label: "Off" },
    ],
  },
  {
    category: "outcomes",
    title: "Fix results",
    description: "When a fix you made has been measured. Only clear wins get their own email; the rest go in your summary.",
    options: EMAIL_OR_APP,
  },
  { category: "credits", title: "Credits", description: "When your credits are running low or have run out.", options: EMAIL_OR_APP },
  { category: "approvals", title: "Waiting for your review", description: "When a fix pull request is waiting for you. At most one reminder a day.", options: EMAIL_OR_APP },
  { category: "integrations", title: "Connections", description: "When Google or Gmail needs to be reconnected. At most one reminder every 3 days.", options: EMAIL_OR_APP },
  {
    category: "content",
    title: "Social drafts",
    description: "When new social post drafts are ready to review in the app. Never emailed.",
    options: [
      { value: "daily", label: "In the app only" },
      { value: "off", label: "Off" },
    ],
  },
];

/** Non-summary categories show one "in the app only" choice, however it was stored. */
function shownValue(category: NotificationCategory, value: Frequency): Frequency {
  return displayedFrequency(category, value);
}

function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export default function NotificationsSettingsPage() {
  const { show } = useToast();
  const { query, data, save, sendTest } = useNotificationPrefs();
  const tzSaved = useRef(false);

  // Remember the browser's timezone once, so "Monday" means the user's Monday.
  useEffect(() => {
    if (!data || tzSaved.current || data.prefs.timezone) return;
    const timezone = browserTimezone();
    if (!timezone) return;
    tzSaved.current = true;
    save.mutate({ prefs: { ...data.prefs, timezone } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (query.isPending) {
    return (
      <div className="min-w-0 max-w-3xl">
        <SettingsPageHeader
          title="Notifications"
          caption="Choose what Marlo tells you about. Everything shows in the bell at the top of your dashboard; email is optional on top of that."
        />
        <SkeletonCard rows={5} />
      </div>
    );
  }
  if (query.isError || !data) {
    return (
      <div className="min-w-0 max-w-3xl">
        <SettingsPageHeader title="Notifications" />
        <p className="text-[13px] text-ui-muted" role="alert">
          Couldn&apos;t load your notification settings.{" "}
          <button type="button" onClick={() => query.refetch()} className="font-medium text-ui-text underline">
            Try again
          </button>
        </p>
      </div>
    );
  }

  const { prefs, unsubscribedAll, emailConfigured, email } = data;
  const emailOn = emailConfigured && !unsubscribedAll && !prefs.paused;

  function update(next: NotificationPrefs, message = "Saved.") {
    save.mutate({ prefs: next }, { onSuccess: () => show(message), onError: () => show("Couldn't save that. Try again.") });
  }

  function setCategory(category: NotificationCategory, value: Frequency) {
    update({ ...prefs, categories: { ...prefs.categories, [category]: value } });
  }

  function onTest() {
    sendTest.mutate(undefined, {
      onSuccess: (r) => show(`Test email sent to ${r.to}.`),
      onError: (err) => show(err instanceof Error ? err.message : "Couldn't send the test email."),
    });
  }

  return (
    <div className="min-w-0 max-w-3xl">
      <SettingsPageHeader
        title="Notifications"
        caption="Choose what Marlo tells you about. Everything shows in the bell at the top of your dashboard; email is optional on top of that."
      />

      <section className={`${CARD} mb-4 p-5`} aria-labelledby="email-status">
        <div className="flex items-start gap-3">
          <Mail size={16} className="mt-0.5 shrink-0 text-ui-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="email-status" className="text-[13px] font-semibold text-ui-text">
              Email
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">
              Emails go out during a daily check ({FEATURES.PLATFORM_MODE ? "around 03:00 UTC" : "this app checks every few hours while it is open"}), not the moment something happens.
              Everything also appears in the app straight away.
            </p>
            {!emailConfigured ? (
              FEATURES.PLATFORM_MODE ? (
                <p className="mt-1 text-[13px] leading-relaxed text-ui-muted">
                  Email delivery is managed by the host, so notifications stay in the app for now.
                </p>
              ) : (
                <p className="mt-1 text-[13px] leading-relaxed text-ui-muted">
                  Email isn&apos;t set up on this server, so notifications stay in the app. To turn email on, the server needs a Resend API key and a sender address
                  (<code className="rounded bg-ui-surface-sunken px-1 text-[12px]">RESEND_API_KEY</code>, <code className="rounded bg-ui-surface-sunken px-1 text-[12px]">NOTIFY_FROM_EMAIL</code>), plus <code className="rounded bg-ui-surface-sunken px-1 text-[12px]">NOTIFY_SIGNING_SECRET</code> and <code className="rounded bg-ui-surface-sunken px-1 text-[12px]">NEXT_PUBLIC_APP_URL</code> for the unsubscribe links.
                </p>
              )
            ) : unsubscribedAll ? (
              <p className="mt-1 text-[13px] leading-relaxed text-ui-muted">
                You unsubscribed from Marlo emails. Notifications still appear in the app.
              </p>
            ) : (
              <p className="mt-1 text-[13px] leading-relaxed text-ui-muted">
                {email ? <>Emails go to <span className="break-all font-medium text-ui-text">{email}</span>.</> : "We don't have an email address for you yet."} They&apos;re separate from the
                outreach emails you send to leads, and every one has an unsubscribe link.
              </p>
            )}

            {emailConfigured && unsubscribedAll && (
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate({ unsubscribedAll: false }, { onSuccess: () => show("Email is back on.") })}
                className={`${BTN_PRIMARY} mt-3`}
              >
                Turn email back on
              </button>
            )}
            {emailConfigured && !unsubscribedAll && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={sendTest.isPending || !email}
                  onClick={onTest}
                  className={BTN_SECONDARY}
                >
                  {sendTest.isPending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                  Send me a test email
                </button>
                <span className="text-[12px] text-ui-muted">Sends one message to your address to check it arrives.</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={`${CARD} mb-4 flex items-start justify-between gap-4 p-5`}>
        <div>
          <h2 className="text-[13px] font-semibold text-ui-text">Pause all email</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">Handy for holidays. Notifications still collect in the app.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.paused}
          aria-label="Pause all email"
          disabled={save.isPending}
          onClick={() => update({ ...prefs, paused: !prefs.paused }, prefs.paused ? "Email resumed." : "Email paused.")}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] disabled:opacity-60 ${FOCUS_RING} ${prefs.paused ? "bg-ui-accent" : "bg-ui-border-strong"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${prefs.paused ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </section>

      <section className={CARD} aria-label="What to be notified about">
        <ul className="divide-y divide-ui-border">
          {ROWS.map((row) => {
            const id = `pref-${row.category}`;
            return (
              <li key={row.category} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                <div className="min-w-0">
                  <label htmlFor={id} className="text-[13px] font-semibold text-ui-text">
                    {row.title}
                  </label>
                  <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">{row.description}</p>
                </div>
                <select
                  id={id}
                  value={shownValue(row.category, prefs.categories[row.category])}
                  disabled={save.isPending}
                  onChange={(e) => setCategory(row.category, e.target.value as Frequency)}
                  className={`${INPUT} shrink-0 sm:w-64`}
                >
                  {row.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </section>

      {!emailOn && emailConfigured && !unsubscribedAll && prefs.paused && (
        <p className="mt-4 text-[12px] text-ui-muted">Email is paused. Turn the pause off to get emails again.</p>
      )}
    </div>
  );
}
