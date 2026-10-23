"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { AuditFunnelPayload } from "@/lib/analytics/auditFunnel";
import { MarloMark } from "@/components/shared/MarloMark";

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

type Finding = {
  issueId: string;
  category: string;
  severity: "Warning" | "Error";
  label: string;
  evidence: Record<string, string | number | null>;
  autoFixable: boolean;
  whyItMatters: string;
  recommendation: string;
};

type AuditResult = {
  url: string;
  findings: Finding[];
  summary: { totalFindings: number; critical: number; warnings: number };
  technical: { onPageScore: number; status: number; redirectCount: number };
};

function evidenceText(evidence: Record<string, string | number | null>) {
  const values = Object.entries(evidence)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 2)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: ${value}`);
  return values.join(" · ");
}

function getAuditSessionId() {
  if (typeof window === "undefined") return undefined;
  const key = "marlo:audit-session-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const sessionId = crypto.randomUUID();
  window.localStorage.setItem(key, sessionId);
  return sessionId;
}

function trackAuditEvent(payload: AuditFunnelPayload) {
  const sessionId = getAuditSessionId();
  if (!sessionId) return;
  const body = JSON.stringify({ ...payload, sessionId });
  if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    const queued = navigator.sendBeacon(
      "/api/public/audit/events",
      new Blob([body], { type: "application/json" }),
    );
    if (queued) return;
  }
  void fetch("/api/public/audit/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

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
          <section className="mt-14 max-w-4xl">
            <div className="flex flex-col justify-between gap-4 border-b border-black/10 pb-6 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs uppercase tracking-wider text-black/40">Audit result</p>
                <h2 className="mt-1 break-all text-xl font-medium">{result.url}</h2>
              </div>
              <div className="text-sm text-black/55">
                {result.summary.totalFindings} finding{result.summary.totalFindings === 1 ? "" : "s"} detected
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-black/10 bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-black/40">What we found</p>
                  <p className="mt-2 text-lg font-medium">
                    {result.summary.totalFindings === 0
                      ? "No issues detected by this audit."
                      : result.summary.totalFindings + " issue" + (result.summary.totalFindings === 1 ? "" : "s") + " found"}
                  </p>
                </div>
                <div className="flex gap-4 text-xs text-black/50">
                  <span><strong className="text-black">{result.summary.critical}</strong> important</span>
                  <span><strong className="text-black">{result.summary.warnings}</strong> warning{result.summary.warnings === 1 ? "" : "s"}</span>
                </div>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-black/55">
                {result.summary.critical > 0
                  ? "Start with the important issues, then work through the remaining warnings. Your account keeps the findings and gives you a place to track improvements."
                  : result.summary.totalFindings > 0
                    ? "Your account keeps these findings so you can work through the recommendations and recheck improvements."
                    : "Create an account to save this result and keep your future audits in one place."}
              </p>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {result.findings.map((finding) => (
                <article key={finding.issueId} className="rounded-xl border border-black/10 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${finding.severity === "Error" ? "text-red-600" : "text-amber-600"}`}>
                      {finding.severity === "Error" ? "Important" : "Warning"}
                    </span>
                    <span className="text-xs text-black/35">{finding.category}</span>
                  </div>
                  <h3 className="mt-4 text-base font-medium">{finding.label}</h3>
                  {evidenceText(finding.evidence) && (
                    <p className="mt-1 text-xs text-black/40">{evidenceText(finding.evidence)}</p>
                  )}
                  <p className="mt-2 text-sm leading-6 text-black/55">{finding.whyItMatters}</p>
                  <div className="mt-3 rounded-lg bg-black/[0.03] p-3 text-xs leading-5 text-black/70">
                    <span className="font-semibold">What to do: </span>
                    {finding.recommendation}
                  </div>
                </article>
              ))}
              {result.findings.length === 0 && (
                <div className="sm:col-span-3 rounded-xl border border-black/10 bg-white p-6 text-sm text-black/60">
                  No issues were detected by the checks in this quick audit.
                </div>
              )}
            </div>

            <div className="mt-8 flex flex-col gap-5 rounded-xl bg-[#111111] p-7 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div>
                  <h3 className="text-lg font-medium">
                    {result.summary.critical > 0
                      ? "Turn these " + result.summary.critical + " important issue" + (result.summary.critical === 1 ? "" : "s") + " into a fix plan."
                      : "Keep your audit findings and track the fixes."}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-white/60">
                    Create a Marlo account to save findings, get recommendations, and recheck improvements.
                  </p>
                </div>
              </div>
              <Link
                href={`/login?mode=signup&url=${encodeURIComponent(result.url)}`}
                onClick={() => trackAuditEvent({ event: "signup_cta_clicked" })}
                className="shrink-0 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black"
              >
                Create free account
              </Link>
            </div>
          </section>
        )}

        <p className="mt-10 text-xs leading-5 text-black/40">
          Quick audits are limited to public HTTP/HTTPS websites. Do not submit private, local, or internal addresses.
        </p>
      </section>
    </main>
  );
}
