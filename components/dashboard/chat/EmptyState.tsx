"use client";

export const DEFAULT_STARTERS = [
  "What should I fix first on my site?",
  "Summarise my SEO findings",
  "Draft a post about my latest feature",
];

export default function EmptyState({
  starters = DEFAULT_STARTERS,
  onPick,
}: {
  starters?: string[];
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="space-y-1">
        <p className="dash-title justify-center">How can I help today?</p>
        <p className="dash-meta text-ui-subtle">Ask about your site, your data or your content.</p>
      </div>
      <div className="flex w-full max-w-[260px] flex-col gap-1.5">
        {starters.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="dash-focus dash-body min-h-9 rounded-lg border border-gray-200 px-3 py-1.5 text-left text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
