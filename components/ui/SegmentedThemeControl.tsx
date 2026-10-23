"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_LABEL, THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

const ICON: Record<ThemePreference, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/**
 * Light / Dark / System as a three-option radiogroup. Shared by Settings > Account and the user menu so the
 * choice is one click, labelled, and the current option is always visible.
 */
export default function SegmentedThemeControl({
  labelledBy,
  ariaLabel = "Theme",
  fill = false,
  testId = "theme-control",
}: {
  /** id of a visible label element; falls back to ariaLabel. */
  labelledBy?: string;
  ariaLabel?: string;
  /** Stretch the options to the container width. */
  fill?: boolean;
  testId?: string;
}) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : ariaLabel}
      data-testid={testId}
      className={`${fill ? "flex w-full" : "inline-flex"} rounded-lg border border-gray-200 bg-gray-50 p-0.5`}
    >
      {THEME_PREFERENCES.map((p) => {
        const Icon = ICON[p];
        const active = preference === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPreference(p)}
            className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] ${
              fill ? "flex-1" : ""
            } ${active ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"}`}
          >
            <Icon size={13} aria-hidden />
            {THEME_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}
