/**
 * Seeded fake Supabase (PostgREST + Auth) with per-route request accounting, for the LOCAL load test only.
 * Nothing here talks to the network except its own listener. It also hosts canned stubs for the third-party
 * providers (Tavily, Groq, Google, ...) under /__stub/<host>/..., which scripts/loadtest/guard.cjs routes to.
 *
 *   node --experimental-strip-types --max-old-space-size=6144 scripts/loadtest/fakeSupabase.mts
 *
 * Env: LT_PORT (54391) LT_USERS LT_PPU LT_MARKER_FRACTION LT_MARKERS LT_LEADS LT_FINDINGS LT_SNAP_DAYS LT_GEO_WEEKS
 *      LT_LATENCY_MS (simulated network round trip added to every response) LT_MAX_ROWS (PostgREST max-rows, 1000)
 * Control: GET /__stats /__reset /__trace?on=1|0 /__config?latency=&maxRows= /__truth /__mem /__counts
 */
import http from "node:http";
import { config, handleRest, table, tables, unknownRpc, type Stat } from "./engine.mts";
import { defaultSeed, projectId, seed, userId } from "./seed.mts";

const port = Number(process.env.LT_PORT || 54391);
let latencyMs = Number(process.env.LT_LATENCY_MS || 0);
/** Simulated provider latency applied to every canned third-party answer (Tavily, Groq, Google). */
let stubLatencyMs = Number(process.env.LT_STUB_LATENCY_MS || 0);
const MAX_URL = Number(process.env.LT_MAX_URL || 16384);

const stats = new Map<string, Stat>();
let trace: Array<Record<string, unknown>> | null = null;
const stubHits = new Map<string, number>();
const blocked = new Map<string, number>();
let startedAt = Date.now();

function bump(key: string, rows: number, bytes: number, ms: number) {
  let s = stats.get(key);
  if (!s) stats.set(key, (s = { requests: 0, rows: 0, bytes: 0, ms: 0, maxMs: 0 }));
  s.requests++;
  s.rows += rows;
  s.bytes += bytes;
  s.ms += ms;
  if (ms > s.maxMs) s.maxMs = ms;
}

function userFor(token: string | undefined) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const sub = JSON.parse(Buffer.from(parts[1], "base64url").toString()).sub as string;
    const p = table("profiles");
    const found = [...(p.index("id").get(sub) ?? [])][0];
    if (!found) return null;
    return { id: sub, aud: "authenticated", role: "authenticated", email: found.email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: found.created_at };
  } catch {
    return null;
  }
}

function weekStartUtc(d = new Date()) {
  const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  s.setUTCDate(s.getUTCDate() - ((s.getUTCDay() + 6) % 7));
  return s.toISOString();
}

/** Ground truth about how much work is eligible, so cron runs can be compared against it. */
function truth() {
  const today = new Date().toISOString().slice(0, 10);
  const conns = [...table("integration_connections").rows].filter((c) => c.provider === "gsc");
  const withProp = new Set([...table("integration_resources").rows].filter((r) => r.selected && r.resource_type === "search_console_property").map((r) => r.connection_id));
  const doneToday = new Set([...(table("search_snapshots").index("snapshot_date").get(today) ?? [])].map((r) => r.project_id));
  const gscEligible = conns.filter((c) => c.status === "connected" && withProp.has(c.id) && !doneToday.has(c.project_id)).length;

  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const confirmed = new Set(
    [...(table("project_documents").index("doc_type").get("lead_profile") ?? [])]
      .filter((d) => /"confirmedAt"/.test(String(d.content)) && !/"confirmedAt":null/.test(String(d.content)))
      .map((d) => d.project_id),
  );
  const projects = [...table("projects").rows];
  const due = projects.filter((p) => p.leads_auto_last_at == null || (p.leads_auto_last_at as string) < cutoff);
  const leadsEligible = due.filter((p) => confirmed.has(p.id)).length;

  const ws = weekStartUtc();
  const active = [...table("geo_prompts").rows].filter((p) => p.active);
  const ranThisWeek = new Set<string>();
  for (const r of table("geo_runs").rows) if ((r.run_at as string) >= ws) ranThisWeek.add(`${r.project_id}\u0000${r.prompt}`);
  const geoDueProjects = new Set(active.filter((p) => !ranThisWeek.has(`${p.project_id}\u0000${p.prompt}`)).map((p) => p.project_id));
  return {
    projects: projects.length,
    gscConnections: conns.length,
    gscEligible,
    snapshotsToday: doneToday.size,
    leadsDueAll: due.length,
    leadsEligible,
    leadsStampedLast24h: projects.length - due.length,
    geoProjectsWithPrompts: new Set(active.map((p) => p.project_id)).size,
    geoActivePrompts: active.length,
    geoDueProjects: geoDueProjects.size,
    geoRunsThisWeek: ranThisWeek.size,
    geoRunRows: table("geo_runs").rows.size,
  };
}

