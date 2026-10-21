"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";

/** Self-host only: your own Gemini key powers the real "Gemini + Google Search" AI visibility checks. */
export default function GeminiCard() {
  const { show } = useToast();
  const [preview, setPreview] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        const row = data.settings?.find((s) => s.key === "gemini_api_key");
        if (row?.value) setPreview(row.value);
      })
      .catch(() => {});
  }, []);

  async function save(value: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "gemini_api_key", value }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save key");
      setPreview(value ? `${value.slice(0, 4)}••••${value.slice(-2)}` : "");
      setInput("");
      show(value ? "Gemini connected. AI visibility checks will use real Gemini answers." : "Gemini disconnected.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Could not save the Gemini key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-gray-900">Gemini API key</div>
          <p className="mt-0.5 text-[12px] text-gray-500">Used to ask Gemini (with Google Search) the questions your buyers ask, and see if you are mentioned.</p>
        </div>
        {preview && <span className="flex items-center gap-1 text-[12px] text-[#00ab92]"><Check size={12} /> {preview}</span>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste your Gemini API key"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px]"
        />
        <button onClick={() => input.trim() && save(input.trim())} disabled={busy} className="rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60">Save</button>
        {preview && <button onClick={() => save("")} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-700 disabled:opacity-60">Remove</button>}
      </div>
    </div>
  );
}
