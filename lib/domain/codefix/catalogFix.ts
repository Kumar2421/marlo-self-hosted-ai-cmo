import {
  FIX_KIND_INFO,
  MAX_FIX_FILES,
  MAX_NEW_FILE_BYTES,
  MAX_SNIPPET_BYTES,
  isSafeRepoPath,
  type FixKind,
} from "./fixCatalog.ts";

/** Pure helpers behind the catalog (multi-file) fixes: prompt, response parsing, validation, PR text. */

export type FixChange =
  | { type: "edit"; path: string; oldSnippet: string; newSnippet: string }
  | { type: "create"; path: string; content: string };

export type CatalogFixInput = {
  findingId: string;
  label: string;
  kinds: FixKind[];
  recommendation: string;
  evidence: Record<string, unknown>;
  /** The page the finding is about, when known. */
  pageUrl: string | null;
};

export type CatalogProposal = { changes: FixChange[]; explanation: string };

export type CatalogApplyMeta = {
  findingId: string;
  label: string;
  recommendation: string;
  pageUrl: string | null;
  explanation: string;
  kinds: FixKind[];
};

const byteLength = (s: string) => Buffer.byteLength(s, "utf8");

/** Where a brand-new file for `kind` goes: next to the other static assets when the repo has a public/ folder. */
export function newFilePathFor(kind: FixKind, hasPublicDir: boolean): string {
  const name = kind === "llms_txt" ? "llms.txt" : "sitemap.xml";
  return hasPublicDir ? `public/${name}` : name;
}

export function buildCatalogPrompt(args: {
  repoFullName: string;
  projectName: string;
  projectUrl: string;
  input: CatalogFixInput;
  pagePath: string | null;
  pageContent: string | null;
  newFiles: { kind: FixKind; path: string }[];
}): { system: string; prompt: string } {
  const { input } = args;
  const system =
    "You are a careful engineer making small, surgical SEO/GEO fixes to a real website repo. " +
    "Output ONLY the exact format requested. Change only what the issue needs. Never invent facts about the business; use only the evidence and page content given. Do not touch config, scripts or anything unrelated.";
  const wants = input.kinds.map((k) => `- ${FIX_KIND_INFO[k].label}`).join("\n");
  const pageBlock = args.pagePath
    ? `Page source file: ${args.pagePath}\n"""\n${args.pageContent ?? ""}\n"""\n`
    : "";
  const createBlock = args.newFiles.length
    ? `New files to create (exactly these paths):\n${args.newFiles.map((f) => `- ${f.path} (${FIX_KIND_INFO[f.kind].label})`).join("\n")}\n`
    : "";
  const prompt = `Repo: ${args.repoFullName}
Product: ${args.projectName} (${args.projectUrl})
Issue: ${input.label}
What to fix:
${wants}
Recommendation: ${input.recommendation}
Evidence: ${JSON.stringify(input.evidence).slice(0, 2000)}

${pageBlock}${createBlock}
Return the fix in exactly this format and nothing else. Use one EDIT block per change to the page source file, and one CREATE block per new file listed above.

EDIT: <the page source file path>
OLD:
<<<
(a short substring copied VERBATIM from the page source above: the exact tag/line to replace, or an exact anchor line like </head> to insert before)
>>>
NEW:
<<<
(what OLD becomes)
>>>

CREATE: <new file path>
<<<
(full content of the new file)
>>>

EXPLANATION: <one or two sentences for the pull request description>

Every OLD block must exist character-for-character in the page source. At most ${MAX_FIX_FILES} files in total.`;
  return { system, prompt };
}

export type ParsedCatalogResponse = {
  edits: { path: string; oldSnippet: string; newSnippet: string }[];
  creates: { path: string; content: string }[];
  explanation: string;
};

export function parseCatalogResponse(raw: string): ParsedCatalogResponse {
  const edits: ParsedCatalogResponse["edits"] = [];
  const creates: ParsedCatalogResponse["creates"] = [];
  const editRe = /^EDIT:[ \t]*(\S+)[ \t]*\r?\nOLD:[ \t]*\r?\n<<<\r?\n([\s\S]*?)\r?\n>>>[ \t]*\r?\nNEW:[ \t]*\r?\n<<<\r?\n([\s\S]*?)\r?\n>>>/gm;
  const createRe = /^CREATE:[ \t]*(\S+)[ \t]*\r?\n<<<\r?\n([\s\S]*?)\r?\n>>>/gm;
  for (const m of raw.matchAll(editRe)) edits.push({ path: m[1], oldSnippet: m[2], newSnippet: m[3] });
  for (const m of raw.matchAll(createRe)) creates.push({ path: m[1], content: m[2] });
  if (edits.length === 0 && creates.length === 0) throw new Error("The model didn't return a parseable fix. Try again.");
  const explanation = raw.match(/^EXPLANATION:[ \t]*(.+)$/m)?.[1]?.trim() ?? "Fixes the reported issue.";
  return { edits, creates, explanation };
}

/** Applies edits in order to one file's content; every OLD must really be there. */
export function applyEditsToContent(content: string, edits: { oldSnippet: string; newSnippet: string }[]): string {
  let out = content;
  for (const e of edits) {
    if (!e.oldSnippet || !out.includes(e.oldSnippet)) {
      throw new Error("The file changed or the fix no longer matches it. Prepare the fix again.");
    }
    out = out.replace(e.oldSnippet, () => e.newSnippet);
  }
  return out;
}

