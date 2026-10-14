"use client";

import { useEffect, useRef } from "react";
import { Loader2, Mail } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { SkeletonCard } from "@/components/shared/Skeleton";
import { useNotificationPrefs } from "@/components/dashboard/notifications/useNotificationPrefs";
import { displayedFrequency, type NotificationPrefs } from "@/lib/domain/notifications/preferences";
import type { Frequency, NotificationCategory } from "@/lib/domain/notifications/types";

type Option = { value: Frequency; label: string };

const EMAIL_OR_APP: Option[] = [
  { value: "instant", label: "Email me right away" },
  { value: "daily", label: "In the app and weekly summary only" },
  { value: "off", label: "Off" },
];

const ROWS: Array<{ category: NotificationCategory; title: string; description: string; options: Option[] }> = [
  {
    category: "digest",
    title: "Summary",
    description: "What happened on your site: fixes measured, changes made, search movement. Skipped when nothing happened.",
    options: [
      { value: "weekly", label: "Weekly, on Mondays" },
      { value: "daily", label: "Daily" },
      { value: "off", label: "Off" },
    ],
  },
  {
    category: "outcomes",
    title: "Fix results",
    description: "When a fix you made has been measured. Only clear wins are emailed right away; the rest go in your summary.",
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

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

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
      <div className="max-w-2xl">
        <SkeletonCard rows={5} />
      </div>
    );
  }
  if (query.isError || !data) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-[15px] font-semibold text-gray-900">Notifications</h1>
        <p className="mt-2 text-[13px] text-gray-600" role="alert">
          Couldn&apos;t load your notification settings.{" "}
          <button type="button" onClick={() => query.refetch()} className="font-medium text-gray-900 underline">
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

  function setQuiet(patch: { startHour?: number; endHour?: number } | null) {
    if (patch === null) return update({ ...prefs, quietHours: null });
    const current = prefs.quietHours ?? { startHour: 22, endHour: 7 };
    const next = { ...current, ...patch };
    if (next.startHour === next.endHour) return;
    update({ ...prefs, quietHours: next });
  }

  function onTest() {
    sendTest.mutate(undefined, {
      onSuccess: (r) => show(`Test email sent to ${r.to}.`),
      onError: (err) => show(err instanceof Error ? err.message : "Couldn't send the test email."),
    });
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Notifications</h1>
      <p className="mb-5 text-[13px] text-gray-500">
        Choose what Marlo tells you about. Everything shows in the bell at the top of your dashboard; email is optional on top of that.
      </p>

      <section className="mb-5 rounded-xl border border-gray-200 p-4" aria-labelledby="email-status">
        <div className="flex items-start gap-3">
          <Mail size={16} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="email-status" className="text-[13px] font-semibold text-gray-900">
              Email
            </h2>
            {!emailConfigured ? (
              <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
                Email isn&apos;t set up on this server, so notifications stay in the app. To turn email on, the server needs a Resend API key and a sender address
                (<code className="rounded bg-gray-100 px-1 text-[12px]">RESEND_API_KEY</code>, <code className="rounded bg-gray-100 px-1 text-[12px]">NOTIFY_FROM_EMAIL</code>).
              </p>
            ) : unsubscribedAll ? (
              <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
                You unsubscribed from Marlo emails. Notifications still appear in the app.
              </p>
            ) : (
              <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
                {email ? <>Emails go to <span className="font-medium text-gray-900">{email}</span>.</> : "We don't have an email address for you yet."} They&apos;re separate from the
                outreach emails you send to leads, and every one has an unsubscribe link.
              </p>
            )}

            {emailConfigured && unsubscribedAll && (
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate({ unsubscribedAll: false }, { onSuccess: () => show("Email is back on.") })}
                className="mt-3 rounded-lg bg-[#111111] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
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
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {sendTest.isPending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                  Send me a test email
                </button>
                <span className="text-[12px] text-gray-500">Sends one message to your address to check it arrives.</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-gray-200 p-4">
        <div>
          <h2 className="text-[13px] font-semibold text-gray-900">Pause all email</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-500">Handy for holidays. Notifications still collect in the app.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.paused}
          aria-label="Pause all email"
          disabled={save.isPending}
          onClick={() => update({ ...prefs, paused: !prefs.paused }, prefs.paused ? "Email resumed." : "Email paused.")}
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${prefs.paused ? "bg-[#00ab92]" : "bg-gray-300"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${prefs.paused ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </section>

      <section className="rounded-xl border border-gray-200" aria-label="What to be notified about">
        <ul className="divide-y divide-gray-100">
          {ROWS.map((row) => {
            const id = `pref-${row.category}`;
            return (
              <li key={row.category} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <label htmlFor={id} className="text-[13px] font-semibold text-gray-900">
                    {row.title}
                  </label>
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{row.description}</p>
                </div>
                <select
                  id={id}
                  value={shownValue(row.category, prefs.categories[row.category])}
                  disabled={save.isPending}
                  onChange={(e) => setCategory(row.category, e.target.value as Frequency)}
                  className="w-full shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] text-gray-900 outline-none focus:border-black sm:w-60"
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

      <section className="mt-5 rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[13px] font-semibold text-gray-900">Quiet hours</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
              Emails that would arrive in this window wait until it ends. Uses your timezone{prefs.timezone ? ` (${prefs.timezone})` : ""}.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.quietHours !== null}
            aria-label="Use quiet hours"
            disabled={save.isPending}
            onClick={() => setQuiet(prefs.quietHours ? null : {})}
            className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${prefs.quietHours ? "bg-[#00ab92]" : "bg-gray-300"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${prefs.quietHours ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </div>
        {prefs.quietHours && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-gray-700">
            <label htmlFor="quiet-start">From</label>
            <select id="quiet-start" value={prefs.quietHours.startHour} onChange={(e) => setQuiet({ startHour: Number(e.target.value) })} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 outline-none focus:border-black">
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <label htmlFor="quiet-end">to</label>
            <select id="quiet-end" value={prefs.quietHours.endHour} onChange={(e) => setQuiet({ endHour: Number(e.target.value) })} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 outline-none focus:border-black">
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
        )}
      </section>

      {!emailOn && emailConfigured && !unsubscribedAll && prefs.paused && (
        <p className="mt-4 text-[12px] text-gray-500">Email is paused. Turn the pause off to get emails again.</p>
      )}
    </div>
  );
}
