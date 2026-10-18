import test from "node:test";
import assert from "node:assert/strict";
import { ContentsApiFixProvider } from "../lib/domain/codefix/ContentsApiFixProvider.ts";
import { listOpenPullRequests } from "../lib/domain/codefix/githubApi.ts";
import { branchPrefixFor } from "../lib/domain/codefix/openPrPolicy.ts";
import type { CodeFixContext, FixChange } from "../lib/domain/codefix/types.ts";

const PAGE = `export default function Home() {\n  return (<html><head>\n<title>Hi</title>\n</head><body>Hello</body></html>);\n}\n`;
const ctx: CodeFixContext = { projectId: "p1", projectName: "Acme", projectUrl: "https://acme.com", repoFullName: "acme/site", githubToken: "ghs_fake" };
const CHANGES: FixChange[] = [
  { type: "edit", path: "app/page.tsx", oldSnippet: "<title>Hi</title>", newSnippet: "<title>Hi there</title>" },
  { type: "create", path: "public/llms.txt", content: "# Acme\n" },
];
const META = { findingId: "f1", label: "Missing JSON-LD and llms.txt", recommendation: "Add structured data.", pageUrl: "https://acme.com/", explanation: "Adds JSON-LD.", kinds: ["json_ld", "llms_txt"] as never };
const PR_URL = "https://github.com/acme/site/pull/7";

type Opts = {
  /** Path whose PUT fails (e.g. "public/llms.txt"). */
  failPut?: string;
  /** Status returned by POST /pulls. 201 means success. */
  prStatus?: number;
  /** Open PRs returned by GET /pulls, or "fail" to make the listing error. */
  openPulls?: Array<{ html_url: string; head: { ref: string; repo?: { full_name: string } | null } }> | "fail";
  /** Status returned by DELETE on a branch. */
  deleteStatus?: number;
};

/** In-memory GitHub for the write path only. Records every request and which branches exist. */
function fakeGithub(opts: Opts = {}) {
  const requests: Array<{ method: string; path: string; search: string; body?: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const branches = new Set<string>();
  const files: Record<string, string> = { "app/page.tsx": PAGE };
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/repos/acme/site", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path, search: url.search, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === "") return json({ default_branch: "main", full_name: "acme/site" });
    if (path === "/git/ref/heads/main") return json({ object: { sha: "base-sha" } });
    if (path === "/git/refs" && method === "POST") {
      branches.add(String(body.ref).replace("refs/heads/", ""));
      return json({}, 201);
    }
    if (path.startsWith("/git/refs/heads/") && method === "DELETE") {
      if (opts.deleteStatus && opts.deleteStatus !== 204) return json({}, opts.deleteStatus);
      branches.delete(path.slice("/git/refs/heads/".length));
      return new Response(null, { status: 204 });
    }
    if (path.startsWith("/contents/") && method === "GET") {
      const p = path.slice("/contents/".length);
      if (p in files) return json({ encoding: "base64", content: Buffer.from(files[p]).toString("base64"), sha: `sha-${p}` });
      return json({ message: "Not Found" }, 404);
    }
    if (path.startsWith("/contents/") && method === "PUT") {
      const p = path.slice("/contents/".length);
      if (opts.failPut === p) return json({ message: "boom" }, 500);
      files[p] = Buffer.from(body.content, "base64").toString("utf8");
      return json({}, 201);
    }
    if (path === "/pulls" && method === "GET") {
      if (opts.openPulls === "fail") return json({ message: "boom" }, 502);
      return json(opts.openPulls ?? []);
    }
    if (path === "/pulls" && method === "POST") {
      return opts.prStatus && opts.prStatus !== 201 ? json({ message: "Validation Failed" }, opts.prStatus) : json({ html_url: PR_URL }, 201);
    }
    return json({ message: "unexpected" }, 500);
  }) as typeof fetch;
  return {
    requests,
    branches,
    deletes: () => requests.filter((r) => r.method === "DELETE"),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const provider = () => new ContentsApiFixProvider(async () => ({ text: "" }) as never, "k", "m");

test("a commit that fails mid-way deletes the new branch and rethrows the original error", async () => {
  const gh = fakeGithub({ failPut: "public/llms.txt" });
  try {
    await assert.rejects(provider().applyCatalogFix(CHANGES, ctx, META), /Couldn't commit public\/llms.txt: HTTP 500/);
    assert.equal(gh.deletes().length, 1);
    assert.equal(gh.branches.size, 0, "the orphan branch is gone");
    assert.equal(gh.requests.some((r) => r.method === "POST" && r.path === "/pulls"), false, "no PR was attempted");
  } finally { gh.restore(); }
});

test("a createPullRequest failure with no open PR on the branch deletes the branch and rethrows", async () => {
  const gh = fakeGithub({ prStatus: 422, openPulls: [] });
  try {
    await assert.rejects(provider().applyCatalogFix(CHANGES, ctx, META), /Couldn't open PR: HTTP 422/);
    assert.equal(gh.deletes().length, 1);
    assert.equal(gh.branches.size, 0);
  } finally { gh.restore(); }
});

test("a createPullRequest failure after GitHub accepted the PR returns that PR and keeps the branch", async () => {
  let branch = "";
  const gh = fakeGithub({ prStatus: 500, openPulls: [] });
  try {
    // Simulate GitHub having created the PR before the response failed: list it under the branch the provider made.
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/pulls") && (init?.method ?? "GET") === "GET") {
        branch = [...gh.branches][0];
        return new Response(JSON.stringify([{ html_url: PR_URL, head: { ref: branch, repo: { full_name: "acme/site" } } }]), { status: 200 });
      }
      return original(input, init);
    }) as typeof fetch;
    const res = await provider().applyCatalogFix(CHANGES, ctx, META);
    assert.equal(res.prUrl, PR_URL);
    assert.equal(res.branch, branch);
    assert.deepEqual(gh.deletes(), [], "the branch that holds the PR is not deleted");
  } finally { gh.restore(); }
});

