import Link from "next/link";
import { Lock } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/components/ui/cn";
import { FOCUS_RING } from "@/components/ui/variants";
import { PLAN_LABELS, type PlanId } from "@/lib/domain/plans/planMatrix";

export type LockedLineProps = {
  /** What is locked, e.g. "Leads finder". */
  label: string;
  minPlan: PlanId;
  /** Optional one-sentence explanation shown in a tooltip. */
  hint?: string;
  className?: string;
};

/**
 * One compact row that stands in for a plan-locked feature: lock icon, a
 * plain statement and a link to /pricing. No counts, no previews of the real
 * content, no banner. Render it only when lockedFeature(...).locked.
 */
export function LockedLine({ label, minPlan, hint, className }: LockedLineProps) {
  const text = `${label} is on the ${PLAN_LABELS[minPlan]} plan`;
  const row = (
    <span className="min-w-0 flex-1 truncate text-ui-text" data-testid="locked-line-text">
      {text}
    </span>
  );
  return (
    <div
      data-testid="locked-line"
      className={cn("flex h-9 items-center gap-2 rounded-ui-sm border border-ui-border px-3 text-[13px]", className)}
    >
      <Lock size={14} aria-hidden="true" className="shrink-0 text-ui-muted" />
      {hint ? (
        <Tooltip content={hint}>
          <span tabIndex={0} aria-label={`${text}. ${hint}`} className={cn("min-w-0 flex-1 truncate rounded-ui-sm", FOCUS_RING)}>
            {text}
          </span>
        </Tooltip>
      ) : (
        row
      )}
      <Link href="/pricing" className={cn("shrink-0 font-medium text-ui-text underline underline-offset-2 hover:no-underline", FOCUS_RING)}>
        See plans
      </Link>
    </div>
  );
}
