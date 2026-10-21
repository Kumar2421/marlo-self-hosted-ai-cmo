"use client";

import { useSyncExternalStore } from "react";
import { MOBILE_MAX_PX, TABLET_MAX_PX, type Breakpoint } from "@/lib/dashboardShell";

const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_PX}px)`;
const TABLET_QUERY = `(max-width: ${TABLET_MAX_PX}px)`;

function subscribe(onChange: () => void) {
  const queries = [window.matchMedia(MOBILE_QUERY), window.matchMedia(TABLET_QUERY)];
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}

function getSnapshot(): Breakpoint {
  if (window.matchMedia(MOBILE_QUERY).matches) return "mobile";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

// The server (and the hydration render) assumes desktop; React re-renders with
// the real value right after hydration, so window is never read during render
// and the markup always matches.
function getServerSnapshot(): Breakpoint {
  return "desktop";
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
