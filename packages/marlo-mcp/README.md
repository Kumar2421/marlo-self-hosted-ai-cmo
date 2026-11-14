# marlo-mcp

An [MCP](https://modelcontextprotocol.io) server that lets Claude, Cursor and other AI assistants audit a web page for SEO and technical issues with [Marlo](https://github.com/Kumar2421/okara-alternative), the open-source AI CMO.

Ask your assistant things like:

- "Audit https://mysite.com and tell me what to fix first."
- "Check this page before I ship it."

It has one tool, `audit_site`. It is **read-only**: it fetches the page and changes nothing. It checks **one page**, and returns the top findings, each with evidence, why it matters and a concrete fix.

## Install

Add it to your MCP client. For Claude Desktop, Cursor, Windsurf and similar clients:

```json
{
  "mcpServers": {
    "marlo": {
      "command": "npx",
      "args": ["-y", "marlo-mcp"]
    }
  }
}
```

For Claude Code: `claude mcp add marlo -- npx -y marlo-mcp`

Requires Node.js 20 or newer.

## Claude Desktop (one click)

Build the bundle and open the `.mcpb` file with Claude Desktop (or drag it into Settings, Extensions):

```bash
npm run bundle   # writes dist-mcpb/marlo-mcp-<version>.mcpb
```

It asks for two optional settings: your own Marlo server and its access password. Leave both empty to use the hosted Marlo. The same file is what Smithery asks for when you add a local server.

## Use your own Marlo server

By default the tool calls the hosted Marlo at `https://app.marlo.mlforge.in`, which rate limits public audits. To use your own [self-hosted](https://github.com/Kumar2421/okara-alternative/blob/main/docs/self-hosting.md) Marlo instead:

| Variable | Purpose |
|---|---|
| `MARLO_BASE_URL` | Your server, for example `http://localhost:3000` |
| `MARLO_ACCESS_PASSWORD` | Your server's `MARLO_ACCESS_PASSWORD`, if you set one. It is only ever sent to `MARLO_BASE_URL`, never to the hosted app. |

```json
{
  "mcpServers": {
    "marlo": {
      "command": "npx",
      "args": ["-y", "marlo-mcp"],
      "env": { "MARLO_BASE_URL": "http://localhost:3000" }
    }
  }
}
```

## What it sends

Only the page address you ask about, to Marlo's public audit endpoint. No API keys, files or conversation text leave your machine. Private and local addresses are refused by the server.

## Limits

- One page per call, and the top three findings. The full product tracks findings over time, checks AI readiness (GEO), reads Search Console and opens draft fix PRs on GitHub.
- The hosted endpoint is rate limited. If you hit the limit, the tool says so and when to retry.

## Development

```bash
npm install
npm test
node bin/marlo-mcp.mjs   # speaks MCP over stdio
```

License: AGPL-3.0, same as Marlo.
