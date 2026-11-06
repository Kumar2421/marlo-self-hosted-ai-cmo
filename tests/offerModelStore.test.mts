import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getOfferModel, saveOfferModel, OFFER_MODEL_DOC } from "../lib/domain/offer/offerModelStore.ts";
import { normalizeOfferModel } from "../lib/domain/offer/offerModel.ts";

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE project_documents (
    project_id TEXT NOT NULL, doc_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ready',
    content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, doc_type))`);
  return db;
}

test("nothing saved yet means no offer model", () => {
  assert.equal(getOfferModel(memoryDb(), "p1"), null);
});

test("save then read back, per project, and saving again replaces it", () => {
  const db = memoryDb();
  saveOfferModel(db, "p1", normalizeOfferModel({ whoPays: "clinics", sells: "software" }));
  saveOfferModel(db, "p2", normalizeOfferModel({ whoPays: "shops" }));
  assert.equal(getOfferModel(db, "p1")?.whoPays, "clinics");
  assert.equal(getOfferModel(db, "p2")?.whoPays, "shops");
  saveOfferModel(db, "p1", normalizeOfferModel({ whoPays: "schools" }));
  assert.equal(getOfferModel(db, "p1")?.whoPays, "schools");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM project_documents WHERE doc_type = ?").get(OFFER_MODEL_DOC) as { n: number }).n, 2);
});

test("a corrupt stored row reads as no offer model instead of throwing", () => {
  const db = memoryDb();
  db.prepare("INSERT INTO project_documents (project_id, doc_type, content, created_at, updated_at) VALUES ('p1', ?, 'not json', 'a', 'b')").run(OFFER_MODEL_DOC);
  assert.equal(getOfferModel(db, "p1"), null);
});

test("what is read back is re-normalized, so a tampered row cannot smuggle in bad fields", () => {
  const db = memoryDb();
  db.prepare("INSERT INTO project_documents (project_id, doc_type, content, created_at, updated_at) VALUES ('p1', ?, ?, 'a', 'b')").run(
    OFFER_MODEL_DOC,
    JSON.stringify({ archetype: "hacker", roles: ["A", "A", 7], whoPays: "x".repeat(900) }),
  );
  const m = getOfferModel(db, "p1");
  assert.equal(m?.archetype, null);
  assert.deepEqual(m?.roles, ["A"]);
  assert.equal(m?.whoPays.length, 160);
});
