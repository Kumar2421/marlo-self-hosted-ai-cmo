/**
 * Theme preference (Light / Dark / System). Pure helpers, no React and no DOM,
 * so they can be unit-tested with node --test. The browser glue lives in
 * lib/useTheme.ts, and THEME_INIT_SCRIPT mirrors resolveTheme() for first paint.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "marlo-theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Anything unknown (null, old values, tampered storage) falls back to the default. */
export function parseThemePreference(raw: unknown): ThemePreference {
  return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** Order used by the one-click toggle in the user menu: light -> dark -> system -> light. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  const i = THEME_PREFERENCES.indexOf(current);
  return THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length];
}

export const THEME_LABEL: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Runs inline in <head> before first paint so there is no flash of the wrong
 * theme. Keep it dependency-free and wrapped in try/catch: storage can throw
 * (private windows, blocked cookies) and the page must still render.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=null;try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.setAttribute("data-theme",d?"dark":"light");r.style.colorScheme=d?"dark":"light"}catch(e){}})();`;
