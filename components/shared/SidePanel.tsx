"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialog } from "./useDialog";

const WIDTHS = {
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
} as const;

type SidePanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One quiet line under the title (e.g. data freshness). */
  subtitle?: ReactNode;
  width?: keyof typeof WIDTHS;
  /** Sticky controls under the header, such as a tab bar. */
  toolbar?: ReactNode;
  /** Pinned under the scrolling content, for the panel's primary actions. */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * Right slide-over for data that does not fit in a dashboard column. Same
 * look as the existing document panels (right edge, left border, shadow) but
 * shared: Esc and backdrop-click close it, focus moves in and returns to the
 * trigger, and it goes full-width on small screens.
 */
export default function SidePanel({ open, onClose, title, subtitle, width = "lg", toolbar, footer, children }: SidePanelProps) {
  const titleId = useId();
  const panelRef = useDialog<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex h-full w-full ${WIDTHS[width]} flex-col border-l border-gray-200 bg-white shadow-2xl outline-none motion-safe:animate-[slideIn_160ms_ease-out]`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-[15px] font-semibold text-gray-900">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-gray-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={16} />
          </button>
        </header>
        {toolbar && <div className="border-b border-gray-100 px-5 py-2">{toolbar}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-gray-100 bg-white px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
