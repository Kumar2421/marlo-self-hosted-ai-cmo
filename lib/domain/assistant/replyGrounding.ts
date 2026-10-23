/**
 * Reply-grounding check for the AI CMO chat.
 *
 * Same idea as documents/grounding.ts (findUnverifiedClaims): a cheap deterministic pass that flags
 * figures the reply states as fact but that appear in NO tool result of the turn. It is LOG-ONLY:
 * the count goes into the turn log, the reply is never changed or blocked.
 *
 * Deliberately conservative about false positives: list numbering, small generic numbers, duration
 * phrases ("last 28 days"), today's year, and anything the user said themselves are not flagged.
 * Known limit: figures the model derives itself (a sum, a delta it computed) are flagged, because
 * the check only knows what the tools literally returned (plus array lengths).
 */

export type UnverifiedKind = "number" | "date" | "percent" | "domain";
export type UnverifiedItem = { kind: UnverifiedKind; text: string };
export type GroundingResult = { unverified: UnverifiedItem[]; ok: boolean };
export type GroundingOptions = {
  /** "Today": its year, and its month/day, are not flagged. */
  today?: Date;
  /** Extra text that counts as grounded, e.g. the user's own message or the project URL. */
  extraGrounded?: string[];
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const TLDS = "com|org|net|io|co|ai|dev|app|xyz|info|biz|me|us|uk|de|fr|es|it|nl|ca|au|in|shop|store|tech|online|site|cloud|so|sh|gg|tv";
const DOMAIN_RE = new RegExp(`(?<![@\\w.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS}))(?![\\w-]|\\.[a-z0-9])`, "gi");

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+Z?)?\b/g;

type Known = { text: string; numbers: number[]; dates: Set<string>; monthYears: Set<string>; domains: Set<string> };

const pad = (n: number) => String(n).padStart(2, "0");
const md = (m: number, d: number) => `${pad(m)}-${pad(d)}`;

function walkLengths(v: unknown, out: number[], depth = 0): void {
  if (depth > 6 || v == null) return;
  if (Array.isArray(v)) { out.push(v.length); for (const x of v) walkLengths(x, out, depth + 1); return; }
  if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walkLengths(x, out, depth + 1);
}

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractAllNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = parseNumber(m[0]);
    if (n !== null) out.push(n);
  }
  return out;
}

function buildKnown(texts: string[]): Known {
  const text = texts.join("\n");
  const numbers = extractAllNumbers(text);
  const dates = new Set<string>();
  const monthYears = new Set<string>();
  for (const m of text.matchAll(ISO_DATE)) {
    dates.add(`${m[1]}-${m[2]}-${m[3]}`);
    dates.add(md(Number(m[2]), Number(m[3])));
    monthYears.add(`${m[1]}-${m[2]}`);
  }
  for (const t of texts) {
    try { const lens: number[] = []; walkLengths(JSON.parse(t), lens); numbers.push(...lens); } catch { /* not JSON */ }
  }
  const domains = new Set<string>();
  for (const m of text.matchAll(DOMAIN_RE)) domains.add(m[1].toLowerCase().replace(/^www\./, ""));
  return { text: text.toLowerCase(), numbers, dates, monthYears, domains };
}

function decimalsOf(raw: string): number {
  const i = raw.indexOf(".");
  return i < 0 ? 0 : raw.length - i - 1;
}
const roundTo = (n: number, d: number) => Number(n.toFixed(d));

/** n (as written, with its decimals) is explained by some known figure: exact, rounded, or k/m shorthand. */
function numberKnown(n: number, raw: string, suffix: string, known: number[]): boolean {
  const d = decimalsOf(raw);
  const scale = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  for (const m of known) {
    if (scale === 1) {
      if (m === n) return true;
      if (d > 0 && roundTo(m, d) === n) return true;
      if (Math.abs(m) >= 1 && d === 0 && Math.round(m) === n && !Number.isInteger(m)) return true;
    } else {
      if (roundTo(m / scale, d) === n) return true;
    }
    // ratios stored as 0..1 (ctr 0.034) and quoted as percent
    if (m > 0 && m <= 1 && (roundTo(m * 100, d) === n || Math.round(m * 100) === n)) return true;
  }
  return false;
}

const METRIC_NOUN = /^\s*(?:clicks?|views?|impressions?|errors?|warnings?|leads?|findings?|issues?|queries|query|pages?|competitors?|replies|emails?|citations?|visits?|sessions?|positions?)\b/i;
const DURATION = /^\s*(?:-|\s)?(?:days?|weeks?|months?|hours?|minutes?|years?)\b/i;

/**
 * Flags figures in `reply` that no entry of `toolResults` supports.
 * Pure and deterministic; never throws.
 */
