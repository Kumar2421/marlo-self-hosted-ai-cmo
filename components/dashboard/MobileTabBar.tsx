"use client";

import { useRef } from "react";
import { Layers, BarChart2, Users, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { DASHBOARD_TABS, nextTabForKey, type DashboardTab } from "@/lib/dashboardShell";

export type MobileTab = DashboardTab;

const TABS: { key: MobileTab; label: string; icon: ReactNode }[] = [
  { key: "context", label: "Context", icon: <Layers size={18} /> },
  { key: "analytics", label: "Analytics", icon: <BarChart2 size={18} /> },
  { key: "agents", label: "Leads", icon: <Users size={18} /> },
  { key: "chat", label: "Chat", icon: <MessageSquare size={18} /> },
];

export const tabId = (key: MobileTab) => `dash-tab-${key}`;
export const panelId = (key: MobileTab) => `dash-panel-${key}`;

export default function MobileTabBar({
  active,
  onChange,
  statusDots,
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  /** Tabs that should show a small teal status dot. Not wired to data yet. */
  statusDots?: Partial<Record<MobileTab, boolean>>;
}) {
  const refs = useRef<Partial<Record<MobileTab, HTMLButtonElement | null>>>({});
  const activeIndex = DASHBOARD_TABS.indexOf(active);

  function onKeyDown(e: React.KeyboardEvent, key: MobileTab) {
    const next = nextTabForKey(key, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <nav
      aria-label="Dashboard sections"
      className="relative shrink-0 border-t border-gray-200 bg-white pt-1.5 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 h-0.5 w-1/4 transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      >
        <span className="mx-auto block h-full w-10 rounded-full bg-gray-900" />
      </span>
      <div role="tablist" aria-label="Dashboard sections" className="flex items-stretch">
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                refs.current[tab.key] = el;
              }}
              id={tabId(tab.key)}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={panelId(tab.key)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(e) => onKeyDown(e, tab.key)}
              className={`flex min-h-12 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gray-900 ${
                isActive ? "text-gray-900" : "text-gray-500"
              }`}
            >
              <span
                className={`relative flex h-8 w-8 items-center justify-center rounded-full ${
                  isActive ? "bg-gray-100" : ""
                }`}
              >
                {tab.icon}
                {statusDots?.[tab.key] && (
                  <span
                    data-testid={`tab-dot-${tab.key}`}
                    className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-teal-500 ring-2 ring-white"
                  />
                )}
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
