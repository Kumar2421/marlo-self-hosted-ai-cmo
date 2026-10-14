"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PlatformId } from "@/lib/domain/social/platforms";
import SocialWriterPanel from "./SocialWriterPanel";

export type SocialPanelValue = {
  /** The network whose side panel is open, or null. */
  openPlatform: PlatformId | null;
  /** Open one network's panel. Replaces whichever panel was open. */
  open: (platform: PlatformId) => void;
  close: () => void;
};

const NOOP_VALUE: SocialPanelValue = { openPlatform: null, open: () => {}, close: () => {} };

const SocialPanelContext = createContext<SocialPanelValue | null>(null);

/**
 * Owns the single social draft side panel for the dashboard. Mount it once above both
 * the mobile and desktop layouts; the top-bar menu and notifications call useSocialPanel().
 */
export function SocialPanelProvider({ children }: { children: ReactNode }) {
  const [openPlatform, setOpenPlatform] = useState<PlatformId | null>(null);

  const open = useCallback((platform: PlatformId) => setOpenPlatform(platform), []);
  const close = useCallback(() => setOpenPlatform(null), []);

  const value = useMemo<SocialPanelValue>(() => ({ openPlatform, open, close }), [openPlatform, open, close]);

  return (
    <SocialPanelContext.Provider value={value}>
      {children}
      {openPlatform && <SocialWriterPanel key={openPlatform} platform={openPlatform} onClose={close} />}
    </SocialPanelContext.Provider>
  );
}

/** Safe outside the provider: returns a no-op so callers never crash when it is not mounted. */
export function useSocialPanel(): SocialPanelValue {
  return useContext(SocialPanelContext) ?? NOOP_VALUE;
}
