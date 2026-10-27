"use client";

import type { KeyboardEventHandler } from "react";
import { cn } from "./cn.ts";
import { FOCUS_RING_INSET } from "./variants.ts";

const TRACK =
  "flex shrink-0 gap-0.5 overflow-x-auto rounded-xl border border-ui-border bg-ui-surface-sunken p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const SEGMENT =
  "ui-transition min-h-11 min-w-fit flex-1 cursor-pointer truncate rounded-lg border border-transparent px-1 text-center text-[12px] leading-4 font-medium md:min-h-8";
const SEGMENT_ON = "border-ui-border bg-ui-surface text-ui-text shadow-ui-sm";
const SEGMENT_OFF = "text-ui-muted hover:text-ui-text";

export type SegmentedTabsProps<T extends string> = {
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  /** Tab ids are `${idPrefix}${item}`. */
  idPrefix: string;
  /** Id of the tabpanel the selected tab controls. */
  panelId: string;
  /** Arrow/Home/End handling lives with the owner (it also moves focus). */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  className?: string;
};

/** Full-width pill tab bar: sunken track, raised selected tab. role=tablist/tab with a roving tabindex. */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  idPrefix,
  panelId,
  onKeyDown,
  className,
  "aria-label": ariaLabel,
}: SegmentedTabsProps<T>) {
  return (
    <div role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} className={cn(TRACK, className)}>
      {items.map((item) => (
        <button
          key={item}
          id={`${idPrefix}${item}`}
          role="tab"
          type="button"
          aria-selected={value === item}
          aria-controls={panelId}
          tabIndex={value === item ? 0 : -1}
          onClick={() => onChange(item)}
          className={cn(SEGMENT, FOCUS_RING_INSET, value === item ? SEGMENT_ON : SEGMENT_OFF)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

/** Same look for a two-way view switch (Desktop / Mobile). Plain buttons with aria-pressed, not tabs. */
export function SegmentedToggle<T extends string>({
  items,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn(TRACK, "w-full", className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(SEGMENT, "text-[13px]", FOCUS_RING_INSET, value === item.value ? SEGMENT_ON : SEGMENT_OFF)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
