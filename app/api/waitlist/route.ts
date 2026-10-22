import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { readLimitedText, trustedClientIp } from "@/lib/domain/net/publicGuard";
import { publicRateLimiter } from "@/lib/domain/net/publicRuntime";
import {
  WAITLIST_SOURCE,
  validateWaitlist,
  waitlistMessage,
  waitlistPlanPrefix,
} from "@/lib/domain/waitlist/validate";

export const maxDuration = 15;

const MAX_BODY_BYTES = 2048;
const GENERIC_ERROR = "Could not save your request. Please try again shortly.";
const TOO_MANY = "Too many requests. Please wait a minute and try again.";

/** Same body for new and repeat sign-ups, so the response never reveals whether an email was already on the list. */
function accepted() {
  return NextResponse.json({ ok: true });
}

function fail(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(req: NextRequest) {
  // The list lives in Supabase (marketing_leads). Self-host has no Supabase project.
  if (!FEATURES.PLATFORM_MODE) {
    return fail(503, "The waitlist is only available on the hosted version of Marlo.");
  }

  // Anonymous rate limit through the shared rate_limit_hit RPC. Fails closed on a store outage.
  const limiter = publicRateLimiter("closed");
  const ip = trustedClientIp(req.headers, process.env);
  const checks = ip
    ? [
        { key: `waitlist:ip:${ip}:min`, windowSec: 60, limit: 5 },
        { key: `waitlist:ip:${ip}:hour`, windowSec: 3600, limit: 20 },
      ]
    : [{ key: "waitlist:unknown:min", windowSec: 60, limit: 10 }];
  checks.push({ key: "waitlist:global", windowSec: 3600, limit: 300 });
  for (const check of checks) {
    const result = await limiter.hit(check.key, check.windowSec, check.limit);
    if (!result.allowed) {
      const headers = { "Retry-After": String(Math.max(1, result.retryAfterSec)) };
      return result.unavailable
        ? fail(503, "Service temporarily unavailable. Please try again shortly.", headers)
        : fail(429, TOO_MANY, headers);
    }
  }

  const text = await readLimitedText(req, MAX_BODY_BYTES);
  if (text === null) return fail(413, "Request is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "Invalid request.");
  }

  const parsed = validateWaitlist(body);
  // Bots that fill the hidden field get the normal answer and nothing is stored.
  if (!parsed.ok && parsed.reason === "honeypot") return accepted();
  if (!parsed.ok) return fail(400, parsed.message);
  const { email, website, plan, interval } = parsed.value;

  try {
    const db = createServiceClient();
    const message = waitlistMessage(plan, interval);

    // One row per email + plan: update it instead of adding another.
    const { data: existing, error: lookupError } = await db
      .from("marketing_leads")
      .select("id")
      .eq("source", WAITLIST_SOURCE)
      .eq("email", email)
      .like("message", waitlistPlanPrefix(plan))
      .limit(1);
    if (lookupError) throw new Error(lookupError.message);

    if (existing && existing.length > 0) {
      const update: { message: string; website?: string } = { message };
      if (website) update.website = website;
      const { error } = await db.from("marketing_leads").update(update).eq("id", existing[0].id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("marketing_leads")
        .insert({ source: WAITLIST_SOURCE, name: null, email, website, message });
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    // Server-side detail only; the client gets a generic message.
    console.error("[waitlist] save failed:", error instanceof Error ? error.message : "unknown error");
    return fail(500, GENERIC_ERROR);
  }

  return accepted();
}
