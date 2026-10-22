/**
 * Minimal in-memory PostgREST + GoTrue emulator used only by the local load test.
 * Implements just the query features the app's supabase-js calls use: eq/neq/gt/gte/lt/lte/like/in/is/not,
 * or(), order (with nulls first/last), limit/offset, select with JSON paths, count=exact, HEAD, maybeSingle,
 * insert/upsert/update/delete and a handful of RPCs. It is NOT Postgres: no planner, no locks, no RLS.
 */
import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;

export const PK: Record<string, string[]> = {
  project_documents: ["project_id", "doc_type"],
  user_settings: ["user_id", "key"],
  search_snapshots: ["project_id", "snapshot_date"],
  notification_preferences: ["user_id"],
  geo_usage: ["user_id", "method", "day"],
  geo_locks: ["project_id"],
  site_crawls: ["project_id"],
  traffic_checks: ["project_id"],
  geo_checks: ["project_id"],
  link_checks: ["project_id"],
  seo_audits: ["project_id", "url"],
  profiles: ["id"],
};

export class Table {
  name: string;
  rows = new Set<Row>();
  indexes = new Map<string, Map<unknown, Set<Row>>>();
  constructor(name: string) {
    this.name = name;
  }
  add(row: Row) {
    this.rows.add(row);
    for (const [col, idx] of this.indexes) {
      const v = row[col];
      let b = idx.get(v);
      if (!b) idx.set(v, (b = new Set()));
      b.add(row);
    }
  }
  remove(row: Row) {
    this.rows.delete(row);
    for (const [col, idx] of this.indexes) idx.get(row[col])?.delete(row);
  }
  index(col: string) {
    let idx = this.indexes.get(col);
    if (!idx) {
      idx = new Map();
      for (const row of this.rows) {
        const v = row[col];
        let b = idx.get(v);
        if (!b) idx.set(v, (b = new Set()));
        b.add(row);
      }
      this.indexes.set(col, idx);
    }
    return idx;
  }
  /** Re-index a row after `cols` changed (old values supplied). */
  reindex(row: Row, old: Row) {
    for (const [col, idx] of this.indexes) {
      if (!(col in old) || old[col] === row[col]) continue;
      idx.get(old[col])?.delete(row);
      let b = idx.get(row[col]);
      if (!b) idx.set(row[col], (b = new Set()));
      b.add(row);
    }
  }
}

export const tables = new Map<string, Table>();
export function table(name: string): Table {
  let t = tables.get(name);
  if (!t) tables.set(name, (t = new Table(name)));
  return t;
}

