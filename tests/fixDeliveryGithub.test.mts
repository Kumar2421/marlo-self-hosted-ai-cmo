import test from "node:test";
import assert from "node:assert/strict";
import { fixDeliveryGithub } from "../lib/domain/fixes/fixDeliveryGithub.ts";

const PR = "https://github.com/o/r/pull/3";

/** Runs one status check against a stubbed GitHub response (or a network failure), restoring fetch afterwards. */
async function statusWith(respond: () => Promise<Response>, prUrl = PR) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => respond()) as typeof fetch;
  try {
    return await fixDeliveryGithub("token-for-test").status(prUrl);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("an open PR is open", async () => {
  assert.deepEqual(await statusWith(async () => json(200, { state: "open", merged_at: null })), { state: "open" });
});

test("a merged PR is merged, with its merge time", async () => {
  const mergedAt = "2026-10-05T12:00:00Z";
  assert.deepEqual(await statusWith(async () => json(200, { state: "closed", merged_at: mergedAt })), { state: "merged", mergedAt });
});

test("a PR closed WITHOUT a merge is closed", async () => {
  assert.deepEqual(await statusWith(async () => json(200, { state: "closed", merged_at: null })), { state: "closed" });
});

test("a non-OK response (token problem, outage, missing PR) is unknown, never closed", async () => {
  for (const status of [401, 403, 404, 500, 503]) {
    assert.deepEqual(await statusWith(async () => json(status, { message: "nope" })), { state: "unknown" }, `HTTP ${status}`);
  }
});

test("a network error is unknown, never closed", async () => {
  assert.deepEqual(await statusWith(async () => { throw new TypeError("fetch failed"); }), { state: "unknown" });
});

test("a body we cannot read or do not understand is unknown", async () => {
  assert.deepEqual(await statusWith(async () => new Response("not json", { status: 200 })), { state: "unknown" });
  assert.deepEqual(await statusWith(async () => json(200, { unexpected: true })), { state: "unknown" });
});

test("a URL that is not a GitHub pull request is unknown and makes no request", async () => {
  let called = false;
  const result = await statusWith(async () => { called = true; return json(200, { state: "open" }); }, "https://example.com/pull/3");
  assert.deepEqual(result, { state: "unknown" });
  assert.equal(called, false);
});

test("a GitHub call that hangs is cut off by a timeout and reported unknown, never closed", async () => {
  const originalTimeout = AbortSignal.timeout;
  const originalFetch = globalThis.fetch;
  const requested: number[] = [];
  let signalSeen: AbortSignal | undefined;
  // Stand-in for the timeout: aborts after 20ms instead of 5s. A ref'd timer keeps the test alive while it waits.
  AbortSignal.timeout = ((ms: number) => {
    requested.push(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("timed out")), 20);
    return controller.signal;
  }) as typeof AbortSignal.timeout;
  // A fetch that never answers on its own; it only ends when the request's signal aborts.
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    signalSeen = init?.signal ?? undefined;
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    });
  }) as typeof fetch;
  try {
    assert.deepEqual(await fixDeliveryGithub("token-for-test").status(PR), { state: "unknown" });
    assert.deepEqual(requested, [5000], "the request is bounded by a 5 second timeout");
    assert.ok(signalSeen?.aborted, "the request was actually aborted");
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});
