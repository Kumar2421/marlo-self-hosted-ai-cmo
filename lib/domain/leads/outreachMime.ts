import { randomBytes } from "node:crypto";

/**
 * Builds the raw RFC 5322 message sent through the Gmail API (multipart/alternative: plain text then HTML).
 * Pure apart from the random boundary (injectable). Header values can never carry a line break: CR, LF and NUL
 * are replaced before anything is written, so a subject or name cannot inject headers.
 */

export type MimeInput = {
  fromEmail: string;
  fromName?: string | null;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers (e.g. List-Unsubscribe). Names must be plain header tokens; values are sanitised. */
  headers?: Record<string, string>;
  boundary?: string;
};

/** Removes anything that could end a header line. */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0\u2028\u2029]+/g, " ").trim();
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 "B" encoded-words (UTF-8), each at most 75 chars, never splitting a code point, folded with CRLF + space. */
export function encodeHeaderText(value: string): string {
  const clean = sanitizeHeaderValue(value);
  if (isAscii(clean)) return clean;
  const words: string[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length) words.push(`=?UTF-8?B?${Buffer.from(current).toString("base64")}?=`);
    current = [];
  };
  for (const ch of clean) {
    const bytes = [...Buffer.from(ch, "utf8")];
    if (current.length + bytes.length > 45) flush();
    current.push(...bytes);
  }
  flush();
  return words.join("\r\n ");
}

function formatAddress(email: string, name?: string | null): string {
  const addr = sanitizeHeaderValue(email);
  if (!/^[^\s@<>,;"()\\]+@[^\s@<>,;"()\\]+$/.test(addr)) throw new Error("Invalid email address.");
  const display = sanitizeHeaderValue(name ?? "").replace(/["\\<>]/g, "");
  if (!display) return addr;
  return `${isAscii(display) ? `"${display}"` : encodeHeaderText(display)} <${addr}>`;
}

function base64Lines(content: string): string {
  return (Buffer.from(content, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
const RESERVED = new Set(["from", "to", "subject", "mime-version", "content-type", "content-transfer-encoding", "date"]);

export function buildOutreachMime(input: MimeInput): string {
  const boundary = input.boundary ?? `marlo_${randomBytes(12).toString("hex")}`;
  const lines: string[] = [
    `From: ${formatAddress(input.fromEmail, input.fromName)}`,
    `To: ${formatAddress(input.toEmail)}`,
    `Subject: ${encodeHeaderText(input.subject)}`,
    "MIME-Version: 1.0",
  ];
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (!HEADER_NAME.test(name) || RESERVED.has(name.toLowerCase())) continue;
    lines.push(`${name}: ${sanitizeHeaderValue(value)}`);
  }
  lines.push(
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.html),
    `--${boundary}--`,
    "",
  );
  return lines.join("\r\n");
}

export function base64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}
