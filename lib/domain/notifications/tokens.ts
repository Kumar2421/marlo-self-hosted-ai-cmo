import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring tokens for links in emails (unsubscribe, manage). HMAC-SHA256
 * with a server secret. Everything fails closed: a missing or short secret
 * signs nothing and verifies nothing.
 */
export type TokenScope = "unsubscribe" | "lead-unsubscribe";

export const MIN_SECRET_LENGTH = 16;
const DEFAULT_TTL_SECONDS = 365 * 24 * 3600;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function usable(secret: string | undefined | null): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

function mac(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

/** Returns null (never a weak token) when the secret is unusable. */
export function signToken(
  args: { userId: string; scope: TokenScope; now?: Date; ttlSeconds?: number; email?: string; leadId?: string },
  secret: string | undefined | null,
): string | null {
  if (!usable(secret) || !args.userId) return null;
  const exp = Math.floor((args.now ?? new Date()).getTime() / 1000) + (args.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const body = b64(JSON.stringify({ u: args.userId, s: args.scope, e: exp, ...(args.email ? { m: args.email } : {}), ...(args.leadId ? { l: args.leadId } : {}) }));
  return `${body}.${b64(mac(body, secret))}`;
}

/** The user id the token was issued for, or null for anything wrong: malformed, forged, wrong scope, expired, no secret. */
export function verifyToken(
  token: string | null | undefined,
  scope: TokenScope,
  secret: string | undefined | null,
  now: Date = new Date(),
): { userId: string; email?: string; leadId?: string } | null {
  if (!usable(secret) || typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;

  const given = Buffer.from(sig, "base64url");
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u?: unknown; s?: unknown; e?: unknown; m?: unknown; l?: unknown };
    if (typeof data.u !== "string" || !data.u || data.s !== scope || typeof data.e !== "number") return null;
    if (data.e * 1000 < now.getTime()) return null;
    return {
      userId: data.u,
      ...(typeof data.m === "string" ? { email: data.m } : {}),
      ...(typeof data.l === "string" ? { leadId: data.l } : {}),
    };
  } catch {
    return null;
  }
}
