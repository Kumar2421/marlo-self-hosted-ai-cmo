"use client";

import { Loader2 } from "lucide-react";
import { useAuthUser } from "@/lib/useAuthUser";
import { CARD, SettingsPageHeader } from "@/components/settings/ui";

export default function PersonalizationPage() {
  const { user, loading: userLoading } = useAuthUser();

  return (
    <div className="min-w-0 max-w-3xl">
      <SettingsPageHeader title="Profile" caption="Your account identity." />
      <div className={`${CARD} flex items-center gap-4 px-5 py-4`}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ui-primary text-[13px] font-semibold text-ui-inverse">
          {userLoading ? <Loader2 size={14} className="animate-spin" /> : user?.initials || "?"}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-ui-text">{user?.name || "Not signed in"}</div>
          <div className="truncate text-[13px] text-ui-muted">{user?.email || ""}</div>
        </div>
      </div>
    </div>
  );
}
