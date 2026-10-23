"use client";

import { useState } from "react";
import { ChevronDown, Cpu } from "lucide-react";
import Link from "next/link";
import { useProviders } from "@/lib/providers-store";

export default function ModelPicker() {
  const { connectedModels, primaryModel, setPrimaryModel } = useProviders();
  const [open, setOpen] = useState(false);

  const active = primaryModel && connectedModels.some((m) => m.model === primaryModel) ? primaryModel : null;

  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
      >
        <Cpu size={12} className="shrink-0 text-ui-faint" />
        <span className="min-w-0 truncate">{active ?? (connectedModels.length ? "Select model" : "No model connected")}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute bottom-9 left-0 z-50 w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
          {connectedModels.length === 0 ? (
            <Link
              href="/settings/llm-providers"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-[13px] text-gray-600 hover:bg-gray-50"
            >
              Connect a provider to select a model →
            </Link>
          ) : (
            connectedModels.map((m) => (
              <button
                key={`${m.providerId}-${m.model}`}
                onClick={() => {
                  setPrimaryModel(m.model);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] ${
                  primaryModel === m.model ? "bg-gray-100 font-medium text-gray-900" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span>{m.model}</span>
                <span className="text-xs text-ui-subtle">{m.providerName}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
