/** Real GitHub REST API — raw fetch, no octokit (matches this codebase's
 * convention elsewhere: Gmail, Places, PageSpeed are all raw fetch too).
 * API contracts verified against real GitHub docs before writing this. */

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

async function githubFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers(token), ...(init?.headers ?? {}) } });
  return res;
}

export type GitHubRepo = { defaultBranch: string; fullName: string };

/** Validates the token + repo are real and accessible — used both by the
 * Settings card (save-time check) and the fix agent (before touching files). */
export async function getRepo(token: string, repoFullName: string): Promise<GitHubRepo> {
  const res = await githubFetch(token, `/repos/${repoFullName}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Repo "${repoFullName}" not found, or this token can't see it.`);
    if (res.status === 401) throw new Error("GitHub token was rejected — check it's valid and not expired.");
    throw new Error(`GitHub repo check failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return { defaultBranch: data.default_branch, fullName: data.full_name };
}

export type CodeSearchResult = { path: string };

/** Real GitHub Code Search — finds the file most likely to render a given
 * URL path, grounded in an actual search rather than guessed. Only searches
 * the default branch, files <384KB — real API limits, not ours. */
export async function searchCode(token: string, repoFullName: string, query: string): Promise<CodeSearchResult[]> {
  const q = encodeURIComponent(`${query} repo:${repoFullName}`);
  const res = await githubFetch(token, `/search/code?q=${q}&per_page=10`);
  if (!res.ok) {
    throw new Error(`GitHub code search failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.items ?? []).map((item: { path: string }) => ({ path: item.path }));
}

export type FileContent = { content: string; sha: string };

export async function getFileContent(token: string, repoFullName: string, path: string, ref?: string): Promise<FileContent> {
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await githubFetch(token, `/repos/${repoFullName}/contents/${path}${suffix}`);
  if (!res.ok) {
    throw new Error(`Couldn't read ${path} from ${repoFullName}: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.encoding !== "base64") throw new Error(`Unexpected encoding for ${path}: ${data.encoding}`);
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
}

/** True when a file or folder exists at `path` on `ref` (404 means no; anything else unexpected throws). */
export async function pathExists(token: string, repoFullName: string, path: string, ref?: string): Promise<boolean> {
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await githubFetch(token, `/repos/${repoFullName}/contents/${path}${suffix}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Couldn't check ${path} in ${repoFullName}: HTTP ${res.status}`);
  return true;
}

export type OpenPullRequestSummary = { url: string; headRef: string };

/** Open PRs in the repo, newest first (first page of 100). Used to find a PR a fix already opened. */
export async function listOpenPullRequests(token: string, repoFullName: string): Promise<OpenPullRequestSummary[]> {
  const res = await githubFetch(token, `/repos/${repoFullName}/pulls?state=open&per_page=100`);
  if (!res.ok) throw new Error(`Couldn't list pull requests: HTTP ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .map((pr: { html_url?: unknown; head?: { ref?: unknown } }) => ({ url: String(pr.html_url ?? ""), headRef: String(pr.head?.ref ?? "") }))
    .filter((pr: OpenPullRequestSummary) => pr.url !== "" && pr.headRef !== "");
}

/** Deletes a branch. Deleting a branch that is already gone counts as deleted. */
export async function deleteBranch(token: string, repoFullName: string, branch: string): Promise<void> {
  const res = await githubFetch(token, `/repos/${repoFullName}/git/refs/heads/${branch}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Couldn't delete branch "${branch}": HTTP ${res.status}`);
}

async function getRefSha(token: string, repoFullName: string, branch: string): Promise<string> {
  const res = await githubFetch(token, `/repos/${repoFullName}/git/ref/heads/${branch}`);
  if (!res.ok) throw new Error(`Couldn't read branch "${branch}": HTTP ${res.status}`);
  const data = await res.json();
  return data.object.sha;
}

/** Creates a new branch off the repo's default branch — returns the branch
 * name so callers don't need to re-derive it. */
export async function createBranch(token: string, repoFullName: string, baseBranch: string, newBranch: string): Promise<void> {
  const sha = await getRefSha(token, repoFullName, baseBranch);
  const res = await githubFetch(token, `/repos/${repoFullName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha }),
  });
  if (!res.ok) {
    throw new Error(`Couldn't create branch "${newBranch}": HTTP ${res.status}`);
  }
}

export async function putFileContent(
  token: string,
  repoFullName: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<void> {
  const res = await githubFetch(token, `/repos/${repoFullName}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch, sha }),
  });
  if (!res.ok) {
    throw new Error(`Couldn't commit ${path}: HTTP ${res.status}`);
  }
}

export async function createPullRequest(
  token: string,
  repoFullName: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<string> {
  let res = await githubFetch(token, `/repos/${repoFullName}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, body, head, base, draft: true }),
  });
  if (res.status === 422) {
    // Some plans/repos don't support draft PRs; a normal PR is still human-merge-only.
    const detail = await res.clone().text().catch(() => "");
    if (/draft/i.test(detail)) {
      res = await githubFetch(token, `/repos/${repoFullName}/pulls`, { method: "POST", body: JSON.stringify({ title, body, head, base }) });
    }
  }
  if (!res.ok) {
    throw new Error(`Couldn't open PR: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.html_url;
}