/** Checks a model proposal against what the repo and plan actually allow (fail-closed). */
export function validateProposal(
  parsed: ParsedCatalogResponse,
  ctx: { pagePath: string | null; pageContent: string | null; newFilePaths: string[] },
): FixChange[] {
  const changes: FixChange[] = [];
  for (const e of parsed.edits) {
    if (!ctx.pagePath || e.path !== ctx.pagePath) throw new Error("The model tried to edit a file outside the plan. Try again.");
    if (!e.oldSnippet || !ctx.pageContent?.includes(e.oldSnippet)) {
      throw new Error("Generated fix didn't match the real file content exactly. Try again.");
    }
    if (byteLength(e.oldSnippet) > MAX_SNIPPET_BYTES || byteLength(e.newSnippet) > MAX_SNIPPET_BYTES) throw new Error("The generated change is too large for an automatic fix.");
    changes.push({ type: "edit", path: e.path, oldSnippet: e.oldSnippet, newSnippet: e.newSnippet });
  }
  const seen = new Set<string>();
  for (const c of parsed.creates) {
    if (!ctx.newFilePaths.includes(c.path) || seen.has(c.path)) throw new Error("The model tried to create a file outside the plan. Try again.");
    seen.add(c.path);
    if (!c.content.trim()) throw new Error("The model returned an empty file. Try again.");
    if (byteLength(c.content) > MAX_NEW_FILE_BYTES) throw new Error("The generated file is too large for an automatic fix.");
    changes.push({ type: "create", path: c.path, content: c.content.endsWith("\n") ? c.content : `${c.content}\n` });
  }
  return assertWithinLimits(changes);
}

export function changedPaths(changes: FixChange[]): string[] {
  return [...new Set(changes.map((c) => c.path))];
}

function assertWithinLimits(changes: FixChange[]): FixChange[] {
  if (changes.length === 0) throw new Error("There is nothing to change.");
  if (changedPaths(changes).length > MAX_FIX_FILES) throw new Error(`An automatic fix may change at most ${MAX_FIX_FILES} files.`);
  return changes;
}

/** Validates changes sent back by the browser (possibly edited by the user) before anything touches the repo. */
export function parseClientChanges(value: unknown, allowedPaths: string[]): FixChange[] {
  if (!Array.isArray(value)) throw new Error("No changes to apply.");
  const changes: FixChange[] = [];
  for (const raw of value) {
    const c = raw as Record<string, unknown>;
    const path = c?.path;
    if (typeof path !== "string" || !isSafeRepoPath(path) || !allowedPaths.includes(path)) throw new Error("That change targets a file Marlo didn't propose.");
    if (c.type === "edit") {
      if (typeof c.oldSnippet !== "string" || typeof c.newSnippet !== "string" || !c.oldSnippet) throw new Error("A change is malformed.");
      if (byteLength(c.oldSnippet) > MAX_SNIPPET_BYTES || byteLength(c.newSnippet) > MAX_SNIPPET_BYTES) throw new Error("A change is too large for an automatic fix.");
      changes.push({ type: "edit", path, oldSnippet: c.oldSnippet, newSnippet: c.newSnippet });
    } else if (c.type === "create") {
      if (typeof c.content !== "string" || !c.content.trim()) throw new Error("A new file is empty.");
      if (byteLength(c.content) > MAX_NEW_FILE_BYTES) throw new Error("A new file is too large for an automatic fix.");
      changes.push({ type: "create", path, content: c.content });
    } else {
      throw new Error("A change is malformed.");
    }
  }
  return assertWithinLimits(changes);
}

export function buildPrTitle(label: string): string {
  return `fix(seo): ${label}`.slice(0, 120);
}

/** Makes untrusted text inert inside a GitHub PR body: no HTML, links, mentions, issue refs or markdown structure. */
export function sanitizeProse(text: string, max = 500): string {
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[&<>@#`[\]!*_]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function buildPrBody(meta: CatalogApplyMeta, changes: FixChange[]): string {
  const files = changedPaths(changes).map((p) => {
    const isNew = changes.some((c) => c.path === p && c.type === "create");
    return `- \`${p}\`${isNew ? " (new file)" : ""}`;
  });
  return [
    "## What",
    sanitizeProse(meta.explanation),
    "",
    "## Why",
    `Marlo flagged this on ${sanitizeProse(meta.pageUrl ?? "your site", 300)}: **${sanitizeProse(meta.label, 120)}**.`,
    meta.recommendation ? `\n> ${sanitizeProse(meta.recommendation, 600)}` : "",
    "",
    "## Files changed",
    ...files,
    "",
    `Fix type: ${meta.kinds.map((k) => FIX_KIND_INFO[k].label).join(", ")}`,
    `Finding: \`${meta.findingId}\``,
    "",
    "Marlo never merges pull requests. Review the change and merge it when you are happy; Marlo will then measure what it did.",
  ].join("\n");
}

/** The slug in a fix branch name: lowercase words joined by "-", at most 40 characters. */
export function branchSlugFor(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "fix";
}

export function branchNameFor(label: string, now = Date.now()): string {
  return `marlo/${branchSlugFor(label)}-${now.toString(36)}`;
}
