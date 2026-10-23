"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronLeft,
  Globe,
  Cpu,
  SlidersHorizontal,
  Plug,
  UserCircle,
  Shield,
  KeyRound,
  Zap,
  Bell,
} from "lucide-react";
import { FEATURES } from "@/lib/features";
import { FOCUS_RING } from "@/components/settings/ui";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; dot?: boolean };

const AI_CMO_ITEMS: NavItem[] = [
  { href: "/settings/websites", label: "Websites", icon: Globe },
  { href: "/settings/credits", label: "Credits", icon: Zap, dot: true },
  { href: "/settings/llm-providers", label: "LLM Providers", icon: Cpu, dot: true },
  { href: "/settings/api-credentials", label: "API Credentials", icon: KeyRound },
  { href: "/settings/agents", label: "Agents", icon: SlidersHorizontal },
  { href: "/settings/integrations", label: "Integrations", icon: Plug, dot: true },
];

// API Credentials is a self-host-only concern -- platform mode manages its
// own keys (see resolvePlatformApiKey.ts), so the entry is noise there.
// Team, Devices and Skills & MCP were placeholders; their routes redirect to Websites.
export const VISIBLE_AI_CMO_ITEMS = FEATURES.PLATFORM_MODE
  ? AI_CMO_ITEMS.filter((item) => item.href !== "/settings/api-credentials")
  : AI_CMO_ITEMS;

export const CHAT_ITEMS: NavItem[] = [{ href: "/settings/personalization", label: "Profile", icon: UserCircle }];

export const GENERAL_ITEMS: NavItem[] = [
  { href: "/settings/account", label: "Account & Security", icon: Shield },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
];

function NavGroup({
  title,
  items,
  pathname,
}: {
  title?: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="mb-5">
      {title && (
        <div className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-ui-subtle">{title}</div>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group mb-0.5 flex min-h-10 items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${FOCUS_RING} ${
              active
                ? "border-ui-border bg-ui-surface text-ui-text shadow-sm"
                : "border-transparent text-ui-muted hover:bg-ui-surface-sunken hover:text-ui-text"
            }`}
          >
            <span className={active ? "text-ui-text" : "text-ui-faint group-hover:text-ui-muted"}>
              <Icon size={15} />
            </span>
            {item.label}
            {item.dot && <span aria-hidden="true" className="ml-auto h-1.5 w-1.5 rounded-full bg-ui-accent" />}
          </Link>
        );
      })}
    </div>
  );
}

const MOBILE_ITEMS: NavItem[] = [...VISIBLE_AI_CMO_ITEMS, ...CHAT_ITEMS, ...GENERAL_ITEMS];

export default function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <>
      <nav aria-label="Settings" data-testid="settings-sidebar" className="hidden w-64 shrink-0 border-r border-ui-border px-3 py-7 md:block">
        <button
          onClick={() => router.push("/dashboard")}
          className={`mb-7 flex items-center gap-2 rounded-lg px-1 text-2xl font-bold tracking-tight text-ui-text hover:opacity-70 ${FOCUS_RING}`}
        >
          <ChevronLeft size={20} />
          Settings
        </button>
        <NavGroup title="AI CMO" items={VISIBLE_AI_CMO_ITEMS} pathname={pathname} />
        <NavGroup title="CHAT" items={CHAT_ITEMS} pathname={pathname} />
        <NavGroup title="GENERAL" items={GENERAL_ITEMS} pathname={pathname} />
      </nav>

      <nav aria-label="Settings" data-testid="settings-mobile-bar" className="border-b border-ui-border md:hidden">
        <div className="flex items-center gap-1 px-2 pt-2">
          <button
            onClick={() => router.push("/dashboard")}
            aria-label="Back to dashboard"
            className={`flex min-h-11 items-center gap-1 rounded-lg px-2 text-[15px] font-semibold text-ui-text hover:bg-ui-surface-sunken ${FOCUS_RING}`}
          >
            <ChevronLeft size={18} />
            Settings
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-3 py-2">
          {MOBILE_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium ${FOCUS_RING} ${
                  active
                    ? "border-ui-border-strong bg-ui-surface text-ui-text shadow-sm"
                    : "border-transparent text-ui-muted hover:bg-ui-surface-sunken"
                }`}
              >
                <Icon size={14} />
                {item.label}
                {item.dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ui-accent" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
