import type { HTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn.ts";
import { badgeClass, chipClass, TONE_DOT, type Tone } from "./variants.ts";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  /** Leading status dot in the tone color. */
  dot?: boolean;
};

/** Small static status label. */
export function Badge({ tone = "neutral", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={badgeClass({ tone, className })} {...rest}>
      {dot ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export type ChipProps = {
  children: ReactNode;
  /** Toggle state; sets aria-pressed. */
  selected?: boolean;
  onClick?: () => void;
  /** When set, a trailing remove button is rendered. */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  className?: string;
};

/** Interactive pill: a filter toggle, optionally removable. */
export function Chip({ children, selected = false, onClick, onRemove, removeLabel = "Remove", disabled, className }: ChipProps) {
  return (
    <span className="inline-flex max-w-full items-center">
      <button
        type="button"
        aria-pressed={onClick ? selected : undefined}
        disabled={disabled}
        onClick={onClick}
        className={cn(chipClass({ selected, className }), "disabled:pointer-events-none disabled:opacity-40", onRemove && "rounded-r-none border-r-0 pr-2")}
      >
        <span className="min-w-0 truncate">{children}</span>
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
          className={cn(chipClass({ selected }), "w-7 justify-center rounded-l-none border-l-0 px-0 disabled:pointer-events-none disabled:opacity-40")}
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
