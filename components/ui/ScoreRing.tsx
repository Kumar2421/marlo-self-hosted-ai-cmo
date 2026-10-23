import { cn } from "./cn.ts";
import { ringArc, scoreAriaLabel, scoreBand, SCORE_STROKE } from "./premium.ts";

/**
 * Circular score (0-100). Colour comes from the score band (<50 red, 50-89 orange, >=90 green) and is the only
 * place those colours appear on a ring. An undefined value is "not measured": a dash and an empty track, never a 0.
 */
export function ScoreRing({
  value,
  label,
  size = 56,
  stroke = 4,
  className,
}: {
  value: number | null | undefined;
  label: string;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const band = scoreBand(value);
  const { radius, circumference, offset } = ringArc(value, size, stroke);
  const center = size / 2;
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-1.5", className)}>
      <div role="img" aria-label={scoreAriaLabel(label, value)} className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
          <circle cx={center} cy={center} r={radius} fill="none" strokeWidth={stroke} className="stroke-score-track" />
          {band ? (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className={cn(SCORE_STROKE[band], "transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none")}
            />
          ) : null}
        </svg>
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-[15px] font-semibold tabular-nums text-ui-text">
          {band ? Math.round(value as number) : "—"}
        </div>
      </div>
      <span className="max-w-full text-center text-xs leading-4 text-ui-muted">{label}</span>
    </div>
  );
}
