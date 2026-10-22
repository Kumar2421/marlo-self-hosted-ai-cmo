"use client";

import type { ReactElement, ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

export const TOOLTIP_DELAY_MS = 300;

export type TooltipProps = {
  content: ReactNode;
  /** A single focusable element; the tooltip is attached to it. */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
};

/**
 * Hover/focus hint (300ms delay). Not a place for essential information:
 * touch users never see it, so keep the same text in an aria-label or visible.
 */
export function Tooltip({ content, children, side = "top", delayDuration = TOOLTIP_DELAY_MS }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={100}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="ui-pop z-(--z-tooltip) max-w-[min(20rem,calc(100vw-1rem))] rounded-ui-sm bg-ui-primary px-2 py-1 text-[12px] leading-4 text-ui-inverse shadow-ui-sm"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
