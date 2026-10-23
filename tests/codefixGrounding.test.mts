import test from "node:test";
import assert from "node:assert/strict";
import {
  FixBlockedError,
  checkEditSafety,
  findCurrentText,
  groundInFile,
  groundingCandidates,
  hasUseClient,
  locateMetadataDeclaration,
} from "../lib/domain/codefix/grounding.ts";
import { scoreRepoMatch, siteIdentityOf, readRepoEvidence } from "../lib/domain/codefix/repoMatch.ts";
import { ContentsApiFixProvider } from "../lib/domain/codefix/ContentsApiFixProvider.ts";
import type { CatalogFixInput, CodeFixContext } from "../lib/domain/codefix/types.ts";

const LONG = "Marlo helps small teams find, fix and track every SEO problem on their site, with plain-language findings, one-click pull requests, and honest progress reports for the whole team to read.";
assert.equal(LONG.length > 100, true);

const ROOT_INDEX = `export default function RootIndex() {\n  return <main>Hello</main>;\n}\n`;
const WITH_METADATA = `import type { Metadata } from "next";\n\nexport const metadata: Metadata = {\n  title: "Acme",\n  description: ${JSON.stringify(LONG)},\n};\n\nexport default function Page() {\n  return <main />;\n}\n`;
const CLIENT_PAGE = `"use client";\nimport { useState } from "react";\nexport default function Page() {\n  const [n] = useState(0);\n  return <main>{n}</main>;\n}\n`;
const HEAD_TAG = `export default function Page() {\n  return (<html><head>\n<meta name="description" content="${LONG}" />\n</head></html>);\n}\n`;

type Row = { name: string; content: string; evidence: Record<string, unknown>; expect: string };
const rows: Row[] = [
  { name: "exact current text in a metadata object", content: WITH_METADATA, evidence: { current: LONG }, expect: "exact" },
  { name: "exact current text in a meta tag", content: HEAD_TAG, evidence: { current: LONG }, expect: "exact" },
  { name: "text differs from the live value but a description declaration exists", content: WITH_METADATA, evidence: { current: "Some other live description that is not in the source file at all." }, expect: "declaration" },
  { name: "text differs but a meta description tag exists", content: HEAD_TAG, evidence: { current: "Totally different live text that never appears in this file." }, expect: "declaration" },
  { name: "production bug: file has no description anywhere", content: ROOT_INDEX, evidence: { current: LONG }, expect: "not_found" },
  { name: "client component without any description", content: CLIENT_PAGE, evidence: { current: LONG }, expect: "not_found" },
  { name: "missing tag (no current value) inserts", content: ROOT_INDEX, evidence: { current: null }, expect: "insert" },
];

for (const r of rows) {
  test(`grounding: ${r.name}`, () => {
    const out = groundInFile({ kinds: ["meta_description"], evidence: r.evidence, content: r.content });
    assert.equal(out.status, r.expect);
    if (out.status === "exact") assert.ok(r.content.includes(out.anchor));
    if (out.status === "declaration") assert.ok(r.content.includes(out.anchor));
  });
}

test("a description property outside the metadata object is not a declaration", () => {
  const content = `const card = { description: "A card, not page metadata" };\nexport default function P() { return null; }\n`;
  assert.equal(locateMetadataDeclaration(content, ["meta_description"]), null);
});

test("current text is found through whitespace and escaping differences", () => {
  assert.equal(findCurrentText(`<p>Fish &amp; chips are great</p>`, "Fish & chips are great"), "Fish &amp; chips are great");
  assert.equal(findCurrentText(`description: "He said \\"hi\\" twice"`, `He said "hi" twice`), `He said \\"hi\\" twice`);
  assert.ok(findCurrentText("<p>One two\n      three four</p>", "One two three four"));
  assert.equal(findCurrentText("nothing relevant", "One two three"), null);
});

test("grounding candidates: page, then its layout and the root layout", () => {
  assert.deepEqual(groundingCandidates("src/app/about/page.tsx"), ["src/app/about/page.tsx", "src/app/about/layout.tsx", "src/app/layout.tsx"]);
  assert.deepEqual(groundingCandidates("pages/index.tsx"), ["pages/index.tsx"]);
});

