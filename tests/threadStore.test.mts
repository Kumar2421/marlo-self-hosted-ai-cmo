import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { CHAT_THREADS_SQLITE_DDL } from "../lib/domain/assistant/threadSchema.ts";
import {
  THREAD_LIST_LIMIT, THREAD_MESSAGES_LIMIT, ThreadsUnavailableError, deriveThreadTitle, memoryThreadStore, sqliteThreadStore,
  type ThreadStore,
} from "../lib/domain/assistant/threadStore.ts";
import { supabaseThreadStore } from "../lib/domain/assistant/threadStoreSupabase.ts";

const DAY = 86_400_000;
const T0 = new Date("2026-10-23T12:00:00.000Z");

function clock(start = T0) {
  let t = start.getTime();
  return { now: () => new Date(t), set: (d: Date) => { t = d.getTime(); }, tick: (ms = 1000) => { t += ms; } };
}

const makers: [string, (c: ReturnType<typeof clock>) => ThreadStore][] = [
  ["memory", (c) => memoryThreadStore({ now: c.now })],
  ["sqlite", (c) => {
    const db = new Database(":memory:");
    db.exec(CHAT_THREADS_SQLITE_DDL);
    return sqliteThreadStore(() => db, { now: c.now });
  }],
];

const alice = { userId: "u-alice", projectId: "p1" };
const bob = { userId: "u-bob", projectId: "p1" };
const aliceP2 = { userId: "u-alice", projectId: "p2" };

