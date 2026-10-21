import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type StatProps = {
  label: string;
  value: ReactNode;
  /** Quiet line under the value, e.g. "vs last 7 days". */
  hint?: ReactNode;
  className?: string;
};

/** Number + label. Tabular figures keep columns of stats from jittering. */
export function Stat({ label, value, hint, className }: StatProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-[11px] leading-4 text-ui-muted">{label}</div>
      <div className="truncate text-[16px] leading-6 font-semibold text-ui-text tabular-nums">{value}</div>
      {hint ? <div className="truncate text-[11px] leading-4 text-ui-subtle">{hint}</div> : null}
    </div>
  );
}