// ---------------------------------------------------------------- filters
type Cond = { kind: "cond"; col: string; op: string; val: string; neg: boolean; set?: Set<string> };
type Group = { kind: "or" | "and"; items: Node[]; neg: boolean };
type Node = Cond | Group;

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, q = false, cur = "";
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseCond(col: string, rest: string): Cond {
  let neg = false;
  if (rest.startsWith("not.")) {
    neg = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  return { kind: "cond", col, op: rest.slice(0, dot), val: rest.slice(dot + 1), neg };
}

function parseGroup(kind: "or" | "and", body: string, neg = false): Group {
  const items: Node[] = splitTop(body.slice(1, -1)).map((piece) => {
    const m = /^(not\.)?(or|and)\(([\s\S]*)\)$/.exec(piece);
    if (m) return parseGroup(m[2] as "or" | "and", `(${m[3]})`, Boolean(m[1]));
    const d = piece.indexOf(".");
    return parseCond(piece.slice(0, d), piece.slice(d + 1));
  });
  return { kind, items, neg };
}

function unq(v: string) {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

function cmp(a: unknown, b: string): number {
  if (typeof a === "number") return a - Number(b);
  return String(a) < b ? -1 : String(a) > b ? 1 : 0;
}

function evalCond(row: Row, c: Cond): boolean {
  const v = row[c.col];
  let r: boolean;
  switch (c.op) {
    case "eq": r = v != null && (typeof v === "boolean" ? String(v) === c.val : typeof v === "number" ? v === Number(c.val) : String(v) === c.val); break;
    case "neq": r = v != null && String(v) !== c.val; break;
    case "gt": r = v != null && cmp(v, c.val) > 0; break;
    case "gte": r = v != null && cmp(v, c.val) >= 0; break;
    case "lt": r = v != null && cmp(v, c.val) < 0; break;
    case "lte": r = v != null && cmp(v, c.val) <= 0; break;
    case "is": r = c.val === "null" ? v == null : c.val === "true" ? v === true : c.val === "false" ? v === false : false; break;
    case "in": {
      if (!c.set) c.set = new Set(splitTop(c.val.slice(1, -1)).map(unq));
      r = v != null && c.set.has(String(v));
      break;
    }
    case "like":
    case "ilike": {
      if (v == null) { r = false; break; }
      const pat = c.val.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, "[\\s\\S]*").replace(/_/g, "[\\s\\S]");
      r = new RegExp(`^${pat}$`, c.op === "ilike" ? "i" : "").test(String(v));
      break;
    }
    default: throw new Error(`unsupported operator ${c.op}`);
  }
  return c.neg ? !r : r;
}

function evalNode(row: Row, n: Node): boolean {
  if (n.kind === "cond") return evalCond(row, n);
  const r = n.kind === "or" ? n.items.some((i) => evalNode(row, i)) : n.items.every((i) => evalNode(row, i));
  return n.neg ? !r : r;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

export function parseFilters(params: URLSearchParams): Node[] {
  const nodes: Node[] = [];
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and") nodes.push(parseGroup(key, value));
    else nodes.push(parseCond(key, value));
  }
  return nodes;
}

/** Rows matching, using an equality index when one is available. */
export function matchRows(t: Table, nodes: Node[]): Row[] {
  let candidates: Iterable<Row> = t.rows;
  let best = Infinity;
  for (const n of nodes) {
    if (n.kind === "cond" && n.op === "eq" && !n.neg) {
      // Coerce to the stored type: ids/dates are strings, flags booleans; the index is keyed by stored value.
      const idx = t.index(n.col);
      let bucket = idx.get(n.val);
      if (!bucket && (n.val === "true" || n.val === "false")) bucket = idx.get(n.val === "true");
      if (!bucket) bucket = idx.get(Number(n.val)) as Set<Row> | undefined;
      const size = bucket?.size ?? 0;
      if (size < best) {
        best = size;
        candidates = bucket ?? [];
      }
    }
  }
  // An IN list on an indexed column is a union of buckets (what a Postgres index scan would do).
  for (const n of nodes) {
    if (n.kind === "cond" && n.op === "in" && !n.neg) {
      if (!n.set) n.set = new Set(splitTop(n.val.slice(1, -1)).map(unq));
      if (n.set.size < best) {
        const idx = t.index(n.col);
        const union: Row[] = [];
        for (const v of n.set) for (const row of idx.get(v) ?? []) union.push(row);
        if (union.length < best) {
          best = union.length;
          candidates = union;
        }
      }
    }
  }
  const out: Row[] = [];
  for (const row of candidates) if (nodes.every((n) => evalNode(row, n))) out.push(row);
  return out;
}

// ---------------------------------------------------------------- order / project
type Order = { col: string; desc: boolean; nullsFirst: boolean };
export function parseOrder(s: string | null): Order[] {
  if (!s) return [];
  return s.split(",").map((part) => {
    const bits = part.split(".");
    const desc = bits.includes("desc");
    const nullsFirst = bits.includes("nullsfirst") ? true : bits.includes("nullslast") ? false : desc;
    return { col: bits[0], desc, nullsFirst };
  });
}

export function sortRows(rows: Row[], orders: Order[]): Row[] {
  if (orders.length === 0) return rows;
  return rows.sort((a, b) => {
    for (const o of orders) {
      const x = a[o.col], y = b[o.col];
      if (x == null && y == null) continue;
      if (x == null) return o.nullsFirst ? -1 : 1;
      if (y == null) return o.nullsFirst ? 1 : -1;
      if (x === y) continue;
      const c = (x as string | number) < (y as string | number) ? -1 : 1;
      return o.desc ? -c : c;
    }
    return 0;
  });
}

type Proj = { star: boolean; items: Array<{ out: string; path: string[]; text: boolean }> };
const projCache = new Map<string, Proj>();
function parseSelect(sel: string | null): Proj {
  const key = sel ?? "*";
  let p = projCache.get(key);
  if (p) return p;
  p = { star: false, items: [] };
  for (const raw of splitTop(key)) {
    const part = raw.trim();
    if (part === "*") { p.star = true; continue; }
    const am = /^(\w+):(.+)$/.exec(part);
    const alias = am ? am[1] : null;
    const expr = am ? am[2] : part;
    const text = expr.includes("->>");
    const path = expr.split(/->>|->/);
    p.items.push({ out: alias ?? path[path.length - 1], path, text });
  }
  projCache.set(key, p);
  return p;
}

function project(row: Row, p: Proj): Row {
  if (p.star) return row;
  const out: Row = {};
  for (const it of p.items) {
    let v: unknown = row[it.path[0]];
    for (let i = 1; i < it.path.length && v != null; i++) v = (v as Row)[it.path[i]];
    out[it.out] = it.text && v != null && typeof v === "object" ? JSON.stringify(v) : v ?? null;
  }
  return out;
}

// ---------------------------------------------------------------- request handling
export type Stat = { requests: number; rows: number; bytes: number; ms: number; maxMs: number };
export type Result = { status: number; headers: Record<string, string>; body: string; table: string; rows: number };

export const config = { maxRows: Number(process.env.LT_MAX_ROWS || 1000) };

function jsonResult(status: number, payload: unknown, tableName: string, rows: number, headers: Record<string, string> = {}): Result {
  return { status, headers: { "content-type": "application/json", ...headers }, body: payload === undefined ? "" : JSON.stringify(payload), table: tableName, rows };
}

export function handleRest(method: string, path: string, params: URLSearchParams, headers: Record<string, string | undefined>, bodyText: string): Result {
  const name = path.replace(/^\/rest\/v1\//, "");
  if (name.startsWith("rpc/")) return handleRpc(name.slice(4), bodyText);

  const t = table(name);
  const prefer = (headers["prefer"] ?? "").split(",").map((s) => s.trim());
  const wantsRep = prefer.includes("return=representation");
  const wantCount = prefer.some((p) => p.startsWith("count="));
  const accept = headers["accept"] ?? "";
  const single = accept.includes("vnd.pgrst.object+json");
  const nodes = parseFilters(params);
  const proj = parseSelect(params.get("select"));

  if (method === "GET" || method === "HEAD") {
    const matched = matchRows(t, nodes);
    const total = matched.length;
    sortRows(matched, parseOrder(params.get("order")));
    const offset = Number(params.get("offset") || 0);
    const limit = Math.min(params.has("limit") ? Number(params.get("limit")) : Infinity, config.maxRows);
    const page = matched.slice(offset, offset + limit);
    const rangeHdr = { "content-range": `${page.length ? `${offset}-${offset + page.length - 1}` : "*"}/${wantCount ? total : "*"}` };
    if (method === "HEAD") return { status: 200, headers: rangeHdr, body: "", table: name, rows: 0 };
    const rows = page.map((r) => project(r, proj));
    if (single) {
      if (rows.length !== 1) {
        return jsonResult(406, { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" }, name, 0);
      }
      return jsonResult(200, rows[0], name, 1, rangeHdr);
    }
    return jsonResult(200, rows, name, rows.length, rangeHdr);
  }

  if (method === "POST") {
    const parsed = bodyText ? JSON.parse(bodyText) : [];
    const items: Row[] = Array.isArray(parsed) ? parsed : [parsed];
    const resolution = prefer.find((p) => p.startsWith("resolution="));
    const out: Row[] = [];
    const now = new Date().toISOString();
    if (resolution) {
      const keys = (params.get("on_conflict") ?? (PK[name] ?? ["id"]).join(",")).split(",");
      for (const item of items) {
        const found = matchRows(t, keys.map((k): Cond => ({ kind: "cond", col: k, op: "eq", val: String(item[k]), neg: false })));
        if (found.length) {
          if (resolution.endsWith("merge-duplicates")) {
            const old: Row = {};
            for (const k of Object.keys(item)) old[k] = found[0][k];
            Object.assign(found[0], item);
            t.reindex(found[0], old);
            out.push(found[0]);
          }
        } else out.push(insertRow(t, item, now));
      }
    } else for (const item of items) out.push(insertRow(t, item, now));
    if (wantsRep) return jsonResult(201, out.map((r) => project(r, proj)), name, out.length);
    return { status: 201, headers: {}, body: "", table: name, rows: 0 };
  }

  if (method === "PATCH") {
    const patch = JSON.parse(bodyText || "{}") as Row;
    const matched = matchRows(t, nodes);
    for (const row of matched) {
      const old: Row = {};
      for (const k of Object.keys(patch)) old[k] = row[k];
      Object.assign(row, patch);
      t.reindex(row, old);
    }
    if (wantsRep) return jsonResult(200, matched.map((r) => project(r, proj)), name, matched.length);
    return { status: 204, headers: {}, body: "", table: name, rows: 0 };
  }

  if (method === "DELETE") {
    const matched = matchRows(t, nodes);
    for (const row of matched) t.remove(row);
    if (wantsRep) return jsonResult(200, matched.map((r) => project(r, proj)), name, matched.length);
    return { status: 204, headers: {}, body: "", table: name, rows: 0 };
  }

  return jsonResult(405, { message: "method not allowed" }, name, 0);
}

function insertRow(t: Table, item: Row, now: string): Row {
  const row: Row = { ...item };
  const pk = PK[t.name] ?? ["id"];
  if (pk.length === 1 && pk[0] === "id" && row.id == null) row.id = randomUUID();
  if (row.created_at === undefined && !["geo_usage", "geo_locks", "user_settings"].includes(t.name)) row.created_at = now;
  t.add(row);
  return row;
}

export const unknownRpc = new Map<string, number>();

function handleRpc(fn: string, bodyText: string): Result {
  const args = bodyText ? JSON.parse(bodyText) : {};
  const name = `rpc/${fn}`;
  switch (fn) {
    case "geo_last_runs": {
      const ids = new Set<string>(args.p_project_ids ?? []);
      const best = new Map<string, string>();
      for (const r of table("geo_runs").rows) {
        const pid = r.project_id as string;
        if (!ids.has(pid)) continue;
        const at = r.run_at as string;
        if (!best.has(pid) || at > best.get(pid)!) best.set(pid, at);
      }
      const rows = [...best].map(([project_id, last_run_at]) => ({ project_id, last_run_at }));
      return jsonResult(200, rows, name, rows.length);
    }
    case "vault_get_secret": return jsonResult(200, `fake-secret-${args.p_id}`, name, 1);
    case "vault_set_secret": return jsonResult(200, randomUUID(), name, 1);
    case "geo_try_lock":
    case "geo_reserve_slots":
    case "rate_limit_hit":
      return jsonResult(200, true, name, 1);
    case "rate_limits_cleanup": return jsonResult(200, null, name, 0);
    default:
      unknownRpc.set(fn, (unknownRpc.get(fn) ?? 0) + 1);
      return jsonResult(200, null, name, 0);
  }
}
