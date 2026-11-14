import { scoreBand, type ScoreBand } from "@/lib/domain/seo/publicReportShared";

const COLOR: Record<ScoreBand, string> = {
  strong: "#15803d",
  good: "#4d7c0f",
  "needs-work": "#b45309",
  weak: "#b91c1c",
};

/** The on-page score as a ring. It is the share of on-page checks that passed, and the caption says so. */
export default function ScoreRing({ score, size = 128 }: { score: number; size?: number }) {
  const { band, label } = scoreBand(score);
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4" data-testid="audit-score">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`On-page score ${score} out of 100, ${label}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COLOR[band]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.3} fontWeight={600} fill="#111111">
          {score}
        </text>
      </svg>
      <div>
        <p className="text-lg font-medium" style={{ color: COLOR[band] }}>{label}</p>
        <p className="max-w-[16rem] text-xs leading-5 text-black/50">of the on-page checks passed. This is a checklist, not a ranking prediction.</p>
      </div>
    </div>
  );
}
