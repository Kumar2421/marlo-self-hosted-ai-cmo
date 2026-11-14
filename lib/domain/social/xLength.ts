/**
 * Counts text the way X weights characters against its 280 limit: every URL counts as 23
 * characters regardless of its real length, and each code point counts 1 inside the narrow
 * ranges below and 2 everywhere else (emoji, CJK and similar).
 * Pure module: no imports and no I/O.
 */

export const X_LIMIT = 280;

const URL_WEIGHT = 23;

// Matches http(s) URLs and bare domains (optional path/query). A URL ends before any run of
// trailing sentence punctuation that is followed by whitespace or the end of the text.
// A bare domain only counts as a link when it ends in a common top-level domain: "node.js" and "file.txt" are words,
// not links, and counting them as 23 would warn about a limit the post does not hit.
const TLDS = "com|net|org|io|co|ai|app|dev|in|uk|us|ca|au|de|fr|es|it|nl|me|xyz|info|biz|so|sh|gg|tv|ly|to|cc|tech|site|online|store|shop|blog|cloud|agency|design|studio|page|link|club";
const URL_PATTERN = new RegExp(
  String.raw`(?<![\w.\/@-])(?:https?:\/\/\S+?|(?:[a-z0-9-]+\.)+(?:${TLDS})(?:\/\S+?)?)(?=[.,!?;:)\]"]*(?:\s|$))`,
  "gi",
);

function isWeightOne(cp: number): boolean {
  return (
    (cp >= 0x0000 && cp <= 0x10ff) ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
  );
}

export function xWeightedLength(text: string): number {
  const withUrlsWeighted = text.replace(URL_PATTERN, "x".repeat(URL_WEIGHT));
  let total = 0;
  for (const ch of withUrlsWeighted) {
    total += isWeightOne(ch.codePointAt(0) ?? 0) ? 1 : 2;
  }
  return total;
}

export function xOverLimit(text: string): boolean {
  return xWeightedLength(text) > X_LIMIT;
}
