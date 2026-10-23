"use client";

import { useState } from "react";
import Link from "next/link";
import * as Accordion from "@radix-ui/react-accordion";
import { Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList } from "@/components/ui/Tabs";
import { cn } from "@/components/ui/cn";
import { FOCUS_RING } from "@/components/ui/variants";
import { PLAN_PRICES, type PlanId } from "@/lib/domain/plans/planMatrix";
import { buildPlanCards, type PlanCardView } from "@/lib/domain/plans/pricingView";
import type { WaitlistInterval } from "@/lib/domain/waitlist/validate";
import { WaitlistDialog } from "./WaitlistDialog";

const INTERVAL_ITEMS = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
];

const CARDS = buildPlanCards();

/** Highlighted (dark) card. */
const FEATURED: PlanId = "pro";

function money(amount: number): string {
  return `$${amount}`;
}

export function PricingClient() {
  const [interval, setInterval] = useState<WaitlistInterval>("monthly");

  // The Tabs root also wraps the cards: they are the tab panel of the selected
  // interval, so each tab's aria-controls points at a real element. The panel
  // keeps the same element when the value changes, so accordion rows and
  // dialogs keep their state while prices update.
  return (
    <Tabs value={interval} onValueChange={(v) => setInterval(v as WaitlistInterval)}>
      <div className="mx-auto flex max-w-sm items-center gap-3">
        <TabsList
          items={INTERVAL_ITEMS}
          aria-label="Billing interval"
          // Inactive tab text: the primitive's muted gray is 4.4:1 on the track; this is 6.9:1.
          className="min-w-0 flex-1 [&_[role=tab][data-state=inactive]]:text-[var(--ui-text-muted-strong)]"
        />
        <span className="shrink-0 text-[13px] font-medium text-ui-accent-strong">2 months free</span>
      </div>

      <TabsContent value={interval} className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3 md:items-start">
        {CARDS.map((card) => (
          <PlanCard key={card.id} card={card} interval={interval} featured={card.id === FEATURED} />
        ))}
      </TabsContent>
    </Tabs>
  );
}

function PlanCard({ card, interval, featured }: { card: PlanCardView; interval: WaitlistInterval; featured: boolean }) {
  const paid = card.id !== "free";
  const annual = interval === "annual" && paid;
  const price = PLAN_PRICES[card.id];
  const shown = annual ? price.annualPerMonth : price.monthly;

  const buttonClass = cn(
    "ui-transition inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-ui-md [:root[data-theme=dark]_&]:rounded-full px-4 text-[14px] font-medium",
    FOCUS_RING,
    featured ? "bg-white text-ui-primary hover:bg-gray-200" : "bg-ui-primary text-ui-inverse hover:bg-ui-primary-hover",
  );

  const heading = `${card.name} plan`;

  return (
    <section
      aria-label={heading}
      data-plan={card.id}
      className={cn(
        "rounded-ui-lg border p-5 sm:p-6",
        featured
          ? // Dark card: white focus ring (the default ring is near-black) and light text.
            "theme-island border-ui-primary bg-ui-primary text-ui-inverse ring-1 ring-white/20 [--focus-ring-color:#ffffff]"
          : "border-ui-border bg-ui-surface text-ui-text shadow-ui-xs",
      )}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-2">
        <h2 className="text-[16px] leading-6 font-semibold">{card.name}</h2>
        {annual ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium",
              featured ? "bg-[#00ab92]/20 text-[#5fe0cc]" : "bg-ui-accent-soft text-ui-accent-strong",
            )}
          >
            2 months free
          </span>
        ) : null}
        {featured ? (
          <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[11px] leading-4 font-medium text-white">Most popular</span>
        ) : null}
      </div>

      <p className="mt-4 flex items-baseline gap-1" data-testid={`price-${card.id}`}>
        <span className="text-[40px] leading-none font-semibold tracking-tight tabular-nums">{money(shown)}</span>
        <span className={cn("text-[14px]", featured ? "text-white/70" : "text-ui-muted")}>/mo</span>
      </p>
      <p className={cn("mt-1 min-h-5 text-[13px]", featured ? "text-white/70" : "text-ui-muted")}>
        {!paid ? "Free to start, no card needed" : annual ? `Billed ${money(price.annualTotal)} per year` : "Billed monthly"}
      </p>

      <p className={cn("mt-3 min-h-10 text-[14px] leading-5", featured ? "text-white/80" : "text-ui-muted")}>{card.tagline}</p>

      <div className="mt-5">
        {paid ? (
          <WaitlistDialog plan={card.id} interval={interval} planName={card.name} triggerClassName={buttonClass}>
            Join the waitlist
          </WaitlistDialog>
        ) : (
          <Link href="/login" className={buttonClass}>
            Start free
          </Link>
        )}
        <p className={cn("mt-2 text-center text-[12px]", featured ? "text-white/70" : "text-ui-muted")}>
          {paid ? "Paid plans open soon · 1 AI CMO per website" : "1 AI CMO per website · No credit card"}
        </p>
      </div>

      <hr className={cn("my-5 border-0 border-t", featured ? "border-white/15" : "border-ui-border")} />

      <p className="text-[13px] font-medium">
        {card.inheritsFrom ? `Everything in ${card.inheritsFrom.name}, plus` : "Includes"}
      </p>
      <Accordion.Root type="multiple" className="mt-2">
        {card.rows.map((row) => (
          <Accordion.Item
            key={row.id}
            value={row.id}
            className={cn("border-b last:border-b-0", featured ? "border-white/10" : "border-ui-border")}
          >
            <Accordion.Header asChild>
              <div>
                <Accordion.Trigger
                  className={cn(
                    "group flex min-h-11 w-full cursor-pointer items-center gap-2 py-2 text-left text-[13px] leading-5",
                    FOCUS_RING,
                  )}
                >
                  <span className="min-w-0 flex-1">{row.label}</span>
                  {row.limitText ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium tabular-nums",
                        featured ? "bg-white/15 text-white" : "bg-ui-surface-sunken text-[#4b5563]",
                      )}
                    >
                      {row.limitText}
                    </span>
                  ) : null}
                  <Plus
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-(--dur-base) ease-(--ease-out) group-data-[state=open]:rotate-45",
                      featured ? "text-white/70" : "text-ui-muted",
                    )}
                  />
                </Accordion.Trigger>
              </div>
            </Accordion.Header>
            <Accordion.Content>
              <p className={cn("pb-3 text-[13px] leading-5", featured ? "text-white/70" : "text-ui-muted")}>{row.description}</p>
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </section>
  );
}
