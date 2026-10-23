import { test } from "node:test";
import * as assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const guarded = [
  join(root, "lib/domain/chat/tools.ts"),
  join(root, "lib/domain/chat/toolLoop.ts"),
  join(root, "lib/domain/chat/toolSchema.ts"),
  join(root, "lib/domain/chat/untrusted.ts"),
  join(root, "lib/domain/chat/toolAudit.ts"),
  join(root, "lib/domain/chat/chatQueries.ts"),
  ...walk(join(root, "lib/domain/assistant/gateway")),
];

// Anything that gives a path to the service role, the local DB handle, or stored secrets.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bgetDb\b/, "getDb"],
  [/createServiceClient/, "createServiceClient"],
  [/serviceClient/, "serviceClient module"],
  [/service_role/i, "service_role"],
  [/SUPABASE_SECRET_KEY/, "SUPABASE_SECRET_KEY"],
  [/vault/i, "vault helpers"],
  [/from\s+["']@\/lib\/db["']/, "@/lib/db"],
  [/platformKeys|resolveLlmCredential|credentialResolver/, "credential helpers"],
];

test("static guard: the chat tool layer and the gateway cannot reach service-role, local DB or vault code", () => {
  assert.ok(guarded.length >= 10, "guard sees the gateway files");
  for (const file of guarded) {
    const text = readFileSync(file, "utf8");
    for (const [re, label] of FORBIDDEN) {
      assert.ok(!re.test(text), `${relative(root, file)} must not reference ${label}`);
    }
  }
});

test("static guard: the gateway exposes no generic query function and no writes", () => {
  const types = readFileSync(join(root, "lib/domain/assistant/gateway/types.ts"), "utf8");
  const iface = types.slice(types.indexOf("export interface DataGateway"), types.indexOf("}\n", types.indexOf("export interface DataGateway")));
  const methods = [...iface.matchAll(/^\s+(\w+)\(([^)]*)\)/gm)];
  assert.ok(methods.length >= 8);
  for (const m of methods) {
    assert.match(m[2], /^scope: GatewayScope/, `${m[1]} must take the scope first`);
    assert.ok(!/^(query|sql|raw|exec|run|from|table|insert|update|upsert|delete|write|set)/i.test(m[1]), `${m[1]} looks generic or mutating`);
  }
  for (const file of walk(join(root, "lib/domain/assistant/gateway"))) {
    const text = readFileSync(file, "utf8");
    assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(text), `${relative(root, file)} must be read-only`);
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\s/.test(text.replace(/\/\*[\s\S]*?\*\//g, "")), `${relative(root, file)} has a SQL write`);
  }
});

test("platform adapter: data reads use the user client; the service client is only for credentials", () => {
  const text = readFileSync(join(root, "lib/domain/assistant/platformAdapters.ts"), "utf8");
  // Every getServiceDb() use must sit inside the credentials.resolve block.
  const uses = [...text.matchAll(/getServiceDb\(\)/g)].map((m) => m.index as number);
  const credStart = text.indexOf("credentials:");
  const credEnd = text.indexOf("credits:");
  const defStart = text.indexOf("const getServiceDb");
  for (const at of uses) {
    const line = text.slice(text.lastIndexOf("
", at) + 1, text.indexOf("
", at));
    const entitlement = /platformEntitlementPort(getServiceDb)/.test(line); // usage_events count, not chat data
    assert.ok((at > credStart && at < credEnd) || (at >= defStart && at < defStart + 80) || entitlement, "getServiceDb used outside credentials");
  }
  assert.ok(text.includes("createSupabaseGateway(await getUserDb())"));
});
