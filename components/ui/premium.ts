import { cn } from "./cn.ts";

/**
 * Pure helpers behind the premium presentational components (ScoreRing, StatusChip,
 * TintedNotice, IconTile). No React so node --test can cover them (tests/uiPremium.test.mts).
 */

export type ScoreBand = "good" | "mid" | "bad";

/** Lighthouse bands: below 50 red, 50-89 orange, 90 and up green. Anything that is not a real 0-100 number has no band. */
export function scoreBand(value: number | null | undefined): ScoreBand | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  if (value >= 90) return "good";
  if (value >= 50) return "mid";
  return "bad";
}

/** Stroke class for a ring arc. An unmeasured score gets the neutral track colour, never a band. */
export const SCORE_STROKE: Record<ScoreBand, string> = {
  good: "stroke-score-good",
  mid: "stroke-score-mid",
  bad: "stroke-score-bad",
};

/** Accessible text for a ring: "Performance 63 out of 100", or "Performance not measured". */
export function scoreAriaLabel(label: string, value: number | null | undefined): string {
  return scoreBand(value) === null ? `${label} not measured` : `${label} ${Math.round(value as number)} out of 100`;
}

/** Circle geometry for a progress ring. offset is the stroke-dashoffset that leaves `value`% of the arc drawn. */
export function ringArc(
  value: number | null | undefined,
  size: number,
  stroke: number,
): { radius: number; circumference: number; offset: number } {
  const radius = Math.max(0, (size - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  const pct = scoreBand(value) === null ? 0 : Math.min(100, Math.max(0, value as number));
  return { radius, circumference, offset: circumference * (1 - pct / 100) };
}

export type NoticeTone = "warning" | "success" | "info" | "danger";

const NOTICE_TONE: Record<NoticeTone, string> = {
  warning: "border-tint-warning-border bg-tint-warning-bg text-tint-warning-fg",
  success: "border-tint-success-border bg-tint-success-bg text-tint-success-fg",
  info: "border-tint-info-border bg-tint-info-bg text-tint-info-fg",
  danger: "border-tint-danger-border bg-tint-danger-bg text-tint-danger-fg",
};

export function tintedNoticeClass(opts: { tone?: NoticeTone; className?: string } = {}): string {
  const { tone = "warning", className } = opts;
  return cn("rounded-xl border px-3 py-2.5 text-[12px] leading-5", NOTICE_TONE[tone], className);
}

export type ChipTone = "neutral" | NoticeTone;

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "border-ui-border bg-ui-surface-sunken text-ui-muted",
  warning: "border-tint-warning-border bg-tint-warning-bg text-tint-warning-fg",
  success: "border-tint-success-border bg-tint-success-bg text-tint-success-fg",
  info: "border-tint-info-border bg-tint-info-bg text-tint-info-fg",
  danger: "border-tint-danger-border bg-tint-danger-bg text-tint-danger-fg",
};

/** Small rounded status pill with a subtle border. `dashed` is the "add" affordance (neutral, no fill). */
export function statusChipClass(opts: { tone?: ChipTone; dashed?: boolean; className?: string } = {}): string {
  const { tone = "neutral", dashed = false, className } = opts;
  return cn(
    "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap",
    dashed ? "border-dashed border-ui-border-strong bg-transparent text-ui-muted" : CHIP_TONE[tone],
    className,
  );
}

/** Dot colour for a chip or row status. */
export const CHIP_DOT: Record<ChipTone, string> = {
  neutral: "bg-ui-faint",
  warning: "bg-score-mid",
  success: "bg-score-good",
  info: "bg-ui-info",
  danger: "bg-score-bad",
};

/** Core Web Vitals status ("Pass" / "Warn" / "Fail" / anything else) to a tone. Unknown stays neutral. */
export function vitalTone(status: string): ChipTone {
  if (status === "good" || status === "Pass") return "success";
  if (status === "warn" || status === "Warn") return "warning";
  if (status === "bad" || status === "Fail") return "danger";
  return "neutral";
}

export const VITAL_TEXT: Record<ChipTone, string> = {
  neutral: "text-ui-text",
  success: "text-score-good",
  warning: "text-score-mid",
  danger: "text-score-bad",
  info: "text-ui-text",
};

/** One or two capital letters for an avatar tile; "?" when there is nothing usable. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "")
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "?";
  const second = words.length > 1 ? (Array.from(words[1])[0] ?? "") : "";
  return (first + second).toUpperCase();
}

export type IconTileTone = "neutral" | NoticeTone;
export type IconTileSize = "sm" | "md" | "lg";

const TILE_TONE: Record<IconTileTone, string> = {
  neutral: "border-ui-border bg-ui-surface-sunken text-ui-muted",
  warning: "border-tint-warning-border bg-tint-warning-bg text-tint-warning-fg",
  success: "border-tint-success-border bg-tint-success-bg text-tint-success-fg",
  info: "border-tint-info-border bg-tint-info-bg text-tint-info-fg",
  danger: "border-tint-danger-border bg-tint-danger-bg text-tint-danger-fg",
};
const TILE_SIZE: Record<IconTileSize, string> = { sm: "h-7 w-7 text-xs", md: "h-8 w-8 text-xs", lg: "h-10 w-10 text-sm" };

export function iconTileClass(opts: { tone?: IconTileTone; size?: IconTileSize; round?: boolean; className?: string } = {}): string {
  const { tone = "neutral", size = "md", round = false, className } = opts;
  return cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden border font-semibold",
    round ? "rounded-full" : "rounded-lg",
    TILE_TONE[tone],
    TILE_SIZE[size],
    className,
  );
}
