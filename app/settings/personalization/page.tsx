"use client";

import { Loader2 } from "lucide-react";
import { useAuthUser } from "@/lib/useAuthUser";

export default function PersonalizationPage() {
  const { user, loading: userLoading } = useAuthUser();

  return (
    <div className="min-w-0 max-w-2xl">
      <h1 className="mb-1 text-[15px] font-semibold text-gray-900">Profile</h1>
      <p className="mb-3 text-[13px] text-gray-500">Your account identity.</p>
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#8a8a8a] text-[12px] font-semibold text-white">
          {userLoading ? <Loader2 size={13} className="animate-spin" /> : user?.initials || "?"}
        </div>
        <div>
          <div className="text-[13px] font-semibold text-gray-900">{user?.name || "Not signed in"}</div>
          <div className="text-[12px] text-gray-500">{user?.email || ""}</div>
        </div>
      </div>
    </div>
  );
}
