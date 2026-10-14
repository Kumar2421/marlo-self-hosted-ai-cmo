"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import type { NotificationKind } from "@/lib/domain/notifications/types";
import type { SocialNavTarget } from "@/lib/domain/social/socialNav";

export type ClientNotification = {
  id: string;
  kind: NotificationKind;
  projectId: string | null;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** Set when clicking the notification should open a social draft panel. */
  nav?: SocialNavTarget | null;
};

type ListResponse = { unreadCount: number; notifications: ClientNotification[] };

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** The user's notifications and unread count, refreshed every minute and when the tab regains focus. */
export function useNotifications() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => fetchJson<ListResponse>("/api/notifications"),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: (args: { ids: string[] } | { all: true }) => fetchJson<{ unreadCount: number }>("/api/notifications/read", jsonInit(args)),
    onMutate: async (args) => {
      // Show it as read straight away; the server answer settles the count.
      await queryClient.cancelQueries({ queryKey: qk.notifications() });
      const before = queryClient.getQueryData<ListResponse>(qk.notifications());
      if (before) {
        const ids = "ids" in args ? new Set(args.ids) : null;
        const notifications = before.notifications.map((n) => (!ids || ids.has(n.id) ? { ...n, read: true } : n));
        queryClient.setQueryData<ListResponse>(qk.notifications(), { notifications, unreadCount: notifications.filter((n) => !n.read).length });
      }
      return { before };
    },
    onError: (_err, _args, context) => {
      if (context?.before) queryClient.setQueryData(qk.notifications(), context.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications() }),
  });

  return {
    isLoading: query.isPending,
    isError: query.isError,
    /** Signed out (platform) or no backend: nothing to show, so the bell stays hidden. */
    unavailable: query.isError && (query.error as { status?: number } | null)?.status === 401,
    refetch: query.refetch,
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    markRead,
  };
}
