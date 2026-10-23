/**
 * Does the chosen repository plausibly hold this project's site? A pure score from cheap evidence (names, README,
 * package.json, the finding's text found in the repo). Zero means nothing links the two, and the fix needs an
 * explicit confirmation. The reads that feed it are bounded (two files, one time budget).
 */

export type SiteIdentity = { host: string; rootDomain: string; brandTokens: string[] };

export type RepoEvidence = {
  fullName: string;
  description?: string | null;
  homepage?: string | null;
  readme?: string | null;
  packageName?: string | null;
  packageHomepage?: string | null;
  /** The finding's current text was found in the repo's page file. */
  foundCurrentText?: boolean;
};

export type RepoMatch = { score: number; reasons: string[] };

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
const GENERIC = new Set(["website", "site", "home", "page", "app", "official", "www", "company", "project", "marketing", "landing"]);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function siteIdentityOf(projectUrl: string, projectName: string): SiteIdentity {
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(projectUrl) ? projectUrl : `https://${projectUrl}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    host = "";
  }
  const labels = host.split(".").filter(Boolean);
  let rootLabels = labels.slice(-2);
  if (labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2])) rootLabels = labels.slice(-3);
  const rootDomain = rootLabels.join(".");
  const tokens = new Set<string>();
  const brandLabel = rootLabels.length >= 2 ? rootLabels[rootLabels.length - (rootLabels.length === 3 ? 3 : 2)] : (rootLabels[0] ?? "");
  if (brandLabel.length >= 3) tokens.add(squash(brandLabel));
  for (const w of projectName.split(/[^A-Za-z0-9]+/)) {
    const t = squash(w);
    if (t.length >= 4 && !GENERIC.has(t)) tokens.add(t);
  }
  return { host, rootDomain, brandTokens: [...tokens] };
}

function mentionsDomain(text: string | null | undefined, site: SiteIdentity): boolean {
  if (!text || !site.host) return false;
  const t = text.toLowerCase();
  return t.includes(site.host) || (site.rootDomain !== "" && t.includes(site.rootDomain));
}

export function scoreRepoMatch(site: SiteIdentity, repo: RepoEvidence): RepoMatch {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };
  if (repo.foundCurrentText) add(5, "the finding's current text is in the repo");
  if (mentionsDomain(repo.homepage, site) || mentionsDomain(repo.packageHomepage, site)) add(4, "the repo's homepage points at the site");
  if (mentionsDomain(repo.readme, site)) add(3, "the README mentions the site");
  if (mentionsDomain(repo.description, site)) add(2, "the repo description mentions the site");
  const slug = squash(repo.fullName);
  const pkg = squash(repo.packageName ?? "");
  const readme = squash((repo.readme ?? "").slice(0, 4000));
  for (const token of site.brandTokens) {
    if (slug.includes(token)) add(2, `the repo name contains "${token}"`);
    else if (pkg.includes(token)) add(2, `package.json is named for "${token}"`);
    else if (readme.includes(token)) add(1, `the README mentions "${token}"`);
  }
  return { score, reasons };
}

/* -- bounded reads -------------------------------------------------- */

export type RepoReadPorts = {
  /** File text, or null when the file doesn't exist. Any other failure must throw (the check fails closed). */
  readFile(path: string): Promise<string | null>;
};

const MAX_EVIDENCE_BYTES = 40_000;

export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} took too long. Try again in a moment.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Reads README.md and package.json (nothing else) and parses what the score needs. */
export async function readRepoEvidence(
  base: Pick<RepoEvidence, "fullName" | "description" | "homepage" | "foundCurrentText">,
  ports: RepoReadPorts,
  budgetMs = 6000,
): Promise<RepoEvidence> {
  const [readme, pkgText] = await withTimeout(Promise.all([ports.readFile("README.md"), ports.readFile("package.json")]), budgetMs, "Checking the repository");
  let packageName: string | null = null;
  let packageHomepage: string | null = null;
  if (pkgText && pkgText.length <= MAX_EVIDENCE_BYTES) {
    try {
      const pkg = JSON.parse(pkgText) as { name?: unknown; homepage?: unknown };
      packageName = typeof pkg.name === "string" ? pkg.name : null;
      packageHomepage = typeof pkg.homepage === "string" ? pkg.homepage : null;
    } catch {
      // An unreadable package.json is just missing evidence.
    }
  }
  return { ...base, readme: readme ? readme.slice(0, MAX_EVIDENCE_BYTES) : null, packageName, packageHomepage };
}
