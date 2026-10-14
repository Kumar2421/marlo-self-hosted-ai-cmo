import test from "node:test";
import assert from "node:assert/strict";
import { ContentsApiFixProvider } from "../lib/domain/codefix/ContentsApiFixProvider.ts";
import { buildPrBody, parseClientChanges, parseCatalogResponse, validateProposal } from "../lib/domain/codefix/catalogFix.ts";
import type { CatalogFixInput, CodeFixContext } from "../lib/domain/codefix/types.ts";

const PAGE = `export default function Home() {\n  return (<html><head>\n<title>Hi</title>\n</head><body>Hello</body></html>);\n}\n`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Req = { method: string; path: string; body?: any };

/** In-memory GitHub: files on main, and a record of every write. */
function fakeGithub(files: Record<string, string>, codeSearchPaths: string[] = []) {
  const requests: Req[] = [];
  const branches = new Map<string, Record<string, string>>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/repos/acme/site", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === "") return json({ default_branch: "main", full_name: "acme/site" });
    if (path.startsWith("/contents/") && method === "GET") {
      const p = path.slice("/contents/".length);
      const ref = url.searchParams.get("ref") ?? "main";
      const tree = ref === "main" ? files : (branches.get(ref) ?? files);
      if (p === "public" && Object.keys(tree).some((k) => k.startsWith("public/"))) return json([{ name: "robots.txt" }]);
      if (p in tree) return json({ encoding: "base64", content: Buffer.from(tree[p]).toString("base64"), sha: `sha-${p}` });
      return json({ message: "Not Found" }, 404);
    }
    if (path === "/git/ref/heads/main") return json({ object: { sha: "base-sha" } });
    if (path === "/git/refs" && method === "POST") {
      branches.set(String(body.ref).replace("refs/heads/", ""), { ...files });
      return json({}, 201);
    }
    if (path.startsWith("/contents/") && method === "PUT") {
      const p = path.slice("/contents/".length);
      const exists = p in files;
      if (exists && !body.sha) return json({ message: "sha required" }, 422);
      const b = branches.get(body.branch)!;
      b[p] = Buffer.from(body.content, "base64").toString("utf8");
      return json({}, 201);
    }
    if (path === "/search/code") return json({ items: codeSearchPaths.map((p) => ({ path: p })) });
    if (path === "/pulls" && method === "POST") return json({ html_url: "https://github.com/acme/site/pull/7" }, 201);
    return json({}, 404);
  }) as typeof fetch;
  return { requests, branches, restore: () => { globalThis.fetch = original; } };
}

const ctx: CodeFixContext = { projectId: "p1", projectName: "Acme", projectUrl: "https://acme.com", repoFullName: "acme/site", githubToken: "ghs_fake" };
const input: CatalogFixInput = {
  findingId: "f1", label: "Missing JSON-LD and llms.txt", kinds: ["json_ld", "llms_txt"],
  recommendation: "Add structured data and an llms.txt.", evidence: { url: "https://acme.com" }, pageUrl: "https://acme.com/",
};

const LLM_REPLY = `EDIT: app/page.tsx
OLD:
<<<
</head>
>>>
NEW:
<<<
<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
</head>
>>>
CREATE: public/llms.txt
<<<
# Acme
> Acme builds things.
>>>
EXPLANATION: Adds Organization JSON-LD and an llms.txt so AI assistants can describe Acme accurately.`;

const llm = (text: string) => async () => ({ text } as never);

// A reply that only edits the pricing page (no new files), for the page-lookup tests.
const PRICING_REPLY = LLM_REPLY.replace("EDIT: app/page.tsx", "EDIT: app/pricing/page.tsx").replace(/CREATE: public\/llms\.txt\n<<<\n[\s\S]*?\n>>>\n/, "");
const pricingInput: CatalogFixInput = { ...input, kinds: ["json_ld"], pageUrl: "https://acme.com/pricing" };

