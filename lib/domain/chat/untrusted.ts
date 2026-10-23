/**
 * Prompt-injection hardening for tool results. Crawled titles, meta text, anchor text, finding
 * evidence, competitor and lead names can all be written by an attacker. Before a tool result
 * reaches the model, every string that is not on the trusted list is cleaned and wrapped in
 * DATA_OPEN ... DATA_CLOSE. TOOL_SYSTEM_RULES tells the model that anything between those markers
 * is data and never instructions. Pure; no I/O.
 */
export const DATA_OPEN = "⟦";
export const DATA_CLOSE = "⟧";
export const MAX_FIELD_CHARS = 200;

/** Control chars (keeps nothing but space), zero-width / bidi / BOM / line separators, and unpaired surrogates. */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏ - ⁠-⁯ㅤ︀-️﻿ﾠ￹-￻]/g;

/**
 * Clean one string: strip invisible characters, remove the data markers themselves (so content can
 * never close the wrapper early), defang HTML and code fences, collapse whitespace, cap length.
 */
export function cleanText(input: string, max = MAX_FIELD_CHARS): string {
  let s = input.replace(INVISIBLE, " ");
  s = s.split(DATA_OPEN).join("").split(DATA_CLOSE).join("");
  s = s.replace(/</g, "‹").replace(/>/g, "›").replace(/`/g, "'");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = `${s.slice(0, Math.max(max - 3, 0))}...`;
  return s;
}

/** Clean and mark one string as untrusted data. */
export function wrapUntrusted(input: string, max = MAX_FIELD_CHARS): string {
  return `${DATA_OPEN}${cleanText(input, max)}${DATA_CLOSE}`;
}

/**
 * Keys whose string values are produced by Marlo itself (enums, ids, timestamps, our own notes).
 * They are cleaned but not wrapped, so the model can pass ids back and read dates as normal.
 */
const TRUSTED_KEYS = new Set([
  "id", "findingId", "type", "status", "severity", "category", "leadType", "level", "order", "note", "what",
  "asOf", "dataDate", "snapshotDate", "checkedAt", "auditedAt", "createdAt", "completedAt", "firstSeen", "lastSeen",
  "resolvedAt", "from", "to", "priority", "totalDisplay", "confidence",
]);

/**
 * Walk a result object: wrap every untrusted string, clean trusted ones. Everything under an
 * "evidence" key is attacker-influenced, including its key names, so there nothing is trusted.
 */
export function wrapResult(value: unknown, key = "", depth = 0, force = false): unknown {
  if (typeof value === "string") {
    if (!force && TRUSTED_KEYS.has(key)) return cleanText(value, 1000);
    return wrapUntrusted(value);
  }
  if (value === null || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => wrapResult(v, key, depth + 1, force));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const inEvidence = force || k === "evidence";
    out[inEvidence && k !== "evidence" ? cleanText(k, 60) : k] = wrapResult(v, k, depth + 1, inEvidence);
  }
  return out;
}
