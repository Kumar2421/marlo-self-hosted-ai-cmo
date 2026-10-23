import { Lock } from "lucide-react";

/** Honest placeholder for integrations that don't have a real connection
 * built yet. "Unlock" label matches the production design language, but the
 * button stays `disabled` — no fake toggle that stores nothing and resets
 * on reload (that's what every one of these cards used to be). Disabled by
 * design, not by bug. */
export default function ComingSoonCard({
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
      <div className="mb-2 flex items-center gap-1.5 text-xs text-ui-subtle">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
        Not connected
      </div>
      <button disabled className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white opacity-90">
        <Lock size={11} /> Unlock
      </button>
    </div>
  );
}