const safetyRows: { name: string; content: string; newSnippet: string; oldSnippet: string; ok: boolean; reason?: string }[] = [
  { name: "inserting metadata into a plain server file", content: ROOT_INDEX, oldSnippet: "export default function RootIndex() {", newSnippet: 'export const metadata = { description: "x" };\nexport default function RootIndex() {', ok: true },
  { name: "inserting metadata into a use client file", content: CLIENT_PAGE, oldSnippet: "export default function Page() {", newSnippet: 'export const metadata = { description: "x" };\nexport default function Page() {', ok: false, reason: "use_client" },
  { name: "single-quoted use client directive after a comment", content: `// header\n'use client'\nexport default function P() { return null }\n`, oldSnippet: "export default", newSnippet: 'export const metadata = {};\nexport default', ok: false, reason: "use_client" },
  { name: "second metadata export", content: WITH_METADATA, oldSnippet: "export default function Page() {", newSnippet: 'export const metadata = { description: "x" };\nexport default function Page() {', ok: false, reason: "existing_metadata" },
  { name: "generateMetadata already exported", content: `export async function generateMetadata() { return {}; }\nexport default function P() { return null }\n`, oldSnippet: "export default", newSnippet: 'export const metadata = {};\nexport default', ok: false, reason: "existing_metadata" },
  { name: "editing the existing description is fine", content: WITH_METADATA, oldSnippet: `description: ${JSON.stringify(LONG)}`, newSnippet: 'description: "Short and sweet."', ok: true },
  { name: "editing a string inside a client file is fine", content: CLIENT_PAGE, oldSnippet: "<main>", newSnippet: "<main id='x'>", ok: true },
];
for (const r of safetyRows) {
  test(`build safety: ${r.name}`, () => {
    const out = checkEditSafety(r.content, { oldSnippet: r.oldSnippet, newSnippet: r.newSnippet });
    assert.equal(out.ok, r.ok);
    if (!out.ok) assert.equal(out.reason, r.reason);
  });
}

test("hasUseClient ignores the words inside later code", () => {
  assert.equal(hasUseClient(`import x from "y";\nconst s = "use client";\n`), false);
});

/* -- repo / site match ---------------------------------------------- */

const site = siteIdentityOf("https://home.mlforge.in", "MLForge Home");

test("site identity: host, root domain and brand tokens", () => {
  assert.equal(site.host, "home.mlforge.in");
  assert.equal(site.rootDomain, "mlforge.in");
  assert.ok(site.brandTokens.includes("mlforge"));
  assert.equal(siteIdentityOf("https://www.shop.example.co.uk/x", "Example Shop").rootDomain, "example.co.uk");
});

const matchRows: { name: string; repo: Parameters<typeof scoreRepoMatch>[1]; positive: boolean }[] = [
  { name: "the Marlo app repo for the mlforge site: nothing links them", repo: { fullName: "Kumar2421/marlo", description: "SEO assistant", readme: "# Marlo\nAn app.", packageName: "marlo", packageHomepage: null }, positive: false },
  { name: "repo name contains the brand", repo: { fullName: "Kumar2421/mlforge-site" }, positive: true },
  { name: "package.json homepage is the site", repo: { fullName: "Kumar2421/company-site", packageName: "company-site", packageHomepage: "https://home.mlforge.in" }, positive: true },
  { name: "README mentions the host", repo: { fullName: "Kumar2421/company-site", readme: "Source for https://home.mlforge.in" }, positive: true },
  { name: "GitHub homepage field is the root domain", repo: { fullName: "Kumar2421/company-site", homepage: "https://mlforge.in" }, positive: true },
  { name: "the finding's text is in the repo", repo: { fullName: "Kumar2421/anything", foundCurrentText: true }, positive: true },
  { name: "empty evidence", repo: { fullName: "Kumar2421/anything" }, positive: false },
];
for (const r of matchRows) {
  test(`repo match: ${r.name}`, () => {
    const { score } = scoreRepoMatch(site, r.repo);
    assert.equal(score > 0, r.positive, `score ${score}`);
  });
}

test("repo evidence reads only README.md and package.json, and fails closed", async () => {
  const reads: string[] = [];
  const ev = await readRepoEvidence({ fullName: "a/b" }, {
    readFile: async (p) => {
      reads.push(p);
      return p === "package.json" ? '{"name":"mlforge","homepage":"https://mlforge.in"}' : null;
    },
  });
  assert.deepEqual(reads.sort(), ["README.md", "package.json"]);
  assert.equal(ev.packageName, "mlforge");
  await assert.rejects(readRepoEvidence({ fullName: "a/b" }, { readFile: async () => { throw new Error("HTTP 502"); } }), /502/);
  await assert.rejects(readRepoEvidence({ fullName: "a/b" }, { readFile: () => new Promise(() => {}) }, 20), /took too long/);
});

