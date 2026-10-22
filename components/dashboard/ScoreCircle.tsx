function colorFor(value: number) {
  if (value >= 90) return "#22c55e";
  if (value >= 50) return "#eab308";
  return "#ef4444";
}

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
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - ((value ?? 0) / 100) * circumference;
  const color = value === undefined ? "rgba(0,0,0,0.08)" : colorFor(value);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-900">
          {value ?? "—"}
        </div>
      </div>
      <span className="text-[11px] text-gray-500">{label}</span>
    </div>
  );
}
