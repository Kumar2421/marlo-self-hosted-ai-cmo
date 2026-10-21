"use client";

import { Lock } from "lucide-react";

export default function DevicesPage() {
  return (
    <div className="min-w-0 max-w-2xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Devices</h1>
      <p className="mb-4 text-[13px] text-gray-500">Devices currently signed in to your account.</p>

      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center">
        <Lock size={18} className="text-gray-300" />
        <div className="text-[13px] font-medium text-gray-700">Session tracking isn&apos;t available yet</div>
        <p className="max-w-xs text-[12px] text-gray-500">
          Seeing and revoking individual signed-in devices needs real session tracking, which isn&apos;t built yet —
          this page will show real data once it is.
        </p>
      </div>
    </div>
  );
}
