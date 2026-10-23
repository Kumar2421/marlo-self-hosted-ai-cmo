import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { OutreachPlanResponse, OutreachStatus } from "@/lib/domain/leads/outreachContract";
import { guessedCheckboxLabel, reasonLabel, reasonTone, summarisePlan } from "@/lib/domain/leads/outreachCompose";
import { DailyMeter } from "./DailyMeter";
import { BTN_SECONDARY, leadLabel, type LeadLite } from "./ui";

type Props = {
  leads: LeadLite[];
  selectedCount: number;
  plan: OutreachPlanResponse | undefined;
  /** True while the first plan, or a re-plan after a change, is loading. */
  loading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  acceptGuessed: boolean;
  guessedCount: number;
  onToggleGuessed: (next: boolean) => void;
  fallbackStatus: OutreachStatus | undefined;
};

export function RecipientsStep({ leads, selectedCount, plan, loading, errorMessage, onRetry, acceptGuessed, guessedCount, onToggleGuessed, fallbackStatus }: Props) {
  const byId = new Map(leads.map((l) => [l.id, l]));

  if (!plan && loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Checking your recipients">
        <Skeleton height={24} width="70%" />
        <Skeleton height={40} />
        <Skeleton height={64} rounded="md" />
        <Skeleton height={64} rounded="md" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="space-y-4">
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p>{errorMessage ?? "We couldn't check your recipients."}</p>
            <button type="button" onClick={onRetry} className={`${BTN_SECONDARY} mt-2`}>
              Try again
            </button>
          </div>
        </div>
        {fallbackStatus && <DailyMeter status={fallbackStatus} />}
      </div>
    );
  }

  const summary = summarisePlan(selectedCount, plan);
  const showGuessed = guessedCount > 0 || acceptGuessed;

  return (
    <div className="space-y-5" aria-busy={loading}>
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900" data-testid="plan-headline" aria-live="polite">
          {summary.headline}
        </h3>
        <p className="mt-1 text-xs text-gray-500">{summary.creditLine}</p>
      </div>

      <DailyMeter status={plan.status} />

      {showGuessed && (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <input
            type="checkbox"
            checked={acceptGuessed}
            onChange={(e) => onToggleGuessed(e.target.checked)}
            disabled={loading}
            className="mt-0.5 h-4 w-4 shrink-0 accent-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-amber-900">{guessedCheckboxLabel(guessedCount)}</span>
            <span className="mt-0.5 block text-xs text-amber-800">
              Marlo built these from a name and a company website. They are not confirmed, so some will bounce, which can hurt your sender reputation.
            </span>
          </span>
        </label>
      )}

      {summary.sendable === 0 && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[13px] text-gray-700">
          <Info size={16} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
          <p>Nobody in this selection can be emailed right now. Pick other leads, or see the reasons below.</p>
        </div>
      )}

      {plan.blocked.length > 0 && (
        <section aria-label="Blocked leads">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Not sent ({plan.blocked.length})</h4>
          <ul className="okara-scroll max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200" data-testid="blocked-list">
            {plan.blocked.map((b) => {
              const lead = byId.get(b.leadId);
              return (
                <li key={b.leadId} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-gray-900">{leadLabel(lead)}</span>
                    {lead?.company && lead.name && <span className="block truncate text-xs text-gray-500">{lead.company}</span>}
                  </span>
                  <Badge tone={reasonTone(b.reason)}>
                    {reasonLabel(b.reason)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
