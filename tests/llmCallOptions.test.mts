import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import openaiDriver from "../lib/llm/openai.ts";

// The OpenAI-compatible driver against a local HTTP server, so the timeout, retry and
// abort options are exercised through the real SDK rather than mocked.

type Handler = (hits: number) => Promise<{ status: number; body: unknown; delayMs?: number }>;

async function withServer(handler: Handler, run: (baseUrl: string, hits: () => number) => Promise<void>) {
  let hits = 0;
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 404;
      res.end();
      return;
    }
    req.resume();
    req.on("end", async () => {
      hits += 1;
      const { status, body, delayMs = 0 } = await handler(hits);
      setTimeout(() => {
        if (res.destroyed) return;
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/v1`, () => hits);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const OK_BODY = { id: "c1", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hello" } }] };

test("a successful call returns the model text", async () => {
  await withServer(async () => ({ status: 200, body: OK_BODY }), async (baseUrl) => {
    const result = await openaiDriver({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], baseUrl });
    assert.equal(result.text, "hello");
  });
});

test("timeoutMs: a slow provider is abandoned at the timeout, not after the SDK default", async () => {
  await withServer(
    async () => ({ status: 200, body: OK_BODY, delayMs: 2000 }),
    async (baseUrl) => {
      const started = Date.now();
      await assert.rejects(
        openaiDriver({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], baseUrl, timeoutMs: 150, maxRetries: 0 }),
      );
      assert.ok(Date.now() - started < 1500, "gave up near the 150ms timeout");
    },
  );
});

test("maxRetries 0: a failing provider is called once, not retried", async () => {
  await withServer(
    async () => ({ status: 500, body: { error: { message: "boom", type: "server_error" } } }),
    async (baseUrl, hits) => {
      await assert.rejects(openaiDriver({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], baseUrl, maxRetries: 0 }));
      assert.equal(hits(), 1);
    },
  );
});

test("signal: aborting the request rejects it right away", async () => {
  await withServer(
    async () => ({ status: 200, body: OK_BODY, delayMs: 3000 }),
    async (baseUrl) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      const started = Date.now();
      await assert.rejects(
        openaiDriver({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], baseUrl, signal: controller.signal, maxRetries: 0 }),
      );
      assert.ok(Date.now() - started < 1500, "the abort ended the call early");
    },
  );
});
