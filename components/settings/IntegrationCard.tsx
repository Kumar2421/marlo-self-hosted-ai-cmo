"use client";

import { useState } from "react";
import { Lock, Check } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";

export default function IntegrationCard({
  name,
  desc,
  icon,
  color,
}: {
  name: string;
  desc: string;
  icon: string;
  color: string;
}) {
  const [connected, setConnected] = useState(false);
  const { show } = useToast();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-gray-900">{name}</div>
          <div className="truncate text-[12px] text-gray-500">{desc}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[12px] text-gray-400">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[#00ab92]" : "bg-gray-300"}`} />
          {connected ? "Connected" : "Not connected"}
        </span>
        {connected ? (
          <button
            onClick={() => {
              setConnected(false);
              show(`${name} disconnected.`);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
          >
            <Check size={12} /> Connected
          </button>
        ) : (
          <button
            onClick={() => {
              setConnected(true);
              show(`${name} connected.`);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
          >
            <Lock size={11} /> Unlock
          </button>
        )}
      </div>
    </div>
  );
}
