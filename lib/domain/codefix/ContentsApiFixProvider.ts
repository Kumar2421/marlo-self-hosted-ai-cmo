import type { LlmDriver } from "@/lib/llm";
import type { Finding } from "@/lib/domain/seo/SEOAgent";
import type { CatalogApplyMeta, CatalogFixInput, CatalogProposal, CodeFixContext, CodeFixProvider, FixChange, ProposedFix } from "./types.ts";
import { getRepo, searchCode, getFileContent, createBranch, putFileContent, createPullRequest, pathExists } from "./githubApi.ts";
import {
  applyEditsToContent,
  branchNameFor,
  buildCatalogPrompt,
  buildPrBody,
  buildPrTitle,
  changedPaths,
  newFilePathFor,
  sanitizeProse,
  parseCatalogResponse,
  validateProposal,
} from "./catalogFix.ts";
import { MAX_FIX_FILES, MAX_NEW_FILE_BYTES, MAX_SOURCE_FILE_BYTES, isSafeRepoPath, plannedTargets } from "./fixCatalog.ts";

/** Finds the real source file most likely to render `projectUrl`'s path —
 * grounded in GitHub's real Code Search, never guessed. Homepage is tried
 * against common framework conventions directly (no search term to anchor
 * on for "/"); throws honestly if nothing matches rather than picking a
 * random file. */
async function locateFile(token: string, repoFullName: string, defaultBranch: string, projectUrl: string): Promise<string> {
  const pathname = new URL(projectUrl).pathname.replace(/\/+$/, "");

  if (!pathname) {
    const candidates = ["app/page.tsx", "app/page.jsx", "src/app/page.tsx", "pages/index.tsx", "pages/index.jsx", "index.html"];
    for (const candidate of candidates) {
      try {
        await getFileContent(token, repoFullName, candidate, defaultBranch);
        return candidate;
      } catch {
        continue;
      }
    }
    throw new Error("Couldn't locate the homepage file automatically — none of the common framework paths matched. Fix it manually.");
  }

  const segment = pathname.split("/").filter(Boolean).pop()!;
  const results = await searchCode(token, repoFullName, `in:path ${segment}`);
  if (results.length === 0) {
    throw new Error(`Couldn't find a file matching "${pathname}" in ${repoFullName} — search didn't return anything. Fix it manually.`);
  }
  // Only a file whose path names the page segment counts: an unrelated hit is never edited just because it came first.
  const safe = results.filter((r) => isSafeRepoPath(r.path));
  const best = safe.find((r) => r.path.includes(`/${segment}/`) || r.path.includes(`/${segment}.`));
  if (!best) throw new Error(`Couldn't find a file Marlo may edit for "${pathname}". Fix it manually.`);
  return best.path;
}

type ParsedPatch = { old: string; new: string; explanation: string };

/** Parses the fixed OLD/NEW/EXPLANATION format the LLM is instructed to
 * return — a strict find-replace, not "regenerate the whole file", so a
 * small model can't silently corrupt unrelated content. */
function parsePatchResponse(raw: string): ParsedPatch {
  const oldMatch = raw.match(/OLD:\s*\n?<<<\n?([\s\S]*?)\n?>>>/);
  const newMatch = raw.match(/NEW:\s*\n?<<<\n?([\s\S]*?)\n?>>>/);
  const explanationMatch = raw.match(/EXPLANATION:\s*(.+)/);

  if (!oldMatch || !newMatch) {
    throw new Error("Model didn't return a parseable fix — try again.");
  }
  return {
    old: oldMatch[1],
    new: newMatch[1],
    explanation: explanationMatch?.[1]?.trim() ?? "Fixes the reported issue.",
  };
}

/**
 * Real implementation of CodeFixProvider for v1's scope (single-tag/single-
 * line fixes): read the real file via Contents API, have the LLM produce a
 * strict find-replace patch (not a full-file rewrite), verify the OLD block
 * actually exists in the file before trusting it, then push via a new
 * branch + draft PR. No repo clone, no build/test execution — see
 * types.ts's CodeFixProvider doc for why (and the future OpenHands seam).
 */
export class ContentsApiFixProvider implements CodeFixProvider {
  private llmDriver: LlmDriver;
  private llmApiKey: string;
  private llmModel: string;
  private llmBaseUrl?: string;

