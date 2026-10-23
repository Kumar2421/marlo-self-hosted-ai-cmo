"use client";

import SegmentedThemeControl from "@/components/ui/SegmentedThemeControl";
import { useTheme } from "@/lib/useTheme";

/** Light / Dark / System. "System" follows the operating system and updates live when it changes. */
export default function AppearanceSetting() {
  const { preference, resolved } = useTheme();
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3" data-testid="appearance-setting">
      <div className="mb-0.5 text-[13px] font-semibold text-gray-900" id="appearance-label">
        Appearance
      </div>
      <p className="mb-2 text-[12px] text-gray-500">
        {preference === "system" ? `Following your system (currently ${resolved}).` : `Always ${resolved}.`}
      </p>
      <SegmentedThemeControl labelledBy="appearance-label" />
    </div>
  );
}
