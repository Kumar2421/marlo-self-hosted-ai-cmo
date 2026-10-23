"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronLeft,
  Globe,
  Cpu,
  SlidersHorizontal,
  Plug,
  Users,
  UserCircle,
  Shield,
  KeyRound,
  Zap,
  Bell,
} from "lucide-react";
import { FEATURES } from "@/lib/features";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; dot?: boolean };

const AI_CMO_ITEMS: NavItem[] = [
  { href: "/settings/websites", label: "Websites", icon: Globe },
  { href: "/settings/credits", label: "Credits", icon: Zap, dot: true },
  { href: "/settings/llm-providers", label: "LLM Providers", icon: Cpu, dot: true },
  { href: "/settings/api-credentials", label: "API Credentials", icon: KeyRound },
  { href: "/settings/agents", label: "Agents", icon: SlidersHorizontal },
  { href: "/settings/integrations", label: "Integrations", icon: Plug, dot: true },
  { href: "/settings/team", label: "Team", icon: Users, dot: true },
];

// API Credentials is a self-host-only concern -- platform mode manages its
// own keys (see resolvePlatformApiKey.ts), so the entry is noise there.
// Devices and Skills & MCP routes still exist but are intentionally unlinked.
export const VISIBLE_AI_CMO_ITEMS = FEATURES.PLATFORM_MODE
  ? AI_CMO_ITEMS.filter((item) => item.href !== "/settings/api-credentials")
  : AI_CMO_ITEMS;

export const CHAT_ITEMS: NavItem[] = [{ href: "/settings/personalization", label: "Personalization", icon: UserCircle }];

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
        <div className="mb-1 px-3 text-xs font-semibold tracking-wide text-ui-subtle">{title}</div>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/40 ${
              active ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Icon size={15} />
            {item.label}
            {item.dot && <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />}
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
      <nav aria-label="Settings" data-testid="settings-sidebar" className="hidden w-64 shrink-0 border-r border-gray-100 px-3 py-6 md:block">
        <button
          onClick={() => router.push("/dashboard")}
          className="mb-6 flex items-center gap-2 rounded-lg px-1 text-2xl font-bold text-gray-900 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/40"
        >
          <ChevronLeft size={20} />
          Settings
        </button>
        <NavGroup title="AI CMO" items={VISIBLE_AI_CMO_ITEMS} pathname={pathname} />
        <NavGroup title="CHAT" items={CHAT_ITEMS} pathname={pathname} />
        <NavGroup title="GENERAL" items={GENERAL_ITEMS} pathname={pathname} />
      </nav>

      <nav aria-label="Settings" data-testid="settings-mobile-bar" className="border-b border-gray-100 md:hidden">
        <div className="flex items-center gap-1 px-2 pt-2">
          <button
            onClick={() => router.push("/dashboard")}
            aria-label="Back to dashboard"
            className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-[15px] font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/40"
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
                className={`flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/40 ${
                  active
                    ? "border-gray-200 bg-gray-100 text-gray-900"
                    : "border-transparent text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Icon size={14} />
                {item.label}
                {item.dot && <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
