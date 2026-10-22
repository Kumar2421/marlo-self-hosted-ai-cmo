import test from "node:test";
import assert from "node:assert/strict";
import { auditOverviewTiles } from "../lib/domain/seo/auditDisplay.ts";

test("three different numbers keep three tiles", () => {
  const tiles = auditOverviewTiles({ needsAttention: 12, lighthouse: 0, onPage: 1 });
  assert.deepEqual(tiles.map((t) => [t.key, t.value]), [["findings", 12], ["lighthouse", 0], ["onpage", 1]]);
});

test("identical numbers merge into one tile that says they agree", () => {
  const tiles = auditOverviewTiles({ needsAttention: 4, lighthouse: 4, onPage: 4 });
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].value, 4);
  assert.match(tiles[0].caption, /agree/);
});

test("zeros everywhere merge too", () => {
  assert.equal(auditOverviewTiles({ needsAttention: 0, lighthouse: 0, onPage: 0 }).length, 1);
});

test("findings still loading (no number) never merge, and show a dash value", () => {
  const tiles = auditOverviewTiles({ needsAttention: null, lighthouse: 0, onPage: 0 });
  assert.equal(tiles.length, 3);
  assert.equal(tiles[0].value, null);
});
