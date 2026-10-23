"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { pickHighlights } from "@/lib/domain/search/highlights";
import type { SearchInsights } from "@/lib/domain/search/types";
import SearchInsightsPanel, { type TopQuery } from "./SearchInsightsPanel";
import { useSearchOpportunities } from "./useSearchOpportunities";

function Chip({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  const color = tone === "good" && value > 0 ? "text-emerald-600" : tone === "bad" && value > 0 ? "text-red-600" : "text-gray-900";
  return (
    <div className="flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2">
      <div className={`text-base font-semibold leading-none ${color}`}>{value}</div>
      <div className="mt-1 text-xs uppercase leading-tight text-gray-500">{label}</div>
    </div>
  );
}

/**
 * The compact, always-visible part of search insights for the dashboard
 * column: how things changed, the few items worth a look, and one button that
 * opens everything else in a slide-over.
 */
export default function SearchInsightsSection({ search, topQueries }: { search: SearchInsights | null; topQueries: TopQuery[] }) {
  const state = useSearchOpportunities();
  const [open, setOpen] = useState(false);

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mt-3 flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-800 transition-colors hover:bg-gray-50"
    >
      See all search insights
      <ChevronRight size={14} className="text-ui-faint" />
    </button>
  );

  let content: React.ReactNode;
  if (state.status === "loading") {
    content = <div className="text-xs text-ui-subtle">Loading search insights…</div>;
  } else if (state.status === "error") {
    content = <div className="text-xs text-amber-600">⚠ Couldn&apos;t load search insights.</div>;
  } else if (state.status === "empty") {
    content = (
      <div className="rounded-xl border border-dashed border-gray-200 p-3 text-[12px] text-gray-500">
        Use <strong>Refresh now</strong> above to save your search history and see what changed.
      </div>
    );
  } else {
    const { changes } = state.opportunities;
    const highlights = pickHighlights(state.opportunities);
    content = (
      <>
        <div className="mb-3 flex gap-2">
          <Chip label="Improved" value={changes.up} tone="good" />
          <Chip label="Slipping" value={changes.down} tone="bad" />
          <Chip label="New" value={changes.new} />
          <Chip label="Lost" value={changes.lost} />
        </div>
        {highlights.length === 0 ? (
          <div className="text-[12px] text-gray-500">Nothing stands out right now.</div>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white px-3">
            {highlights.map((item) => (
              <li key={`${item.type}:${item.query}`} className="py-2">
                <div className="truncate text-[12px] font-medium text-gray-900" title={item.query}>
                  {item.query}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-gray-500">{item.reasons[0]}</div>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <section className="mb-5">
      <h4 className="mb-2 text-[12px] font-semibold text-gray-700">Search insights</h4>
      {content}
      {trigger}
      <SearchInsightsPanel open={open} onClose={() => setOpen(false)} state={state} search={search} topQueries={topQueries} />
    </section>
  );
}
