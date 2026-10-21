import type { Page } from "@playwright/test";

/**
 * In-page performance probes for the vitals spec. `installVitals` must run before the
 * first navigation; it records into `window.__vitals` with PerformanceObserver:
 *   - layout-shift  (CLS; every shift counts, including ones right after a click, which
 *                    is stricter than the web.dev definition and what we want for tab switches)
 *   - longtask      (main-thread tasks over 50 ms)
 *   - largest-contentful-paint
 */

export type LayoutShift = { value: number; at: number; nodes: string[] };
export type LongTask = { at: number; duration: number };
export type Vitals = { shifts: LayoutShift[]; longTasks: LongTask[]; lcp: number | null };

declare global {
  interface Window {
    __vitals?: Vitals;
  }
}

function init() {
  const v: Vitals = { shifts: [], longTasks: [], lcp: null };
  window.__vitals = v;
  const label = (n: Node | null | undefined) => {
    if (!n) return "?";
    const el = n as Element;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    return (el.nodeName || "#text").toLowerCase() + (cls ? "." + cls : "");
  };
  const observe = (type: string, onEntry: (e: PerformanceEntry & Record<string, any>) => void) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => onEntry(e as never))).observe({ type, buffered: true });
    } catch {
      /* entry type not supported in this browser */
    }
  };
  observe("layout-shift", (e) => {
    v.shifts.push({ value: e.value, at: e.startTime, nodes: (e.sources || []).map((s: { node?: Node }) => label(s.node)) });
  });
  observe("longtask", (e) => v.longTasks.push({ at: e.startTime, duration: e.duration }));
  observe("largest-contentful-paint", (e) => {
    v.lcp = e.startTime;
  });
}

export async function installVitals(page: Page) {
  await page.addInitScript(init);
}

export async function readVitals(page: Page): Promise<Vitals> {
  return page.evaluate(() => window.__vitals ?? { shifts: [], longTasks: [], lcp: null });
}

/** Page clock (ms since navigation start), for splitting shifts into phases. */
export function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** Sum of layout shifts that started in [from, to). */
export function clsBetween(v: Vitals, from = 0, to = Infinity): number {
  return v.shifts.filter((s) => s.at >= from && s.at < to).reduce((sum, s) => sum + s.value, 0);
}

export function describeShifts(v: Vitals, from = 0, to = Infinity): string {
  return v.shifts
    .filter((s) => s.at >= from && s.at < to)
    .map((s) => `${s.value.toFixed(4)} @${Math.round(s.at)}ms [${s.nodes.join(", ")}]`)
    .join("\n");
}

/**
 * Collects everything a clean page should not produce: console errors and warnings,
 * uncaught exceptions, failed requests and HTTP >= 400 responses.
 */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()} (${m.location().url})`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  return problems;
}