test("a page is never edited just because an unrelated search hit came first", async () => {
  const gh = fakeGithub({ "lib/util.ts": "export const x = 1;\n", "app/page.tsx": PAGE }, ["lib/util.ts"]);
  try {
    const provider = new ContentsApiFixProvider(llm(PRICING_REPLY), "k", "m");
    await assert.rejects(provider.proposeCatalogFix(pricingInput, ctx), /Couldn't find a file Marlo may edit for "\/pricing"/);
    assert.deepEqual(gh.requests.filter((r) => r.method !== "GET"), [], "nothing written");
  } finally { gh.restore(); }
});

test("a search hit that names the page segment is the file that gets proposed", async () => {
  const gh = fakeGithub({ "app/pricing/page.tsx": PAGE, "lib/util.ts": "export const x = 1;\n" }, ["lib/util.ts", "app/pricing/page.tsx"]);
  try {
    const provider = new ContentsApiFixProvider(llm(PRICING_REPLY), "k", "m");
    const proposal = await provider.proposeCatalogFix(pricingInput, ctx);
    assert.deepEqual(proposal.changes.map((c) => c.path), ["app/pricing/page.tsx"]);
  } finally { gh.restore(); }
});

test("propose is preview-only: reads the repo, writes nothing", async () => {
  const gh = fakeGithub({ "app/page.tsx": PAGE, "public/robots.txt": "User-agent: *" });
  try {
    const provider = new ContentsApiFixProvider(llm(LLM_REPLY), "k", "m");
    const proposal = await provider.proposeCatalogFix(input, ctx);
    assert.equal(proposal.changes.length, 2);
    assert.deepEqual(proposal.changes.map((c) => c.path), ["app/page.tsx", "public/llms.txt"]);
    assert.match(proposal.explanation, /JSON-LD/);
    assert.deepEqual(gh.requests.filter((r) => r.method !== "GET"), [], "no branch, commit or PR before approval");
  } finally { gh.restore(); }
});

test("apply writes both files to one branch and opens a single PR against main", async () => {
  const gh = fakeGithub({ "app/page.tsx": PAGE, "public/robots.txt": "User-agent: *" });
  try {
    const provider = new ContentsApiFixProvider(llm(LLM_REPLY), "k", "m");
    const proposal = await provider.proposeCatalogFix(input, ctx);
    // The user edits the reviewed copy before approving.
    const edited = proposal.changes.map((c) => (c.type === "create" ? { ...c, content: c.content + "> Edited by user.\n" } : c));
    const res = await provider.applyCatalogFix(edited, ctx, {
      findingId: "f1", label: input.label, recommendation: input.recommendation, pageUrl: input.pageUrl, explanation: proposal.explanation, kinds: input.kinds,
    });
    assert.equal(res.prUrl, "https://github.com/acme/site/pull/7");
    assert.deepEqual(res.files, ["app/page.tsx", "public/llms.txt"]);
    assert.match(res.branch, /^marlo\/missing-json-ld-and-llms-txt-/);
    const writes = gh.requests.filter((r) => r.method === "PUT");
    assert.equal(writes.length, 2);
    assert.ok(writes.every((w) => w.body.branch === res.branch));
    const branch = gh.branches.get(res.branch)!;
    assert.match(branch["app/page.tsx"], /application\/ld\+json/);
    assert.match(branch["public/llms.txt"], /Edited by user/);
    const pr = gh.requests.find((r) => r.path === "/pulls")!;
    assert.equal(pr.body.base, "main");
    assert.equal(pr.body.head, res.branch);
    assert.match(pr.body.body, /## What[\s\S]*## Why[\s\S]*## Files changed/);
    assert.match(pr.body.body, /`public\/llms.txt` \(new file\)/);
    assert.match(pr.body.body, /Marlo never merges/);
    assert.equal(gh.requests.some((r) => /merge/i.test(r.path)), false);
  } finally { gh.restore(); }
});

test("refuses to overwrite an existing llms.txt and oversized source files", async () => {
  let gh = fakeGithub({ "app/page.tsx": PAGE, "public/llms.txt": "already" });
  try {
    await assert.rejects(new ContentsApiFixProvider(llm(LLM_REPLY), "k", "m").proposeCatalogFix(input, ctx), /already exists/);
  } finally { gh.restore(); }
  gh = fakeGithub({ "app/page.tsx": "x".repeat(250_000) });
  try {
    await assert.rejects(new ContentsApiFixProvider(llm(LLM_REPLY), "k", "m").proposeCatalogFix({ ...input, kinds: ["json_ld"] }, ctx), /too large/);
  } finally { gh.restore(); }
});

test("a model reply that edits outside the plan or paraphrases the file is rejected", () => {
  const ctxV = { pagePath: "app/page.tsx", pageContent: PAGE, newFilePaths: ["public/llms.txt"] };
  const wrongFile = parseCatalogResponse(LLM_REPLY.replace("EDIT: app/page.tsx", "EDIT: package.json"));
  assert.throws(() => validateProposal(wrongFile, ctxV), /outside the plan/);
  const paraphrase = parseCatalogResponse(LLM_REPLY.replace("</head>\n>>>\nNEW", "</HEAD>\n>>>\nNEW"));
  assert.throws(() => validateProposal(paraphrase, ctxV), /match/);
  const wrongCreate = parseCatalogResponse(LLM_REPLY.replace("CREATE: public/llms.txt", "CREATE: .github/workflows/x.yml"));
  assert.throws(() => validateProposal(wrongCreate, ctxV), /outside the plan/);
  assert.throws(() => parseCatalogResponse("nonsense"), /parseable/);
});

test("browser-sent changes are checked against the files Marlo proposed", () => {
  const allowed = ["app/page.tsx", "public/llms.txt"];
  assert.equal(parseClientChanges([{ type: "edit", path: "app/page.tsx", oldSnippet: "a", newSnippet: "b" }], allowed).length, 1);
  assert.throws(() => parseClientChanges([{ type: "edit", path: "package.json", oldSnippet: "a", newSnippet: "b" }], allowed), /didn't propose/);
  assert.throws(() => parseClientChanges([{ type: "create", path: "../x", content: "y" }], ["../x"]), /didn't propose/);
  assert.throws(() => parseClientChanges([{ type: "create", path: "public/llms.txt", content: "  " }], allowed), /empty/);
  assert.throws(() => parseClientChanges([{ type: "create", path: "public/llms.txt", content: "x".repeat(70_000) }], allowed), /too large/);
  assert.throws(() => parseClientChanges("nope", allowed), /No changes/);
  const many = ["a", "b", "c", "d", "e"].map((n) => ({ type: "create", path: `public/${n}.txt`, content: "x" }));
  assert.throws(() => parseClientChanges(many, many.map((m) => m.path)), /at most/);
});

test("PR body links the finding and lists files", () => {
  const body = buildPrBody(
    { findingId: "f1", label: "Missing title", recommendation: "Add a title", pageUrl: "https://acme.com/", explanation: "Adds a title.", kinds: ["title"] },
    [{ type: "edit", path: "app/page.tsx", oldSnippet: "a", newSnippet: "b" }],
  );
  assert.match(body, /Missing title/);
  assert.match(body, /`f1`/);
  assert.match(body, /`app\/page.tsx`/);
});
