"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_LABEL, THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

const ICON: Record<ThemePreference, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/** Light / Dark / System. "System" follows the operating system and updates live when it changes. */
export default function AppearanceSetting() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3" data-testid="appearance-setting">
      <div className="mb-0.5 text-[13px] font-semibold text-gray-900" id="appearance-label">
        Appearance
      </div>
      <p className="mb-2 text-[12px] text-gray-500">
        {preference === "system" ? `Following your system (currently ${resolved}).` : `Always ${resolved}.`}
      </p>
      <div role="radiogroup" aria-labelledby="appearance-label" className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
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
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] ${
                active ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <Icon size={13} aria-hidden />
              {THEME_LABEL[p]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
