import dns from "node:dns/promises";
import net from "node:net";

/**
 * Shared SSRF checks. Pure except for assertResolvesPublic, whose DNS lookup is injectable.
 * Error text is deliberately generic so a caller cannot use it as a port or host scanner.
 */

export const BLOCKED_MESSAGE = "That address can't be used.";

export type LookupFn = (host: string) => Promise<{ address: string }[]>;

/** Lowercase, no IPv6 brackets, no trailing dots ("localhost." is still localhost). */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

/** Names that are never public, whatever they resolve to. */
export function isBlockedHostname(raw: string): boolean {
  const host = normalizeHost(raw);
  if (!host) return true;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "0.0.0.0"
  );
}

function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // Embedded dotted IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    s = s.slice(0, s.length - tail[0].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const all = [...head, ...(halves.length === 2 ? Array(missing).fill("0") : []), ...rest];
  const nums = all.map((g) => parseInt(g, 16));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

function embeddedV4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivateV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for loopback, private, link-local, CGNAT, ULA, multicast and unparseable addresses. */
export function isPrivateIp(raw: string): boolean {
  const ip = normalizeHost(raw);
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind !== 6) return true; // not an IP at all: treat as unsafe
  const g = v6Groups(ip);
  if (!g) return true;
  if (g.every((n) => n === 0) || (g.slice(0, 7).every((n) => n === 0) && g[7] === 1)) return true; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated, never public)
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001:0000::/32 (tunnels, never a safe target)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0x0001) return true; // 64:ff9b:1::/48 local-use NAT64
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-translated (::ffff:0:a.b.c.d), IPv4-compatible and NAT64
  // (64:ff9b::/96): judge by the embedded IPv4 in the last two groups.
  const mapped = g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff;
  const translated = g.slice(0, 4).every((n) => n === 0) && g[4] === 0xffff && g[5] === 0;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0);
  if (mapped || translated || nat64 || g.slice(0, 6).every((n) => n === 0)) {
    return isPrivateV4(embeddedV4(g[6], g[7]));
  }
  // 6to4 2002::/16: the IPv4 sits in groups 1-2.
  if (g[0] === 0x2002) return isPrivateV4(embeddedV4(g[1], g[2]));
  return false;
}

/** Synchronous host check: blocked names and IP literals. Throws the generic message. */
export function assertPublicHostLiteral(host: string): void {
  const h = normalizeHost(host);
  if (isBlockedHostname(h)) throw new Error(BLOCKED_MESSAGE);
  if (net.isIP(h) && isPrivateIp(h)) throw new Error(BLOCKED_MESSAGE);
}

const defaultLookup: LookupFn = (host) => dns.lookup(host, { all: true, verbatim: true });

/** A DNS answer that takes longer than this is treated as blocked, so a stalled resolver cannot hold a request. */
export const LOOKUP_TIMEOUT_MS = 3_000;

async function lookupWithin(lookup: LookupFn, host: string, ms: number): Promise<{ address: string }[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("dns lookup timed out")), ms);
  });
  try {
    return await Promise.race([lookup(host), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolves the host and rejects when ANY address is non-public (a name with one public and one
 * private record is rejected). IP literals are checked directly. A failed or slow lookup (over
 * timeoutMs) is rejected with the same generic message.
 *
 * Residual window: the caller's fetch() resolves the name again on its own. An answer that changes
 * between this check and that connect (DNS rebinding) is not caught here. Closing it needs a
 * dispatcher that connects to the address validated here; that is not wired because undici is not
 * a direct dependency and mixing its Agent with the global fetch is version-sensitive.
 */
export async function assertResolvesPublic(
  rawHost: string,
  lookup: LookupFn = defaultLookup,
  timeoutMs: number = LOOKUP_TIMEOUT_MS
): Promise<void> {
  const host = normalizeHost(rawHost);
  assertPublicHostLiteral(host);
  if (net.isIP(host)) return;
  let addrs: { address: string }[];
  try {
    addrs = await lookupWithin(lookup, host, timeoutMs);
  } catch {
    throw new Error(BLOCKED_MESSAGE);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new Error(BLOCKED_MESSAGE);
}

/** Stricter async variant of assertPublicHttpUrl: scheme, name and literal checks plus DNS resolution. */
export async function assertPublicHttpUrlResolved(raw: string, lookup?: LookupFn): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http/https URLs are allowed");
  await assertResolvesPublic(u.hostname, lookup);
  return u;
}
