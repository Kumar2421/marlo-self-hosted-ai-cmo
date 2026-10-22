import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { sqliteSetupStateStore } from "../lib/domain/project/setupStateStore.ts";
import { supabaseSetupStateStore } from "../lib/domain/project/setupStateStoreSupabase.ts";
import { getOrCreateSetupState, recordSetupTransition, startSetupState, type SetupStateStore } from "../lib/domain/project/setupStateService.ts";
import { nextStepsToRun } from "../lib/domain/project/setupState.ts";

const NOW = new Date("2026-10-22T10:00:00.000Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const DOCS = ["product_info", "marketing_strategy", "competitor_analysis", "competitor_comparison", "content_strategy", "design_guide"];

function sqliteDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '');
    CREATE TABLE seo_audits (url TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE project_competitors (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE project_documents (project_id TEXT NOT NULL, doc_type TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', PRIMARY KEY (project_id, doc_type));
    CREATE TABLE project_setup_state (project_id TEXT PRIMARY KEY, steps TEXT NOT NULL, started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL);
  `);
  return db;
}

/** Minimal PostgREST-shaped fake: the chains the store uses, filters by eq(), unique key on project_id. */
function fakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: [string, unknown][] = [];
    let mode: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    let limitN = Infinity;
    const match = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v));
    const run = () => {
      if (mode === "update") {
        const hit = match();
        hit.forEach((r) => Object.assign(r, patch));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      return { data: match().slice(0, limitN).map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      limit: (n: number) => ((limitN = n), q),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      insert: async (row: Record<string, unknown>) => {
        if (table === "project_setup_state" && rows.some((r) => r.project_id === row.project_id)) {
          return { error: { code: "23505", message: "duplicate key" } };
        }
        rows.push({ ...row });
        return { error: null };
      },
      update: (p: Record<string, unknown>) => ((mode = "update"), (patch = p), q),
      then: (resolve: (v: unknown) => unknown) => resolve(run()),
    };
    return q;
  }
  return { from } as unknown as Parameters<typeof supabaseSetupStateStore>[0];
}

type Variant = { name: string; make: () => { store: SetupStateStore; seedComplete: () => void; seedEmpty: () => void } };

const variants: Variant[] = [
  {
    name: "sqlite",
    make: () => {
      const db = sqliteDb();
      db.prepare("INSERT INTO projects (id, url, description) VALUES ('p1', 'https://a.test', 'desc')").run();
      return {
        store: sqliteSetupStateStore(db, "p1"),
        seedComplete: () => {
          db.prepare("INSERT INTO seo_audits VALUES ('https://a.test', '{}', 'x')").run();
          db.prepare("INSERT INTO project_competitors VALUES ('c1', 'p1', 'https://c.test', 'x')").run();
          for (const d of DOCS) db.prepare("INSERT INTO project_documents VALUES ('p1', ?, 'body')").run(d);
        },
        seedEmpty: () => {
          db.prepare("UPDATE projects SET description = '' WHERE id = 'p1'").run();
        },
      };
    },
  },
  {
    name: "supabase",
    make: () => {
      const tables: Record<string, Record<string, unknown>[]> = {
        projects: [{ id: "p1", owner_id: "u1", description: "desc" }],
      };
      return {
        store: supabaseSetupStateStore(fakeSupabase(tables), "u1", "p1"),
        seedComplete: () => {
          tables.seo_audits = [{ id: "a", user_id: "u1", project_id: "p1" }];
          tables.project_competitors = [{ id: "c", user_id: "u1", project_id: "p1" }];
          tables.project_documents = DOCS.map((d) => ({ user_id: "u1", project_id: "p1", doc_type: d, content: "body" }));
        },
        seedEmpty: () => {
          tables.projects[0].description = "";
        },
      };
    },
  },
];

for (const v of variants) {
  test(`${v.name}: a project with no state row but complete documents counts as done, and the row is written lazily`, async () => {
    const { store, seedComplete } = v.make();
    seedComplete();
    assert.equal(await store.load(), null);
    const s = await getOrCreateSetupState(store, NOW);
    assert.equal(nextStepsToRun(s, NOW).length, 0);
    assert.notEqual(await store.load(), null, "row persisted");
  });

  test(`${v.name}: an empty legacy project derives pending steps without starting a run`, async () => {
    const { store, seedEmpty } = v.make();
    seedEmpty();
    const s = await getOrCreateSetupState(store, NOW);
    assert.equal(s.startedAt, null);
    assert.equal(s.steps.audit.status, "pending");
  });

  test(`${v.name}: startSetupState creates a started, all-pending row once`, async () => {
    const { store } = v.make();
    await startSetupState(store, NOW);
    const first = await store.load();
    assert.equal(first?.startedAt, NOW.toISOString());
    await startSetupState(store, later(5000));
    assert.equal((await store.load())?.updatedAt, first?.updatedAt);
  });

  test(`${v.name}: transitions persist and survive a reload of the store`, async () => {
    const { store } = v.make();
    await startSetupState(store, NOW);
    assert.equal((await recordSetupTransition(store, { step: "audit", status: "running" }, later(1000))).ok, true);
    assert.equal((await recordSetupTransition(store, { step: "audit", status: "done" }, later(2000))).ok, true);
    assert.equal((await store.load())?.steps.audit.status, "done");
  });

  test(`${v.name}: a second tab claiming a running step is refused; done cannot go back without retry`, async () => {
    const { store } = v.make();
    await startSetupState(store, NOW);
    await recordSetupTransition(store, { step: "audit", status: "running" }, later(1000));
    assert.equal((await recordSetupTransition(store, { step: "audit", status: "running" }, later(2000))).ok, false);
    await recordSetupTransition(store, { step: "audit", status: "done" }, later(3000));
    assert.equal((await recordSetupTransition(store, { step: "audit", status: "pending" }, later(4000))).ok, false);
  });

  test(`${v.name}: a lost compare-and-set is retried against the winner's row`, async () => {
    const { store } = v.make();
    await startSetupState(store, NOW);
    // Another writer slips in between this writer's read and write.
    let raced = false;
    const racing: SetupStateStore = {
      ...store,
      load: async () => {
        const s = await store.load();
        if (!raced) {
          raced = true;
          await recordSetupTransition(store, { step: "description", status: "done" }, later(500));
        }
        return s;
      },
    };
    const r = await recordSetupTransition(racing, { step: "audit", status: "done" }, later(1000));
    assert.equal(r.ok, true);
    const final = await store.load();
    assert.equal(final?.steps.audit.status, "done");
    assert.equal(final?.steps.description.status, "done", "the other writer's change is kept");
  });
}

test("sqlite: another project's state is never read", async () => {
  const db = sqliteDb();
  await startSetupState(sqliteSetupStateStore(db, "a"), NOW);
  assert.equal(await sqliteSetupStateStore(db, "b").load(), null);
});

test("supabase: another user's row is invisible to the store", async () => {
  const client = fakeSupabase({ projects: [] });
  await startSetupState(supabaseSetupStateStore(client, "u1", "p1"), NOW);
  assert.equal(await supabaseSetupStateStore(client, "u2", "p1").load(), null);
});
