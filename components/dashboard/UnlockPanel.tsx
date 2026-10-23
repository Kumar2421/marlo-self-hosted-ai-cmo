"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { PricingClient } from "@/components/pricing/PricingClient";
import { usePlan } from "@/components/plan/usePlan";
import { PRICING_BETA, PRICING_BETA_NOTE } from "@/lib/domain/plans/pricingView";
import { unlockTrigger } from "@/lib/ui/unlockTrigger";
import { UNLOCK_DISMISS_KEY, parseDismissedAt, shouldShowUnlockPanel } from "@/lib/domain/plans/unlockPanel";

function readDismissedAt(): number | null {
  try {
    return parseDismissedAt(window.localStorage.getItem(UNLOCK_DISMISS_KEY));
  } catch {
    return null;
  }
}

/**
 * The quiet "Unlock the full AI CMO" panel at the top of the chat column. Free hosted users see it; clicking
 * "See plans" opens the pricing section in a slide-over (the dashboard stays where it is). The X hides it for
 * a week. Pricing is in beta, so the copy says plans open soon and never promises a purchase.
 */
export default function UnlockPanel() {
  const plan = usePlan();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // Null until mounted: storage and the clock are read on the client only (no server/client mismatch, no impure render).
  const [now, setNow] = useState<number | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);
  // Set when the chat hits its free cap: shows the panel even after a dismissal.
  const [forced, setForced] = useState(false);

  useEffect(() => {
    // Reading storage on the client only avoids a server/client mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissedAt(readDismissedAt());
    setNow(Date.now());
  }, []);

  useEffect(
    () =>
      unlockTrigger.subscribe(() => {
        try {
          window.localStorage.removeItem(UNLOCK_DISMISS_KEY);
        } catch {
          /* storage blocked: forced still shows it for this page view */
        }
        setDismissedAt(null);
        setForced(true);
        setPlansOpen(true);
      }),
    [],
  );

  if (now === null || !shouldShowUnlockPanel({ plan: plan.data?.plan, dismissedAt, now, forced })) return null;

  function dismiss() {
    const at = Date.now();
    setForced(false);
    setDismissedAt(at);
    setNow(at);
    try {
      window.localStorage.setItem(UNLOCK_DISMISS_KEY, String(at));
    } catch {
      /* storage blocked: it stays hidden for this page view */
    }
  }

  return (
    <>
      <section aria-label="Unlock more" data-testid="unlock-panel" className="relative shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-3 pr-11">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#111111] text-white">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-5 text-gray-900">Unlock the full AI CMO</p>
            <p className="text-xs leading-4 text-gray-600">More agents, more credits, more growth.{PRICING_BETA ? " Plans open soon." : ""}</p>
          </div>
          <button
            type="button"
            onClick={() => setPlansOpen(true)}
            className="shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-xs font-medium text-white hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
          >
            See plans
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close this panel"
          className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-md text-ui-subtle hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
        >
          <X size={15} aria-hidden />
        </button>
      </section>

      <Sheet open={plansOpen} onOpenChange={setPlansOpen}>
        <SheetContent
          title="Plans"
          subtitle={PRICING_BETA ? PRICING_BETA_NOTE : "Start free. Upgrade when you want it running on autopilot."}
          width="xl"
          footer={
            <Link href="/pricing" className="text-xs font-medium text-ui-accent-strong hover:underline">
              Open the full pricing page
            </Link>
          }
        >
          <PricingClient />
        </SheetContent>
      </Sheet>
    </>
  );
}
