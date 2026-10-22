import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, DEFAULT_FETCH_TIMEOUT_MS, defaultTimeoutMs, fetchJson, fetchWithTimeout } from "../lib/query/fetchJson.ts";
import { shouldRetry } from "../lib/query/retry.ts";
import { nextTabIndex } from "../lib/tabKeys.ts";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch that never answers on its own, only rejecting when its signal aborts (like the real one). */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      // AbortSignal.timeout's timer is unref'd in Node, so keep the event loop alive until it fires.
      setTimeout(() => {}, 200);
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch;
}

test("reads are bounded, writes are not", () => {
  assert.equal(defaultTimeoutMs(undefined), DEFAULT_FETCH_TIMEOUT_MS);
  assert.equal(defaultTimeoutMs("get"), DEFAULT_FETCH_TIMEOUT_MS);
  assert.equal(defaultTimeoutMs("POST"), null);
  assert.equal(defaultTimeoutMs("PUT"), null);
});

test("a read that never answers fails with a timed-out ApiError instead of hanging", async () => {
  globalThis.fetch = hangingFetch();
  await assert.rejects(
    () => fetchJson("/api/x", { timeoutMs: 20 }),
    (err: unknown) => err instanceof ApiError && err.timedOut === true && err.status === 0,
  );
});

test("a write with no explicit timeout is never aborted", async () => {
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    signal = init?.signal;
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await fetchJson("/api/x", { method: "POST" }), { ok: 1 });
  assert.equal(signal, undefined);
});

test("an explicit timeout applies to writes too", async () => {
  globalThis.fetch = hangingFetch();
  await assert.rejects(() => fetchWithTimeout("/api/x", { method: "POST", timeoutMs: 20 }), /taking too long/);
});

test("offline (fetch throws) is a network error, not a timeout", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await assert.rejects(
    () => fetchJson("/api/x"),
    (err: unknown) => err instanceof ApiError && err.timedOut === false && err.status === 0 && /Network error/.test(err.message),
  );
});

test("a caller's own abort is passed through, not reported as a timeout", async () => {
  globalThis.fetch = hangingFetch();
  const controller = new AbortController();
  const pending = fetchWithTimeout("/api/x", { signal: controller.signal });
  controller.abort(new DOMException("cancelled", "AbortError"));
  await assert.rejects(pending, (err: unknown) => !(err instanceof ApiError));
});

test("server errors keep their status and message", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "nope" }), { status: 403 })) as typeof fetch;
  await assert.rejects(
    () => fetchJson("/api/x"),
    (err: unknown) => err instanceof ApiError && err.status === 403 && err.message === "nope",
  );
});

test("timeouts are not retried (that would triple the wait), other flaky failures are", () => {
  assert.equal(shouldRetry(0, new ApiError("slow", 0, true)), false);
  assert.equal(shouldRetry(0, new ApiError("offline", 0)), true);
  assert.equal(shouldRetry(0, new ApiError("boom", 500)), true);
  assert.equal(shouldRetry(0, new ApiError("nope", 404)), false);
  assert.equal(shouldRetry(2, new ApiError("boom", 500)), false);
});

test("nextTabIndex wraps and jumps like the WAI-ARIA tabs pattern", () => {
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
  assert.equal(nextTabIndex("Enter", 0, 3), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
});
