"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  explicitTabFromSearch,
  parseDashboardTabOrNull,
  resolveDashboardTab,
  searchWithTab,
  type DashboardTab,
} from "@/lib/dashboardShell";

const STORAGE_KEY = "marlo.dashboard.tab";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function readStored(): DashboardTab | null {
  try {
    return parseDashboardTabOrNull(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null; // private mode / blocked storage
  }
}

/**
 * Active compact-shell tab, mirrored to ?tab= with replaceState (no history
 * entries). Precedence: ?tab= in the URL, then the user's last-used tab
 * (localStorage, written only when they pick one), then `hasAudit`-based
 * default (see resolveDashboardTab). Returns null while that default is still
 * unknown. The server snapshot is "nothing known" so hydration matches; the
 * real values are adopted right after.
 */
export function useDashboardTab(hasAudit: boolean | null): [DashboardTab | null, (tab: DashboardTab) => void] {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  const stored = useSyncExternalStore(subscribe, readStored, () => null);

  const setTab = useCallback((next: DashboardTab) => {
    try {
      const url = `${window.location.pathname}${searchWithTab(window.location.search, next)}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // URL sync is best effort.
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Remembering the tab is best effort.
    }
    listeners.forEach((l) => l());
  }, []);

  return [resolveDashboardTab({ urlTab: explicitTabFromSearch(search), storedTab: stored, hasAudit }), setTab];
}
