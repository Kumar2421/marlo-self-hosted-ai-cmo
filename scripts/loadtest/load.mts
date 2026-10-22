/**
 * Local load driver. Talks only to the app under test (loopback) and to the fake Supabase control endpoints.
 *
 *   node --experimental-strip-types scripts/loadtest/load.mts <scenario> [more scenarios]
 *
 * Env: APP (http://127.0.0.1:3191)  FAKE (http://127.0.0.1:54391)  CRON_SECRET  OUT (results dir)
 *      APP_PID / FAKE_PID (for RSS sampling via tasklist)  LABEL (tag written into every result)
 *      VU_SECONDS (60)  VUS ("10,50,100")  THINK_MS (0)
 * Scenarios: trace seq s1 s2 s3 s4 s5 s6
 *
 * Recipe (all loopback, nothing leaves the machine):
 *   1. node --experimental-strip-types --max-old-space-size=6144 scripts/loadtest/fakeSupabase.mts      (seeds ~2M rows, ~10 s)
 *      LT_STUB_LATENCY_MS=1500 makes the canned Tavily/Groq/Google answers slow like the real ones (S5 coverage).
 *   2. NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54391 NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SECRET_KEY=x npx next build
 *   3. same three vars + CRON_SECRET=lt-cron-secret GROQ_API_KEY=x TAVILY_API_KEY=x LT_STUB_ORIGIN=http://127.0.0.1:54391
 *      NODE_OPTIONS="--require $PWD/scripts/loadtest/guard.cjs" npx next start -p 3191 -H 127.0.0.1
 *   4. APP_PID=<next pid> FAKE_PID=<fake pid> node --experimental-strip-types scripts/loadtest/load.mts s1 s2 s3 s4 s6
 *   Restart the fake (fresh seed) before s5: the crons write to it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APP = process.env.APP || "http://127.0.0.1:3191";
const FAKE = process.env.FAKE || "http://127.0.0.1:54391";
const CRON_SECRET = process.env.CRON_SECRET || "lt-cron-secret";
const OUT = process.env.OUT || "loadtest-results";
const LABEL = process.env.LABEL || "main";
const COOKIE_NAME = `sb-${new URL(FAKE).hostname.split(".")[0]}-auth-token`;
mkdirSync(OUT, { recursive: true });

const hex12 = (n: number) => n.toString(16).padStart(12, "0");
const userId = (u: number) => `00000000-0000-4000-8000-${hex12(u)}`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

const cookies = new Map<number, string>();
function cookieFor(u: number): string {
  let c = cookies.get(u);
  if (!c) {
    const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId(u), aud: "authenticated", role: "authenticated", exp: 4102444800 })}.lt-signature`;
    const session = {
      access_token: token, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "lt-refresh",
      user: { id: userId(u), aud: "authenticated", role: "authenticated", email: `user${u}@example.test`, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    };
    c = `${COOKIE_NAME}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
    cookies.set(u, c);
  }
  return c;
}

// ------------------------------------------------------------------ helpers
type Sample = { ms: number; status: number; bytes: number; ok: boolean; err?: string };

async function call(path: string, u: number | null, extra: Record<string, string> = {}, timeoutMs = 120_000): Promise<Sample & { text?: string; etag?: string | null }> {
  const t0 = performance.now();
  try {
    const headers: Record<string, string> = { ...extra };
    if (u !== null) headers.cookie = cookieFor(u);
    const res = await fetch(APP + path, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = performance.now() - t0;
    return { ms, status: res.status, bytes: buf.length, ok: res.status < 400, text: buf.toString(), etag: res.headers.get("etag") };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, bytes: 0, ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

function pct(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function summarize(samples: Sample[], wallMs: number) {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const bytes = samples.map((s) => s.bytes).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok).length;
  const statuses: Record<string, number> = {};
  for (const s of samples) statuses[String(s.status)] = (statuses[String(s.status)] ?? 0) + 1;
  return {
    n: samples.length,
    errors,
    errorRatePct: +(100 * (errors / Math.max(1, samples.length))).toFixed(2),
    statuses,
    p50: +pct(ms, 50).toFixed(1), p95: +pct(ms, 95).toFixed(1), p99: +pct(ms, 99).toFixed(1), max: +(ms[ms.length - 1] ?? 0).toFixed(1),
    meanBytes: Math.round(bytes.reduce((a, b) => a + b, 0) / Math.max(1, bytes.length)), p95Bytes: pct(bytes, 95),
    rps: +(samples.length / (wallMs / 1000)).toFixed(1),
  };
}

async function pool<T>(total: number, concurrency: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(total);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (next < total) {
        const i = next++;
        out[i] = await fn(i);
      }
    }),
  );
  return out;
}

async function control(path: string) {
  return (await fetch(FAKE + path)).json() as Promise<any>;
}

function rssMb(pid: string | undefined): number | null {
  if (!pid) return null;
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    const m = /"([\d,.\s]+) K"\s*$/m.exec(out.trim());
    return m ? Math.round(Number(m[1].replace(/[^\d]/g, "")) / 1024) : null;
  } catch {
    return null;
  }
}
const mem = () => ({ appRssMb: rssMb(process.env.APP_PID), fakeRssMb: rssMb(process.env.FAKE_PID) });

function save(name: string, data: unknown) {
  writeFileSync(join(OUT, `${LABEL}-${name}.json`), JSON.stringify(data, null, 2));
  console.log(`\n=== ${name} (${LABEL}) ===\n${JSON.stringify(data, null, 2)}`);
}

/** Runs `n` calls at `concurrency`, resets the fake's counters around it, and derives per-call DB figures. */
async function measure(label: string, path: string, opts: { n: number; concurrency: number; users: (i: number) => number; headers?: Record<string, string>; warm?: number }) {
  for (let i = 0; i < (opts.warm ?? 10); i++) await call(path, opts.users(i), opts.headers);
  await control("/__reset");
  const memBefore = mem();
  const t0 = performance.now();
  const samples = await pool(opts.n, opts.concurrency, (i) => call(path, opts.users(i), opts.headers));
  const wall = performance.now() - t0;
  const stats = await control("/__stats");
  const memAfter = mem();
  const s = summarize(samples, wall);
  const perCall = (x: number) => +(x / opts.n).toFixed(2);
  const routes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries<any>(stats.routes)) routes[k] = { perCallRequests: perCall(v.requests), perCallRows: perCall(v.rows), perCallBytes: Math.round(v.bytes / opts.n) };
  return {
    label, path, concurrency: opts.concurrency, ...s,
    db: { requestsPerCall: perCall(stats.total.requests - stats.auth), authCallsPerCall: perCall(stats.auth), rowsPerCall: perCall(stats.total.rows), dbBytesPerCall: Math.round(stats.total.bytes / opts.n), byRoute: routes },
    mem: { before: memBefore, after: memAfter },
  };
}

