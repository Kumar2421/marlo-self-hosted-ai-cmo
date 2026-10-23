import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";
import { CHIP_DOT, statusChipClass, type ChipTone } from "./premium.ts";

export type StatusChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ChipTone;
  dot?: boolean;
  dashed?: boolean;
  icon?: ReactNode;
};

/** Rounded status label with a subtle border: tag chips, "Ready", severity, email status. */
export function StatusChip({ tone = "neutral", dot, dashed, icon, className, children, ...rest }: StatusChipProps) {
  return (
    <span className={statusChipClass({ tone, dashed, className })} {...rest}>
      {dot ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CHIP_DOT[tone])} /> : null}
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
