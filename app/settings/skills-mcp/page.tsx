"use client";

import { Puzzle } from "lucide-react";

export default function SkillsMcpPage() {
  return (
    <div className="min-w-0 max-w-2xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Skills &amp; MCP</h1>
      <p className="mb-4 text-[13px] text-gray-500">Extend your AI CMO with custom skills and MCP servers.</p>

      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center">
        <Puzzle size={18} className="text-gray-300" />
        <div className="text-[13px] font-medium text-gray-700">Skills &amp; MCP isn&apos;t built yet</div>
        <p className="max-w-xs text-[12px] text-gray-500">
          Custom skills and MCP server connections aren&apos;t available yet — this page will show real,
          configurable connections once they are.
        </p>
      </div>
    </div>
  );
}
