"use client";

import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { SkeletonCard } from "@/components/shared/Skeleton";
import type { LeadStatus } from "@/lib/domain/leads/local/businessLead";
import BusinessLeadCard, { type BusinessLead } from "./BusinessLeadCard";

export type BusinessSearchError = { message: string; status: number };

/** The current search's results (with Load more), then the saved business leads below. */
export default function BusinessResults({
  searching,
  searched,
  results,
  saved,
  nextPageToken,
  duplicates,
  loadingMore,
  error,
  showStatus,
  canEmail,
  onRetry,
  onLoadMore,
  onRemove,
  onEmail,
  onStatusChange,
}: {
  searching: boolean;
  /** A search has run this session, so an empty result can say so. */
  searched: boolean;
  results: BusinessLead[];
  saved: BusinessLead[];
  nextPageToken: string | null;
  /** Businesses the project already had, across this session's pages. */
  duplicates: number;
  loadingMore: boolean;
  error: BusinessSearchError | null;
  showStatus: boolean;
  canEmail: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onRemove: (id: string) => void;
  onEmail: (lead: BusinessLead) => void;
  onStatusChange: (id: string, status: LeadStatus) => Promise<void>;
}) {
  const cardProps = { showStatus, canEmail, onRemove, onEmail, onStatusChange };

  return (
    <div className="space-y-4 p-3">
      {error && <ErrorBlock error={error} onRetry={onRetry} />}

      {searching && results.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} rows={3} />
          ))}
        </div>
      ) : results.length === 0 ? (
        searched && !error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Search size={18} className="text-gray-300" />
            <p className="text-[13px] font-medium text-gray-700">No places found - try a broader category or nearby city</p>
          </div>
        ) : !searched && saved.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Search size={18} className="text-gray-300" />
            <p className="max-w-[240px] text-[12px] text-gray-500">
              Search a category and a city above. Each result is a real place, with the contact details we could find on its own site.
            </p>
          </div>
        ) : null
      ) : (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Results ({results.length})</h3>
          {results.map((lead) => (
            <BusinessLeadCard key={lead.id} lead={lead} {...cardProps} />
          ))}
          <div className="flex flex-col items-center gap-1.5 pt-1 text-center">
            {duplicates > 0 && (
              <p className="text-[11px] text-gray-400">
                {duplicates} already saved {duplicates === 1 ? "was" : "were"} skipped
              </p>
            )}
            {nextPageToken ? (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-4 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore && <Loader2 size={12} className="animate-spin" />}
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            ) : (
              <p className="text-[11px] text-gray-400">No more results</p>
            )}
          </div>
        </section>
      )}

      {saved.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Saved businesses ({saved.length})</h3>
          {saved.map((lead) => (
            <BusinessLeadCard key={lead.id} lead={lead} {...cardProps} />
          ))}
        </section>
      )}
    </div>
  );
}

function ErrorBlock({ error, onRetry }: { error: BusinessSearchError; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-[12px] text-red-700">
      <p>{error.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onRetry} className="min-h-9 rounded-lg border border-red-200 bg-white px-3 font-medium text-red-700 hover:bg-red-50">
          Retry
        </button>
        {error.status === 402 && (
          <Link href="/settings/credits" className="font-medium underline hover:text-red-800">
            Open credits in Settings
          </Link>
        )}
        {error.status === 422 && (
          <Link href="/settings/api-credentials" className="font-medium underline hover:text-red-800">
            Open API credentials
          </Link>
        )}
      </div>
    </div>
  );
}
