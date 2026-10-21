"use client";

import GhostLoader from "@/components/shared/GhostLoader";

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-200 ${className}`} />;
}

function ColumnSkeleton({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  return (
    <div className={`${className} flex h-full flex-col border-r ${dark ? "border-white/10 bg-[#110f0e]" : "border-gray-200 bg-white"} p-4`}>
      <div className={`mb-4 h-4 w-24 animate-pulse rounded ${dark ? "bg-white/10" : "bg-gray-200"}`} />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`h-14 animate-pulse rounded-xl ${dark ? "bg-white/5" : "bg-gray-100"}`} />
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="relative flex h-dvh flex-col bg-white">
      {/* Same geometry as the dashboard's terminal bar so the swap to real content doesn't shift. */}
      <div className="shrink-0 px-3 pb-1 pt-2">
      <div className="flex h-12 items-center justify-between rounded-xl bg-[#110f0e] px-3">
        <div className="flex items-center gap-2">
          <GhostLoader className="h-8 w-8" tone="light" />
          <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 animate-pulse rounded-full bg-white/10" />
          <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
        </div>
      </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[22%_26%_26%_1fr]">
        <ColumnSkeleton />
        <ColumnSkeleton className="max-md:hidden" />
        <ColumnSkeleton className="max-md:hidden" />
        <ColumnSkeleton dark className="max-md:hidden" />
      </div>
    </div>
  );
}
