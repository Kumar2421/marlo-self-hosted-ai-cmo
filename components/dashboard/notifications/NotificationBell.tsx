"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Bell, CheckCheck, CircleDollarSign, GitPullRequest, Newspaper, TrendingUp } from "lucide-react";
import SidePanel from "@/components/shared/SidePanel";
import { SkeletonLines } from "@/components/shared/Skeleton";
import type { NotificationKind } from "@/lib/domain/notifications/types";
import { resolveSocialPlatform } from "@/lib/domain/social/socialNav";
import { useSocialPanel } from "@/components/dashboard/social/SocialPanelProvider";
import { useNotifications, type ClientNotification } from "./useNotifications";

const ICONS: Record<NotificationKind, typeof Bell> = {
  weekly_digest: Newspaper,
  outcome_measured: TrendingUp,
  credits_low: CircleDollarSign,
  approval_needed: GitPullRequest,
  integration_disconnected: AlertTriangle,
};

function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function Row({ n, onActivate }: { n: ClientNotification; onActivate: (n: ClientNotification) => void }) {
  const Icon = ICONS[n.kind] ?? Bell;
  return (
    <li>
      <button
        type="button"
        onClick={() => onActivate(n)}
        className={`flex w-full gap-3 rounded-lg px-3 py-3 text-left transition-colors ${n.read ? "hover:bg-gray-50" : "bg-[#f3fbf9] hover:bg-[#e9f7f4]"}`}
        aria-label={`${n.title}. ${n.read ? "Read" : "Unread. Press to mark as read"}`}
      >
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${n.read ? "bg-gray-100 text-gray-500" : "bg-white text-[#00846f] ring-1 ring-[#bfe8e0]"}`}>
          <Icon size={14} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] leading-snug text-gray-900 ${n.read ? "font-normal" : "font-semibold"}`}>{n.title}</span>
          {n.body && <span className="mt-0.5 block text-[12px] leading-relaxed text-gray-600">{n.body}</span>}
          <span className="mt-1 block text-[11px] text-gray-400">{timeAgo(n.createdAt)}</span>
        </span>
        {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#00ab92]" aria-hidden="true" />}
      </button>
    </li>
  );
}

/** Bell in the dashboard top bar: unread count, and a side panel with the list. */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, isLoading, isError, unavailable, refetch, markRead } = useNotifications();
  const social = useSocialPanel();

  /** Mark read; a social notification also opens that network draft panel (the bell closes first). */
  function activate(n: ClientNotification) {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    if (n.nav) {
      setOpen(false);
      social.open(resolveSocialPlatform(n.nav.platform));
    }
  }

  // Not signed in: there is nothing to show and nothing to explain here.
  if (unavailable) return null;

  const badge = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 hover:text-white"
        title="Notifications"
      >
        <Bell size={16} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#00ab92] px-1 text-[10px] font-semibold leading-none text-white">
            {badge}
          </span>
        )}
      </button>

      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
        width="md"
        toolbar={
          <div className="flex items-center justify-between">
            <Link href="/settings/notifications" className="text-[12px] font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline">
              Notification settings
            </Link>
            <button
              type="button"
              disabled={unreadCount === 0 || markRead.isPending}
              onClick={() => markRead.mutate({ all: true })}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <CheckCheck size={13} aria-hidden="true" /> Mark all as read
            </button>
          </div>
        }
      >
        {isLoading ? (
          <SkeletonLines rows={6} />
        ) : isError ? (
          <div className="rounded-lg border border-gray-200 p-4 text-[13px] text-gray-600" role="alert">
            Couldn&apos;t load your notifications.{" "}
            <button type="button" onClick={() => refetch()} className="font-medium text-gray-900 underline">
              Try again
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-2 py-10 text-center">
            <Bell size={20} className="mx-auto text-gray-300" aria-hidden="true" />
            <p className="mt-3 text-[13px] font-medium text-gray-800">Nothing yet</p>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
              You&apos;ll see measured fixes, your weekly summary, and anything that needs you here.
            </p>
          </div>
        ) : (
          <ul className="-mx-3 space-y-1">
            {notifications.map((n) => (
              <Row key={n.id} n={n} onActivate={activate} />
            ))}
          </ul>
        )}
      </SidePanel>
    </>
  );
}