function stubFor(host: string, path: string) {
  stubHits.set(host, (stubHits.get(host) ?? 0) + 1);
  if (host === "api.tavily.com") return { status: 200, body: { query: "stub", results: [], answer: null } };
  if (host === "api.groq.com" || host === "api.mistral.ai") {
    return { status: 200, body: { id: "stub", object: "chat.completion", created: 0, model: "stub", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "[]" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } };
  }
  if (host === "www.googleapis.com" && path.includes("searchAnalytics")) {
    return { status: 200, body: { rows: Array.from({ length: 50 }, (_, i) => ({ keys: [`stub query ${i}`, `https://site.example.test/p/${i}`], clicks: 50 - i, impressions: 500 - i, ctr: 0.1, position: 4 })) } };
  }
  if (host === "oauth2.googleapis.com") return { status: 200, body: { access_token: "stub-access", expires_in: 3600, token_type: "Bearer" } };
  return { status: 503, body: { error: "stubbed provider has no canned answer", host } };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

const server = http.createServer(async (req, res) => {
  const t0 = performance.now();
  const url = new URL(req.url ?? "/", "http://x");
  const method = req.method ?? "GET";

  if (url.pathname.startsWith("/__")) return control(url, req, res);
  if ((req.url?.length ?? 0) > MAX_URL) {
    res.writeHead(414, { "content-type": "text/plain" });
    return res.end("URI too long");
  }
  if (url.pathname === "/health") return res.end('{"ok":true}');

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const bodyText = Buffer.concat(chunks).toString();
  if (latencyMs > 0) await sleep(latencyMs);

  if (method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
    return res.end();
  }

  if (url.pathname.startsWith("/auth/v1/")) {
    const sub = url.pathname.slice("/auth/v1".length);
    let status = 200;
    let body: unknown = {};
    if (sub === "/user" && method === "GET") {
      const user = userFor(req.headers.authorization?.replace(/^Bearer\s+/i, ""));
      if (user) body = user;
      else { status = 401; body = { code: 401, error_code: "bad_jwt", msg: "invalid JWT" }; }
    }
    const out = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(out);
    const ms = performance.now() - t0;
    bump(`AUTH ${method} ${sub}`, 0, Buffer.byteLength(out), ms);
    trace?.push({ key: `AUTH ${method} ${sub}`, rows: 0, bytes: Buffer.byteLength(out), ms: +ms.toFixed(2), q: "" });
    return;
  }

  if (url.pathname.startsWith("/stub/")) {
    const [, , host, ...rest] = url.pathname.split("/");
    const s = stubFor(host, "/" + rest.join("/"));
    if (stubLatencyMs > 0) await sleep(stubLatencyMs);
    res.writeHead(s.status, { "content-type": "application/json" });
    return res.end(JSON.stringify(s.body));
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    let result;
    try {
      result = handleRest(method, url.pathname, url.searchParams, req.headers as Record<string, string | undefined>, bodyText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[fake] error", method, req.url?.slice(0, 200), msg);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "PGRSTX", message: msg }));
      bump(`ERR ${method} ${url.pathname}`, 0, 0, performance.now() - t0);
      return;
    }
    res.writeHead(result.status, result.headers);
    res.end(result.body);
    const bytes = Buffer.byteLength(result.body);
    const ms = performance.now() - t0;
    const key = `${method} ${result.table}`;
    bump(key, result.rows, bytes, ms);
    trace?.push({ key, rows: result.rows, bytes, ms: +ms.toFixed(2), q: decodeURIComponent((url.search || "").slice(0, 200)) });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end("{}");
});

function control(url: URL, _req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader("content-type", "application/json");
  const send = (o: unknown) => res.end(JSON.stringify(o));
  switch (url.pathname) {
    case "/__stats": {
      const routes = Object.fromEntries([...stats].sort((a, b) => b[1].requests - a[1].requests).map(([k, v]) => [k, { ...v, ms: +v.ms.toFixed(1), maxMs: +v.maxMs.toFixed(1) }]));
      const all = [...stats.values()];
      return send({
        sinceMs: Date.now() - startedAt,
        total: { requests: all.reduce((a, s) => a + s.requests, 0), rows: all.reduce((a, s) => a + s.rows, 0), bytes: all.reduce((a, s) => a + s.bytes, 0) },
        auth: [...stats].filter(([k]) => k.startsWith("AUTH")).reduce((a, [, s]) => a + s.requests, 0),
        routes,
        stubHits: Object.fromEntries(stubHits),
        blocked: Object.fromEntries(blocked),
        unknownRpc: Object.fromEntries(unknownRpc),
      });
    }
    case "/__reset":
      stats.clear();
      stubHits.clear();
      blocked.clear();
      unknownRpc.clear();
      startedAt = Date.now();
      if (trace) trace = [];
      return send({ ok: true });
    case "/__trace":
      if (url.searchParams.get("on") === "1") trace = [];
      else if (url.searchParams.get("on") === "0") {
        const t = trace ?? [];
        trace = null;
        return send(t);
      }
      return send({ tracing: trace !== null });
    case "/__config":
      if (url.searchParams.has("latency")) latencyMs = Number(url.searchParams.get("latency"));
      if (url.searchParams.has("stubLatency")) stubLatencyMs = Number(url.searchParams.get("stubLatency"));
      if (url.searchParams.has("maxRows")) config.maxRows = Number(url.searchParams.get("maxRows"));
      return send({ latencyMs, stubLatencyMs, maxRows: config.maxRows });
    case "/__blocked":
      // guard.cjs reports a provider call it refused (host only, never a URL with secrets)
      blocked.set(url.searchParams.get("host") ?? "?", (blocked.get(url.searchParams.get("host") ?? "?") ?? 0) + 1);
      return send({ ok: true });
    case "/__truth":
      return send(truth());
    case "/__mem":
      return send(process.memoryUsage());
    case "/__counts":
      return send(Object.fromEntries([...tables].map(([k, v]) => [k, v.rows.size])));
    default:
      res.statusCode = 404;
      return send({});
  }
}

const cfg = defaultSeed();
const t0 = Date.now();
const projects = seed(cfg);
console.log(`[fake] seeded ${cfg.users} users, ${projects} projects in ${Date.now() - t0} ms; rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
console.log("[fake] tables", JSON.stringify(Object.fromEntries([...tables].map(([k, v]) => [k, v.rows.size]))));
console.log("[fake] sample ids", userId(0), projectId(0));
server.keepAliveTimeout = 30_000;
server.listen(port, "127.0.0.1", () => console.log(`[fake] listening on ${port}`));
