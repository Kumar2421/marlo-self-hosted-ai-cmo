"use client";

import { useCallback, useState } from "react";
import { EMPTY_SENDER, SENDER_STORAGE_KEY, parseSenderProfile, type SenderProfile } from "@/lib/domain/leads/outreachCompose";

function read(): SenderProfile {
  try {
    return parseSenderProfile(window.localStorage.getItem(SENDER_STORAGE_KEY));
  } catch {
    return EMPTY_SENDER;
  }
}

/**
 * Sign-off name, company and postal address, remembered in this browser only. The panel is rendered after a click,
 * never on the server, so reading storage during the first render is safe. If storage is blocked it still works for
 * the session, it just is not remembered.
 */
export function useSenderProfile() {
  const [profile, setProfile] = useState<SenderProfile>(read);
  const update = useCallback((patch: Partial<SenderProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(SENDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private window or blocked storage: keep it in memory only */
      }
      return next;
    });
  }, []);
  return [profile, update] as const;
}