export function checkReplyGrounding(reply: string, toolResults: string[], opts: GroundingOptions = {}): GroundingResult {
  const unverified: UnverifiedItem[] = [];
  try {
    const known = buildKnown([...toolResults, ...(opts.extraGrounded ?? [])]);
    const today = opts.today;
    const seen = new Set<string>();
    const push = (kind: UnverifiedKind, text: string) => {
      const key = `${kind}:${text.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      unverified.push({ kind, text });
    };

    // Work on a copy that we blank out as each category is consumed, so "2026-09-28" is not also three numbers.
    let rest = reply.replace(/^\s*(?:\d{1,3}[.)]|[-*+])\s+/gm, (m) => " ".repeat(m.length)); // list numbering / bullets

    // Domains first (so "example.com" and "v1.2.3"-like text do not leak into numbers).
    rest = rest.replace(DOMAIN_RE, (full, host: string) => {
      const h = host.toLowerCase().replace(/^www\./, "");
      const ok = known.domains.has(h) || known.text.includes(h) || [...known.domains].some((d) => d.endsWith(`.${h}`) || h.endsWith(`.${d}`));
      if (!ok) push("domain", host);
      return " ".repeat(full.length);
    });

    // Dates: ISO, "Sept 28(, 2026)", "28 September (2026)", "9/28/2026" or "28/09/2026", "September 2026".
    const dateOk = (year: number | null, month: number, day: number): boolean => {
      if (today && month === today.getUTCMonth() + 1 && day === today.getUTCDate() && (year === null || year === today.getUTCFullYear())) return true;
      if (year !== null) return known.dates.has(`${year}-${pad(month)}-${pad(day)}`);
      return known.dates.has(md(month, day));
    };
    rest = rest.replace(ISO_DATE, (full, y: string, mo: string, d: string) => {
      if (!dateOk(Number(y), Number(mo), Number(d))) push("date", full);
      return " ".repeat(full.length);
    });
    const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, "gi");
    rest = rest.replace(dmy, (full, d: string, mon: string, y?: string) => {
      if (!dateOk(y ? Number(y) : null, MONTHS[mon.toLowerCase()], Number(d))) push("date", full.trim());
      return " ".repeat(full.length);
    });
    const mdy = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi");
    rest = rest.replace(mdy, (full, mon: string, d: string, y?: string) => {
      if (Number(d) < 1 || Number(d) > 31) return full;
      if (!dateOk(y ? Number(y) : null, MONTHS[mon.toLowerCase()], Number(d))) push("date", full.trim());
      return " ".repeat(full.length);
    });
    const monthYear = new RegExp(`\\b${MONTH_RE}\\s+(\\d{4})\\b`, "gi");
    rest = rest.replace(monthYear, (full, mon: string, y: string) => {
      const key = `${y}-${pad(MONTHS[mon.toLowerCase()])}`;
      const isToday = today && Number(y) === today.getUTCFullYear() && MONTHS[mon.toLowerCase()] === today.getUTCMonth() + 1;
      if (!isToday && !known.monthYears.has(key)) push("date", full.trim());
      return " ".repeat(full.length);
    });
    const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
    rest = rest.replace(slash, (full, a: string, b: string, y: string) => {
      const [x, z] = [Number(a), Number(b)];
      const ok = dateOk(Number(y), x, z) || dateOk(Number(y), z, x);
      if (!ok) push("date", full);
      return " ".repeat(full.length);
    });

    // Percentages.
    rest = rest.replace(/(?<![\w.])(\d+(?:[.,]\d+)?)\s?%/g, (full, raw: string) => {
      const n = parseNumber(raw.replace(",", "."));
      if (n !== null && !numberKnown(n, raw.replace(",", "."), "", known.numbers)) push("percent", full.trim());
      return " ".repeat(full.length);
    });

    // Plain numbers (with optional k/m shorthand).
    const numRe = /(?<![\w.,/-])(\d[\d,]*(?:\.\d+)?)([kKmM])?(?![\w-])/g;
    for (const m of rest.matchAll(numRe)) {
      const raw = m[1].replace(/,$/, "");
      const suffix = (m[2] ?? "").toLowerCase();
      const n = parseNumber(raw);
      if (n === null) continue;
      const after = rest.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 24);
      if (/^(?:19|20)\d\d$/.test(raw) && today && n === today.getUTCFullYear()) continue; // this year
      if (!suffix && DURATION.test(after)) continue; // "28 days" window phrases
      if (!suffix && Number.isInteger(n) && n <= 10 && !raw.includes(",") && !METRIC_NOUN.test(after)) continue; // generic small number
      if (!suffix && Number.isInteger(n) && n <= 10 && known.numbers.includes(n)) continue;
      if (!numberKnown(n, raw, suffix, known.numbers)) push("number", `${m[1]}${m[2] ?? ""}`);
    }
  } catch {
    return { unverified: [], ok: true };
  }
  return { unverified, ok: unverified.length === 0 };
}
