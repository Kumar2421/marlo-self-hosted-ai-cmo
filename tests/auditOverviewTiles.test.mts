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

import { onPageIssues } from "../lib/domain/seo/auditDisplay.ts";

test("onPageIssues drops the duplicate canonical line and PageSpeed notices (5 raw lines -> 3 real issues)", () => {
  const raw = [
    { label: "Missing canonical URL", level: "Warning" as const },
    { label: "Missing Meta Description", level: "Error" as const },
    { label: "Missing canonical tag", level: "Warning" as const },
    { label: "No H1 tag found", level: "Error" as const },
    { label: "PageSpeed Insights was too slow to answer — Performance/CWV not measured this run", level: "Warning" as const },
  ];
  assert.deepEqual(onPageIssues(raw).map((i) => i.label), ["Missing canonical URL", "Missing Meta Description", "No H1 tag found"]);
});

test("the on-page tile is labelled as checks, not as audit issues", () => {
  assert.equal(auditOverviewTiles({ needsAttention: 1, lighthouse: 0, onPage: 2 })[2].label, "On-page checks");
});