  // Explicit fields (not parameter properties) so this file also runs under Node's type stripping in tests.
  constructor(llmDriver: LlmDriver, llmApiKey: string, llmModel: string, llmBaseUrl?: string) {
    this.llmDriver = llmDriver;
    this.llmApiKey = llmApiKey;
    this.llmModel = llmModel;
    this.llmBaseUrl = llmBaseUrl;
  }

  async proposeFix(finding: Finding, ctx: CodeFixContext): Promise<ProposedFix> {
    const repo = await getRepo(ctx.githubToken, ctx.repoFullName);
    const filePath = await locateFile(ctx.githubToken, ctx.repoFullName, repo.defaultBranch, ctx.projectUrl);
    if (!isSafeRepoPath(filePath)) throw new Error("That file can't be changed automatically. Fix it manually.");
    const file = await getFileContent(ctx.githubToken, ctx.repoFullName, filePath, repo.defaultBranch);
    if (Buffer.byteLength(file.content, "utf8") > MAX_SOURCE_FILE_BYTES) throw new Error(`${filePath} is too large for an automatic fix. Make this change manually.`);

    const system = `You are a senior engineer making one small, surgical fix to a real source file for a real SEO issue. Output ONLY the exact format requested, nothing else. Never touch anything unrelated to this one issue.`;
    const prompt = `Repo: ${ctx.repoFullName}
File: ${filePath}
Issue: ${finding.label} (category: ${finding.category})
Evidence: ${JSON.stringify(finding.evidence)}
Product: ${ctx.projectName} — ${ctx.projectUrl}

Current file content:
"""
${file.content}
"""

Return the fix in exactly this format, nothing else:
OLD:
<<<
(a short substring copied VERBATIM from the file above — either the exact tag/line to replace, or an exact anchor line like </head> to insert new content right before)
>>>
NEW:
<<<
(what OLD becomes — the fixed or inserted content)
>>>
EXPLANATION: <one sentence, for the PR description>

The OLD block must exist character-for-character in the file above — copy it exactly, do not paraphrase or reformat it.`;

    const result = await this.llmDriver({
      apiKey: this.llmApiKey,
      model: this.llmModel,
      system,
      messages: [{ role: "user", content: prompt }],
      baseUrl: this.llmBaseUrl,
    });

    const parsed = parsePatchResponse(result.text ?? "");
    if (!file.content.includes(parsed.old)) {
      throw new Error("Generated fix didn't match the real file content exactly — the model may have paraphrased. Try again.");
    }

    const after = file.content.replace(parsed.old, parsed.new);
    return {
      filePath,
      before: file.content,
      after,
      oldSnippet: parsed.old,
      newSnippet: parsed.new,
      explanation: parsed.explanation,
      applyToken: file.sha,
    };
  }

