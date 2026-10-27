// Builds dist-mcpb/marlo-mcp-<version>.mcpb: a one-click bundle for Claude Desktop and the
// "local server" path on Smithery. The manifest version always comes from package.json.
// Usage: npm run bundle
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const MCPB_CLI = "@anthropic-ai/mcpb@2.1.2";
const dist = join(root, "dist-mcpb");
const stage = join(dist, "stage");
const out = join(dist, `marlo-mcp-${pkg.version}.mcpb`);

function run(args, cwd) {
  const res = spawnSync("npx", ["-y", ...args], { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) throw new Error(`Command failed: npx ${args.join(" ")}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const item of ["bin", "src", "LICENSE", "README.md", "package.json", "package-lock.json"]) {
  cpSync(join(root, item), join(stage, item), { recursive: true });
}
const manifest = readFileSync(join(root, "mcpb", "manifest.template.json"), "utf8").replaceAll("__VERSION__", pkg.version);
writeFileSync(join(stage, "manifest.json"), manifest);

const install = spawnSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: stage, stdio: "inherit", shell: process.platform === "win32" });
if (install.status !== 0) throw new Error("npm ci failed");

run([MCPB_CLI, "validate", join(stage, "manifest.json")], root);
run([MCPB_CLI, "pack", stage, out], root);
if (!existsSync(out)) throw new Error("The bundle was not created.");
console.log(`\nBuilt ${out}`);
