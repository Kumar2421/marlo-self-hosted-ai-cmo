/**
 * One robots.txt parser for the whole app (RFC 9309). Pure: no IO, no clock. The audit, the GEO
 * readiness check and the site crawl all decide from this, so they cannot drift apart.
 *
 * The caller caps the input (the RFC asks for at least 500 KiB, see ROBOTS_MAX_BYTES); parseRobots
 * itself reads whatever it is given.
 */

/** Only this much of a robots.txt is considered. Anything past it is ignored, as the RFC allows. */
export const ROBOTS_MAX_BYTES = 500 * 1024;
/** Longest Crawl-delay a crawler honours by default. A bigger ask means "skip this host". */
export const DEFAULT_MAX_CRAWL_DELAY_SEC = 60;

export type RobotsRule = { allow: boolean; pattern: string };
export type RobotsGroup = {
  /** Lowercased user-agent tokens that share this block. */
  agents: string[];
  rules: RobotsRule[];
  /** Seconds, from the last valid Crawl-delay line of the block. */
  crawlDelaySec: number | null;
};
export type ParsedRobots = { groups: RobotsGroup[] };

/** Unreserved characters never need their escape; everything else keeps it (upper-case hex). */
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/** Same spelling for a rule and a path: %xx upper-cased, unreserved decoded, non-ASCII percent-encoded. */
function normalise(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const hex = ch === "%" ? input.slice(i + 1, i + 3) : "";
    if (/^[0-9a-fA-F]{2}$/.test(hex)) {
      const decoded = String.fromCharCode(parseInt(hex, 16));
      out += UNRESERVED.test(decoded) ? decoded : `%${hex.toUpperCase()}`;
      i += 2;
    } else if (ch.charCodeAt(0) < 0x80) {
      out += ch;
    } else {
      const cp = input.codePointAt(i) as number;
      const char = String.fromCodePoint(cp);
      if (cp > 0xffff) i++;
      try {
        out += encodeURIComponent(char);
      } catch {
        out += "%EF%BF%BD"; // a lone surrogate cannot be encoded; use U+FFFD
      }
    }
  }
  return out;
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      // Consecutive User-agent lines share one block of rules.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySec: null };
        groups.push(current);
      }
      if (value) current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      // An empty value is "no restriction" and carries no rule.
      if (current && value) current.rules.push({ allow: field === "allow", pattern: normalise(value) });
    } else if (field === "crawl-delay") {
      lastWasAgent = false;
      const sec = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
      if (current && Number.isFinite(sec)) current.crawlDelaySec = sec;
    }
    // Sitemap and unknown fields do not end a block.
  }
  return { groups };
}

/** Product token of a User-Agent string: "OkaraAlternative/1.0 (+x)" -> "okaraalternative". */
function productToken(userAgent: string): string {
  return userAgent.trim().split(/[\s/]/)[0].toLowerCase();
}

/** Groups naming this crawler; when none does, the "*" groups. Several blocks for one name merge. */
function applicableGroups(parsed: ParsedRobots, userAgent: string): RobotsGroup[] {
  const token = productToken(userAgent);
  const named = parsed.groups.filter((g) => g.agents.includes(token));
  return named.length > 0 ? named : parsed.groups.filter((g) => g.agents.includes("*"));
}

/** The rules that apply to a crawler (most specific group, else "*"). */
export function rulesFor(parsed: ParsedRobots, userAgent: string): RobotsRule[] {
  return applicableGroups(parsed, userAgent).flatMap((g) => g.rules);
}

/** `*` is any run of characters, a trailing `$` anchors the end; otherwise a prefix match. */
export function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/**
 * Is this path (with its query string) allowed for the crawler? The longest matching pattern wins;
 * on a tie Allow wins; no match means allowed.
 */
export function isAllowed(parsed: ParsedRobots, userAgent: string, path: string): boolean {
  const target = normalise(path.startsWith("/") ? path : `/${path}`);
  let bestLen = -1;
  let allowed = true;
  for (const rule of rulesFor(parsed, userAgent)) {
    if (!patternMatches(rule.pattern, target)) continue;
    const len = rule.pattern.length;
    if (len > bestLen || (len === bestLen && rule.allow)) {
      bestLen = len;
      allowed = rule.allow;
    }
  }
  return allowed;
}

/** Crawl-delay in seconds from the crawler's own group, else "*"; null when none is given. */
export function getCrawlDelay(parsed: ParsedRobots, userAgent: string): number | null {
  const delays = applicableGroups(parsed, userAgent).map((g) => g.crawlDelaySec).filter((d): d is number => d !== null);
  return delays.length > 0 ? delays[delays.length - 1] : null;
}

/** The delay if a crawler should honour it, or null when it is over the cap (skip the host). */
export function capCrawlDelay(delaySec: number | null, maxDelaySec: number = DEFAULT_MAX_CRAWL_DELAY_SEC): number | null {
  if (delaySec === null || delaySec > maxDelaySec) return null;
  return delaySec;
}
