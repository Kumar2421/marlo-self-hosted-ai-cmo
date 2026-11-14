import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { assertSafeUserUrl } from "@/lib/domain/net/publicUrl";
import { clientKey, trustedClientIp } from "@/lib/domain/net/publicGuard";
import { publicRateLimiter } from "@/lib/domain/net/publicRuntime";
import { isOwnerTokenShape, isReportId } from "@/lib/domain/seo/publicReport";
import { publicReportStore } from "@/lib/domain/seo/publicReportRuntime";
import { auditPostsEnabled } from "@/lib/domain/audit/auditLeadsConfig";
import { writeAuditPosts } from "@/lib/domain/audit/auditPosts";
import { getDriver } from "@/lib/llm";
import { PLATFORM_DEFAULT_MODELS, platformKeyFor } from "@/lib/llm/platformKeys";

// Page read + two model calls in parallel: well inside the platform maximum (Hobby caps at 60s).
export const maxDuration = 60;
export const runtime = "nodejs";

const PROVIDER = "groq";
const MODEL_TIMEOUT_MS = 20_000;
// Only the owner token can start this. Per visitor, and for the whole deployment, so a link going wide cannot run up costs.
const PER_IP = { windowSec: 3600, limit: 3 };
const GLOBAL = { windowSec: 86_400, limit: 150 };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!auditPostsEnabled(process.env, FEATURES.PLATFORM_MODE)) return NextResponse.json({ error: "Not available." }, { status: 404 });

  const { id } = await ctx.params;
  const token = request.headers.get("x-report-token");
  if (!isReportId(id) || !isOwnerTokenShape(token)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const apiKey = platformKeyFor(PROVIDER);
  const model = PLATFORM_DEFAULT_MODELS[PROVIDER];
  const driver = getDriver(PROVIDER);
  if (!apiKey || !model || !driver) return NextResponse.json({ error: "Not available." }, { status: 404 });

  try {
    const store = publicReportStore();
    // Ownership first: nothing paid starts for a wrong token or an unknown report.
    if (!(await store.isOwner(id, token))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const report = await store.get(id);
    if (!report) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (report.posts) return NextResponse.json({ posts: report.posts, cached: true });

    const ip = trustedClientIp(request.headers, process.env);
    const key = ip ? clientKey(ip) ?? "unknown" : "unknown";
    const limiter = publicRateLimiter("closed");
    const perIp = await limiter.hit(`public-audit-posts:${key}`, PER_IP.windowSec, ip ? PER_IP.limit : 1);
    const global = perIp.allowed ? await limiter.hit("public-audit-posts:all", GLOBAL.windowSec, GLOBAL.limit) : perIp;
    if (!perIp.allowed || !global.allowed) {
      return NextResponse.json(
        { error: perIp.unavailable || global.unavailable ? "Try again in a few minutes." : "That is enough sample posts for now. Try again later, or create a free account." },
        { status: 429, headers: { "Retry-After": String(Math.max(perIp.retryAfterSec, global.retryAfterSec, 60)) } },
      );
    }

    const url = await assertSafeUserUrl(report.url);
    const audit = await new SEOAgent().audit(url.toString());
    const posts = await writeAuditPosts({
      driver,
      apiKey,
      model,
      page: { host: report.host, title: audit.meta.title ?? "", description: audit.meta.description ?? "", bodyText: audit.bodyText ?? "" },
      timeoutMs: MODEL_TIMEOUT_MS,
    });
    if (!posts) return NextResponse.json({ error: "Could not write sample posts just now. Try again." }, { status: 502 });

    await store.savePosts(id, token, posts);
    return NextResponse.json({ posts });
  } catch (error) {
    console.error("[public-audit] posts failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Could not write sample posts just now. Try again." }, { status: 502 });
  }
}
