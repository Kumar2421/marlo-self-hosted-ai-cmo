"use client";

import SegmentedThemeControl from "@/components/ui/SegmentedThemeControl";
import { useTheme } from "@/lib/useTheme";
import { CARD } from "@/components/settings/ui";

/** Light / Dark / System. "System" follows the operating system and updates live when it changes. */
export default function AppearanceSetting() {
  const { preference, resolved } = useTheme();
  return (
    <div className={`${CARD} mb-4 px-5 py-4`} data-testid="appearance-setting">
      <div className="mb-0.5 text-[14px] font-semibold text-ui-text" id="appearance-label">
        Appearance
      </div>
      <p className="mb-3 text-[13px] text-ui-muted">
        {preference === "system" ? `Following your system (currently ${resolved}).` : `Always ${resolved}.`}
      </p>
      <SegmentedThemeControl labelledBy="appearance-label" />
    </div>
  );
}
