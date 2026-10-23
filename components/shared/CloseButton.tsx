"use client";

import { X } from "lucide-react";

/**
 * The one close ("X") control for drawers, modals and expanded panels.
 * 44px touch target below the sm breakpoint, 32px on larger screens, and a
 * visible focus ring for keyboard users.
 */
export function CloseButton({
  onClick,
  label = "Close",
  size = 16,
  className = "",
}: {
  onClick: () => void;
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 sm:h-8 sm:w-8 ${className}`}
    >
      <X size={size} aria-hidden="true" />
    </button>
  );
}
