import type { CSSProperties } from "react";
import { cn } from "./cn.ts";

type Size = number | string;

const toCss = (v: Size) => (typeof v === "number" ? `${v}px` : v);

export type SkeletonProps = {
  /** Required so the placeholder reserves its final height and nothing shifts on load. */
  height: Size;
  width?: Size;
  /** Use "full" for avatars and dots. */
  rounded?: "sm" | "md" | "lg" | "full";
  className?: string;
};

const ROUNDED = { sm: "rounded-ui-sm", md: "rounded-ui-md", lg: "rounded-ui-lg", full: "rounded-full" } as const;

/** Shimmering placeholder. Decorative: hidden from assistive tech. */
export function Skeleton({ height, width = "100%", rounded = "sm", className }: SkeletonProps) {
  const style: CSSProperties = { height: toCss(height), width: toCss(width) };
  return <span aria-hidden="true" className={cn("ui-skeleton block max-w-full", ROUNDED[rounded], className)} style={style} />;
}

export type SkeletonTextProps = {
  lines?: number;
  /** Height of each line in px. Total height = lines * lineHeight + (lines - 1) * gap. */
  lineHeight?: number;
  gap?: number;
  className?: string;
};

/** Paragraph placeholder; the last line is shorter. */
export function SkeletonText({ lines = 3, lineHeight = 12, gap = 8, className }: SkeletonTextProps) {
  return (
    <span aria-hidden="true" className={cn("flex flex-col", className)} style={{ gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={lineHeight} width={i === lines - 1 && lines > 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}
