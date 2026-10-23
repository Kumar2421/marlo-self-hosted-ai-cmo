"use client";

import type { AutomationMode } from "@/lib/domain/actions/automationSettings";
import { useAutomation } from "./useAutomation";

const OPTIONS: Array<{ mode: AutomationMode; label: string }> = [
  { mode: "off", label: "Ask me" },
  { mode: "auto_approve_safe", label: "Auto-approve safe fixes" },
];

/** Per-project daily automation setting. Off by default. */
export default function AutomationCard({ projectId }: { projectId: string }) {
  const { mode, isLoading, isError, save } = useAutomation(projectId);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" data-testid="automation-card">
      <h4 className="text-[12px] font-semibold text-gray-700">Automation</h4>
      <p className="mt-1 text-xs leading-4 text-gray-500">
        Marlo suggests up to 3 fixes a day. &ldquo;Ask me&rdquo; leaves them for you to approve; &ldquo;Auto-approve safe fixes&rdquo; pre-approves the low-risk ones. Nothing changes on your site or gets sent without your click.
      </p>
      <div role="radiogroup" aria-label="Automation" className="mt-3 inline-flex rounded-lg border border-gray-200 p-0.5">
        {OPTIONS.map((option) => {
          const active = mode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={isLoading || save.isPending}
              onClick={() => !active && save.mutate(option.mode)}
              className={
                "rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 " +
                (active ? "bg-[#111111] text-white" : "text-gray-600 hover:bg-gray-50")
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {(isError || save.isError) && <p className="mt-2 text-xs text-red-600">Could not load or save this setting. Try again.</p>}
    </section>
  );
}
