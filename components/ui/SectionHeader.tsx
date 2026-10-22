import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type SectionHeaderProps = {
  label: string;
  /** Optional trailing control, e.g. a text button or IconButton. */
  action?: ReactNode;
  /** Heading level to render; pick the one that fits the page outline. */
  as?: "h2" | "h3" | "h4";
  className?: string;
};

/** Uppercase section label (matches .dash-section-label) with an optional action. */
export function SectionHeader({ label, action, as: Tag = "h3", className }: SectionHeaderProps) {
  return (
    <div className={cn("flex min-h-6 items-center justify-between gap-2", className)}>
      <Tag className="min-w-0 truncate text-[11px] leading-4 font-semibold tracking-wider text-ui-subtle uppercase">{label}</Tag>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}
