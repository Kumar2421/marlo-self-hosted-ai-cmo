/** Real Google PageSpeed Insights v5 fetch — shared by the main single-page
 * audit (SEOAgent.ts) and the opt-in per-page PageSpeed check on the
 * multi-page Site Pages crawl, so there's one real implementation instead of
 * two copies drifting apart. No mock fallback exists here — callers only
 * invoke this when a real key is present, and treat a thrown error as
 * "not available this run," never as a reason to invent placeholder scores. */

/** "Unknown": PSI did not return this audit, so it was not measured (never a fake Fail). */
export type CwvStatus = "Pass" | "Warn" | "Fail" | "Unknown";
export type CwvMetric = { value: string; status: CwvStatus };
export type CwvSnapshot = { lcp: CwvMetric; fcp: CwvMetric; cls: CwvMetric };

/** A score is undefined when PSI did not return that category: "not measured", never 0. */
export type PageSpeedScores = {
  performance: number | undefined;
  accessibility: number | undefined;
  bestPractices: number | undefined;
  seo: number | undefined;
};

export const NOT_MEASURED = "Not measured";
export type LighthouseIssue = {
  id: string;
  title: string;
  score: number | null;
  displayValue?: string;
  mode: "opportunity" | "diagnostic";
};
export type PageSpeedResult = {
  pageSpeed: { desktop: PageSpeedScores; mobile: PageSpeedScores };
  coreWebVitals: { desktop: CwvSnapshot; mobile: CwvSnapshot };
  lighthouseIssues: { desktop: LighthouseIssue[]; mobile: LighthouseIssue[] };
};

/** Longest one PageSpeed Insights measurement (both attempts together) may take.
 * PSI itself can run 15-40s on a slow page; past this we report "not measured"
 * instead of letting one page hold a 60s serverless request hostage. */
export const PSI_TIMEOUT_MS = 20_000;

/** PSI budget for the audit that runs during project creation (P3 fix 5): if PSI
 * is slower than this it is skipped so onboarding is not blocked. */
export const PSI_ONBOARDING_TIMEOUT_MS = 10_000;

/** Raised when PSI did not answer inside its time budget. Callers treat it as
 * "not measured this run" (no scores, no fake 0), not as a failure to alert on. */
export class PageSpeedTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`PageSpeed Insights did not respond within ${Math.round(timeoutMs / 1000)}s`);
    this.name = "PageSpeedTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function isPageSpeedTimeout(e: unknown): e is PageSpeedTimeoutError {
  return e instanceof PageSpeedTimeoutError;
}