/* -- provider: fake GitHub, fake model ------------------------------ */

function fakeGithub(repo: string, files: Record<string, string>, opts: { failWith?: number } = {}) {
  const requests: { method: string; path: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(`/repos/${repo}`, "");
    requests.push({ method, path });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (opts.failWith) return json({}, opts.failWith);
    if (path === "") return json({ default_branch: "main", full_name: repo, description: null, homepage: null });
    if (path.startsWith("/contents/") && method === "GET") {
      const p = path.slice("/contents/".length);
      if (p in files) return json({ encoding: "base64", content: Buffer.from(files[p]).toString("base64"), sha: `sha-${p}` });
      return json({ message: "Not Found" }, 404);
    }
    return json({}, 404);
  }) as typeof fetch;
  return { requests, restore: () => { globalThis.fetch = original; } };
}

const ctx = (over: Partial<CodeFixContext> = {}): CodeFixContext => ({
  projectId: "p", projectName: "MLForge Home", projectUrl: "https://home.mlforge.in", repoFullName: "Kumar2421/marlo", githubToken: "ghs_fake", ...over,
});
const input = (over: Partial<CatalogFixInput> = {}): CatalogFixInput => ({
  findingId: "f1", label: "Meta description", kinds: ["meta_description"], recommendation: "Shorten it.", evidence: { current: LONG, length: LONG.length }, pageUrl: "https://home.mlforge.in/", ...over,
});
function spyLlm(text = "") {
  const calls: unknown[] = [];
  return { calls, driver: (async (req: unknown) => { calls.push(req); return { text }; }) as never };
}
const editReply = (path: string, oldS: string, newS: string) => `EDIT: ${path}\nOLD:\n<<<\n${oldS}\n>>>\nNEW:\n<<<\n${newS}\n>>>\nEXPLANATION: Shortens the description.`;
const MARLO_FILES = { "src/app/page.tsx": ROOT_INDEX, "package.json": '{"name":"marlo"}', "README.md": "# Marlo\nThe app." };

test("production bug: text not in the repo file -> honest not-found, the model is never called", async () => {
  const gh = fakeGithub("Kumar2421/marlo", MARLO_FILES);
  const llm = spyLlm(editReply("src/app/page.tsx", "export default function RootIndex() {", 'export const metadata = { description: "new" };\nexport default function RootIndex() {'));
  try {
    const provider = new ContentsApiFixProvider(llm.driver, "k", "m");
    const err = await provider.proposeCatalogFix(input(), ctx()).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof FixBlockedError);
    assert.equal(err.blocked.kind, "not_found");
    if (err.blocked.kind !== "not_found") throw new Error("unreachable");
    assert.equal(err.blocked.message, "We couldn't find this text in Kumar2421/marlo.");
    assert.deepEqual(err.blocked.filesSearched, ["src/app/page.tsx"]);
    assert.equal(err.blocked.repoLooksWrong, true);
    assert.equal(err.blocked.host, "home.mlforge.in");
    assert.equal(llm.calls.length, 0, "no model call");
    assert.deepEqual(gh.requests.filter((r) => r.method !== "GET"), [], "read-only");
  } finally { gh.restore(); }
});

test("found text in the right repo: the draft replaces the real current text", async () => {
  const files = { "src/app/page.tsx": WITH_METADATA, "package.json": '{"name":"mlforge-site"}' };
  const gh = fakeGithub("Kumar2421/company-site", files);
  const llm = spyLlm(editReply("src/app/page.tsx", `description: ${JSON.stringify(LONG)}`, 'description: "Find, fix and track SEO problems."'));
  try {
    const provider = new ContentsApiFixProvider(llm.driver, "k", "m");
    const proposal = await provider.proposeCatalogFix(input(), ctx({ repoFullName: "Kumar2421/company-site" }));
    assert.equal(proposal.grounding, "exact");
    const change = proposal.changes[0];
    assert.equal(change.type, "edit");
    if (change.type === "edit") assert.ok(WITH_METADATA.includes(change.oldSnippet), "old text is the real file text");
    assert.equal(llm.calls.length, 1);
    // exact hit proves the repo, so no extra evidence reads
    assert.equal(gh.requests.some((r) => r.path === "/contents/README.md"), false);
  } finally { gh.restore(); }
});

