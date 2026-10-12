import { NextRequest, NextResponse } from "next/server";
import { SEOAgent, type Finding } from "@/lib/domain/seo/SEOAgent";
import { assertPublicHttpUrlResolved } from "@/lib/domain/net/ssrf";
import { setCachedPublicAudit } from "@/lib/domain/seo/publicAuditCache";
import { explainFinding } from "@/lib/domain/seo/findingExplanations";

export const maxDuration = 60;

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const requests = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anonymous";
}

function rateLimit(key: string): boolean {
  const now = Date.now();
  const current = requests.get(key);
  if (!current || current.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function rankFindings(findings: Finding[]): Finding[] {
  const severity = { Error: 0, Warning: 1 };
  return [...findings]
    .sort((a, b) => severity[a.severity] - severity[b.severity])
    .slice(0, 3);
}

export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req))) {
    return NextResponse.json(
      { error: "Too many audits. Please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const body = await req.json().catch(() => null);
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";

  if (!rawUrl) {
    return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
  }

  let url: URL;
  try {
    // Resolve DNS before crawling, and reject the hostname if ANY returned address
    // is private, loopback, link-local, or otherwise non-public.
    url = await assertPublicHttpUrlResolved(rawUrl);
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
  } catch {
    // Avoid returning internal crawler/network details to anonymous callers.
    return NextResponse.json({ error: "Audit failed. Check the URL and try again." }, { status: 502 });
  }
}
