import type { Metadata } from "next";
import Link from "next/link";

// NOTE: not legal advice - replace with counsel-reviewed text before launch.

export const metadata: Metadata = {
  title: "Privacy Policy - Marlo",
  description: "What data Marlo stores and why.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm leading-6 text-black/80">
      <Link href="/login" className="text-xs font-medium underline underline-offset-2">
        Back to sign in
      </Link>
      <h1 className="mt-6 text-3xl font-medium tracking-[-0.03em] text-black">Privacy Policy</h1>
      <p className="mt-2 text-black/50">Last updated: October 2026</p>

      <p className="mt-6">
        Marlo is open source (AGPL). This page describes the hosted beta at
        app.marlo.mlforge.in. If you self-host Marlo, your data stays on your own
        infrastructure.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">What we store</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Your account email and sign-in details managed by our authentication provider (Supabase).</li>
        <li>Your projects and their settings.</li>
        <li>Crawl and analysis results for the sites you add.</li>
        <li>OAuth tokens for services you connect (for example Google or GitHub), stored encrypted.</li>
      </ul>

      <h2 className="mt-8 text-lg font-medium text-black">How we use it</h2>
      <p className="mt-2">
        We use this data only to run Marlo for you: to sign you in, show your projects and
        results, and act on the integrations you connect. We do not sell your data.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Service providers</h2>
      <p className="mt-2">
        Marlo relies on hosting, database, and authentication providers, and on AI model
        providers when you use features that need them. Content needed for those features
        may be sent to the provider to produce a result.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Cookies</h2>
      <p className="mt-2">
        We use cookies to keep you signed in. If you untick Remember me at sign-in, the
        session ends when you close your browser. We do not use advertising cookies.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Payments</h2>
      <p className="mt-2">We do not collect payment information at this time.</p>

      <h2 className="mt-8 text-lg font-medium text-black">Your choices</h2>
      <p className="mt-2">
        You can disconnect integrations at any time. To have your account and data deleted,
        contact us through the project repository and we will remove it.
      </p>

      <p className="mt-8">
        See also the{" "}
        <Link href="/terms" className="font-medium underline underline-offset-2">
          Terms of Service
        </Link>
        .
      </p>
    </main>
  );
}