export type PageSpeedOptions = {
  /** Total time for this measurement, retry included. Defaults to PSI_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
};

function statusFromScore(score: number | undefined): CwvStatus {
  if (typeof score !== "number") return "Unknown";
  if (score >= 0.9) return "Pass";
  if (score >= 0.5) return "Warn";
  return "Fail";
}

async function fetchLighthouse(
  url: string,
  apiKey: string,
  strategy: "desktop" | "mobile",
  timeoutMs: number,
  fetchImpl: typeof fetch,
) {
  const psiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  psiUrl.searchParams.append("url", url);
  psiUrl.searchParams.append("strategy", strategy);
  psiUrl.searchParams.append("key", apiKey);
  // PSI only returns the categories you explicitly ask for — without this,
  // accessibility/bestPractices/seo silently come back as 0 (confirmed for
  // real: the raw response only had a "performance" key until these were added).
  for (const category of ["performance", "accessibility", "best-practices", "seo"]) {
    psiUrl.searchParams.append("category", category);
  }

  // The signal covers the body read too: a response that stalls mid-stream is
  // cut off by the same timer rather than hanging.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetchImpl(psiUrl.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`PSI fetch failed: HTTP ${res.status}`);
    return parseLighthouse(await res.json());
  } catch (e) {
    if (controller.signal.aborted) throw new PageSpeedTimeoutError(timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function categoryScore(category: { score?: unknown } | undefined): number | undefined {
  return typeof category?.score === "number" ? Math.round(category.score * 100) : undefined;
}

function cwvMetric(audit: { score?: number; displayValue?: string } | undefined): CwvMetric {
  return {
    value: typeof audit?.displayValue === "string" ? audit.displayValue : NOT_MEASURED,
    status: statusFromScore(audit?.score),
  };
}

/** Pure: turn a raw PSI response into scores, vitals and issues. Anything PSI did not return stays undefined / "Not measured". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseLighthouse(data: any) {
  const categories = data.lighthouseResult?.categories ?? {};
  const audits = (data.lighthouseResult?.audits ?? {}) as Record<string, {
    score?: number;
    title?: string;
    displayValue?: string;
    details?: { type?: string };
  }>;

  const lighthouseIssues: LighthouseIssue[] = Object.entries(audits)
    .map(([id, audit]) => {
      const score = typeof audit?.score === "number" ? audit.score : null;
      const mode = audit?.details?.type === "opportunity" ? "opportunity" : "diagnostic";
      return {
        id,
        title: typeof audit?.title === "string" ? audit.title : id,
        score,
        displayValue: typeof audit?.displayValue === "string" ? audit.displayValue : undefined,
        mode,
      } as LighthouseIssue;
    })
    .filter((audit) => audit.score !== null && audit.score < 0.9 && audit.id !== "largest-contentful-paint" && audit.id !== "first-contentful-paint" && audit.id !== "cumulative-layout-shift")
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 8);

  const cwv: CwvSnapshot = {
    lcp: cwvMetric(audits["largest-contentful-paint"]),
    fcp: cwvMetric(audits["first-contentful-paint"]),
    cls: cwvMetric(audits["cumulative-layout-shift"]),
  };

  return {
    scores: {
      performance: categoryScore(categories.performance),
      accessibility: categoryScore(categories.accessibility),
      bestPractices: categoryScore(categories["best-practices"]),
      seo: categoryScore(categories.seo),
    } satisfies PageSpeedScores,
    cwv,
    lighthouseIssues,
  };
}

/** PSI genuinely 500s sometimes when asked to compute all 4 categories at
 * once on a slower page — confirmed for real: a page that failed with all 4
 * categories succeeded immediately when requesting just one. One retry
 * meaningfully improves real yield without hiding a persistent failure.
 * The retry shares the one deadline and never follows a timeout, so the whole
 * measurement stays inside `timeoutMs`. */
async function fetchLighthouseWithRetry(
  url: string,
  apiKey: string,
  strategy: "desktop" | "mobile",
  timeoutMs: number,
  fetchImpl: typeof fetch,
) {
  const deadline = Date.now() + timeoutMs;
  try {
    return await fetchLighthouse(url, apiKey, strategy, timeoutMs, fetchImpl);
  } catch (e) {
    if (isPageSpeedTimeout(e)) throw e;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new PageSpeedTimeoutError(timeoutMs);
    return await fetchLighthouse(url, apiKey, strategy, remaining, fetchImpl);
  }
}

export async function fetchPageSpeed(url: string, apiKey: string, options: PageSpeedOptions = {}): Promise<PageSpeedResult> {
  const timeoutMs = options.timeoutMs ?? PSI_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const [desktopData, mobileData] = await Promise.all([
    fetchLighthouseWithRetry(url, apiKey, "desktop", timeoutMs, fetchImpl),
    fetchLighthouseWithRetry(url, apiKey, "mobile", timeoutMs, fetchImpl),
  ]);

  return {
    pageSpeed: { desktop: desktopData.scores, mobile: mobileData.scores },
    coreWebVitals: { desktop: desktopData.cwv, mobile: mobileData.cwv },
    lighthouseIssues: { desktop: desktopData.lighthouseIssues, mobile: mobileData.lighthouseIssues },
  };
}
