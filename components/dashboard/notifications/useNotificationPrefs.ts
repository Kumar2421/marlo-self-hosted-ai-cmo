"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import type { NotificationPrefs } from "@/lib/domain/notifications/preferences";

export type PrefsResponse = {
  prefs: NotificationPrefs;
  unsubscribedAll: boolean;
  /** The server has RESEND_API_KEY and NOTIFY_FROM_EMAIL. */
  emailConfigured: boolean;
  /** Where email would go. */
  email: string | null;
};

const put = (body: unknown): RequestInit => ({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const fetchNotificationPrefs = () => fetchJson<PrefsResponse>("/api/notifications/preferences");

export function useNotificationPrefs() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.notificationPrefs(), queryFn: fetchNotificationPrefs });

  const save = useMutation({
    mutationFn: (body: { prefs?: NotificationPrefs; unsubscribedAll?: boolean }) => fetchJson<PrefsResponse>("/api/notifications/preferences", put(body)),
    onSuccess: (data) => queryClient.setQueryData(qk.notificationPrefs(), data),
  });

  const sendTest = useMutation({
    mutationFn: () => fetchJson<{ sent: boolean; to: string }>("/api/notifications/send-test", { method: "POST" }),
  });

  return { query, data: query.data, save, sendTest };
}
