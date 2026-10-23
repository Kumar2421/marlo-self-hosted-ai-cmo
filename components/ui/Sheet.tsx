"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "./cn.ts";
import { IconButton } from "./IconButton.tsx";

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

const WIDTHS = { md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" } as const;

export type SheetContentProps = Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, "title"> & {
  /** Required: the accessible name of the panel. */
  title: string;
  /** One quiet line under the title (e.g. data freshness). */
  subtitle?: ReactNode;
  width?: keyof typeof WIDTHS;
  /** Sticky controls under the header, such as a tab bar. */
  toolbar?: ReactNode;
  /** Pinned under the scrolling content, for the panel's primary actions. */
  footer?: ReactNode;
};

/**
 * Slide-over panel: right side on >=640px, bottom sheet (max 90dvh) below.
 * Radix handles focus trap, Esc, scroll lock, focus return and aria. Intended
 * to replace components/shared/SidePanel.tsx.
 */
export function SheetContent({ title, subtitle, width = "lg", toolbar, footer, className, children, ...rest }: SheetContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="ui-fade fixed inset-0 z-(--z-overlay) bg-(--ui-overlay)" />
      <RadixDialog.Content
        // Sheets have no required description; opt out so Radix does not warn.
        {...(rest["aria-describedby"] ? {} : { "aria-describedby": undefined })}
        className={cn(
          "ui-sheet fixed z-(--z-modal) flex flex-col bg-ui-surface shadow-ui-md outline-none",
          // mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-ui-lg border-t border-ui-border",
          // >=640px: right panel
          "sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-full sm:rounded-none sm:border-t-0 sm:border-l",
          WIDTHS[width],
          className,
        )}
        {...rest}
      >
        <div aria-hidden="true" className="flex shrink-0 justify-center pt-2 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-ui-border-strong" />
        </div>
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-ui-border px-4 py-2">
          <div className="min-w-0">
            <RadixDialog.Title className="truncate text-[13px] leading-5 font-semibold text-ui-text">{title}</RadixDialog.Title>
            {subtitle ? <div className="truncate text-xs leading-4 text-ui-muted">{subtitle}</div> : null}
          </div>
          <RadixDialog.Close asChild>
            <IconButton aria-label="Close" size="sm" icon={<X className="h-4 w-4" />} className="-mr-1" />
          </RadixDialog.Close>
        </div>
        {toolbar ? <div className="shrink-0 border-b border-ui-border px-4 py-2">{toolbar}</div> : null}
        <div className="okara-scroll min-h-0 flex-1 overflow-y-auto p-4 text-[13px] leading-5 text-ui-text">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ui-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
