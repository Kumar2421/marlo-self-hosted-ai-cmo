import type { Metadata } from "next";
import Link from "next/link";

// NOTE: not legal advice - replace with counsel-reviewed text before launch.

export const metadata: Metadata = {
  title: "Terms of Service - Marlo",
  description: "The terms for using Marlo.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm leading-6 text-black/80">
      <Link href="/login" className="text-xs font-medium underline underline-offset-2">
        Back to sign in
      </Link>
      <h1 className="mt-6 text-3xl font-medium tracking-[-0.03em] text-black">Terms of Service</h1>
      <p className="mt-2 text-black/50">Last updated: October 2026</p>

      <h2 className="mt-8 text-lg font-medium text-black">About Marlo</h2>
      <p className="mt-2">
        Marlo is an open-source product licensed under the GNU AGPL. The hosted service at
        app.marlo.mlforge.in is currently in beta. Features can change, break, or be removed
        without notice, and the service is provided as is, without warranties.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Your account</h2>
      <p className="mt-2">
        You are responsible for your account and for keeping your credentials safe. Provide an
        accurate email address and do not share access with people you do not trust.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Acceptable use</h2>
      <p className="mt-2">
        Use Marlo only for lawful purposes and only on websites you own or are allowed to
        analyze. Do not use it to send spam, to scrape sites in breach of their rules, to
        attack or overload other services, or to try to break the hosted service.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Third-party services</h2>
      <p className="mt-2">
        Marlo can connect to services such as Google, GitHub, and AI model providers on your
        behalf. Your use of those services is governed by their own terms. Content generated
        by AI can be wrong, so review it before you publish or send it.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Payments</h2>
      <p className="mt-2">
        There is no paid plan yet. If that changes, pricing will be shown before you are
        charged anything.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Ending your use</h2>
      <p className="mt-2">
        You can stop using Marlo at any time. We may suspend accounts that break these terms
        or put the service at risk.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Liability</h2>
      <p className="mt-2">
        To the extent the law allows, Marlo and its contributors are not liable for lost
        traffic, rankings, revenue, or data resulting from use of the service.
      </p>

      <h2 className="mt-8 text-lg font-medium text-black">Changes and contact</h2>
      <p className="mt-2">
        We may update these terms and will change the date above when we do. See the{" "}
        <Link href="/privacy" className="font-medium underline underline-offset-2">
          Privacy Policy
        </Link>{" "}
        for how data is handled. Questions can be raised in the project repository.
      </p>
    </main>
  );
}
