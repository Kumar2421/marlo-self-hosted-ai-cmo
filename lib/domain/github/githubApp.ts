import crypto from "node:crypto";
import { signPayload, verifyPayload } from "./signedPayload.ts";
import { safeReturnPath } from "./returnPath.ts";

export { safeReturnPath };

/**
 * GitHub App plumbing for the hosted "connect GitHub" flow. Marlo stores only the installation id
 * and the chosen repo; every API call mints a short-lived installation token that is never
 * persisted. Secrets (private key, client secret, tokens) never appear in errors or logs.
 */

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type GithubAppConfig = {
  appId: string;
  clientId: string;
  clientSecret: string;
  slug: string;
  privateKey: string;
};

export class InstallationGoneError extends Error {
  constructor() {
    super("The GitHub App installation no longer exists.");
    this.name = "InstallationGoneError";
  }
}

/** PEM keys often arrive from env files with literal \n sequences. */
export function normalizePrivateKey(raw: string): string {
  return raw.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

export function readGithubAppConfig(env: Record<string, string | undefined> = process.env): GithubAppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const slug = env.GITHUB_APP_SLUG?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY ? normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY) : "";
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim() ?? "";
  if (!appId || !slug || !privateKey) return null;
  return { appId, slug, privateKey, clientId, clientSecret };
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** RS256 JWT identifying the App itself (valid <10 minutes, per GitHub). */
export function createAppJwt(cfg: Pick<GithubAppConfig, "appId" | "privateKey">, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 9 * 60 + 60, iss: cfg.appId }));
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).sign(cfg.privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

export function installUrl(slug: string, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION };
}

export type InstallationToken = { token: string; expiresAt: string };

/** Mints a short-lived token for one installation (optionally narrowed to one repo). Never store the result. */
export async function mintInstallationToken(
  cfg: GithubAppConfig,
  installationId: number,
  opts: { fetch?: FetchLike; now?: number; repo?: string } = {},
): Promise<InstallationToken> {
  const f = opts.fetch ?? fetch;
  const body: Record<string, unknown> = { permissions: { contents: "write", pull_requests: "write", metadata: "read" } };
  if (opts.repo) body.repositories = [opts.repo.split("/").pop()];
  const res = await f(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { ...headers(createAppJwt(cfg, opts.now)), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 404) throw new InstallationGoneError();
  if (!res.ok) throw new Error(`GitHub could not issue an installation token: HTTP ${res.status}`);
  const data = (await res.json()) as { token?: string; expires_at?: string };
  if (!data.token) throw new Error("GitHub did not return an installation token.");
  return { token: data.token, expiresAt: data.expires_at ?? "" };
}

export type InstallationRepo = { fullName: string; defaultBranch: string; private: boolean };

export async function listInstallationRepos(token: string, f: FetchLike = fetch): Promise<InstallationRepo[]> {
  const repos: InstallationRepo[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await f(`${API}/installation/repositories?per_page=100&page=${page}`, { headers: headers(token) });
    if (res.status === 401 || res.status === 404) throw new InstallationGoneError();
    if (!res.ok) throw new Error(`Couldn't list the repositories GitHub shared: HTTP ${res.status}`);
    const data = (await res.json()) as { repositories?: Array<{ full_name: string; default_branch: string; private: boolean }> };
    const batch = data.repositories ?? [];
    for (const r of batch) repos.push({ fullName: r.full_name, defaultBranch: r.default_branch, private: Boolean(r.private) });
    if (batch.length < 100) break;
  }
  return repos;
}

/** Exchanges the one-time `code` from "Request user authorization during installation" for a throwaway user token. */
export async function exchangeUserCode(cfg: GithubAppConfig, code: string, f: FetchLike = fetch): Promise<string> {
  if (!cfg.clientId || !cfg.clientSecret) throw new Error("GitHub App user authorization is not configured.");
  const res = await f("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code }),
  });
  if (!res.ok) throw new Error(`GitHub authorization failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("GitHub did not confirm this authorization.");
  return data.access_token;
}

/** Installation ids the signed-in GitHub user can access: proves the installation is theirs. */
export async function listUserInstallationIds(userToken: string, f: FetchLike = fetch): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await f(`${API}/user/installations?per_page=100&page=${page}`, { headers: headers(userToken) });
    if (!res.ok) throw new Error(`Couldn't verify the GitHub installation: HTTP ${res.status}`);
    const data = (await res.json()) as { installations?: Array<{ id: number }> };
    const batch = data.installations ?? [];
    ids.push(...batch.map((i) => i.id));
    if (batch.length < 100) break;
  }
  return ids;
}

/**
 * The repositories (full names) this GitHub user can actually access within one installation.
 * Used while the throwaway user token exists, so Marlo never grants installation-wide access on
 * installation-level proof alone. Only names are returned; the token is not kept.
 */
export async function listUserInstallationRepos(userToken: string, installationId: number, f: FetchLike = fetch): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await f(`${API}/user/installations/${installationId}/repositories?per_page=100&page=${page}`, { headers: headers(userToken) });
    if (!res.ok) throw new Error(`Couldn't check which repositories you can access: HTTP ${res.status}`);
    const data = (await res.json()) as { repositories?: Array<{ full_name?: unknown }> };
    const batch = data.repositories ?? [];
    for (const r of batch) if (typeof r.full_name === "string") names.push(r.full_name);
    if (batch.length < 100) break;
  }
  return names;
}

// ---- install `state`: signed, short-lived, bound to the user and project ----

const STATE_PURPOSE = "github-app-install";
const STATE_TTL_MS = 15 * 60 * 1000;

/** HMAC key derived from the private key, so no extra secret has to be configured. */
export function stateSecret(cfg: Pick<GithubAppConfig, "privateKey">): string {
  return crypto.createHash("sha256").update(`marlo-github-state:${cfg.privateKey}`).digest("hex");
}

export type InstallState = { userId: string; projectId: string; returnTo: string | null };

export function createInstallState(cfg: Pick<GithubAppConfig, "privateKey">, input: InstallState, now = Date.now()): string {
  return signPayload(stateSecret(cfg), STATE_PURPOSE, { ...input, returnTo: safeReturnPath(input.returnTo) }, STATE_TTL_MS, now);
}

export function verifyInstallState(cfg: Pick<GithubAppConfig, "privateKey">, state: unknown, now = Date.now()): InstallState | null {
  const data = verifyPayload<{ userId?: unknown; projectId?: unknown; returnTo?: unknown }>(stateSecret(cfg), STATE_PURPOSE, state, now);
  if (!data || typeof data.userId !== "string" || typeof data.projectId !== "string") return null;
  return { userId: data.userId, projectId: data.projectId, returnTo: safeReturnPath(data.returnTo) };
}
