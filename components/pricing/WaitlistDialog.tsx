"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/components/ui/cn";
import { FOCUS_RING } from "@/components/ui/variants";
import { HONEYPOT_FIELD, validateWaitlist, type WaitlistInterval, type WaitlistPlan } from "@/lib/domain/waitlist/validate";

type Status = "idle" | "submitting" | "done";

const FIELD =
  "ui-transition h-10 w-full rounded-ui-md border border-ui-border-strong bg-ui-surface px-3 text-[14px] text-ui-text placeholder:text-ui-subtle focus-visible:border-ui-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus-ring-color) aria-[invalid=true]:border-ui-danger";

export type WaitlistDialogProps = {
  plan: WaitlistPlan;
  interval: WaitlistInterval;
  /** Plan name shown in the dialog title, e.g. "Lite". */
  planName: string;
  /** Classes for the trigger button. */
  triggerClassName: string;
  children: ReactNode;
};

/**
 * Trigger button + Radix Dialog with the waitlist form. The Dialog primitive
 * provides the focus trap, Esc to close and focus return to the trigger.
 */
export function WaitlistDialog({ plan, interval, planName, triggerClassName, children }: WaitlistDialogProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<{ email?: string; website?: string; form?: string }>({});

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset after a finished sign-up so reopening starts fresh; keep typed values otherwise.
      if (status === "done") {
        setStatus("idle");
        setEmail("");
        setWebsite("");
      }
      setErrors({});
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;
    const payload = { email, website, plan, interval, [HONEYPOT_FIELD]: trap };
    const check = validateWaitlist(payload);
    if (!check.ok && check.reason === "invalid") {
      setErrors({ [check.field === "website" ? "website" : "email"]: check.message });
      return;
    }
    setErrors({});
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setStatus("done");
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setErrors({ form: data?.error ?? "Could not save your request. Please try again." });
    } catch {
      setErrors({ form: "Could not reach the server. Check your connection and try again." });
    }
    setStatus("idle");
  }

  const emailId = `${uid}-email`;
  const websiteId = `${uid}-website`;
  const emailErrorId = `${uid}-email-error`;
  const websiteErrorId = `${uid}-website-error`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className={triggerClassName}>
          {children}
        </button>
      </DialogTrigger>
      <DialogContent
        size="sm"
        title={`Join the ${planName} waitlist`}
        description="Paid plans open soon. Leave your email and we will tell you when they do."
      >
        {status === "done" ? (
          <div role="status" className="py-2">
            <p className="text-[14px] font-medium text-ui-text">You are on the list.</p>
            <p className="mt-1 text-[13px] text-ui-muted">
              We will email you when {planName} opens. Nothing is charged today.
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={cn(
                "ui-transition mt-4 inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-ui-md bg-ui-primary text-[14px] font-medium text-ui-inverse hover:bg-ui-primary-hover",
                FOCUS_RING,
              )}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
            <div>
              <label htmlFor={emailId} className="mb-1 block text-[13px] font-medium text-ui-text">
                Email
              </label>
              <input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? emailErrorId : undefined}
                placeholder="you@company.com"
                className={FIELD}
              />
              {errors.email ? (
                <p id={emailErrorId} role="alert" className="mt-1 text-[12px] text-ui-danger-text">
                  {errors.email}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor={websiteId} className="mb-1 block text-[13px] font-medium text-ui-text">
                Website <span className="font-normal text-ui-muted">(optional)</span>
              </label>
              <input
                id={websiteId}
                name="website"
                type="text"
                inputMode="url"
                autoComplete="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                aria-invalid={errors.website ? true : undefined}
                aria-describedby={errors.website ? websiteErrorId : undefined}
                placeholder="example.com"
                className={FIELD}
              />
              {errors.website ? (
                <p id={websiteErrorId} role="alert" className="mt-1 text-[12px] text-ui-danger-text">
                  {errors.website}
                </p>
              ) : null}
            </div>

            {/* Honeypot: off-screen, skipped by keyboard and screen readers. Bots fill it. */}
            <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Leave this field empty
                <input
                  type="text"
                  name={HONEYPOT_FIELD}
                  tabIndex={-1}
                  autoComplete="off"
                  value={trap}
                  onChange={(e) => setTrap(e.target.value)}
                />
              </label>
            </div>

            {errors.form ? (
              <p role="alert" className="text-[13px] text-ui-danger-text">
                {errors.form}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={status === "submitting"}
              className={cn(
                "ui-transition inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-ui-md bg-ui-primary text-[14px] font-medium text-ui-inverse hover:bg-ui-primary-hover disabled:cursor-not-allowed disabled:opacity-60",
                FOCUS_RING,
              )}
            >
              {status === "submitting" ? <Spinner size="sm" label="Sending" /> : null}
              Join the waitlist
            </button>
            <p className="text-[12px] text-ui-muted">No payment is taken. We only use your email to tell you when plans open.</p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
