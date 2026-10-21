"use client";

import { useAuthUser } from "@/lib/useAuthUser";
import { Loader2 } from "lucide-react";

export default function TeamPage() {
  const { user, loading } = useAuthUser();

  return (
    <div className="min-w-0 max-w-2xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-semibold text-gray-900">Team</h1>
          <p className="text-[13px] text-gray-500">Manage who has access to this workspace.</p>
        </div>
        <button
          disabled
          title="Team invites are coming soon"
          className="rounded-lg bg-[#111111] px-3 py-1.5 text-[13px] font-medium text-white opacity-40"
        >
          + Invite
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#8a8a8a] text-[11px] font-semibold text-white">
            {loading ? <Loader2 size={12} className="animate-spin" /> : user?.initials || "?"}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-gray-900">{user?.name || "Not signed in"}</div>
            <div className="text-[12px] text-gray-500">{user?.email || ""}</div>
          </div>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">Owner</span>
      </div>

      <p className="mt-3 text-[11px] text-gray-400">
        Multi-person workspaces aren&apos;t available yet — every project is single-owner for now.
      </p>
    </div>
  );
}