const userSpread = (i: number) => (i * 37) % 1000;
/** Users whose active project (global index 3u) has GSC + tracked prompts in the seed (m < 6) and is not the heavy runner. */
const geoUsers = Array.from({ length: 1000 }, (_, u) => u).filter((u) => (3 * u) % 10 < 6 && (3 * u) % 20 !== 0).slice(0, 50);

// ------------------------------------------------------------------ scenarios
const scenarios: Record<string, () => Promise<unknown>> = {
  /** One cold-ish call per route with the fake's request trace on: the exact DB request sequence (N+1 check). */
  async trace() {
    const targets = ["/api/project", "/api/project/data", "/api/project/data?datasets=project_documents", "/api/project/data?datasets=seo_audits,project_competitors",
      "/api/notifications", "/api/agents/analytics/findings", "/api/geo/overview"];
    const out: Record<string, unknown> = {};
    for (const path of targets) {
      await call(path, 5);
      await control("/__trace?on=1");
      const r = await call(path, 6);
      const trace = (await control("/__trace?on=0")) as Array<{ key: string; rows: number; bytes: number; ms: number; q: string }>;
      out[path] = { status: r.status, appMs: +r.ms.toFixed(1), appBytes: r.bytes, dbSequence: trace.map((t) => `${t.key} rows=${t.rows} bytes=${t.bytes} q=${t.q.slice(0, 110)}`) };
    }
    save("trace", out);
  },

  async s1() {
    const results = [];
    results.push(await measure("GET /api/project", "/api/project", { n: 300, concurrency: 8, users: userSpread }));
    results.push(await measure("GET /api/project/data (full)", "/api/project/data", { n: 300, concurrency: 8, users: userSpread }));
    results.push(await measure("GET /api/project/data?datasets=project_documents", "/api/project/data?datasets=project_documents", { n: 300, concurrency: 8, users: userSpread }));
    results.push(await measure("GET /api/project/data?datasets=seo_audits,project_competitors", "/api/project/data?datasets=seo_audits,project_competitors", { n: 300, concurrency: 8, users: userSpread }));
    // ETag revalidation: what a focus refetch sends. The body is still built; only the transfer is saved.
    const first = await call("/api/project/data", 11);
    results.push(await measure("GET /api/project/data (If-None-Match -> 304)", "/api/project/data", { n: 300, concurrency: 8, users: () => 11, headers: { "if-none-match": first.etag ?? "" } }));
    save("s1", results);
  },

  /** Concurrency 1: the critical path of one request (sequential round trips), most useful with LT latency set on the fake. */
  async seq() {
    const out = [];
    for (const p of ["/api/project", "/api/project/data", "/api/project/data?datasets=seo_audits,project_competitors", "/api/notifications", "/api/agents/analytics/findings", "/api/geo/overview"]) {
      out.push(await measure(p, p, { n: 40, concurrency: 1, users: (i) => geoUsers[i % geoUsers.length] }));
    }
    save("seq", out);
  },

  async s2() {
    save("s2", [await measure("GET /api/notifications", "/api/notifications", { n: 400, concurrency: 8, users: userSpread })]);
  },

  async s3() {
    save("s3", [await measure("GET /api/agents/analytics/findings", "/api/agents/analytics/findings", { n: 300, concurrency: 8, users: userSpread })]);
  },

  async s4() {
    save("s4", [
      await measure("GET /api/geo/overview (typical project: 10 prompts, 13 weekly runs)", "/api/geo/overview", { n: 200, concurrency: 8, users: (i) => geoUsers[i % geoUsers.length] }),
      await measure("GET /api/geo/overview (heavy manual runner, user 0)", "/api/geo/overview", { n: 100, concurrency: 8, users: () => 0 }),
    ]);
  },

  /** Cron selection routes, called with CRON_SECRET, several invocations each, against the 3000-project seed. */
  async s5() {
    const runs: unknown[] = [];
    const routes = ["/api/cron/leads-refresh", "/api/cron/geo-weekly", "/api/cron/search-monitor"];
    const invocations = Number(process.env.CRON_INVOCATIONS || 3);
    for (const route of routes) {
      for (let k = 1; k <= invocations; k++) {
        await control("/__reset");
        const truthBefore = await control("/__truth");
        const memBefore = mem();
        const t0 = performance.now();
        const r = await call(route, null, { authorization: `Bearer ${CRON_SECRET}` }, 180_000);
        const wall = performance.now() - t0;
        const truthAfter = await control("/__truth");
        const stats = await control("/__stats");
        let body: any = null;
        try { body = JSON.parse(r.text ?? ""); } catch { body = (r.text ?? "").slice(0, 300); }
        const slim = body && typeof body === "object" ? { ...body, results: body.results ? `[${body.results.length} items]` : undefined, failed: Array.isArray(body.failed) ? { count: body.failed.length, sample: body.failed.slice(0, 2) } : body.failed } : body;
        const reads: Record<string, unknown> = {};
        for (const [key, v] of Object.entries<any>(stats.routes)) reads[key] = { requests: v.requests, rows: v.rows, MB: +(v.bytes / 1048576).toFixed(2), ms: v.ms };
        runs.push({ route, invocation: k, status: r.status, wallMs: Math.round(wall), responseBytes: r.bytes, response: slim, truthBefore, truthAfter, dbRequests: stats.total.requests - stats.auth, dbRows: stats.total.rows, dbMB: +(stats.total.bytes / 1048576).toFixed(1), stubHits: stats.stubHits, blocked: stats.blocked, unknownRpc: stats.unknownRpc, perTable: reads, mem: { before: memBefore, after: mem() } });
        console.log(`  ${route} #${k}: status ${r.status} wall ${Math.round(wall)} ms`);
      }
    }
    save("s5", runs);
  },

  /** Closed-loop ramp: each VU repeats the dashboard-open sequence (project, data full, documents refresh, audits+competitors). */
  async s6() {
    const seconds = Number(process.env.VU_SECONDS || 60);
    const levels = (process.env.VUS || "10,50,100").split(",").map(Number);
    const think = Number(process.env.THINK_MS || 0);
    const out = [];
    for (const vus of levels) {
      await call("/api/project/data", 1); // keep warm
      await control("/__reset");
      const memBefore = mem();
      const per: Record<string, Sample[]> = { project: [], data: [], documents: [], audits: [] };
      const iterMs: number[] = [];
      let iterations = 0;
      const stopAt = performance.now() + seconds * 1000;
      const t0 = performance.now();
      await Promise.all(
        Array.from({ length: vus }, async (_, v) => {
          const u = (v * 10 + 3) % 1000;
          while (performance.now() < stopAt) {
            const it0 = performance.now();
            per.project.push(await call("/api/project", u));
            per.data.push(await call("/api/project/data", u));
            per.documents.push(await call("/api/project/data?datasets=project_documents", u));
            per.audits.push(await call("/api/project/data?datasets=seo_audits,project_competitors", u));
            iterMs.push(performance.now() - it0);
            iterations++;
            if (think) await new Promise((r) => setTimeout(r, think));
          }
        }),
      );
      const wall = performance.now() - t0;
      const stats = await control("/__stats");
      const all = Object.values(per).flat();
      const iter = iterMs.slice().sort((a, b) => a - b);
      out.push({
        vus, seconds, thinkMs: think, iterations, iterationsPerSec: +(iterations / (wall / 1000)).toFixed(2),
        iteration: { p50: +pct(iter, 50).toFixed(0), p95: +pct(iter, 95).toFixed(0), p99: +pct(iter, 99).toFixed(0) },
        overall: summarize(all, wall),
        perEndpoint: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, summarize(v, wall)])),
        db: { requestsPerIteration: +((stats.total.requests - stats.auth) / Math.max(1, iterations)).toFixed(2), authPerIteration: +(stats.auth / Math.max(1, iterations)).toFixed(2), MBPerIteration: +(stats.total.bytes / 1048576 / Math.max(1, iterations)).toFixed(3) },
        mem: { before: memBefore, after: mem() },
      });
      console.log(`  ${vus} VUs done: ${iterations} iterations`);
    }
    save("s6", out);
  },
};

const wanted = process.argv.slice(2);
if (wanted.length === 0) {
  console.error(`usage: load.mts ${Object.keys(scenarios).join(" ")}`);
  process.exit(2);
}
for (const name of wanted) {
  if (!scenarios[name]) throw new Error(`unknown scenario ${name}`);
  await scenarios[name]();
}
