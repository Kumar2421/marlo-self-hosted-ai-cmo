import {
  InstallationGoneError,
  exchangeUserCode,
  installUrl,
  authorizeUrl,
  createInstallState,
  listInstallationRepos,
  listUserInstallationIds,
  listUserInstallationRepos,
  mintInstallationToken,
  verifyInstallState,
  type FetchLike,
  type GithubAppConfig,
  type InstallState,
  type InstallationRepo,
} from "./githubApp.ts";

/**
 * What Marlo remembers per project: the installation id, the repos the connecting GitHub user was
 * allowed to access in it (names only), and the one chosen repo. Never a token.
 */
export type GithubAppLink = { installationId: number; allowedRepos: string[]; repoFullName: string | null; connectedAt: string };

const inList = (list: string[], name: string) => list.some((r) => r.toLowerCase() === name.toLowerCase());

export type GithubAppStorePort = {
  get(projectId: string): Promise<GithubAppLink | null>;
  set(projectId: string, link: GithubAppLink): Promise<void>;
  clear(projectId: string): Promise<void>;
};

export type GithubAppDeps = { cfg: GithubAppConfig; store: GithubAppStorePort; fetch?: FetchLike; now?: () => number };

export type InstallStart = { ok: true; url: string } | { ok: false; error: string };

/**
 * With a callback URL (and user authorization configured) the user first authorizes the app so the
 * callback can find an installation they already have; GitHub never redirects back from the
 * install page of an app that is already installed. Without it, go straight to the install page.
 */
export function startInstall(cfg: GithubAppConfig, input: { userId: string; projectId: string; returnTo?: string | null; callbackUrl?: string }, now = Date.now()): InstallStart {
  const state = createInstallState(cfg, { userId: input.userId, projectId: input.projectId, returnTo: input.returnTo ?? null }, now);
  if (input.callbackUrl && cfg.clientId && cfg.clientSecret) return { ok: true, url: authorizeUrl(cfg.clientId, input.callbackUrl, state) };
  return { ok: true, url: installUrl(cfg.slug, state) };
}

export type InstallResult = { ok: true; projectId: string; returnTo: string | null } | { ok: false; error: string };

/**
 * Finishes an installation. Fail-closed: the signed state must match the signed-in user, and the
 * installation id (which arrives as a plain query parameter anyone could forge) must belong to the
 * GitHub account that just authorized, proven through the one-time `code`.
 */
