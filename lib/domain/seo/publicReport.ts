import { createHash, randomBytes } from "node:crypto";
import { hostOf, scoreBand, type ReportFinding, type ScoreBand } from "./publicReportShared.ts";

export { hostOf, scoreBand };
export type { ReportFinding, ScoreBand };

/**
 * A saved, shareable copy of one public audit result.
 *
 * Only what the visitor already saw on screen is stored: the audited public URL, the on-page score, the
 * counts and the three findings shown. Nothing from the crawl body, headers or cookies. The owner gets a
 * one-time token to remove the report; only its hash is stored.
 */

export const REPORT_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PublicReport = {
  id: string;
  url: string;
  host: string;
  score: number;
  summary: { totalFindings: number; critical: number; warnings: number };
  findings: ReportFinding[];
  createdAt: string;
  expiresAt: string;
};

export type StoredReport = PublicReport & { ownerTokenHash: string };

export type PublicReportStore = {
  save(report: StoredReport): Promise<void>;
  /** Returns null when the id is unknown or the report has expired. Never returns the token hash. */
  get(id: string, now?: Date): Promise<PublicReport | null>;
  /** Removes the report when the token matches. Returns whether something was removed. */
  remove(id: string, ownerToken: string): Promise<boolean>;
};

// Crockford-style alphabet: no 0/O/1/I/L, so an id read aloud or typed from a screenshot is hard to get wrong.
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REPORT_ID_LENGTH = 12;
const ID_PATTERN = new RegExp(`^[${ID_ALPHABET}]{${REPORT_ID_LENGTH}}$`);

function randomFrom(alphabet: string, length: number): string {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function newReportId(): string {
  return randomFrom(ID_ALPHABET, REPORT_ID_LENGTH);
}

export function isReportId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function newOwnerToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isOwnerTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(value);
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clipText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function cleanEvidence(evidence: unknown): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (!evidence || typeof evidence !== "object") return out;
  for (const [key, value] of Object.entries(evidence as Record<string, unknown>).slice(0, 6)) {
    if (typeof value === "number" && Number.isFinite(value)) out[clipText(key, 40)] = value;
    else if (typeof value === "string") out[clipText(key, 40)] = clipText(value, 200);
    else if (value === null) out[clipText(key, 40)] = null;
  }
  return out;
}

export type ReportInput = {
  url: string;
  score: unknown;
  findings: Array<{
    issueId: string;
    category: string;
    severity: "Warning" | "Error";
    label: string;
    evidence: Record<string, string | number | null>;
    whyItMatters: string;
    recommendation: string;
  }>;
  summary: { totalFindings: number; critical: number; warnings: number };
};

/** Builds the record to save. Everything is length-capped, so a hostile page cannot bloat a row. */
export function buildStoredReport(input: ReportInput, now: Date = new Date()): { report: StoredReport; ownerToken: string } {
  const ownerToken = newOwnerToken();
  const url = clipText(input.url, 500);
  const report: StoredReport = {
    id: newReportId(),
    url,
    host: hostOf(url),
    score: clampScore(input.score),
    summary: {
      totalFindings: Math.max(0, Math.floor(input.summary.totalFindings)),
      critical: Math.max(0, Math.floor(input.summary.critical)),
      warnings: Math.max(0, Math.floor(input.summary.warnings)),
    },
    findings: input.findings.slice(0, 3).map((f) => ({
      issueId: clipText(f.issueId, 80),
      category: clipText(f.category, 40),
      severity: f.severity === "Error" ? "Error" : "Warning",
      label: clipText(f.label, 200),
      evidence: cleanEvidence(f.evidence),
      whyItMatters: clipText(f.whyItMatters, 600),
      recommendation: clipText(f.recommendation, 600),
    })),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REPORT_TTL_DAYS * DAY_MS).toISOString(),
    ownerTokenHash: hashOwnerToken(ownerToken),
  };
  return { report, ownerToken };
}

export function toPublicReport(stored: StoredReport): PublicReport {
  const { ownerTokenHash: _hash, ...rest } = stored;
  void _hash;
  return rest;
}

export function isExpired(report: { expiresAt: string }, now: Date = new Date()): boolean {
  const at = Date.parse(report.expiresAt);
  return !Number.isFinite(at) || at <= now.getTime();
}

/** The link people share. `origin` comes from the request, never from user input. */
export function reportPath(id: string): string {
  return `/audit/r/${id}`;
}

/** Bounded in-memory store for tests and as a safe stand-in. Not used in production code paths. */
export function memoryReportStore(): PublicReportStore {
  const rows = new Map<string, StoredReport>();
  return {
    async save(report) {
      rows.set(report.id, report);
    },
    async get(id, now = new Date()) {
      const row = rows.get(id);
      if (!row || isExpired(row, now)) return null;
      return toPublicReport(row);
    },
    async remove(id, ownerToken) {
      const row = rows.get(id);
      if (!row || row.ownerTokenHash !== hashOwnerToken(ownerToken)) return false;
      rows.delete(id);
      return true;
    },
  };
}
