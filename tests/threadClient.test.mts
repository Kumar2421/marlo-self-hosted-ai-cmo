import test from "node:test";
import assert from "node:assert/strict";
import { chatSessionReducer, initialChatSessionState, type ChatMsg } from "../lib/domain/chat/chatSessionState.ts";
import {
  initialThreadListState, messagesFromStored, relativeTime, threadListReducer, type ThreadListAction, type ThreadListState,
} from "../lib/domain/chat/threadListState.ts";
import { createThreadsController, type ThreadsApi } from "../lib/domain/chat/threadController.ts";

const item = (id: string, title = id) => ({ id, title, createdAt: "2026-10-23T10:00:00Z", updatedAt: "2026-10-23T10:00:00Z", preview: "" });
const stored = [{ role: "user" as const, content: "hi" }, { role: "assistant" as const, content: "yo", lookedAt: ["findings"] }];

test("session reducer: load replaces the conversation and clears pending", () => {
  const msgs: ChatMsg[] = [{ role: "user", text: "old" }];
  const out = chatSessionReducer({ messages: msgs, pending: true }, { type: "load", messages: [{ role: "assistant", text: "new" }] });
  assert.deepEqual(out, { messages: [{ role: "assistant", text: "new" }], pending: false });
  assert.deepEqual(chatSessionReducer(initialChatSessionState, { type: "load", messages: [] }), initialChatSessionState);
});

test("list reducer: loaded, removed (active resets), cleared, unavailable", () => {
  let s: ThreadListState = initialThreadListState;
  const step = (a: ThreadListAction) => (s = threadListReducer(s, a));
  assert.equal(s.status, "loading");
  step({ type: "loaded", threads: [item("a"), item("b")] });
  step({ type: "activate", id: "a" });
  assert.equal(s.status, "ready");
  step({ type: "removed", id: "b" });
  assert.deepEqual(s.threads.map((t) => t.id), ["a"]);
  assert.equal(s.activeId, "a");
  step({ type: "removed", id: "a" });
  assert.equal(s.activeId, null);
  step({ type: "loaded", threads: [item("c")] });
  step({ type: "clearedAll" });
  assert.deepEqual(s.threads, []);
  step({ type: "unavailable" });
  assert.equal(s.status, "unavailable");
  step({ type: "refreshed", threads: [item("z")] });
  assert.equal(s.status, "unavailable", "a background refresh never revives an unavailable list");
});

test("messagesFromStored maps bubbles and keeps lookedAt only for assistant replies", () => {
  assert.deepEqual(messagesFromStored(stored), [
    { role: "user", text: "hi", lookedAt: undefined },
    { role: "assistant", text: "yo", lookedAt: ["findings"] },
  ]);
});

test("relativeTime", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  assert.equal(relativeTime("2026-10-23T11:59:50Z", now), "just now");
  assert.equal(relativeTime("2026-10-23T11:55:00Z", now), "5 min ago");
  assert.equal(relativeTime("2026-10-23T09:00:00Z", now), "3 h ago");
  assert.equal(relativeTime("2026-10-22T09:00:00Z", now), "yesterday");
  assert.equal(relativeTime("2026-10-19T12:00:00Z", now), "4 d ago");
  assert.equal(relativeTime("garbage", now), "");
});

function harness(over: Partial<ThreadsApi> = {}, projectId: string | null = "p1") {
  const log: string[] = [];
  const actions: ThreadListAction[] = [];
  const loaded: ChatMsg[][] = [];
  let state: ThreadListState = initialThreadListState;
  const api: ThreadsApi = {
    list: async () => ({ kind: "ok", threads: [item("t2"), item("t1")] }),
    open: async (_p, id) => { log.push(`open:${id}`); return { kind: "ok", messages: stored }; },
    remove: async (_p, id) => { log.push(`remove:${id}`); return true; },
    removeAll: async () => { log.push("removeAll"); return true; },
    ...over,
  };
  const c = createThreadsController({
    projectId, api,
    dispatch: (a) => { actions.push(a); state = threadListReducer(state, a); },
    loadMessages: (m) => loaded.push(m),
    getActiveId: () => state.activeId,
  });
  return { c, log, actions, loaded, get state() { return state; } };
}

