"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "./cn.ts";

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;

export function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 6,
  collisionPadding = 8,
  ...rest
}: ComponentPropsWithoutRef<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "ui-pop z-(--z-popover) min-w-40 max-w-[calc(100vw-1rem)] rounded-ui-md border border-ui-border bg-ui-surface p-1 text-[13px] leading-5 text-ui-text shadow-ui-md outline-none",
          className,
        )}
        {...rest}
      />
    </RadixMenu.Portal>
  );
}

const ITEM_BASE =
  "relative flex min-h-8 cursor-pointer items-center gap-2 rounded-ui-sm px-2 py-1 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-ui-surface-sunken";

export type DropdownMenuItemProps = ComponentPropsWithoutRef<typeof RadixMenu.Item> & {
  icon?: ReactNode;
  /** Red styling for irreversible actions. */
  destructive?: boolean;
};

export function DropdownMenuItem({ className, icon, destructive, children, ...rest }: DropdownMenuItemProps) {
  return (
    <RadixMenu.Item className={cn(ITEM_BASE, destructive && "text-ui-danger-text data-[highlighted]:bg-ui-danger-soft", className)} {...rest}>
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 text-ui-muted">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
    </RadixMenu.Item>
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...rest }: ComponentPropsWithoutRef<typeof RadixMenu.CheckboxItem>) {
  return (
    <RadixMenu.CheckboxItem className={cn(ITEM_BASE, "pl-7", className)} {...rest}>
      <RadixMenu.ItemIndicator className="absolute left-2 inline-flex">
        <Check aria-hidden="true" className="h-3.5 w-3.5" />
      </RadixMenu.ItemIndicator>
      <span className="min-w-0 truncate">{children}</span>
    </RadixMenu.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixMenu.Label>) {
  return <RadixMenu.Label className={cn("px-2 py-1 text-[11px] leading-4 font-semibold tracking-wider text-ui-subtle uppercase", className)} {...rest} />;
}

export function DropdownMenuSeparator({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cn("my-1 h-px bg-ui-border", className)} {...rest} />;
}