  async applyFix(fix: ProposedFix, ctx: CodeFixContext, finding: Finding): Promise<{ prUrl: string; branch: string }> {
    if (typeof fix.filePath !== "string" || !isSafeRepoPath(fix.filePath)) throw new Error("That file can't be changed automatically.");
    if (typeof fix.after !== "string" || Buffer.byteLength(fix.after, "utf8") > MAX_SOURCE_FILE_BYTES) throw new Error("The change is too large for an automatic fix.");
    const repo = await getRepo(ctx.githubToken, ctx.repoFullName);
    const branch = `fix/${finding.issueId}-${Date.now().toString(36)}`;

    await createBranch(ctx.githubToken, ctx.repoFullName, repo.defaultBranch, branch);
    await putFileContent(ctx.githubToken, ctx.repoFullName, fix.filePath, fix.after, `fix: ${finding.label}`, branch, fix.applyToken!);

    const prUrl = await createPullRequest(
      ctx.githubToken,
      ctx.repoFullName,
      `fix: ${finding.label}`,
      `${sanitizeProse(String(fix.explanation ?? ""))}\n\nAutomatically generated from a real SEO audit finding on ${sanitizeProse(ctx.projectUrl, 300)}.\n\n**File:** \`${fix.filePath}\`\n**Issue:** ${sanitizeProse(finding.label, 120)}\n\nOpened as a draft - review before merging.`,
      branch,
      repo.defaultBranch
    );

    return { prUrl, branch };
  }
  async proposeCatalogFix(input: CatalogFixInput, ctx: CodeFixContext): Promise<CatalogProposal> {
    const repo = await getRepo(ctx.githubToken, ctx.repoFullName);
    const { pageKinds, newFileKinds } = plannedTargets(input.kinds);

    let pagePath: string | null = null;
    let pageContent: string | null = null;
    if (pageKinds.length > 0) {
      pagePath = await locateFile(ctx.githubToken, ctx.repoFullName, repo.defaultBranch, input.pageUrl ?? ctx.projectUrl);
      // Checked before the file is read or any LLM call is made.
      if (!isSafeRepoPath(pagePath)) throw new Error("The page source is in a place Marlo won't edit. Make this change manually.");
      const file = await getFileContent(ctx.githubToken, ctx.repoFullName, pagePath, repo.defaultBranch);
      if (Buffer.byteLength(file.content, "utf8") > MAX_SOURCE_FILE_BYTES) {
        throw new Error(`${pagePath} is too large for an automatic fix. Make this change manually.`);
      }
      pageContent = file.content;
    }

    const newFiles: { kind: (typeof newFileKinds)[number]; path: string }[] = [];
    if (newFileKinds.length > 0) {
      const hasPublicDir = await pathExists(ctx.githubToken, ctx.repoFullName, "public", repo.defaultBranch);
      for (const kind of newFileKinds) {
        const path = newFilePathFor(kind, hasPublicDir);
        if (await pathExists(ctx.githubToken, ctx.repoFullName, path, repo.defaultBranch)) {
          throw new Error(`${path} already exists in ${ctx.repoFullName}. Update it manually.`);
        }
        newFiles.push({ kind, path });
      }
    }
    if ((pagePath ? 1 : 0) + newFiles.length > MAX_FIX_FILES) throw new Error("This fix would touch too many files.");

    const { system, prompt } = buildCatalogPrompt({
      repoFullName: ctx.repoFullName,
      projectName: ctx.projectName,
      projectUrl: ctx.projectUrl,
      input,
      pagePath,
      pageContent,
      newFiles,
    });
    const result = await this.llmDriver({ apiKey: this.llmApiKey, model: this.llmModel, system, messages: [{ role: "user", content: prompt }], baseUrl: this.llmBaseUrl });
    const parsed = parseCatalogResponse(result.text ?? "");
    const changes = validateProposal(parsed, { pagePath, pageContent, newFilePaths: newFiles.map((f) => f.path) });
    return { changes, explanation: parsed.explanation };
  }

  async applyCatalogFix(changes: FixChange[], ctx: CodeFixContext, meta: CatalogApplyMeta): Promise<{ prUrl: string; branch: string; files: string[] }> {
    const repo = await getRepo(ctx.githubToken, ctx.repoFullName);
    const paths = changedPaths(changes);
    if (paths.length > MAX_FIX_FILES) throw new Error("This fix would touch too many files.");
    if (!paths.every(isSafeRepoPath)) throw new Error("That change targets a file Marlo won't edit.");

    // Re-read every file now, so what is committed is the reviewed edit applied to the current file.
    const writes: { path: string; content: string; sha?: string }[] = [];
    for (const path of paths) {
      const creates = changes.filter((c): c is Extract<FixChange, { type: "create" }> => c.type === "create" && c.path === path);
      if (creates.length > 0) {
        if (await pathExists(ctx.githubToken, ctx.repoFullName, path, repo.defaultBranch)) throw new Error(`${path} now exists in the repo. Prepare the fix again.`);
        if (Buffer.byteLength(creates[0].content, "utf8") > MAX_NEW_FILE_BYTES) throw new Error("A new file is too large for an automatic fix.");
        writes.push({ path, content: creates[0].content });
        continue;
      }
      const file = await getFileContent(ctx.githubToken, ctx.repoFullName, path, repo.defaultBranch);
      if (Buffer.byteLength(file.content, "utf8") > MAX_SOURCE_FILE_BYTES) throw new Error(`${path} is too large for an automatic fix. Make this change manually.`);
      const edits = changes.filter((c): c is Extract<FixChange, { type: "edit" }> => c.type === "edit" && c.path === path);
      const content = applyEditsToContent(file.content, edits);
      if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_FILE_BYTES) throw new Error(`${path} would be too large after this change.`);
      writes.push({ path, content, sha: file.sha });
    }

    const branch = branchNameFor(meta.label);
    await createBranch(ctx.githubToken, ctx.repoFullName, repo.defaultBranch, branch);
    for (const w of writes) {
      await putFileContent(ctx.githubToken, ctx.repoFullName, w.path, w.content, buildPrTitle(meta.label), branch, w.sha);
    }
    const prUrl = await createPullRequest(ctx.githubToken, ctx.repoFullName, buildPrTitle(meta.label), buildPrBody(meta, changes), branch, repo.defaultBranch);
    return { prUrl, branch, files: paths };
  }
}
