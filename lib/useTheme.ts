"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

function applyToDocument(preference: ThemePreference) {
  const dark = resolveTheme(preference, window.matchMedia(DARK_QUERY).matches) === "dark";
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = window.matchMedia(DARK_QUERY);
  // Follow-system: re-apply when the OS flips, but only while the preference is "system".
  const onSystem = () => {
    if (readPreference() === "system") applyToDocument("system");
    onChange();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) {
      applyToDocument(readPreference());
      onChange();
    }
  };
  mq.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = (): ThemePreference => DEFAULT_THEME_PREFERENCE;

/** Current preference plus what it resolves to right now; setPreference persists and applies at once. */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(subscribe, readPreference, serverSnapshot);
  const systemDark = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DARK_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  const setPreference = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
    applyToDocument(next);
    listeners.forEach((l) => l());
  }, []);
  return { preference, resolved: resolveTheme(preference, systemDark), setPreference };
}
