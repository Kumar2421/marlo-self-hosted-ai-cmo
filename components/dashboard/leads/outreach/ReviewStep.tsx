import { AlertTriangle, MailCheck } from "lucide-react";
import { OUTREACH_TEMPLATES, type OutreachStatus, type OutreachTemplateId } from "@/lib/domain/leads/outreachContract";
import { creditLine } from "@/lib/domain/leads/outreachCompose";
import { DailyMeter } from "./DailyMeter";

type Props = {
  count: number;
  templateId: OutreachTemplateId;
  subject: string;
  credits: number;
  status: OutreachStatus;
  guessedIncluded: number;
  errorMessage: string | null;
};

export function ReviewStep({ count, templateId, subject, credits, status, guessedIncluded, errorMessage }: Props) {
  const template = OUTREACH_TEMPLATES.find((t) => t.id === templateId);
  const rows: Array<[string, string]> = [
    ["Recipients", `${count} ${count === 1 ? "person" : "people"}`],
    ["Template", template?.label ?? templateId],
    ["Subject", subject.trim()],
    ["Credits", creditLine(credits)],
  ];
  return (
    <div className="space-y-5">
      {errorMessage && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Ready to send?</h3>
        <p className="mt-1 text-xs text-gray-500">Nothing is sent until you press the button below.</p>
      </div>
      <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="review-summary">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
            <dt className="w-24 shrink-0 text-xs text-gray-500">{k}</dt>
            <dd className="min-w-0 break-words text-[13px] text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="flex items-start gap-2 text-[13px] text-gray-700">
        <MailCheck size={16} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
        Each email includes an unsubscribe link.
      </p>
      {guessedIncluded > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {guessedIncluded} of these {guessedIncluded === 1 ? "address is" : "addresses are"} guessed and may bounce.
        </p>
      )}
      <DailyMeter status={status} />
    </div>
  );
}
