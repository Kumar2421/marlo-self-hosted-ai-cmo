"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

/**
 * A list of short text values: type and press Enter (or comma) to add, click a
 * chip's × to remove, or tap a suggestion. Used for job titles, company
 * types, locations and exclusions in the lead profile.
 */
export default function ChipInput({
  label,
  value,
  onChange,
  suggestions = [],
  placeholder,
  max,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  max: number;
}) {
  const [draft, setDraft] = useState("");
  const atLimit = value.length >= max;
  const has = (text: string) => value.some((v) => v.toLowerCase() === text.toLowerCase());

  const add = (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || has(clean) || atLimit) return;
    onChange([...value, clean]);
    setDraft("");
  };

  const open = suggestions.filter((s) => !has(s)).slice(0, 8);

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={label}>
          {value.map((item) => (
            <li key={item} className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-1 pl-2.5 pr-1.5 text-[12px] text-gray-800">
              <span className="max-w-[16rem] truncate">{item}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== item))}
                aria-label={`Remove ${item}`}
                className="rounded-full p-0.5 text-ui-subtle hover:bg-gray-200 hover:text-gray-700"
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            }
          }}
          disabled={atLimit}
          placeholder={atLimit ? `Up to ${max}` : placeholder}
          aria-label={label}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400 disabled:bg-gray-50"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim() || atLimit}
          aria-label={`Add ${label}`}
          className="rounded-lg border border-gray-200 px-2.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>

      {open.length > 0 && !atLimit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {open.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-gray-400 hover:text-gray-800"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
