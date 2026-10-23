import { ScoreRing } from "@/components/ui/ScoreRing";

/** Kept for existing call sites; the ring itself lives in components/ui/ScoreRing. */
export default function ScoreCircle({
  value,
  label,
  size = 56,
}: {
  /** Undefined means the score was not measured: shown as a dash, never as 0. */
  value: number | undefined;
  label: string;
  size?: number;
}) {
  return <ScoreRing value={value} label={label} size={size} className="shrink-0" />;
}
