"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MarloMark } from "@/components/shared/MarloMark";
import AuditResultView, { SignupCard } from "@/components/audit/AuditResultView";
import ShareBar, { rememberOwnerToken } from "@/components/audit/ShareBar";
import { trackAuditEvent } from "@/components/audit/trackAuditEvent";
import { hostOf, type ReportFinding } from "@/lib/domain/seo/publicReportShared";

/** Same bounds as the server's own check (lib/domain/seo/SEOAgent.ts
 * assertPublicHttpUrl) -- this is just a client-side pre-filter so a
 * malformed ?url= doesn't auto-submit garbage; the server remains the real
 * gate against private/local addresses. */
function parsePublicHttpUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

type AuditResult = {
  url: string;
  findings: ReportFinding[];
  summary: { totalFindings: number; critical: number; warnings: number };
  technical: { onPageScore: number; status: number; redirectCount: number };
  report: { id: string; path: string; ownerToken: string } | null;
};

export default function AuditPage() {
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(() => parsePublicHttpUrl(searchParams.get("url") ?? "") ?? "");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const autoRanRef = useRef(false);

  async function runAuditFor(targetUrl: string) {
    setLoading(true);
    setError("");
    setResult(null);
    trackAuditEvent({ event: "audit_started" });

    let response: Response;
    try {
      response = await fetch("/api/public/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
    } catch {
      // fetch() itself only throws on a network-level failure (offline, DNS,
      // CORS) -- never for a non-2xx response, which is handled below.
      trackAuditEvent({ event: "audit_failed", failureCode: "request_failed" });
      setError("Audit failed.");
      setLoading(false);
      return;
    }

    let data: AuditResult & { error?: string };
    try {
      data = await response.json();
    } catch {
      trackAuditEvent({ event: "audit_failed", failureCode: "invalid_response" });
      setError("Audit failed.");
      setLoading(false);
      return;
    }

    if (!response.ok) {
      trackAuditEvent({ event: "audit_failed", failureCode: "invalid_response" });
      setError(data.error || "Audit failed.");
      setLoading(false);
      return;
    }

    setResult(data);
    if (data.report) rememberOwnerToken(data.report.id, data.report.ownerToken);
    trackAuditEvent({
      event: "audit_completed",
      findingCount: data.summary?.totalFindings,
      criticalCount: data.summary?.critical,
      warningCount: data.summary?.warnings,
    });
    setLoading(false);
  }

  function runAudit(event: FormEvent) {
    event.preventDefault();
    void runAuditFor(url);
  }

  // A personalized outreach link (?url=<their site>) should land on their
  // own result immediately, not an empty form they have to fill in
  // themselves -- that's the whole point of sending a specific link. Runs
  // once per page load only (autoRanRef), never re-fires on later
  // navigation/param changes within the same mount.
  useEffect(() => {
    if (autoRanRef.current) return;
    const prefilled = parsePublicHttpUrl(searchParams.get("url") ?? "");
    if (!prefilled) return;
    autoRanRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runAuditFor(prefilled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-[#fafaf8] text-[#111111]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <a
            href="https://marlo.mlforge.in"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-bold tracking-tight"
          >
            <MarloMark className="h-6 w-6" />
            Marlo
          </a>
          <Link href="/login" className="text-sm text-black/60 hover:text-black">Sign in</Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">Free website audit</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.05em] sm:text-6xl sm:leading-[1.02]">
            Find the SEO problems holding your website back.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-black/60 sm:text-lg">
            Enter a public website. Marlo checks the page and shows the most important issues it can verify right now.
          </p>
        </div>

        <form onSubmit={runAudit} className="mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://yourwebsite.com"
            type="url"
            required
            className="h-12 flex-1 rounded-lg border border-black/15 bg-white px-4 text-sm outline-none focus:border-black"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-12 rounded-lg bg-[#111111] px-6 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Auditing..." : "Run free audit"}
          </button>
        </form>

        {error && (
          <div className="mt-4 max-w-2xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <AuditResultView
            data={{ url: result.url, host: hostOf(result.url), score: result.technical.onPageScore, summary: result.summary, findings: result.findings }}
            share={result.report ? <ShareBar id={result.report.id} path={result.report.path} host={hostOf(result.url)} /> : null}
            footer={<SignupCard url={result.url} critical={result.summary.critical} />}
          />
        )}

        <p className="mt-10 text-xs leading-5 text-black/40">
          Quick audits are limited to public HTTP/HTTPS websites. Do not submit private, local, or internal addresses.
        </p>
      </section>
    </main>
  );
}