test("controller: on load the most recent chat is restored", async () => {
  const h = harness();
  await h.c.start();
  assert.deepEqual(h.log, ["open:t2"]);
  assert.equal(h.state.activeId, "t2");
  assert.equal(h.loaded.length, 1);
  assert.equal(h.loaded[0][1].text, "yo");
});

test("controller: no saved chats means nothing to restore (empty state)", async () => {
  const h = harness({ list: async () => ({ kind: "ok", threads: [] }) });
  await h.c.start();
  assert.equal(h.state.status, "ready");
  assert.equal(h.loaded.length, 0);
});

test("controller: unavailable and error states", async () => {
  const u = harness({ list: async () => ({ kind: "unavailable" }) });
  await u.c.start();
  assert.equal(u.state.status, "unavailable");
  assert.equal(u.loaded.length, 0);
  const e = harness({ list: async () => ({ kind: "error" }) });
  await e.c.start();
  assert.equal(e.state.status, "error");
});

test("controller: restore is cancelled when the user starts typing/sending meanwhile", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const h = harness({ open: async () => { await gate; return { kind: "ok", messages: stored }; } });
  const started = h.c.start();
  await new Promise((r) => setTimeout(r, 0));
  h.c.touch();
  release();
  await started;
  assert.equal(h.loaded.length, 0);
  assert.equal(h.state.activeId, null);
});

test("controller: restore is dropped after dispose (project switched)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const h = harness({ list: async () => { await gate; return { kind: "ok", threads: [item("t1")] }; } });
  const started = h.c.start();
  h.c.dispose();
  release();
  await started;
  assert.equal(h.loaded.length, 0);
  assert.equal(h.actions.length, 0);
});

test("controller: open loads a chat; a missing chat is dropped from the list", async () => {
  const h = harness();
  await h.c.start();
  h.loaded.length = 0;
  assert.equal(await h.c.open("t1"), true);
  assert.equal(h.state.activeId, "t1");
  assert.equal(h.loaded.length, 1);

  let calls = 0;
  const gone = harness({
    open: async () => ({ kind: "missing" }),
    list: async () => ({ kind: "ok", threads: calls++ === 0 ? [item("t1"), item("t2")] : [item("t2")] }),
  });
  await gone.c.start();
  assert.equal(await gone.c.open("t1"), false);
  assert.ok(!gone.state.threads.some((t) => t.id === "t1"));
});

test("controller: deleting the active chat clears the conversation; deleting another keeps it", async () => {
  const h = harness();
  await h.c.start();
  h.loaded.length = 0;
  await h.c.remove("t1");
  assert.equal(h.loaded.length, 0);
  assert.equal(h.state.activeId, "t2");
  await h.c.remove("t2");
  assert.deepEqual(h.loaded, [[]]);
  assert.equal(h.state.activeId, null);
});

test("controller: a failed delete changes nothing", async () => {
  const h = harness({ remove: async () => false, removeAll: async () => false });
  await h.c.start();
  h.loaded.length = 0;
  assert.equal(await h.c.remove("t2"), false);
  assert.equal(await h.c.removeAll(), false);
  assert.equal(h.state.threads.length, 2);
  assert.equal(h.loaded.length, 0);
});

test("controller: delete all clears the list and the conversation", async () => {
  const h = harness();
  await h.c.start();
  h.loaded.length = 0;
  await h.c.removeAll();
  assert.deepEqual(h.state.threads, []);
  assert.deepEqual(h.loaded, [[]]);
  assert.equal(h.state.activeId, null);
});

test("controller: new chat clears; noteTurn adopts the server thread id and refreshes the list", async () => {
  const h = harness();
  await h.c.start();
  h.loaded.length = 0;
  h.c.startNew();
  assert.deepEqual(h.loaded, [[]]);
  assert.equal(h.state.activeId, null);
  h.c.noteTurn("t9");
  assert.equal(h.state.activeId, "t9");
  h.c.noteTurn(undefined);
  assert.equal(h.state.activeId, "t9");
});

test("controller: detach keeps the messages but stops using the thread id", async () => {
  const h = harness();
  await h.c.start();
  h.loaded.length = 0;
  h.c.detach();
  assert.equal(h.state.activeId, null);
  assert.equal(h.loaded.length, 0);
});

test("controller: without a project there is nothing to load", async () => {
  const h = harness({}, null);
  await h.c.start();
  assert.equal(h.state.status, "ready");
  assert.deepEqual(h.state.threads, []);
});
