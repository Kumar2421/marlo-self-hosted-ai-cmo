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
    <div className="rounded-xl border border-ui-border bg-ui-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ui-text">{name}</div>
          <div className="truncate text-[12px] text-ui-muted">{desc}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[12px] text-ui-subtle">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-ui-accent" : "bg-gray-300"}`} />
          {connected ? "Connected" : "Not connected"}
        </span>
        {connected ? (
          <button
            onClick={() => {
              setConnected(false);
              show(`${name} disconnected.`);
            }}
            className="flex items-center gap-1.5 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[12px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 font-medium text-ui-muted hover:bg-ui-surface-sunken"
          >
            <Check size={12} /> Connected
          </button>
        ) : (
          <button
            onClick={() => {
              setConnected(true);
              show(`${name} connected.`);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[12px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover"
          >
            <Lock size={11} /> Unlock
          </button>
        )}
      </div>
    </div>
  );
}