for (const [name, make] of makers) {
  test(`${name}: create, append, list with preview, get`, async () => {
    const c = clock();
    const s = make(c);
    const t = await s.createThread(alice, "Hello there");
    assert.equal(t.title, "Hello there");
    c.tick();
    assert.equal(await s.appendMessages(alice, t.id, [
      { role: "user", content: "Hello there" },
      { role: "assistant", content: "Hi!  How can I\nhelp?", toolsUsed: ["getFindings"], lookedAt: ["findings"] },
    ]), true);
    const list = await s.listThreads(alice);
    assert.equal(list.length, 1);
    assert.equal(list[0].preview, "Hi! How can I help?");
    const got = await s.getThread(alice, t.id);
    assert.deepEqual(got?.messages.map((m) => [m.role, m.content]), [["user", "Hello there"], ["assistant", "Hi!  How can I\nhelp?"]]);
    assert.deepEqual(got?.messages[1].toolsUsed, ["getFindings"]);
    assert.deepEqual(got?.messages[1].lookedAt, ["findings"]);
  });

  test(`${name}: list is newest-activity first and limited to ${THREAD_LIST_LIMIT}`, async () => {
    const c = clock();
    const s = make(c);
    const a = await s.createThread(alice, "a"); c.tick();
    await s.createThread(alice, "b"); c.tick();
    await s.appendMessages(alice, a.id, [{ role: "user", content: "bump" }]);
    assert.deepEqual((await s.listThreads(alice)).map((t) => t.title), ["a", "b"]);
    for (let i = 0; i < 60; i++) { c.tick(); await s.createThread(alice, `t${i}`); }
    const list = await s.listThreads(alice);
    assert.equal(list.length, THREAD_LIST_LIMIT);
    assert.equal(list[0].title, "t59");
  });

  test(`${name}: getThread returns the newest ${THREAD_MESSAGES_LIMIT} messages oldest first; recentMessages honours its limit`, async () => {
    const c = clock();
    const s = make(c);
    const t = await s.createThread(alice, "long");
    for (let i = 0; i < 210; i++) { c.tick(10); await s.appendMessages(alice, t.id, [{ role: i % 2 ? "assistant" : "user", content: `m${i}` }]); }
    const got = await s.getThread(alice, t.id);
    assert.equal(got?.messages.length, THREAD_MESSAGES_LIMIT);
    assert.equal(got?.messages[0].content, "m10");
    assert.equal(got?.messages.at(-1)?.content, "m209");
    const recent = await s.recentMessages(alice, t.id, 3);
    assert.deepEqual(recent?.map((m) => m.content), ["m207", "m208", "m209"]);
  });

  test(`${name}: messages in one batch keep their order`, async () => {
    const s = make(clock());
    const t = await s.createThread(alice, "x");
    await s.appendMessages(alice, t.id, [{ role: "user", content: "q" }, { role: "assistant", content: "a" }]);
    assert.deepEqual((await s.recentMessages(alice, t.id, 20))?.map((m) => m.role), ["user", "assistant"]);
  });

  test(`${name}: content over 8000 characters is clamped`, async () => {
    const s = make(clock());
    const t = await s.createThread(alice, "x");
    await s.appendMessages(alice, t.id, [{ role: "assistant", content: "z".repeat(9000) }]);
    assert.equal((await s.getThread(alice, t.id))?.messages[0].content.length, 8000);
  });

  test(`${name}: rename and delete`, async () => {
    const s = make(clock());
    const t = await s.createThread(alice, "old");
    assert.equal(await s.renameThread(alice, t.id, "  new\nname "), true);
    assert.equal((await s.listThreads(alice))[0].title, "new name");
    assert.equal(await s.deleteThread(alice, t.id), true);
    assert.equal(await s.deleteThread(alice, t.id), false);
    assert.equal(await s.getThread(alice, t.id), null);
  });

  test(`${name}: another user's thread id finds nothing and deletes nothing`, async () => {
    const s = make(clock());
    const t = await s.createThread(alice, "private");
    await s.appendMessages(alice, t.id, [{ role: "user", content: "secret" }]);
    assert.equal(await s.getThread(bob, t.id), null);
    assert.equal(await s.recentMessages(bob, t.id, 20), null);
    assert.equal(await s.appendMessages(bob, t.id, [{ role: "user", content: "inject" }]), false);
    assert.equal(await s.renameThread(bob, t.id, "pwned"), false);
    assert.equal(await s.deleteThread(bob, t.id), false);
    assert.deepEqual(await s.listThreads(bob), []);
    assert.equal(await s.deleteAllThreads(bob), 0);
    const still = await s.getThread(alice, t.id);
    assert.equal(still?.thread.title, "private");
    assert.equal(still?.messages.length, 1);
  });

  test(`${name}: a thread is scoped to its project`, async () => {
    const s = make(clock());
    const t = await s.createThread(alice, "p1 chat");
    assert.equal(await s.getThread(aliceP2, t.id), null);
    assert.equal(await s.deleteThread(aliceP2, t.id), false);
    assert.deepEqual(await s.listThreads(aliceP2), []);
  });

  test(`${name}: deleteAllThreads only removes the caller's threads in that project`, async () => {
    const s = make(clock());
    await s.createThread(alice, "a1");
    await s.createThread(alice, "a2");
    await s.createThread(aliceP2, "other project");
    await s.createThread(bob, "bob");
    assert.equal(await s.deleteAllThreads(alice), 2);
    assert.equal((await s.listThreads(alice)).length, 0);
    assert.equal((await s.listThreads(aliceP2)).length, 1);
    assert.equal((await s.listThreads(bob)).length, 1);
  });

  test(`${name}: self-host (null user) works as a single local owner`, async () => {
    const s = make(clock());
    const local = { userId: null, projectId: "p1" };
    const t = await s.createThread(local, "mine");
    assert.equal((await s.listThreads(local)).length, 1);
    assert.equal(await s.getThread(alice, t.id), null);
  });

  test(`${name}: retention purge at the 90-day boundary`, async () => {
    const c = clock();
    const s = make(c);
    const at = (ms: number) => { c.set(new Date(T0.getTime() - ms)); };
    at(90 * DAY + 1); const old = await s.createThread(alice, "just over 90 days");
    await s.appendMessages(alice, old.id, [{ role: "user", content: "x" }]);
    at(90 * DAY); const edge = await s.createThread(alice, "exactly 90 days");
    at(89 * DAY); const fresh = await s.createThread(bob, "fresh");
    c.set(T0);
    assert.equal(await s.purgeOlderThan(90, T0), 1);
    assert.equal(await s.getThread(alice, old.id), null);
    assert.ok(await s.getThread(alice, edge.id));
    assert.ok(await s.getThread(bob, fresh.id));
    assert.equal(await s.purgeOlderThan(90, T0), 0, "idempotent");
  });

  test(`${name}: a new message refreshes the retention clock`, async () => {
    const c = clock();
    const s = make(c);
    c.set(new Date(T0.getTime() - 200 * DAY));
    const t = await s.createThread(alice, "old but alive");
    c.set(new Date(T0.getTime() - 10 * DAY));
    await s.appendMessages(alice, t.id, [{ role: "user", content: "still here" }]);
    c.set(T0);
    assert.equal(await s.purgeOlderThan(90, T0), 0);
  });
}

test("sqlite: deleting a thread removes its messages (cascade)", async () => {
  const db = new Database(":memory:");
  db.exec(CHAT_THREADS_SQLITE_DDL);
  const s = sqliteThreadStore(() => db);
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number }).n;
  const t = await s.createThread(alice, "x");
  await s.appendMessages(alice, t.id, [{ role: "user", content: "a" }, { role: "assistant", content: "b" }]);
  const other = await s.createThread(alice, "y");
  await s.appendMessages(alice, other.id, [{ role: "user", content: "keep" }]);
  assert.equal(count(), 3);
  await s.deleteThread(alice, t.id);
  assert.equal(count(), 1);
  await s.deleteAllThreads(alice);
  assert.equal(count(), 0);
});