test("a draft that doesn't touch the finding's text is rejected", async () => {
  const gh = fakeGithub("Kumar2421/company-site", { "src/app/page.tsx": WITH_METADATA });
  const llm = spyLlm(editReply("src/app/page.tsx", "export default function Page() {", "export default function Page2() {"));
  try {
    const provider = new ContentsApiFixProvider(llm.driver, "k", "m");
    await assert.rejects(provider.proposeCatalogFix(input(), ctx({ repoFullName: "Kumar2421/company-site" })), /didn't replace the text/);
  } finally { gh.restore(); }
});

test("existing metadata (description differs from live): edits the declaration, refuses a second export", async () => {
  const content = WITH_METADATA.replace(JSON.stringify(LONG), '"An older description"');
  const files = { "src/app/page.tsx": content, "package.json": '{"name":"mlforge-site"}' };
  const gh = fakeGithub("Kumar2421/company-site", files);
  try {
    const good = new ContentsApiFixProvider(spyLlm(editReply("src/app/page.tsx", 'description: "An older description"', 'description: "Short."')).driver, "k", "m");
    const proposal = await good.proposeCatalogFix(input(), ctx({ repoFullName: "Kumar2421/company-site" }));
    assert.equal(proposal.grounding, "declaration");
    const bad = new ContentsApiFixProvider(spyLlm(editReply("src/app/page.tsx", 'description: "An older description"', 'description: "x",\n};\nexport const metadata2 = {}\nexport const metadata = {')).driver, "k", "m");
    await assert.rejects(bad.proposeCatalogFix(input(), ctx({ repoFullName: "Kumar2421/company-site" })), (e: unknown) => e instanceof FixBlockedError && e.blocked.kind === "unsafe");
  } finally { gh.restore(); }
});

test("missing description in a use client file: inserting a metadata export is refused", async () => {
  const files = { "src/app/page.tsx": CLIENT_PAGE, "package.json": '{"name":"mlforge-site"}' };
  const gh = fakeGithub("Kumar2421/company-site", files);
  const reply = editReply("src/app/page.tsx", "export default function Page() {", 'export const metadata = { description: "x" };\nexport default function Page() {');
  try {
    const provider = new ContentsApiFixProvider(spyLlm(reply).driver, "k", "m");
    const err = await provider.proposeCatalogFix(input({ evidence: { current: null } }), ctx({ repoFullName: "Kumar2421/company-site" })).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof FixBlockedError);
    assert.equal(err.blocked.kind, "unsafe");
    if (err.blocked.kind === "unsafe") assert.equal(err.blocked.reason, "use_client");
  } finally { gh.restore(); }
});

test("repo mismatch: a missing tag in an unrelated repo needs an explicit confirmation", async () => {
  const gh = fakeGithub("Kumar2421/marlo", MARLO_FILES);
  const reply = editReply("src/app/page.tsx", "export default function RootIndex() {", 'export const metadata = { description: "x" };\nexport default function RootIndex() {');
  try {
    const llm = spyLlm(reply);
    const provider = new ContentsApiFixProvider(llm.driver, "k", "m");
    const err = await provider.proposeCatalogFix(input({ evidence: { current: null } }), ctx()).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof FixBlockedError);
    assert.equal(err.blocked.kind, "repo_mismatch");
    assert.equal(err.blocked.message, "This repo doesn't appear to contain home.mlforge.in.");
    assert.equal(llm.calls.length, 0, "no model call before the user confirms");
    const confirmed = await provider.proposeCatalogFix(input({ evidence: { current: null }, confirmRepoMismatch: true }), ctx());
    assert.equal(confirmed.changes.length, 1);
  } finally { gh.restore(); }
});

test("fail closed: GitHub unreachable while reading evidence stops the fix", async () => {
  const gh = fakeGithub("Kumar2421/marlo", MARLO_FILES, { failWith: 503 });
  try {
    const llm = spyLlm("");
    const provider = new ContentsApiFixProvider(llm.driver, "k", "m");
    await assert.rejects(provider.proposeCatalogFix(input(), ctx()), /503/);
    assert.equal(llm.calls.length, 0);
  } finally { gh.restore(); }
});
