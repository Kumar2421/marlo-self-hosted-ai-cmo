"use client";

import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query/keys";
import AutomationCard from "./AutomationCard";
import { SkeletonStats, SkeletonCard } from "@/components/shared/Skeleton";
import { summaryTotals } from "@/lib/domain/search/summaryTotals";
import type { NextActionCard } from "@/lib/domain/search/nextActions";
import type { WeekEvent } from "@/lib/domain/search/weekChanges";

type OverviewData = {
  snapshot: { capturedAt: string; snapshotDate: string } | null;
  gscNotConnected?: boolean;
  collectingData?: boolean;
  stats?: {
    d28: { queries: Array<{ clicks: number; impressions: number; position: number }> };
    prev28: { queries: Array<{ clicks: number; impressions: number; position: number }> };
  };
  weekChanges?: WeekEvent[];
  nextActions?: NextActionCard[];
  yourFixes?: Array<{ id: string; title: string; outcome?: { verdict: string } }>;
  error?: string;
};

export default function SearchOverviewPanel({ projectId, onOpenFinding }: { projectId: string; onOpenFinding?: (findingId: string) => void }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.searchOverview(projectId),
    queryFn: async () => {
      const res = await fetch("/api/search/overview");
      if (!res.ok) throw new Error("Failed to load search overview");
      return (await res.json()) as OverviewData;
    },
  });

  if (isLoading) {
    return (
      <div>
        <SkeletonStats count={3} />
        <div className="mt-6 space-y-4">
          <SkeletonCard rows={3} />
          <SkeletonCard rows={3} />
        </div>
      </div>
    );
  }

  if (error || data?.error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-800">
        <span>{error?.message || data?.error}</span>
        <button type="button" onClick={() => refetch()} className="shrink-0 font-medium underline">
          Retry
        </button>
      </div>
    );
  }

  if (data?.gscNotConnected || !data?.snapshot) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="text-sm font-medium text-amber-900">Google Search Console not connected</div>
        <p className="mt-2 text-[12px] text-amber-700">
          Connect Google Search Console to see your search performance, opportunities, and track changes.
        </p>
      </div>
    );
  }

  if (data?.collectingData) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="text-sm font-medium text-blue-900">Collecting data</div>
        <p className="mt-2 text-[12px] text-blue-700">
          Google Search Console data lags about 3 days. Check back soon to see your latest search performance and opportunities.
        </p>
      </div>
    );
  }

  const stats = data?.stats;
  const d28Totals = summaryTotals(stats?.d28 ?? null);
  const prev28Totals = summaryTotals(stats?.prev28 ?? null);

  const clicksDelta = d28Totals.clicks - prev28Totals.clicks;
  const impressionsDelta = d28Totals.impressions - prev28Totals.impressions;
  const positionDelta = prev28Totals.position - d28Totals.position; // Lower is better

  return (
    <div className="space-y-5">
      {/* Summary Stats */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-[12px] font-semibold text-gray-700">Your top searches (28 days vs previous)</h4>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Search clicks" value={d28Totals.clicks.toLocaleString()} delta={clicksDelta} />
          <StatCard label="Search views" value={d28Totals.impressions.toLocaleString()} delta={impressionsDelta} />
          <StatCard label="Avg. position" value={d28Totals.position.toFixed(1)} delta={positionDelta} isBetter={(v) => v > 0} />
        </div>
      </section>

      <AutomationCard projectId={projectId} />

      {/* Week Changes */}
      {data?.weekChanges && data.weekChanges.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-3 text-[12px] font-semibold text-gray-700">This week on Google</h4>
          <div className="space-y-2">
            {data.weekChanges.map((event, i) => (
              <div key={i} className="flex items-start gap-2 text-[12px]">
                <span className={`mt-0.5 inline-block h-2 w-2 rounded-full ${getBadgeColor(event.type)}`} />
                <div>
                  <div className="font-medium text-gray-900">&quot;{event.query}&quot;</div>
                  <div className="text-gray-600">{event.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Next Actions */}
      {data?.nextActions && data.nextActions.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-3 text-[12px] font-semibold text-gray-700">What to work on next</h4>
          <div className="space-y-2">
            {data.nextActions.map((action, i) => (
              <div key={i} className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                <div className="font-medium text-[12px] text-blue-900">{action.title}</div>
                <div className="mt-1 text-xs text-blue-700">{action.why}</div>
                <div className="mt-1 text-xs font-medium text-blue-800">Expected impact: {action.expectedImpact}</div>
                {action.findingId && onOpenFinding && (
                  <button
                    type="button"
                    onClick={() => onOpenFinding(action.findingId!)}
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    See details
                    <ChevronRight size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        data?.snapshot && (
          <section className="rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="text-sm font-medium text-green-900">Nothing to fix right now</div>
            <p className="mt-2 text-[12px] text-green-700">
              Your site is performing well on the searches that matter. Keep an eye on the trends below to catch new opportunities.
            </p>
          </section>
        )
      )}

      {/* Your Fixes */}
      {data?.yourFixes && data.yourFixes.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="mb-3 text-[12px] font-semibold text-gray-700">Your recent fixes</h4>
          <div className="space-y-2">
            {data.yourFixes.map((fix) => (
              <div key={fix.id} className="rounded-lg border border-green-100 bg-green-50 p-3">
                <div className="font-medium text-[12px] text-green-900">{fix.title}</div>
                {fix.outcome && <div className="mt-1 text-xs text-green-700">{fix.outcome.verdict}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, delta, isBetter }: { label: string; value: string; delta: number; isBetter?: (v: number) => boolean }) {
  const isPositive = delta > 0;
  const arrowColor = isBetter ? (isBetter(delta) ? "text-green-600" : "text-red-600") : isPositive ? "text-green-600" : "text-red-600";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1 text-xs uppercase text-gray-500">{label}</div>
      <div className="flex items-end justify-between">
        <div className="text-lg font-semibold text-gray-900">{value}</div>
        <div className={`text-xs font-medium ${arrowColor}`}>
          {Math.abs(delta) > 0 && (isPositive ? "↑" : "↓")} {Math.abs(delta).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function getBadgeColor(type: string): string {
  switch (type) {
    case "appeared":
      return "bg-green-400";
    case "improved":
      return "bg-green-400";
    case "disappeared":
      return "bg-red-400";
    case "declined":
      return "bg-red-400";
    default:
      return "bg-gray-400";
  }
}
