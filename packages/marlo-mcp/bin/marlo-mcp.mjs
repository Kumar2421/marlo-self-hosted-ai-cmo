#!/usr/bin/env node
// Marlo MCP server (stdio). One read-only tool: audit a public web page.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatAudit, parseTargetUrl, resolveConfig, runAudit } from "../src/audit.mjs";

const server = new McpServer({ name: "marlo", version: "0.1.0" });

server.registerTool(
  "audit_site",
  {
    title: "Audit a web page for SEO and AI-readiness",
    description:
      "Audit one public web page and return its top SEO and technical issues, each with evidence, why it matters and a concrete fix. " +
      "Read-only: it fetches the page and changes nothing. Covers a single page, not a whole site.",
    inputSchema: { url: z.string().describe("The page to audit, for example https://example.com or example.com") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ url }) => {
    try {
      const target = parseTargetUrl(url);
      const result = await runAudit(target, resolveConfig(process.env));
      return { content: [{ type: "text", text: formatAudit(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The audit failed." }] };
    }
  },
);

await server.connect(new StdioServerTransport());
