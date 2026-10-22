"use client";

import { useEffect, useRef } from "react";

/**
 * The behaviour every slide-over dialog shares: Esc closes it, focus moves into the panel
 * when it opens and returns to whatever opened it when it closes.
 *
 * Attach the returned ref to the element carrying role="dialog" (it needs tabIndex={-1}).
 * `onClose` may change on every render without re-running the effect, so a parent
 * re-render never steals focus back or fires a spurious "return focus".
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const panelRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [open]);

  return panelRef;
}