export async function completeInstall(
  deps: GithubAppDeps,
  input: { userId: string; state: string | null; installationId: string | null; code: string | null },
): Promise<InstallResult> {
  const now = deps.now?.() ?? Date.now();
  const state = verifyInstallState(deps.cfg, input.state, now);
  if (!state) return { ok: false, error: "This GitHub link expired or was not started from Marlo. Please try connecting again." };
  if (state.userId !== input.userId) return { ok: false, error: "This GitHub link belongs to a different Marlo account." };
  const installationId = Number(input.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return { ok: false, error: "GitHub did not return an installation." };
  if (!input.code) return { ok: false, error: "GitHub did not confirm who installed the app. Turn on \"Request user authorization during installation\" for the app." };
  return finalizeInstall(deps, state, installationId, input.code, now);
}

const NO_INSTALLATION = "no-installation";

/** Proves ownership through the one-time code, then stores the link. installationId "discover" picks one the user already has. */
async function finalizeInstall(deps: GithubAppDeps, state: InstallState, installationId: number | "discover", code: string, now: number): Promise<InstallResult> {
  let allowedRepos: string[];
  try {
    const userToken = await exchangeUserCode(deps.cfg, code, deps.fetch);
    const owned = await listUserInstallationIds(userToken, deps.fetch);
    if (installationId === "discover") {
      if (owned.length === 0) return { ok: false, error: NO_INSTALLATION };
      const current = await deps.store.get(state.projectId);
      // Several installations (personal + orgs): keep the project's current one if still valid, else the first.
      installationId = current && owned.includes(current.installationId) ? current.installationId : owned[0];
    } else if (!owned.includes(installationId)) return { ok: false, error: "That installation isn't on your GitHub account." };
    // Installation access is not repo access: remember only the repos this user can really see.
    allowedRepos = await listUserInstallationRepos(userToken, installationId, deps.fetch);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't verify the GitHub installation." };
  }
  const previous = await deps.store.get(state.projectId);
  await deps.store.set(state.projectId, {
    installationId,
    allowedRepos,
    // Switching installation, or losing access to the chosen repo, invalidates the old repo choice.
    repoFullName: previous?.installationId === installationId && previous.repoFullName && inList(allowedRepos, previous.repoFullName) ? previous.repoFullName : null,
    connectedAt: new Date(now).toISOString(),
  });
  return { ok: true, projectId: state.projectId, returnTo: state.returnTo };
}

export type CallbackOutcome =
  | { kind: "connected"; returnTo: string | null }
  | { kind: "redirect"; url: string }
  | { kind: "error"; error: string; returnTo: string | null };

/**
 * Entry point for the GitHub callback. Never trusts a client-supplied installation id:
 * - code, no installation_id: user authorized first. Find their installations of this app via the
 *   user token; connect one, or send them to the install page (same signed state) if none.
 * - installation_id + code: fresh install or setup_action=update; verified by completeInstall.
 * - installation_id, no code: unproven; go through user authorization to get proof.
 */
export async function handleInstallCallback(
  deps: GithubAppDeps,
  input: { userId: string; state: string | null; installationId: string | null; code: string | null; callbackUrl: string },
): Promise<CallbackOutcome> {
  const now = deps.now?.() ?? Date.now();
  const state = verifyInstallState(deps.cfg, input.state, now);
  if (!state) return { kind: "error", error: "This GitHub link expired or was not started from Marlo. Please try connecting again.", returnTo: null };
  const fail = (error: string): CallbackOutcome => ({ kind: "error", error, returnTo: state.returnTo });
  if (state.userId !== input.userId) return fail("This GitHub link belongs to a different Marlo account.");
  const signed = input.state as string;
  if (!input.code) {
    if (input.installationId && deps.cfg.clientId && deps.cfg.clientSecret) return { kind: "redirect", url: authorizeUrl(deps.cfg.clientId, input.callbackUrl, signed) };
    return fail("GitHub did not confirm who installed the app. Turn on \"Request user authorization (OAuth) during installation\" for the app.");
  }
  let result: InstallResult;
  if (input.installationId) {
    result = await completeInstall(deps, input);
  } else {
    result = await finalizeInstall(deps, state, "discover", input.code, now);
    if (!result.ok && result.error === NO_INSTALLATION) return { kind: "redirect", url: installUrl(deps.cfg.slug, signed) };
  }
  return result.ok ? { kind: "connected", returnTo: result.returnTo } : fail(result.error);
}

export type GithubAccess =
  | { status: "disconnected" }
  | { status: "no_repo"; installationId: number }
  | { status: "ready"; installationId: number; repoFullName: string; token: string };

/**
 * The adapter the code-fix provider and PR reconciler use in hosted mode: a short-lived token for
 * the project's chosen repo. If the user removed the app on GitHub, the link is cleared gracefully.
 */
export async function resolveGithubAccess(deps: GithubAppDeps, projectId: string): Promise<GithubAccess> {
  const link = await deps.store.get(projectId);
  if (!link) return { status: "disconnected" };
  if (!link.repoFullName || !inList(link.allowedRepos, link.repoFullName)) return { status: "no_repo", installationId: link.installationId };
  try {
    const { token } = await mintInstallationToken(deps.cfg, link.installationId, { fetch: deps.fetch, now: deps.now?.(), repo: link.repoFullName });
    return { status: "ready", installationId: link.installationId, repoFullName: link.repoFullName, token };
  } catch (err) {
    if (err instanceof InstallationGoneError) {
      await deps.store.clear(projectId);
      return { status: "disconnected" };
    }
    throw err;
  }
}

export type RepoList = { ok: true; repos: InstallationRepo[] } | { ok: false; disconnected: true } ;

export async function listSelectableRepos(deps: GithubAppDeps, projectId: string): Promise<RepoList> {
  const link = await deps.store.get(projectId);
  if (!link) return { ok: false, disconnected: true };
  try {
    const { token } = await mintInstallationToken(deps.cfg, link.installationId, { fetch: deps.fetch, now: deps.now?.(), readOnly: true });
    const shared = await listInstallationRepos(token, deps.fetch);
    // Only repos both shared with the installation and visible to the user who connected it.
    return { ok: true, repos: shared.filter((r) => inList(link.allowedRepos, r.fullName)) };
  } catch (err) {
    if (err instanceof InstallationGoneError) {
      await deps.store.clear(projectId);
      return { ok: false, disconnected: true };
    }
    throw err;
  }
}

export type SelectRepoResult = { ok: true; repoFullName: string } | { ok: false; error: string; status: number };

/** One repo per project, and only one the installation really shares. */
export async function selectRepository(deps: GithubAppDeps, projectId: string, requested: unknown): Promise<SelectRepoResult> {
  if (typeof requested !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(requested)) return { ok: false, error: "Choose a repository from the list.", status: 400 };
  const link = await deps.store.get(projectId);
  if (!link) return { ok: false, error: "GitHub isn't connected for this project.", status: 409 };
  if (!inList(link.allowedRepos, requested)) return { ok: false, error: "You don't have access to that repository on GitHub.", status: 403 };
  const listed = await listSelectableRepos(deps, projectId);
  if (!listed.ok) return { ok: false, error: "GitHub access was removed. Connect GitHub again.", status: 409 };
  const match = listed.repos.find((r) => r.fullName.toLowerCase() === requested.toLowerCase());
  if (!match) return { ok: false, error: "That repository isn't shared with Marlo. Add it in the GitHub App settings first.", status: 403 };
  await deps.store.set(projectId, { ...link, repoFullName: match.fullName });
  return { ok: true, repoFullName: match.fullName };
}

/**
 * Clears Marlo's own link immediately. It deliberately does NOT uninstall the GitHub App from the
 * account: that is the owner's call, made in GitHub's settings. Open PRs stay open.
 */
export async function disconnectGithubApp(deps: GithubAppDeps, projectId: string): Promise<void> {
  await deps.store.clear(projectId);
}
