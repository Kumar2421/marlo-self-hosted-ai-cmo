"use client";

import { type MouseEvent } from "react";
import { useDialog } from "./useDialog";

/**
 * Esc, backdrop click, focus-in/return and dialog semantics for the centered
 * modals that render their own `fixed inset-0` backdrop.
 *
 *   const { backdropProps, panelProps } = useModal(onClose, "Compose email");
 *   <div {...backdropProps} className="fixed inset-0 ...">
 *     <div {...panelProps} className="...">
 *
 * Pass `open` when the component can render closed (Esc is only listened for while open).
 * Pass `closeOnBackdrop: false` for forms where a stray click would lose typed text
 * (Esc and the X button still close them).
 */
export function useModal(onClose: () => void, label: string, opts: { closeOnBackdrop?: boolean; open?: boolean } = {}) {
  const { closeOnBackdrop = true, open = true } = opts;
  const panelRef = useDialog<HTMLDivElement>(open, onClose);
  return {
    backdropProps: {
      // mousedown on the backdrop itself (not a drag that ends there from inside the panel).
      onMouseDown: (e: MouseEvent<HTMLElement>) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      },
    },
    panelProps: {
      ref: panelRef,
      role: "dialog" as const,
      "aria-modal": true as const,
      "aria-label": label,
      tabIndex: -1,
    },
  };
}
