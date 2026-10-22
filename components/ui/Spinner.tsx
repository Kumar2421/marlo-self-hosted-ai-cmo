import { cn } from "./cn.ts";

const SIZES = { sm: "h-3.5 w-3.5 border-[1.5px]", md: "h-4 w-4 border-2", lg: "h-6 w-6 border-2" } as const;

export type SpinnerProps = {
  size?: keyof typeof SIZES;
  /** Announced to screen readers. */
  label?: string;
  className?: string;
};

/** CSS spinner (no Lottie). Inherits color from the surrounding text. */
export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex shrink-0", className)}>
      <span
        aria-hidden="true"
        className={cn("ui-spinner rounded-full border-current border-t-transparent opacity-70", SIZES[size])}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
