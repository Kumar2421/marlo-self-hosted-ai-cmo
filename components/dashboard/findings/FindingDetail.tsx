"use client";

import { AlertTriangle, Check, ChevronRight } from "lucide-react";
import type { Finding, FindingStatus } from "@/lib/domain/findings/findingTypes";
import { autoVerificationLine, evidenceRowsForFinding, whyItMattersForFinding } from "@/lib/domain/findings/evidenceDisplay";
import { SkeletonLines } from "@/components/shared/Skeleton";
import FindingActionsSection from "../FindingActionsSection";
import FindingCodeFix from "./FindingCodeFix";
import { useFindingWork } from "./useFindings";

export const STATUS_LABEL: Record<FindingStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  fixing: "Fixing",
  fixed: "Fixed",
  verified: "Verified",
  failed: "Verification failed",
};

const STATUS_ORDER: FindingStatus[] = ["new", "acknowledged", "fixing", "fixed", "verified"];

export function severityClass(severity: Finding["severity"]) {
  if (severity === "critical") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-gray-200 bg-gray-50 text-gray-600";
}

export function statusClass(status: FindingStatus) {
  if (status === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
  if (status === "fixing") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-gray-200 bg-gray-50 text-gray-600";
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{children}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4 border-t border-gray-100 px-3 py-2 text-[12px] first:border-t-0">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-gray-800">
        {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
      </span>
    </div>
  );
}

/** Everything about one finding: why it was flagged, the evidence, what to do, tracked actions and lifecycle. */
export default function FindingDetail({
  finding,
  verification,
  error,
}: {
  finding: Finding;
  verification: "verified" | "failed" | null;
  error: string | null;
}) {
  const work = useFindingWork(finding.id);
  const evidenceRows = evidenceRowsForFinding(finding);
  const why = whyItMattersForFinding(finding);
  const currentIndex = STATUS_ORDER.indexOf(finding.status);
  const lastCheckReason = (finding.evidence.lastCheck as { reason?: string } | undefined)?.reason;
  const autoLine = autoVerificationLine(finding.evidence);
  const loadError = work.recommendations.isError ? "Couldn't generate recommendations for this finding." : null;

  return (
    <div className="space-y-5">
      {(error || work.error) && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error ?? work.error}</div>
      )}

      {autoLine && (
        <div
          className={`rounded-xl border p-3 text-[12px] ${
            autoLine.tone === "verified"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : autoLine.tone === "failed"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {autoLine.text}
        </div>
      )}

      {verification && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-[12px] ${
            verification === "verified" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {verification === "verified" ? <Check size={15} className="mt-0.5" /> : <AlertTriangle size={15} className="mt-0.5" />}
          <div>
            <div className="font-semibold">{verification === "verified" ? "Verified" : "Verification failed"}</div>
            <div className="mt-0.5">
              {lastCheckReason ??
                (verification === "verified"
                  ? "The issue is no longer detected on this page."
                  : "The issue is still detected. Keep fixing it and re-check again.")}
            </div>
          </div>
        </div>
      )}

      <section>
        <SectionTitle>Why this was flagged</SectionTitle>
        {why && <p className="mb-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] leading-5 text-gray-700">{why}</p>}
        {evidenceRows.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {evidenceRows.map((row) => (
              <EvidenceRow key={row.key} label={row.label} value={row.value} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>What to do</SectionTitle>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] leading-5 text-gray-700">{finding.recommendation}</div>
      </section>

      <section>
        <SectionTitle hint="Marlo can open a pull request for simple copy and markup fixes. You review and merge it.">Fix in code</SectionTitle>
        <FindingCodeFix finding={finding} actions={work.actions.data ?? []} />
      </section>

      <section>
        <SectionTitle hint="Prioritized from the evidence collected in this audit.">Recommended next steps</SectionTitle>
        {work.recommendations.isPending ? (
          <SkeletonLines rows={3} />
        ) : loadError ? (
          <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
            <span>{loadError}</span>
            <button type="button" onClick={() => work.recommendations.refetch()} className="font-medium underline">
              Retry
            </button>
          </div>
        ) : (
          <FindingActionsSection
            recommendations={work.recommendations.data ?? []}
            actions={work.actions.data ?? []}
            loading={work.actions.isPending}
            busyRecommendationId={work.busyKey}
            onCreate={(recommendation) => work.create.mutate(recommendation)}
            onCancel={(action) => work.cancel.mutate(action)}
            onImplement={(action, pageUrl) => work.implement.mutate({ action, pageUrl })}
            onUndo={(action) => work.undo.mutate(action)}
          />
        )}
      </section>

      <section>
        <SectionTitle>Progress</SectionTitle>
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_ORDER.map((status, index) => (
            <div key={status} className="flex items-center gap-1">
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-medium ${
                  finding.status === status
                    ? statusClass(status)
                    : index < currentIndex
                      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 bg-white text-gray-400"
                }`}
              >
                {STATUS_LABEL[status]}
              </span>
              {index < STATUS_ORDER.length - 1 && <ChevronRight size={11} className="text-gray-300" />}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-gray-400">
          First seen {new Date(finding.firstSeen).toLocaleDateString()} · Last checked {new Date(finding.lastSeen).toLocaleString()}
        </p>
      </section>
    </div>
  );
}
