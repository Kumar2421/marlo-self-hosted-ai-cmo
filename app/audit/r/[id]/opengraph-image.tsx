import { ImageResponse } from "next/og";
import { isReportId, scoreBand } from "@/lib/domain/seo/publicReport";
import { publicReportStore } from "@/lib/domain/seo/publicReportRuntime";

export const alt = "Website audit score";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const COLOR = { strong: "#15803d", good: "#4d7c0f", "needs-work": "#b45309", weak: "#b91c1c" } as const;

// Long domains get a smaller size so they stay on one line instead of breaking mid-word.
function hostFontSize(host: string): number {
  if (host.length <= 14) return 80;
  if (host.length <= 20) return 64;
  if (host.length <= 28) return 50;
  return 40;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let host = "";
  let score = 0;
  let issues = 0;
  let found = false;
  if (isReportId(id)) {
    try {
      const report = await publicReportStore().get(id);
      if (report) {
        host = report.host;
        score = report.score;
        issues = report.summary.totalFindings;
        found = true;
      }
    } catch {
      /* fall through to the generic card */
    }
  }
  const { band, label } = scoreBand(score);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fafaf8", color: "#111111", padding: 72 }}>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>Marlo</div>
        {found ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", maxWidth: 740 }}>
              <div style={{ display: "flex", fontSize: 30, color: "#6b6b6b" }}>Website audit</div>
              <div style={{ display: "flex", fontSize: hostFontSize(host), fontWeight: 600, marginTop: 12 }}>{host}</div>
              <div style={{ display: "flex", fontSize: 32, color: "#6b6b6b", marginTop: 18 }}>
                {issues} issue{issues === 1 ? "" : "s"} found, with what to fix first
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 300, height: 300, borderRadius: 150, border: `18px solid ${COLOR[band]}` }}>
              <div style={{ display: "flex", fontSize: 120, fontWeight: 700, lineHeight: 1 }}>{score}</div>
              <div style={{ display: "flex", fontSize: 30, color: COLOR[band], marginTop: 6 }}>{label}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 64, fontWeight: 600 }}>Free website audit</div>
        )}
        <div style={{ display: "flex", fontSize: 28, color: "#6b6b6b" }}>Check your own site free, no sign-up</div>
      </div>
    ),
    { ...size },
  );
}
