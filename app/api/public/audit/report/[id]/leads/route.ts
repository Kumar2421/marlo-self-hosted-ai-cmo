import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { assertSafeUserUrl } from "@/lib/domain/net/publicUrl";
import { clientKey, trustedClientIp } from "@/lib/domain/net/publicGuard";
import { publicRateLimiter } from "@/lib/domain/net/publicRuntime";
import { isOwnerTokenShape, isReportId } from "@/lib/domain/seo/publicReport";
import { publicReportStore } from "@/lib/domain/seo/publicReportRuntime";
import { auditLeadsEnabled } from "@/lib/domain/audit/auditLeadsConfig";
import { deriveAuditProfile, findAuditLeads } from "@/lib/domain/audit/auditLeads";
import { hostOf } from "@/lib/domain/leads/company/companySites";
import { enrichBusiness } from "@/lib/domain/leads/local/websiteContact";
import { tavilyProvider } from "@/lib/domain/websearch/searchProvider";
import { getDriver } from "@/lib/llm";
import { PLATFORM_DEFAULT_MODELS, platformKeyFor } from "@/lib/llm/platformKeys";

// Page read + one model call + web search + reading a few company sites: the platform maximum (Hobby caps at 60s).
export const maxDuration = 60;
export const runtime = "nodejs";

const PROVIDER = "groq";
const SITE_BUDGET_MS = 28_000;
const MODEL_TIMEOUT_MS = 12_000;
// Only the owner token can start a lookup. Per visitor, and for the whole deployment, so a link going wide cannot run up search and model costs.
const PER_IP = { windowSec: 3600, limit: 3 };
const GLOBAL = { windowSec: 86_400, limit: 150 };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!auditLeadsEnabled(process.env, FEATURES.PLATFORM_MODE)) return NextResponse.json({ error: "Not available." }, { status: 404 });

  const { id } = await ctx.params;
  const token = request.headers.get("x-report-token");
  if (!isReportId(id) || !isOwnerTokenShape(token)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const tavilyKey = process.env.TAVILY_API_KEY?.trim() || "";
  const apiKey = platformKeyFor(PROVIDER);
  const model = PLATFORM_DEFAULT_MODELS[PROVIDER];
  const driver = getDriver(PROVIDER);
  if (!tavilyKey || !apiKey || !model || !driver) return NextResponse.json({ error: "Not available." }, { status: 404 });

  try {
    const store = publicReportStore();
    // Ownership first: nothing paid starts for a wrong token or an unknown report.
    if (!(await store.isOwner(id, token))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const report = await store.get(id);
    if (!report) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (report.leads) return NextResponse.json({ leads: report.leads, cached: true });

    const ip = trustedClientIp(request.headers, process.env);
    const key = ip ? clientKey(ip) ?? "unknown" : "unknown";
    const limiter = publicRateLimiter("closed");
    const perIp = await limiter.hit(`public-audit-leads:${key}`, PER_IP.windowSec, ip ? PER_IP.limit : 1);
    const global = perIp.allowed ? await limiter.hit("public-audit-leads:all", GLOBAL.windowSec, GLOBAL.limit) : perIp;
    if (!perIp.allowed || !global.allowed) {
      return NextResponse.json(
        { error: perIp.unavailable || global.unavailable ? "Try again in a few minutes." : "That is enough lookups for now. Try again later, or create a free account." },
        { status: 429, headers: { "Retry-After": String(Math.max(perIp.retryAfterSec, global.retryAfterSec, 60)) } },
      );
    }

    const url = await assertSafeUserUrl(report.url);
    const audit = await new SEOAgent().audit(url.toString());
    const page = { title: audit.meta.title ?? "", description: audit.meta.description ?? "", h1: "", bodyText: audit.bodyText ?? "" };

    const result = await findAuditLeads(
      {
        derive: (p) => deriveAuditProfile({ driver, apiKey, model, page: p, timeoutMs: MODEL_TIMEOUT_MS }),
        search: {
          provider: tavilyProvider(tavilyKey),
          knownHosts: async () => new Set<string>(),
          enrich: (website) => enrichBusiness(website),
        },
      },
      { page, ownHost: hostOf(report.url) ?? report.host, budgetMs: SITE_BUDGET_MS },
    );

    if (result.status === "unavailable") return NextResponse.json({ error: "Could not look for businesses just now. Try again." }, { status: 502 });

    const leads = result.status === "ok" ? result.leads : [];
    await store.saveLeads(id, token, leads);
    return NextResponse.json({ leads, reason: result.status === "none" ? result.reason : null });
  } catch (error) {
    console.error("[public-audit] leads failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Could not look for businesses just now. Try again." }, { status: 502 });
  }
}
