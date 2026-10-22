import { cn } from "./cn.ts";

/**
 * Pure class builders shared by the primitives. Kept free of React so they can
 * be unit-tested with node --test (see tests/uiVariants.test.mts).
 */

/** Keyboard-only focus ring built from the --focus-ring-* tokens. */
export const FOCUS_RING =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]";

/** Same ring drawn inside the element, for items that sit flush in a container. */
export const FOCUS_RING_INSET =
  "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]";

export type IconButtonVariant = "ghost" | "subtle" | "solid";
export type IconButtonSize = "sm" | "md";

const ICON_BUTTON_BASE =
  "ui-transition relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-ui-sm disabled:pointer-events-none disabled:opacity-40";

const ICON_BUTTON_VARIANT: Record<IconButtonVariant, string> = {
  ghost: "text-ui-muted hover:bg-ui-surface-sunken hover:text-ui-text",
  subtle: "bg-ui-surface-sunken text-ui-muted hover:bg-ui-border hover:text-ui-text",
  solid: "bg-ui-primary text-ui-inverse hover:bg-ui-primary-hover",
};

// "sm" is 28px visually, but the ::before extends the pointer target to 36px.
const ICON_BUTTON_SIZE: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 before:absolute before:-inset-1 before:content-['']",
  md: "h-9 w-9",
};

export function iconButtonClass(opts: { variant?: IconButtonVariant; size?: IconButtonSize; className?: string } = {}): string {
  const { variant = "ghost", size = "md", className } = opts;
  return cn(ICON_BUTTON_BASE, FOCUS_RING, ICON_BUTTON_VARIANT[variant], ICON_BUTTON_SIZE[size], className);
}

export type Tone = "neutral" | "success" | "warn" | "danger" | "info";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-ui-surface-sunken text-ui-muted",
  success: "bg-ui-success-soft text-ui-success-text",
  warn: "bg-ui-warn-soft text-ui-warn-text",
  danger: "bg-ui-danger-soft text-ui-danger-text",
  info: "bg-ui-info-soft text-ui-info-text",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-ui-faint",
  success: "bg-ui-success",
  warn: "bg-ui-warn",
  danger: "bg-ui-danger",
  info: "bg-ui-info",
};

export function badgeClass(opts: { tone?: Tone; className?: string } = {}): string {
  const { tone = "neutral", className } = opts;
  return cn(
    "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap",
    BADGE_TONE[tone],
    className,
  );
}

export function chipClass(opts: { selected?: boolean; className?: string } = {}): string {
  const { selected = false, className } = opts;
  return cn(
    "ui-transition inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] leading-4 font-medium whitespace-nowrap",
    FOCUS_RING,
    selected
      ? "border-ui-primary bg-ui-primary text-ui-inverse"
      : "border-ui-border bg-ui-surface text-ui-muted hover:border-ui-border-strong hover:text-ui-text",
    className,
  );
}

/**
 * Sliding segmented-tab indicator. All segments are equal width, so the pill
 * is positioned with a pure CSS transform: width is one segment (minus the
 * 2px track padding on each side) and translateX moves it by whole widths.
 */
export function tabIndicatorStyle(activeIndex: number, count: number): { width: string; transform: string } {
  const n = Math.max(1, Math.floor(count));
  const i = Number.isFinite(activeIndex) ? Math.min(Math.max(Math.floor(activeIndex), 0), n - 1) : 0;
  return { width: `calc((100% - 4px) / ${n})`, transform: `translateX(${i * 100}%)` };
}
