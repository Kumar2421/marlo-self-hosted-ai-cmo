import type { Metadata } from "next";
import Link from "next/link";
import { FaGithub } from "react-icons/fa6";
import { PricingClient } from "@/components/pricing/PricingClient";
import { PRICING_BETA, PRICING_BETA_NOTE } from "@/lib/domain/plans/pricingView";

export const metadata: Metadata = {
  title: "Pricing | Marlo",
  description: "Marlo is open source. Start free, or join the waitlist for hosted Lite and Pro plans.",
  alternates: { canonical: "/pricing" },
};

const REPO_URL = "https://github.com/Kumar2421/marlo-self-hosted-ai-cmo";
const SELF_HOST_DOCS_URL = `${REPO_URL}#self-host`;

export default function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
      <header className="mx-auto max-w-2xl text-center">
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-[32px] leading-10 font-semibold tracking-tight text-ui-text sm:text-[40px] sm:leading-[48px]">
            Pricing
          </h1>
          {PRICING_BETA ? (
            <span className="rounded-full bg-ui-warn-soft px-2.5 py-0.5 text-[12px] leading-4 font-medium text-ui-warn-text">Beta</span>
          ) : null}
        </div>
        <p className="mt-3 text-[16px] leading-6 text-ui-muted">Hire an AI CMO for your website. Start free, upgrade when you want it running on autopilot.</p>
        {PRICING_BETA ? <p className="mt-3 text-[13px] leading-5 text-ui-muted">{PRICING_BETA_NOTE}</p> : null}
      </header>

      <div className="mt-10">
        <PricingClient />
      </div>

      <aside
        aria-label="Open source"
        className="mx-auto mt-10 flex max-w-3xl flex-col gap-3 rounded-ui-lg border border-ui-border bg-ui-surface-muted p-5 sm:flex-row sm:items-center sm:gap-5"
      >
        <p className="flex-1 text-[14px] leading-5 text-ui-text">
          <strong className="font-semibold">Marlo is open source.</strong> Self-host it free forever with your own API keys — every feature unlocked. Hosted plans
          pay for managed keys, scheduled runs and support.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a
            href={REPO_URL}
            className="ui-transition inline-flex h-10 items-center gap-2 rounded-ui-md border border-ui-border-strong bg-ui-surface px-3 text-[13px] font-medium text-ui-text hover:bg-ui-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring-color)"
          >
            <FaGithub aria-hidden="true" className="h-4 w-4" />
            GitHub
          </a>
          <a
            href={SELF_HOST_DOCS_URL}
            className="ui-transition inline-flex h-10 items-center rounded-ui-md border border-ui-border-strong bg-ui-surface px-3 text-[13px] font-medium text-ui-text hover:bg-ui-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring-color)"
          >
            Self-host docs
          </a>
        </div>
      </aside>

      <p className="mt-8 text-center text-[13px] text-ui-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ui-text underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </main>
  );
}
