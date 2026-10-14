import { NextRequest, NextResponse } from "next/server";
import { SEOAgent, assertPublicHttpUrl, type Finding } from "@/lib/domain/seo/SEOAgent";
import { setCachedPublicAudit } from "@/lib/domain/seo/publicAuditCache";
import { explainFinding } from "@/lib/domain/seo/findingExplanations";
import { guardPublicAudit, readLimitedText, withRelease, AUDIT_MAX_BODY_BYTES } from "@/lib/domain/net/publicGuard";
import { publicConcurrencyGate, publicRateLimiter } from "@/lib/domain/net/publicRuntime";
import { FEATURES } from "@/lib/features";

export const maxDuration = 60;

function rankFindings(findings: Finding[]): Finding[] {
  const severity = { Error: 0, Warning: 1 };
  return [...findings]
    .sort((a, b) => severity[a.severity] - severity[b.severity])
    .slice(0, 3);
}

export async function POST(req: NextRequest) {
  const guard = await guardPublicAudit({
    headers: req.headers,
    env: process.env,
    hosted: FEATURES.PLATFORM_MODE,
    limiter: publicRateLimiter("closed"),
    gate: publicConcurrencyGate(),
    readBody: () => readLimitedText(req, AUDIT_MAX_BODY_BYTES),
  });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: guard.status, headers: guard.headers });
  }
  return withRelease(guard.release, () => runPublicAudit(guard.body));
}

async function runPublicAudit(body: Record<string, unknown> | null) {
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";

  if (!rawUrl) {
    return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
  }

  let url: URL;
  try {
    url = assertPublicHttpUrl(rawUrl);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid URL." },
      { status: 400 }
    );
  }

  try {
    const result = await new SEOAgent().audit(url.toString());
    setCachedPublicAudit(result.url, result);
    const findings = rankFindings(result.findings).map((finding) => ({
      ...finding,
      ...explainFinding(finding),
    }));

    return NextResponse.json({
      url: result.url,
      findings,
      summary: {
        totalFindings: result.findings.length,
        critical: result.findings.filter((f) => f.severity === "Error").length,
        warnings: result.findings.filter((f) => f.severity === "Warning").length,
      },
      technical: {
        onPageScore: result.technical.onPageScore,
        status: result.technical.status,
        redirectCount: result.technical.redirectCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
