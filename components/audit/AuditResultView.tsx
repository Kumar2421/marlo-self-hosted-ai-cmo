"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import ScoreRing from "./ScoreRing";
import { trackAuditEvent } from "./trackAuditEvent";
import type { ReportFinding } from "@/lib/domain/seo/publicReportShared";

export type ResultData = {
  url: string;
  host: string;
  score: number;
  summary: { totalFindings: number; critical: number; warnings: number };
  findings: ReportFinding[];
};

function evidenceText(evidence: Record<string, string | number | null>) {
  return Object.entries(evidence)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 2)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: ${value}`)
    .join(" · ");
}

/** One audit result: score, the three findings and what to do next. Used live and on a shared report. */
export default function AuditResultView({ data, share, footer }: { data: ResultData; share?: ReactNode; footer: ReactNode }) {
  const { summary } = data;
  return (
    <section className="mt-10 max-w-4xl" data-testid="audit-result">
      <div className="flex flex-col gap-6 border-b border-black/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-black/40">Audit result</p>
          <h2 className="mt-1 break-all text-2xl font-medium" data-testid="audit-host">{data.host}</h2>
          <p className="mt-1 text-sm text-black/55">
            {summary.totalFindings} finding{summary.totalFindings === 1 ? "" : "s"} · <strong className="text-black">{summary.critical}</strong> important ·{" "}
            <strong className="text-black">{summary.warnings}</strong> warning{summary.warnings === 1 ? "" : "s"}
          </p>
          {share && <div className="mt-4">{share}</div>}
        </div>
        <ScoreRing score={data.score} />
      </div>

      <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-black/40">
        {summary.totalFindings > 3 ? `Top 3 of ${summary.totalFindings} issues` : "What we found"}
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {data.findings.map((finding) => (
          <article key={finding.issueId} className="rounded-xl border border-black/10 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <span className={`text-xs font-semibold uppercase tracking-wider ${finding.severity === "Error" ? "text-red-600" : "text-amber-600"}`}>
                {finding.severity === "Error" ? "Important" : "Warning"}
              </span>
              <span className="text-[11px] text-black/35">{finding.category}</span>
            </div>
            <h3 className="mt-4 text-base font-medium">{finding.label}</h3>
            {evidenceText(finding.evidence) && <p className="mt-1 text-xs text-black/40">{evidenceText(finding.evidence)}</p>}
            <p className="mt-2 text-sm leading-6 text-black/55">{finding.whyItMatters}</p>
            <div className="mt-3 rounded-lg bg-black/[0.03] p-3 text-xs leading-5 text-black/70">
              <span className="font-semibold">What to do: </span>
              {finding.recommendation}
            </div>
          </article>
        ))}
        {data.findings.length === 0 && (
          <div className="rounded-xl border border-black/10 bg-white p-6 text-sm text-black/60 sm:col-span-3">
            No issues were detected by the checks in this quick audit.
          </div>
        )}
      </div>

      {footer}
    </section>
  );
}

export function SignupCard({ url, critical }: { url: string; critical: number }) {
  return (
    <div className="mt-8 flex flex-col gap-5 rounded-xl bg-[#111111] p-7 text-white sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-lg font-medium">
          {critical > 0 ? `Turn these ${critical} important issue${critical === 1 ? "" : "s"} into a fix plan.` : "Keep your audit findings and track the fixes."}
        </h3>
        <p className="mt-1 text-sm leading-6 text-white/60">Create a Marlo account to save findings, get recommendations, and recheck improvements.</p>
      </div>
      <Link
        href={`/login?mode=signup&url=${encodeURIComponent(url)}`}
        onClick={() => trackAuditEvent({ event: "signup_cta_clicked" })}
        className="shrink-0 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black"
      >
        Create free account
      </Link>
    </div>
  );
}

/** For someone who opened a shared report: check their own site. A plain GET form, so it works without script. */
export function CheckYoursCard() {
  return (
    <form action="/audit" method="get" className="mt-8 rounded-xl bg-[#111111] p-7 text-white" data-testid="check-yours">
      <h3 className="text-lg font-medium">Check your own website</h3>
      <p className="mt-1 text-sm leading-6 text-white/60">Free, no sign-up. You get a score and the three issues worth fixing first.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          name="url"
          type="url"
          required
          placeholder="https://yourwebsite.com"
          aria-label="Your website address"
          className="h-11 flex-1 rounded-lg border border-white/20 bg-white px-4 text-sm text-black outline-none"
        />
        <button type="submit" className="h-11 rounded-lg bg-white px-5 text-sm font-medium text-black">Run free audit</button>
      </div>
    </form>
  );
}
