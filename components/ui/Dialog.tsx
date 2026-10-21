"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "./cn.ts";
import { IconButton } from "./IconButton.tsx";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

const SIZES = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-2xl" } as const;

export type DialogContentProps = Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, "title"> & {
  /** Required: the accessible name of the dialog. */
  title: string;
  /** Rendered as the dialog description (aria-describedby). */
  description?: ReactNode;
  /** Visually hide the title but keep it for screen readers. */
  hideTitle?: boolean;
  size?: keyof typeof SIZES;
  /** Pinned under the scrolling body (actions). */
  footer?: ReactNode;
};

/**
 * Modal dialog. Radix provides focus trap, Esc, scroll lock and aria. Centered
 * on >=640px; below that it is a bottom sheet with a drag-handle look, at most
 * 90dvh tall with the body scrolling internally.
 */
export function DialogContent({ title, description, hideTitle, size = "md", footer, className, children, ...rest }: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="ui-fade fixed inset-0 z-(--z-overlay) bg-(--ui-overlay)" />
      <RadixDialog.Content
        // No description: opt out explicitly so Radix does not warn about it.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "ui-dialog fixed z-(--z-modal) flex max-h-[90dvh] flex-col overflow-hidden border border-ui-border bg-ui-surface shadow-ui-md outline-none",
          // mobile: bottom sheet
          "inset-x-0 bottom-0 rounded-t-ui-lg",
          // >=640px: centered
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-ui-lg",
          SIZES[size],
          className,
        )}
        {...rest}
      >
        <div aria-hidden="true" className="flex shrink-0 justify-center pt-2 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-ui-border-strong" />
        </div>
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0">
            <RadixDialog.Title className={cn("text-[14px] leading-5 font-semibold text-ui-text", hideTitle && "sr-only")}>{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-0.5 text-[13px] leading-5 text-ui-muted">{description}</RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close asChild>
            <IconButton aria-label="Close" size="sm" icon={<X className="h-4 w-4" />} className="-mr-1" />
          </RadixDialog.Close>
        </div>
        <div className="okara-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 text-[13px] leading-5 text-ui-text">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ui-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
