import test from "node:test";
import assert from "node:assert/strict";
import { splitMarkdownTables, splitTableRow } from "../lib/markdown-tables.ts";

test("a pipe table is extracted with its header, alignment and rows", () => {
  const md = [
    "## 1. Brand Colors",
    "",
    "| Role | Value | Source |",
    "|------|:-----:|-------:|",
    "| Theme color | #111111 | meta theme-color |",
    "| Accent | Not stated on the page | — |",
    "",
    "## 2. Typography",
    "Inter",
  ].join("\n");
  const segs = splitMarkdownTables(md);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].kind, "markdown");
  assert.match((segs[0] as { text: string }).text, /## 1\. Brand Colors/);
  assert.deepEqual(segs[1], {
    kind: "table",
    header: ["Role", "Value", "Source"],
    align: [null, "center", "right"],
    rows: [
      ["Theme color", "#111111", "meta theme-color"],
      ["Accent", "Not stated on the page", "—"],
    ],
  });
  assert.equal(segs[2].kind, "markdown");
  assert.match((segs[2] as { text: string }).text, /Inter/);
});

test("a table directly under a paragraph line (no blank line) still splits", () => {
  const md = "Colors used:\n| Role | Value |\n|---|---|\n| Theme | #fff |";
  const segs = splitMarkdownTables(md);
  assert.equal(segs.length, 2);
  assert.equal((segs[0] as { text: string }).text, "Colors used:");
  assert.equal(segs[1].kind, "table");
  assert.deepEqual((segs[1] as { rows: string[][] }).rows, [["Theme", "#fff"]]);
});

test("rows are padded or trimmed to the header width", () => {
  const md = "| A | B |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |";
  const [table] = splitMarkdownTables(md) as Array<{ rows: string[][] }>;
  assert.deepEqual(table.rows, [
    ["1", ""],
    ["1", "2"],
  ]);
});

test("the table ends at a blank line", () => {
  const md = "| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter the table.";
  const segs = splitMarkdownTables(md);
  assert.equal(segs[0].kind, "table");
  assert.equal(segs[1].kind, "markdown");
  assert.equal((segs[1] as { text: string }).text, "\nAfter the table.");
});

test("pipes inside a fenced code block are not treated as a table", () => {
  const md = "```\n| A | B |\n|---|---|\n| 1 | 2 |\n```";
  const segs = splitMarkdownTables(md);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "markdown");
});

test("a header whose cell count differs from the delimiter is not a table", () => {
  const md = "| A | B | C |\n|---|---|";
  const segs = splitMarkdownTables(md);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "markdown");
});

test("a plain '---' line (no pipes) is not mistaken for a delimiter row", () => {
  const md = "Title\n---\nbody | with a pipe";
  const segs = splitMarkdownTables(md);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "markdown");
});

test("escaped pipes stay inside a cell", () => {
  assert.deepEqual(splitTableRow("| a \\| b | c |"), ["a | b", "c"]);
});

test("empty input yields no segments", () => {
  assert.deepEqual(splitMarkdownTables(""), []);
});
