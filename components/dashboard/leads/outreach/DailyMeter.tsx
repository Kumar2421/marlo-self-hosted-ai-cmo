import type { OutreachStatus } from "@/lib/domain/leads/outreachContract";
import { meterLabel, meterPercent } from "@/lib/domain/leads/outreachCompose";

/** "7 of 25 sent today, 18 left" with a thin bar. The bar turns amber when the day is nearly used. */
export function DailyMeter({ status }: { status: OutreachStatus }) {
  const percent = meterPercent(status);
  const label = meterLabel(status);
  return (
    <div data-testid="daily-meter">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-gray-700">Daily limit</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={status.dailyCap}
        aria-valuenow={Math.min(status.sentToday, status.dailyCap)}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100"
      >
        <div className={`h-full rounded-full transition-[width] ${percent >= 90 ? "bg-amber-300" : "bg-gray-900"}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
