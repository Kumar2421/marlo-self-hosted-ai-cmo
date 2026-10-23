"use client";

import { useEffect, useState } from "react";
import { OAUTH_BUSY_TIMEOUT_MS, resetOnPageShow, resetOnReturn } from "@/lib/ui/oauthReturn";

/**
 * Busy flag for a button that navigates away to Google. It resets itself when the
 * page is restored from the back/forward cache, when the user returns to the tab
 * (e.g. from a blocked Google screen), and after a safety timeout.
 */
export function useOauthBusy(): [boolean, (busy: boolean) => void] {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const reset = () => setBusy(false);
    const onPageShow = (e: PageTransitionEvent) => {
      if (resetOnPageShow(e.persisted)) reset();
    };
    const onReturn = () => {
      if (resetOnReturn(startedAt, Date.now(), document.visibilityState === "visible")) reset();
    };
    const timer = window.setTimeout(reset, OAUTH_BUSY_TIMEOUT_MS);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [busy]);

  return [busy, setBusy];
}
