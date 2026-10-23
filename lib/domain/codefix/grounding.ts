import type { FixKind } from "./fixCatalog.ts";

/**
 * Pure grounding rules for code fixes. A fix may only be prepared when the text it replaces is really in the
 * repo file, and an edit may never break the build (no second `metadata` export, none in a client component).
 * Nothing here touches GitHub or a model.
 */

export type FileGrounding =
  /** The finding's current text is in the file exactly (or only differing in whitespace/escaping). `anchor` is the file's own text. */
  | { status: "exact"; anchor: string }
  /** The exact text isn't there, but the metadata declaration that sets it was found by a deterministic search. */
  | { status: "declaration"; anchor: string }
  /** Nothing to replace (the tag is missing from the page), so the fix inserts. Guarded by checkEditSafety. */
  | { status: "insert" }
  | { status: "not_found"; searchedFor: string | null };

const META_KINDS: readonly FixKind[] = ["title", "meta_description"];

/** The finding's current value for a title/description fix, or null when it has none (the tag is missing). */
export function currentTextOf(kinds: readonly FixKind[], evidence: Record<string, unknown> | undefined): string | null {
  if (!kinds.some((k) => META_KINDS.includes(k))) return null;
  const current = evidence?.current;
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds `current` in `content`, tolerating the ways source code spells the same text. Returns the file's own spelling. */
export function findCurrentText(content: string, current: string): string | null {
  if (!current) return null;
  if (content.includes(current)) return current;
  const variants = [
    JSON.stringify(current).slice(1, -1), // escaped quotes / newlines inside a string literal
    current.replace(/&/g, "&amp;"),
    current.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
    current.replace(/'/g, "\\'"),
    current.replace(/"/g, "&quot;"),
  ];
  for (const v of variants) if (v && content.includes(v)) return v;
  // Same words, different whitespace (JSX or template strings wrapped over several lines).
  const words = current.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const m = new RegExp(words.map(escapeRegExp).join("\\s+")).exec(content);
    if (m) return m[0];
  }
  return null;
}

const STRING_LITERAL = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`)";

/** The braces-balanced `{ ... }` of `export const metadata = {...}` or `generateMetadata` (strings and comments skipped). */
export function metadataBlock(content: string): { start: number; end: number; text: string } | null {
  const decl = /export\s+(?:const|let|var)\s+metadata\b[^=]*=|export\s+(?:async\s+)?function\s+generateMetadata\b[^{]*\{/.exec(content);
  if (!decl) return null;
  let i = content.indexOf("{", decl[0].endsWith("{") ? decl.index + decl[0].length - 1 : decl.index + decl[0].length);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  for (; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      for (i++; i < content.length && content[i] !== quote; i++) if (content[i] === "\\") i++;
    } else if (ch === "/" && content[i + 1] === "/") {
      while (i < content.length && content[i] !== "\n") i++;
    } else if (ch === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2);
      if (close < 0) return null;
      i = close + 1;
    } else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start, end: i + 1, text: content.slice(start, i + 1) };
    }
  }
  return null;
}

/** A top-level `description: "..."` property inside the metadata object, or a `<meta name="description">` tag. */
function locateDescription(content: string): string | null {
  const block = metadataBlock(content);
  if (block) {
    const m = new RegExp(String.raw`(?<![\w$.])description\s*:\s*` + STRING_LITERAL).exec(block.text);
    if (m) return m[0];
  }
  const tag = /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i.exec(content);
  return tag ? tag[0] : null;
}

function locateTitle(content: string): string | null {
  const block = metadataBlock(content);
  if (block) {
    const m = new RegExp(String.raw`(?<![\w$.])title\s*:\s*` + STRING_LITERAL).exec(block.text);
    if (m) return m[0];
  }
  const tag = /<title\b[^>]*>[\s\S]*?<\/title>/i.exec(content);
  return tag ? tag[0] : null;
}

/** Locates the existing declaration for a title/description fix by fixed patterns (never by a model). */
export function locateMetadataDeclaration(content: string, kinds: readonly FixKind[]): string | null {
  if (kinds.includes("meta_description")) {
    const d = locateDescription(content);
    if (d) return d;
  }
  if (kinds.includes("title")) {
    const t = locateTitle(content);
    if (t) return t;
  }
  return null;
}

/**
 * Whether `content` really contains what the fix must replace. For a title/description finding with a known current
 * value: the exact text, else an existing metadata declaration, else not found (no model is asked to invent anything).
 * Other fixes add markup, so there is no text to find; they go through checkEditSafety.
 */
export function groundInFile(args: { kinds: readonly FixKind[]; evidence: Record<string, unknown> | undefined; content: string }): FileGrounding {
  const current = currentTextOf(args.kinds, args.evidence);
  if (current === null) return { status: "insert" };
  const exact = findCurrentText(args.content, current);
  if (exact) return { status: "exact", anchor: exact };
  const declared = locateMetadataDeclaration(args.content, args.kinds);
  if (declared) return { status: "declaration", anchor: declared };
  return { status: "not_found", searchedFor: current };
}

/** Candidate files to read for a page source: the page itself, then the layouts that commonly carry its metadata. */
export function groundingCandidates(pagePath: string): string[] {
  const dir = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/")) : "";
  const ext = /\.(tsx|jsx|ts|js)$/.exec(pagePath)?.[1];
  const appRoot = /^((?:src\/)?app)(?:\/|$)/.exec(pagePath)?.[1];
  const out = [pagePath];
  if (appRoot && ext) {
    for (const d of new Set([dir, appRoot])) {
      const layout = `${d}/layout.${ext}`;
      if (!out.includes(layout)) out.push(layout);
    }
  }
  return out;
}

export function hasUseClient(content: string): boolean {
  return /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/.test(content);
}

export function exportsMetadata(content: string): boolean {
  return (
    /export\s+(?:const|let|var)\s+metadata\b/.test(content) ||
    /export\s+(?:async\s+)?function\s+generateMetadata\b/.test(content) ||
    /export\s+(?:const|let|var)\s+generateMetadata\b/.test(content) ||
    /export\s*\{[^}]*\b(?:metadata|generateMetadata)\b[^}]*\}/.test(content)
  );
}

const ADDS_METADATA = /export\s+(?:const|let|var)\s+metadata\b|export\s+(?:async\s+)?function\s+generateMetadata\b|export\s+(?:const|let|var)\s+generateMetadata\b/;

export type BlockReason = "use_client" | "existing_metadata";
export type EditSafety = { ok: true } | { ok: false; reason: BlockReason; message: string };

/** Build-safety guard for one proposed edit: it must not add a metadata export where Next.js would refuse to build. */
export function checkEditSafety(content: string, edit: { oldSnippet: string; newSnippet: string }): EditSafety {
  const adds = ADDS_METADATA.test(edit.newSnippet) && !ADDS_METADATA.test(edit.oldSnippet);
  if (!adds) return { ok: true };
  if (hasUseClient(content)) {
    return {
      ok: false,
      reason: "use_client",
      message: "This file is a client component ('use client'), and Next.js doesn't allow a metadata export there. Set the title or description in a server file (such as the layout) by hand.",
    };
  }
  if (exportsMetadata(content)) {
    return {
      ok: false,
      reason: "existing_metadata",
      message: "This file already exports metadata. A second export would break the build, so the existing one has to be edited instead.",
    };
  }
  return { ok: true };
}

/** An edit to a finding with known current text must really replace that text. */
export function replacesAnchor(edit: { oldSnippet: string }, anchor: string): boolean {
  return edit.oldSnippet.includes(anchor);
}

/* ------------------------------------------------------------------ */
/* Blocked states carried from the provider to the route and the UI.   */
/* ------------------------------------------------------------------ */

export type BlockedFix =
  | {
      kind: "not_found";
      repoFullName: string;
      filesSearched: string[];
      searchedFor: string | null;
      message: string;
      host: string;
      /** Nothing links this repo to the site either, so the likelier fix is choosing another repository. */
      repoLooksWrong: boolean;
    }
  | { kind: "unsafe"; reason: BlockReason; repoFullName: string; filesSearched: string[]; message: string }
  | { kind: "repo_mismatch"; repoFullName: string; host: string; filesSearched: string[]; message: string };

/** Thrown before any model call (or after one, for an unsafe draft) when a fix must not be offered. Carries the state to show. */
export class FixBlockedError extends Error {
  blocked: BlockedFix;
  constructor(blocked: BlockedFix) {
    super(blocked.message);
    this.name = "FixBlockedError";
    this.blocked = blocked;
  }
}

export function notFoundMessage(repoFullName: string): string {
  return `We couldn't find this text in ${repoFullName}.`;
}

export function mismatchMessage(host: string): string {
  return `This repo doesn't appear to contain ${host}.`;
}