test("when the open-PR lookup itself fails, the branch is kept and the original error is thrown", async () => {
  const gh = fakeGithub({ prStatus: 500, openPulls: "fail" });
  try {
    await assert.rejects(provider().applyCatalogFix(CHANGES, ctx, META), /Couldn't open PR: HTTP 500/);
    assert.deepEqual(gh.deletes(), []);
  } finally { gh.restore(); }
});

test("a failing branch delete during cleanup never masks the error that caused it", async () => {
  const gh = fakeGithub({ failPut: "public/llms.txt", deleteStatus: 500 });
  try {
    await assert.rejects(provider().applyCatalogFix(CHANGES, ctx, META), /Couldn't commit public\/llms.txt: HTTP 500/);
    assert.equal(gh.deletes().length, 1, "the cleanup was attempted");
  } finally { gh.restore(); }
});

test("a successful apply deletes nothing", async () => {
  const gh = fakeGithub();
  try {
    const res = await provider().applyCatalogFix(CHANGES, ctx, META);
    assert.equal(res.prUrl, PR_URL);
    assert.deepEqual(res.files, ["app/page.tsx", "public/llms.txt"]);
    assert.deepEqual(gh.deletes(), []);
    assert.equal(gh.branches.size, 1);
  } finally { gh.restore(); }
});

test("a timeout-like createPullRequest failure (5xx) keeps the branch even when the exact-head lookup finds no PR", async () => {
  const gh = fakeGithub({ prStatus: 500, openPulls: [] });
  try {
    await assert.rejects(provider().applyCatalogFix(CHANGES, ctx, META), /Couldn't open PR: HTTP 500/);
    assert.deepEqual(gh.deletes(), [], "not a definite refusal, so the branch may still back a PR");
  } finally { gh.restore(); }
});

test("rate limits (429) are not a definite refusal either", async () => {
  const gh = fakeGithub({ prStatus: 429, openPulls: [] });
  try {
    await assert.rejects(provider().applyCatalogFix(CHANGES, ctx, META));
    assert.deepEqual(gh.deletes(), []);
  } finally { gh.restore(); }
});

test("the branch carries the finding tag, and cleanup looks the PR up by exact head", async () => {
  const gh = fakeGithub({ prStatus: 422, openPulls: [] });
  try {
    await assert.rejects(provider().applyCatalogFix(CHANGES, ctx, META));
    const branch = String(gh.requests.find((r) => r.path === "/git/refs" && r.method === "POST")!.body.ref).replace("refs/heads/", "");
    assert.ok(branch.startsWith(branchPrefixFor(META.label, META.findingId)), branch);
    const lookup = gh.requests.find((r) => r.path === "/pulls" && r.method === "GET")!;
    assert.equal(new URL("https://x/" + lookup.search).searchParams.get("head"), "acme:" + branch);
    assert.equal(gh.deletes().length, 1, "422 is a definite refusal");
  } finally { gh.restore(); }
});

test("listOpenPullRequests pages through results and ignores fork PRs", async () => {
  const original = globalThis.fetch;
  const pages: string[] = [];
  const mk = (n: number, repo: string) => ({ html_url: "https://github.com/acme/site/pull/" + n, head: { ref: "b" + n, repo: { full_name: repo } } });
  globalThis.fetch = (async (input: string | URL) => {
    const u = new URL(String(input));
    const page = Number(u.searchParams.get("page"));
    pages.push(String(page));
    const rows = page === 1
      ? Array.from({ length: 100 }, (_, i) => mk(i + 1, i === 0 ? "evil/site" : "acme/site"))
      : [mk(500, "ACME/site"), { html_url: "https://github.com/acme/site/pull/501", head: { ref: "gone", repo: null } }];
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
  try {
    const prs = await listOpenPullRequests("t", "acme/site");
    assert.deepEqual(pages, ["1", "2"]);
    assert.equal(prs.length, 100, "99 same-repo from page 1 plus 1 from page 2; fork and deleted-fork rows dropped");
    assert.equal(prs.some((p) => p.headRef === "b1"), false);
    assert.equal(prs.some((p) => p.headRef === "b500"), true);
  } finally { globalThis.fetch = original; }
});
