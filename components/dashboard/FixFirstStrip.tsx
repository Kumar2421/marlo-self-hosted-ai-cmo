"use client";

import { Loader2, X } from "lucide-react";
import type { FixFirstView } from "@/lib/domain/overview/fixFirst";

/**
 * "Fix first": the top few things to do, above the Analytics tabs. It never grows past three rows,
 * scrolls inside itself if the panel is very short, and shows a one-row skeleton while loading
 * (the same height as the empty states) so nothing jumps.
 */
export default function FixFirstStrip({
  view,
  onOpen,
  onRetry,
  onShowAll,
  onRunAudit,
  auditRunning = false,
  retrying = false,
  dismissed = false,
  onDismiss,
  onRestore,
}: {
  view: FixFirstView;
  onOpen: (findingId: string) => void;
  onRetry: () => void;
  onShowAll: () => void;
  onRunAudit: () => void;
  auditRunning?: boolean;
  retrying?: boolean;
  /** The user closed these suggestions: show only a one-line "Show" link. */
  dismissed?: boolean;
  onDismiss?: () => void;
  onRestore?: () => void;
}) {
  if (view.kind === "hidden") return null;

  const shell = "shrink-0 max-h-40 overflow-y-auto border-b border-gray-200 bg-white px-4 py-2.5";
  const label = <div className="text-xs font-semibold uppercase tracking-wide text-ui-subtle">Fix first</div>;
  const button = "shrink-0 rounded-lg bg-[#111111] px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50";

  if (view.kind === "loading") {
    return (
      <div data-testid="fix-first" data-state="loading" aria-busy="true" className={shell}>
        {label}
        <div className="mt-1 flex h-[30px] items-center">
          <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  if (view.kind === "actions" && dismissed) {
    return (
      <div data-testid="fix-first" data-state="dismissed" className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-1.5">
        <span className="text-xs text-ui-subtle">Fix-first suggestions hidden</span>
        <button type="button" onClick={onRestore} className="text-xs font-medium text-gray-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
          Show
        </button>
      </div>
    );
  }

  if (view.kind === "actions") {
    return (
      <div data-testid="fix-first" data-state="actions" className={shell}>
        <div className="flex items-center justify-between gap-2">
          {label}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Hide fix-first suggestions"
              title="Hide these suggestions"
              className="-mr-2 -my-1.5 flex h-9 w-9 items-center justify-center rounded-md text-ui-subtle hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
        <ul className="mt-1 space-y-1.5">
          {view.items.map((item) => (
            <li key={item.findingId} className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-[12px] leading-4 text-gray-800">{item.sentence}</span>
              <button type="button" onClick={() => onOpen(item.findingId)} className={button}>
                {item.button}
              </button>
            </li>
          ))}
        </ul>
        {view.moreCount > 0 && (
          <button type="button" onClick={onShowAll} className="mt-1.5 text-xs text-gray-500 hover:text-gray-800 hover:underline">
            {view.moreCount} more in Findings
          </button>
        )}
      </div>
    );
  }

  return (
    <div data-testid="fix-first" data-state={view.kind} className={shell}>
      {label}
      <div className="mt-1 flex min-h-[30px] items-center justify-between gap-3">
        {view.kind === "error" ? (
          <>
            <span role="alert" className="text-[12px] text-red-700">{view.message}</span>
            <button type="button" onClick={onRetry} disabled={retrying} className={button}>
              {retrying ? "Retrying..." : "Retry"}
            </button>
          </>
        ) : view.kind === "no_audit" ? (
          <>
            <span className="text-[12px] text-gray-700">No audit yet.</span>
            <button type="button" onClick={onRunAudit} disabled={auditRunning} className={`${button} inline-flex items-center gap-1`}>
              {auditRunning && <Loader2 size={12} className="animate-spin" />}
              {auditRunning ? "Running audit" : "Run audit"}
            </button>
          </>
        ) : (
          <span className="text-[12px] text-gray-700">Nothing needs attention.</span>
        )}
      </div>
    </div>
  );
}
