import { NextRequest, NextResponse } from "next/server";
import { outreachStoreForDeployment } from "@/lib/domain/leads/outreachRuntime";
import { applyUnsubscribe, checkUnsubscribeToken } from "@/lib/domain/leads/outreachUnsubscribe";
import { memoryRateLimiter } from "@/lib/domain/net/rateLimit";

// Public on purpose: the link in an outreach email must work without an account. The signed token is the only
// credential and it can do one thing: stop that sender emailing that address. Nothing here says whose list it is.

const limiter = memoryRateLimiter();

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
};

function page(title: string, message: string, status = 200): NextResponse {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="margin:0;padding:48px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827"><main style="max-width:480px;margin:0 auto">` +
    `<h1 style="font-size:20px;margin:0 0 12px">${title}</h1><p style="font-size:14px;line-height:1.6">${message}</p></main></body></html>`;
  return new NextResponse(html, { status, headers: HEADERS });
}

function clientKey(req: NextRequest): string {
  return `outreach-unsub:${(req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim()}`;
}

/** A GET never changes anything (mail scanners prefetch links); it forwards to the confirm page. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!checkUnsubscribeToken(token, process.env.NOTIFY_SIGNING_SECRET)) {
    return page("This link isn't valid", "It may have expired or been copied incorrectly.", 400);
  }
  const url = req.nextUrl.clone();
  url.pathname = "/unsubscribe";
  url.search = `?token=${encodeURIComponent(token)}`;
  return NextResponse.redirect(url, 303);
}

/** The confirm button and RFC 8058 one-click (body `List-Unsubscribe=One-Click`) both land here. */
export async function POST(req: NextRequest) {
  const rate = await limiter.hit(clientKey(req), 60, 20);
  if (!rate.allowed) return page("Please try again shortly", "Too many requests.", 429);

  const token = req.nextUrl.searchParams.get("token");
  let outcome;
  try {
    outcome = await applyUnsubscribe(outreachStoreForDeployment(), token, process.env.NOTIFY_SIGNING_SECRET);
  } catch {
    return page("Something went wrong", "We couldn't save that. Please try the link again in a moment.", 500);
  }
  if (outcome === "invalid") return page("This link isn't valid", "It may have expired or been copied incorrectly.", 400);
  if (outcome === "unavailable") return page("Something went wrong", "We couldn't save that. Please try the link again in a moment.", 503);
  return page("You're unsubscribed", "You will not receive further emails from this sender.");
}
