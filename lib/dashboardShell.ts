// Pure helpers for the compact (phone/tablet) dashboard shell. No React, no DOM,
// so they can be unit-tested with node --test.

export type DashboardTab = "context" | "analytics" | "agents" | "chat";
export type Breakpoint = "mobile" | "tablet" | "desktop";

export const DASHBOARD_TABS: readonly DashboardTab[] = ["context", "analytics", "agents", "chat"];
export const DEFAULT_DASHBOARD_TAB: DashboardTab = "context";

/** Below MOBILE_MAX_PX: one panel at a time. Up to TABLET_MAX_PX: two panes. Above: the 4-column desktop grid. */
export const MOBILE_MAX_PX = 767;
export const TABLET_MAX_PX = 1099;

/** Anything that is not one of the four known tab keys falls back to the default. */
export function parseDashboardTab(value: unknown): DashboardTab {
  return typeof value === "string" && (DASHBOARD_TABS as readonly string[]).includes(value)
    ? (value as DashboardTab)
    : DEFAULT_DASHBOARD_TAB;
}

export function breakpointForWidth(width: number): Breakpoint {
  if (width <= MOBILE_MAX_PX) return "mobile";
  if (width <= TABLET_MAX_PX) return "tablet";
  return "desktop";
}

/** Read ?tab= from a query string ("?tab=chat" or "tab=chat"). */
export function tabFromSearch(search: string): DashboardTab {
  return parseDashboardTab(new URLSearchParams(search).get("tab"));
}

/** Return `search` with ?tab= set; other params are kept. The default tab is still written so the URL is explicit. */
export function searchWithTab(search: string, tab: DashboardTab): string {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  return `?${params.toString()}`;
}

/** Tablet panes: the left pane holds Context or Analytics, the right pane Leads or Chat. */
export const TABLET_LEFT: readonly DashboardTab[] = ["context", "analytics"];
export const TABLET_RIGHT: readonly DashboardTab[] = ["agents", "chat"];

/**
 * Which panels are on screen. Mobile: only the active tab. Tablet: the active
 * tab plus the most recent choice from the other pane, so the pair is always
 * one of [Context|Analytics] x [Leads|Chat].
 */
export function visibleTabs(
  bp: Breakpoint,
  active: DashboardTab,
  lastLeft: DashboardTab,
  lastRight: DashboardTab,
): DashboardTab[] {
  if (bp !== "tablet") return [active];
  const left = TABLET_LEFT.includes(active) ? active : TABLET_LEFT.includes(lastLeft) ? lastLeft : "analytics";
  const right = TABLET_RIGHT.includes(active) ? active : TABLET_RIGHT.includes(lastRight) ? lastRight : "agents";
  return [left, right];
}

/** Roving-tabindex arrow-key target; null when the key is not a tablist navigation key. */
export function nextTabForKey(current: DashboardTab, key: string): DashboardTab | null {
  const i = DASHBOARD_TABS.indexOf(current);
  const n = DASHBOARD_TABS.length;
  if (key === "ArrowRight") return DASHBOARD_TABS[(i + 1) % n];
  if (key === "ArrowLeft") return DASHBOARD_TABS[(i - 1 + n) % n];
  if (key === "Home") return DASHBOARD_TABS[0];
  if (key === "End") return DASHBOARD_TABS[n - 1];
  return null;
}
