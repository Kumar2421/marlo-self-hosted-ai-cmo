import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function RailButton({
  icon,
  label,
  onClick,
  active,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col items-center gap-1 dash-focus py-2 text-xs font-medium transition-colors ${
        active ? "text-gray-900" : "text-ui-subtle hover:text-gray-700"
      }`}
      title={label}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full border ${
          active ? "border-gray-300 bg-gray-100" : "border-transparent"
        }`}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

export default function CollapsedRail({
  onExpand,
  dark = false,
  children,
}: {
  onExpand: () => void;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex h-full min-h-0 flex-col items-center border-r py-3 ${
        dark ? "theme-island border-white/10 bg-[#110f0e]" : "border-gray-200 bg-white"
      }`}
    >
      <button
        onClick={onExpand}
        className={`dash-focus mb-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          dark ? "text-gray-400 hover:bg-white/10 hover:text-white" : "text-ui-subtle hover:bg-gray-100 hover:text-gray-700"
        }`}
        title="Expand"
        aria-label="Expand panel"
      >
        <ChevronRight size={15} />
      </button>
      <div className="okara-scroll flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
