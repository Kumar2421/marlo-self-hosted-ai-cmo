import { Check } from "lucide-react";
import { STEPPER, stepperIndex, type Step } from "@/lib/domain/leads/outreachCompose";

/** Three stops: Recipients, Write, Preview & send. Results counts as finished. */
export function Stepper({ step }: { step: Step }) {
  const current = stepperIndex(step);
  const done = step === "results";
  return (
    <ol className="flex items-center gap-2" aria-label="Outreach steps">
      {STEPPER.map((s, i) => {
        const complete = i < current || (done && i === current);
        const active = i === current && !done;
        return (
          <li key={s.id} aria-current={active ? "step" : undefined} className="flex min-w-0 items-center gap-2">
            {i > 0 && <span aria-hidden="true" className={`h-px w-4 shrink-0 sm:w-8 ${i <= current ? "bg-gray-400" : "bg-gray-200"}`} />}
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                complete ? "bg-gray-900 text-white" : active ? "border-2 border-gray-900 text-gray-900" : "border border-gray-300 text-gray-500"
              }`}
            >
              {complete ? <Check size={12} aria-hidden="true" /> : i + 1}
            </span>
            <span className={`truncate text-xs ${active ? "font-semibold text-gray-900" : "text-gray-500"} ${active ? "" : "max-sm:sr-only"}`}>{s.label}</span>
            {complete && <span className="sr-only">(done)</span>}
          </li>
        );
      })}
    </ol>
  );
}
