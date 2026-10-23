"use client";

import { useRef, type KeyboardEvent } from "react";
import { OUTREACH_TEMPLATES, type OutreachTemplateId } from "@/lib/domain/leads/outreachContract";
import { FOCUS_RING_INSET } from "@/components/ui/variants";

/** Miniature drawings of the three layouts. Decorative only. */
function Mini({ id }: { id: OutreachTemplateId }) {
  const line = "h-1 rounded-full bg-gray-300";
  if (id === "card") {
    return (
      <div className="rounded-md border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 px-2 py-1.5">
          <div className="h-1.5 w-10 rounded-full bg-gray-500" />
        </div>
        <div className="space-y-1 p-2">
          <div className={`${line} w-full`} />
          <div className={`${line} w-5/6`} />
          <div className={`${line} w-2/3`} />
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2">
      {id === "clean" && <div className="mb-2 h-0.5 w-6 bg-orange-600" />}
      <div className="space-y-1">
        <div className={`${line} w-full`} />
        <div className={`${line} w-5/6`} />
        <div className={`${line} w-2/3`} />
      </div>
      {id === "clean" && <div className="mt-2 h-1 w-8 rounded-full bg-gray-500" />}
      <div className="mt-2 border-t border-gray-100 pt-1">
        <div className="h-0.5 w-1/2 rounded-full bg-gray-200" />
      </div>
    </div>
  );
}

/** Radio group of template cards. Arrow keys move the choice, Tab leaves the group. */
export function TemplatePicker({ value, onChange }: { value: OutreachTemplateId; onChange: (id: OutreachTemplateId) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = OUTREACH_TEMPLATES.findIndex((t) => t.id === value);
    const last = OUTREACH_TEMPLATES.length - 1;
    const next = e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "ArrowRight" || e.key === "ArrowDown" ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1;
    onChange(OUTREACH_TEMPLATES[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Email template" onKeyDown={onKeyDown} className="grid gap-2 sm:grid-cols-3">
      {OUTREACH_TEMPLATES.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            data-testid={`template-${t.id}`}
            className={`${FOCUS_RING_INSET} flex min-h-11 flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors ${
              selected ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900" : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <span aria-hidden="true">
              <Mini id={t.id} />
            </span>
            <span className="text-[13px] font-semibold text-gray-900">{t.label}</span>
            <span className="text-xs leading-4 text-gray-500">{t.description}</span>
          </button>
        );
      })}
    </div>
  );
}
