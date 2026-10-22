import test from "node:test";
import assert from "node:assert/strict";
import { fetchSetupView } from "../lib/setup-client.ts";
import { newSetupState, summarizeSetup } from "../lib/domain/project/setupState.ts";

const NOW = new Date("2026-10-22T10:00:00.000Z");

function stubFetch(res: { ok?: boolean; body?: unknown; throws?: boolean }) {
  globalThis.fetch = (async () => {
    if (res.throws) throw new Error("offline");
    return { ok: res.ok ?? true, json: async () => res.body } as Response;
  }) as typeof fetch;
}

test("fetchSetupView returns a well-formed view", async () => {
  const state = newSetupState(NOW, true);
  const body = { state, summary: summarizeSetup(state, NOW), serverTime: NOW.toISOString() };
  stubFetch({ body });
  assert.deepEqual(await fetchSetupView("p1"), body);
});

test("fetchSetupView treats an empty or malformed body as unreadable (null), not a crash later", async () => {
  for (const body of [{}, null, "oops", { state: {}, serverTime: "x" }, { state: { steps: {} } }]) {
    stubFetch({ body });
    assert.equal(await fetchSetupView("p1"), null, JSON.stringify(body));
  }
});

test("fetchSetupView is null on HTTP errors and network failures", async () => {
  stubFetch({ ok: false, body: { error: "relation does not exist" } });
  assert.equal(await fetchSetupView(), null);
  stubFetch({ throws: true });
  assert.equal(await fetchSetupView(), null);
});
