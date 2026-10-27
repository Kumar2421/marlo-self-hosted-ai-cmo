import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const pkg = JSON.parse(read("../package.json"));
const manifest = JSON.parse(read("../mcpb/manifest.template.json").replaceAll("__VERSION__", pkg.version));

test("the bundle manifest matches the package", () => {
  assert.equal(manifest.manifest_version, "0.3");
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.license, pkg.license);
  assert.ok(existsSync(fileURLToPath(new URL(`../${manifest.server.entry_point}`, import.meta.url))), "entry point exists");
  assert.ok(manifest.server.mcp_config.args[0].endsWith(manifest.server.entry_point));
});

test("the bundle declares the one tool the server registers, and a privacy policy", () => {
  assert.deepEqual(manifest.tools.map((t) => t.name), ["audit_site"]);
  assert.match(read("../bin/marlo-mcp.mjs"), /registerTool\(\s*"audit_site"/);
  assert.ok(manifest.privacy_policies.every((u) => u.startsWith("https://")));
});

test("settings flow into the environment variables the server reads, and the password is secret", () => {
  const env = manifest.server.mcp_config.env;
  assert.deepEqual(Object.keys(env).sort(), ["MARLO_ACCESS_PASSWORD", "MARLO_BASE_URL"]);
  for (const value of Object.values(env)) {
    const key = /^\$\{user_config\.([a-z_]+)\}$/.exec(value)?.[1];
    assert.ok(key && manifest.user_config[key], `${value} refers to a declared setting`);
    assert.equal(manifest.user_config[key].required, false);
  }
  assert.equal(manifest.user_config.access_password.sensitive, true);
  for (const name of Object.keys(env)) assert.match(read("../src/audit.mjs"), new RegExp(name));
});
