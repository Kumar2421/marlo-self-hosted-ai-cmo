"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchNotificationPrefs } from "@/components/dashboard/notifications/useNotificationPrefs";
import { fetchUsage } from "@/lib/query/useUsage";
import { qk } from "@/lib/query/keys";

/**
 * Warms the two slowest Settings pages (Credits, Notifications) once the browser is idle, so
 * opening them from the nav shows cached content. Fresh data is never replaced: prefetchQuery
 * skips anything already fresh, and the pages refetch in the background once it goes stale.
 */
export default function SettingsPrefetch() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const run = () => {
      void queryClient.prefetchQuery({ queryKey: qk.usage(), queryFn: fetchUsage, staleTime: 30_000 });
      void queryClient.prefetchQuery({ queryKey: qk.notificationPrefs(), queryFn: fetchNotificationPrefs, staleTime: 30_000 });
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 300);
    return () => window.clearTimeout(id);
  }, [queryClient]);
  return null;
}
