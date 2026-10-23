"use client";

import { useCallback, useEffect, useState } from "react";
import { fixFirstDismissKey, isFixFirstDismissed } from "@/lib/domain/overview/fixFirstDismiss";

/**
 * Remembers (per project, in this browser) that the user closed the current Fix-first suggestions.
 * Storage is read after mount, so the server and first client render agree.
 */
export function useFixFirstDismissed(projectId: string | undefined, signature: string) {
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStored(window.localStorage.getItem(fixFirstDismissKey(projectId)));
    } catch {
      setStored(null);
    }
  }, [projectId]);

  const dismiss = useCallback(() => {
    if (!projectId) return;
    setStored(signature);
    try {
      window.localStorage.setItem(fixFirstDismissKey(projectId), signature);
    } catch {
      /* storage blocked: it stays closed for this page view */
    }
  }, [projectId, signature]);

  const restore = useCallback(() => {
    if (!projectId) return;
    setStored(null);
    try {
      window.localStorage.removeItem(fixFirstDismissKey(projectId));
    } catch {
      /* ignore */
    }
  }, [projectId]);

  return { dismissed: isFixFirstDismissed(stored, signature), dismiss, restore };
}
