"use client";

import type { ComponentPropsWithoutRef } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { cn } from "./cn.ts";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

export type PopoverContentProps = ComponentPropsWithoutRef<typeof RadixPopover.Content>;

/** Floating panel anchored to a trigger. Esc and outside click close it. */
export function PopoverContent({ className, align = "start", sideOffset = 6, collisionPadding = 8, ...rest }: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "ui-pop z-(--z-popover) w-72 max-w-[calc(100vw-1rem)] rounded-ui-lg border border-ui-border bg-ui-surface p-3 text-[13px] leading-5 text-ui-text shadow-ui-md outline-none",
          className,
        )}
        {...rest}
      />
    </RadixPopover.Portal>
  );
}