test("sqlite: purge removes the messages of purged threads", async () => {
  const c = clock(new Date(T0.getTime() - 100 * DAY));
  const db = new Database(":memory:");
  db.exec(CHAT_THREADS_SQLITE_DDL);
  const s = sqliteThreadStore(() => db, { now: c.now });
  const t = await s.createThread(alice, "old");
  await s.appendMessages(alice, t.id, [{ role: "user", content: "a" }]);
  await s.purgeOlderThan(90, T0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number }).n, 0);
});

test("sqlite: schema rejects an invalid role and over-long content", () => {
  const db = new Database(":memory:");
  db.exec(CHAT_THREADS_SQLITE_DDL);
  db.prepare("INSERT INTO chat_threads VALUES ('t','u','p','','x','x')").run();
  assert.throws(() => db.prepare("INSERT INTO chat_messages (id,thread_id,user_id,role,content,created_at) VALUES ('m','t','u','system','c','x')").run());
  assert.throws(() => db.prepare("INSERT INTO chat_messages (id,thread_id,user_id,role,content,created_at) VALUES ('m','t','u','user',?, 'x')").run("z".repeat(8001)));
});

// ------------------------------------------------------------ unavailable

test("sqlite without the tables reports unavailable", async () => {
  const db = new Database(":memory:");
  const s = sqliteThreadStore(() => db);
  assert.equal(await s.isAvailable(), false);
  await assert.rejects(() => s.listThreads(alice), ThreadsUnavailableError);
  await assert.rejects(() => s.createThread(alice, "x"), ThreadsUnavailableError);
});

test("memory store can be switched to unavailable", async () => {
  const s = memoryThreadStore();
  s.setUnavailable(true);
  assert.equal(await s.isAvailable(), false);
  await assert.rejects(() => s.listThreads(alice), ThreadsUnavailableError);
});

function failingClient(error: { code?: string; message?: string }) {
  const chain: Record<string, unknown> = {};
  const result = Promise.resolve({ data: null, error });
  for (const m of ["select", "insert", "update", "delete", "eq", "in", "lt", "order", "limit", "single", "maybeSingle"]) chain[m] = () => chain;
  chain.then = result.then.bind(result);
  return { from: () => chain } as never;
}

for (const error of [
  { code: "42P01", message: "relation does not exist" },
  { code: "PGRST205", message: "Could not find the table 'public.chat_threads' in the schema cache" },
]) {
  test(`supabase store maps ${error.code} to unavailable`, async () => {
    const s = supabaseThreadStore(() => failingClient(error));
    assert.equal(await s.isAvailable(), false);
    await assert.rejects(() => s.listThreads(alice), ThreadsUnavailableError);
    await assert.rejects(() => s.createThread(alice, "x"), ThreadsUnavailableError);
    await assert.rejects(() => s.purgeOlderThan(90), ThreadsUnavailableError);
  });
}

test("supabase store: a real error is not mistaken for unavailable", async () => {
  const s = supabaseThreadStore(() => failingClient({ code: "XX000", message: "boom" }));
  await assert.rejects(() => s.listThreads(alice), /boom/);
});

test("supabase store: a non-uuid id is simply not found, without a query", async () => {
  let queried = false;
  const s = supabaseThreadStore(() => { queried = true; return failingClient({ message: "x" }); });
  assert.equal(await s.deleteThread(alice, "not-a-uuid"), false);
  assert.equal(await s.renameThread(alice, "../x", "t"), false);
  assert.equal(queried, false);
});

// ------------------------------------------------------------ titles

test("deriveThreadTitle: single line, sanitised, 60 characters", () => {
  assert.equal(deriveThreadTitle("  What should\n\tI fix   first?  "), "What should I fix first?");
  assert.equal(deriveThreadTitle("a".repeat(100)).length, 60);
  assert.equal(deriveThreadTitle("bell" + String.fromCharCode(7) + "char"), "bell char");
  assert.equal(deriveThreadTitle("   \n "), "New chat");
  assert.equal(deriveThreadTitle(undefined), "New chat");
  assert.equal(deriveThreadTitle("x".repeat(59) + "  y"), "x".repeat(59));
  assert.equal(Array.from(deriveThreadTitle("😀".repeat(80))).length, 60);
});
