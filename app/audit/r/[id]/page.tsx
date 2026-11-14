import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarloMark } from "@/components/shared/MarloMark";
import AuditResultView, { CheckYoursCard } from "@/components/audit/AuditResultView";
import ShareBar from "@/components/audit/ShareBar";
import ReportViewed from "@/components/audit/ReportViewed";
import { isReportId, reportPath, scoreBand, type PublicReport } from "@/lib/domain/seo/publicReport";
import { publicReportStore } from "@/lib/domain/seo/publicReportRuntime";

// Read on every request: a removed report must stop working immediately.
export const dynamic = "force-dynamic";

async function load(id: string): Promise<PublicReport | null> {
  if (!isReportId(id)) return null;
  try {
    return await publicReportStore().get(id);
  } catch (error) {
    console.error("[public-audit] report read failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const report = await load((await params).id);
  if (!report) return { title: "Audit not found", robots: { index: false, follow: false } };
  const { label } = scoreBand(report.score);
  const title = `${report.host} scores ${report.score}/100 on a quick website audit`;
  const description = `${label}: ${report.summary.totalFindings} issue${report.summary.totalFindings === 1 ? "" : "s"} found, with what to fix first. Run a free audit on your own site.`;
  return {
    title,
    description,
    // Pages about other people's sites must not be indexed under Marlo's name.
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharedAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await load(id);
  if (!report) notFound();

  return (
    <main className="min-h-screen bg-[#fafaf8] text-[#111111]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <a href="https://marlo.mlforge.in" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm font-bold tracking-tight">
            <MarloMark className="h-6 w-6" />
            Marlo
          </a>
          <Link href="/audit" className="text-sm text-black/60 hover:text-black">Run your own audit</Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 pb-20 pt-10">
        <AuditResultView
          data={{ url: report.url, host: report.host, score: report.score, summary: report.summary, findings: report.findings }}
          share={<ShareBar id={report.id} path={reportPath(report.id)} host={report.host} />}
          footer={<CheckYoursCard />}
        />
        <p className="mt-8 text-xs leading-5 text-black/40">
          Audited {new Date(report.createdAt).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })} by Marlo. The score is the share of on-page checks that passed on that day. Anyone with this link can see this page; whoever ran the audit can remove it.
        </p>
      </div>
      <ReportViewed />
    </main>
  );
}
