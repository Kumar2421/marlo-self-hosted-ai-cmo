/**
 * Conservative detector for "please stop emailing me" replies. Only the first ~300 characters of the reply's own
 * text count (quoted history and signatures are cut off first), and only clear opt-out phrasing matches.
 * "Not interested" is deliberately NOT a stop request.
 */

const LOOKAHEAD = 300;

/** Cuts quoted text: "On ... wrote:", "-----Original Message-----", "From:" header blocks and "> " lines. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^>/.test(t)) continue;
    if (/^on .{3,200}wrote:?$/i.test(t)) break;
    if (/^-{2,}\s*(original message|forwarded message)/i.test(t) || /^_{5,}$/.test(t)) break;
    if (/^from:\s/i.test(t) && kept.length > 0) break;
    kept.push(line);
  }
  return kept.join("\n");
}

// Each pattern must match a short, standalone request. Sentence-start anchoring is done by splitting into sentences.
const STOP_PATTERNS: RegExp[] = [
  /^(please\s+|kindly\s+)?(stop|unsubscribe|remove me|opt me out)\.?!?$/i,
  /^(please\s+|kindly\s+)?stop (emailing|contacting|messaging|sending|writing)( to)?( me| us)?\b/i,
  /^(please\s+|kindly\s+)?unsubscribe( me| us)?( from (this|your|the) (list|emails?|mailing list|newsletter))?(\s+please)?\.?!?$/i,
  /^(please\s+|kindly\s+)?remove (me|us|my (email|address|name))( from (this|your|the|any) ?(mailing )?(list|lists|emails?|database))?(\s+please)?\.?!?$/i,
  /^(please\s+)?(do not|don't|dont)\s+(contact|email|message|write to)( me| us)?( again| anymore| any more)?\.?!?$/i,
  /^(please\s+)?(do not|don't|dont)\s+(contact|email|message)\s+(me|us)\b/i,
  /^(i|we) (want|wish|would like|d like) to (opt out|unsubscribe|be removed)\b/i,
  /^(i|we) (am|are|'m) opting out\b/i,
  /^opt[- ]?out\.?!?$/i,
  /^(please\s+)?take me off (your|this|the) (list|mailing list)\b/i,
];

export function isStopRequest(replyText: string): boolean {
  const head = stripQuotedReply(replyText).trim().slice(0, LOOKAHEAD);
  if (!head) return false;
  // Sentences/lines; the request has to be one of the first few, standing on its own.
  const parts = head
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.replace(/^(hi|hello|hey|dear)\b[^,.\n]{0,40}[,.]?\s*/i, "").replace(/^(thanks|thank you)[,.!]?\s*/i, "").replace(/^(but|so|and)\s+/i, "").trim())
    .filter(Boolean)
    .slice(0, 4);
  return parts.some((p) => STOP_PATTERNS.some((re) => re.test(p.replace(/[\s]+/g, " "))));
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

/** The text/plain body of a Gmail `format=full` message payload (depth-first), or "" when there is none. */
export function plainTextFromGmailPayload(payload: GmailPart | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const part of payload.parts ?? []) {
    const text = plainTextFromGmailPayload(part);
    if (text) return text;
  }
  return "";
}
