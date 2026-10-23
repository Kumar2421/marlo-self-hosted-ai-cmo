import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { OutreachSendResult, OutreachStatus } from "@/lib/domain/leads/outreachContract";
import { resultReason, sendingText, summariseResults } from "@/lib/domain/leads/outreachCompose";
import { DailyMeter } from "./DailyMeter";
import { leadLabel, type LeadLite } from "./ui";

export function SendingState({ count }: { count: number }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-16 text-center" data-testid="sending-state">
      <Loader2 size={28} className="animate-spin text-gray-500" aria-hidden="true" />
      <p className="text-[15px] font-semibold text-gray-900">{sendingText(count)}</p>
      <p className="max-w-xs text-xs text-gray-500">Emails go out one at a time from your Gmail. This can take a little while.</p>
    </div>
  );
}

type Props = {
  leads: LeadLite[];
  results: OutreachSendResult["results"];
  status: OutreachStatus | undefined;
  errorMessage: string | null;
};

export function ResultsStep({ leads, results, status, errorMessage }: Props) {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const s = summariseResults(results);
  const problems = results.filter((r) => r.status !== "sent");
  return (
    <div className="space-y-5">
      {errorMessage && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}
      <div className="flex items-start gap-3">
        <CheckCircle2 size={20} className={s.sent > 0 ? "mt-0.5 text-emerald-600" : "mt-0.5 text-gray-400"} aria-hidden="true" />
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900" data-testid="results-headline">
            {s.sent} of {s.total} sent
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">Replies show up in your Leads list.</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2" data-testid="results-counts">
        {(
          [
            ["Sent", s.sent],
            ["Failed", s.failed],
            ["Skipped", s.skipped],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-lg border border-gray-200 px-3 py-2">
            <dd className="text-lg font-semibold text-gray-900">{n}</dd>
            <dt className="text-xs text-gray-500">{label}</dt>
          </div>
        ))}
      </dl>
      {problems.length > 0 && (
        <section aria-label="Emails that were not sent">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Not sent ({problems.length})</h4>
          <ul className="okara-scroll max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200" data-testid="results-problems">
            {problems.map((r) => (
              <li key={r.id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-[13px] font-medium text-gray-900">{leadLabel(byId.get(r.id))}</span>
                <span className={`shrink-0 text-right text-xs ${r.status === "failed" ? "text-red-700" : "text-gray-500"}`}>
                  {r.status === "failed" ? "Failed: " : "Skipped: "}
                  {resultReason(r)}
                </span>
              </li>
            ))}
          </ul>
          {s.failed > 0 && <p className="mt-2 text-xs text-gray-500">Skipped emails were held back by a safeguard, so retrying will not change them.</p>}
        </section>
      )}
      {status && <DailyMeter status={status} />}
    </div>
  );
}
