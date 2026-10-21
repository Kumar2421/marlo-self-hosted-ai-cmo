"use client";

import { useCallback, useSyncExternalStore } from "react";
import { searchWithTab, tabFromSearch, type DashboardTab } from "@/lib/dashboardShell";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/**
 * Active compact-shell tab, mirrored to ?tab= with replaceState (no history
 * entries). The server snapshot is the default tab so hydration matches; the
 * real URL value is adopted right after, so deep links and reloads work.
 */
export function useDashboardTab(): [DashboardTab, (tab: DashboardTab) => void] {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );

  const setTab = useCallback((next: DashboardTab) => {
    try {
      const url = `${window.location.pathname}${searchWithTab(window.location.search, next)}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // URL sync is best effort.
    }
    listeners.forEach((l) => l());
  }, []);

  return [tabFromSearch(search), setTab];
}
