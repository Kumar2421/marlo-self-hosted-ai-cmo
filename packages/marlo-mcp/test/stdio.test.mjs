import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BIN = fileURLToPath(new URL("../bin/marlo-mcp.mjs", import.meta.url));

function startFakeMarlo() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body });
      const target = JSON.parse(body || "{}").url ?? "";
      if (target.includes("limited")) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "12" });
        return res.end(JSON.stringify({ error: "Too many audits." }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        url: target,
        findings: [{ issueId: "t", category: "On-page", severity: "Error", label: "Missing page title", evidence: { titleLength: 0 }, autoFixable: false, whyItMatters: "Titles matter.", recommendation: "Add a title." }],
        summary: { totalFindings: 1, critical: 1, warnings: 0 },
        technical: { onPageScore: 60, status: 200, redirectCount: 0 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, port: server.address().port })));
}

async function connect(env) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], env: { ...process.env, ...env }, stderr: "pipe" });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

test("a real MCP client can list and call audit_site over stdio", async () => {
  const fake = await startFakeMarlo();
  const client = await connect({ MARLO_BASE_URL: `http://127.0.0.1:${fake.port}`, MARLO_ACCESS_PASSWORD: "pw" });
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["audit_site"]);
    assert.equal(tools[0].annotations?.readOnlyHint, true);

    const ok = await client.callTool({ name: "audit_site", arguments: { url: "example.com" } });
    assert.notEqual(ok.isError, true);
    assert.match(ok.content[0].text, /Marlo audit of https:\/\/example\.com\//);
    assert.match(ok.content[0].text, /Missing page title/);
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0].url, "/api/public/audit");
    assert.deepEqual(JSON.parse(fake.requests[0].body), { url: "https://example.com/" });
    assert.match(fake.requests[0].auth ?? "", /^Basic /);

    const limited = await client.callTool({ name: "audit_site", arguments: { url: "https://limited.test" } });
    assert.equal(limited.isError, true);
    assert.match(limited.content[0].text, /about 12 seconds/);

    const bad = await client.callTool({ name: "audit_site", arguments: { url: "file:///etc/passwd" } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /http and https/);
    assert.equal(fake.requests.length, 2, "a refused address never reaches the server");
  } finally {
    await client.close();
    fake.server.close();
  }
});
