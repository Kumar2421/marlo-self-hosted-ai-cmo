import assert from "node:assert/strict";
import test from "node:test";
import { X_LIMIT, xOverLimit, xWeightedLength } from "../lib/domain/social/xLength.ts";

test("empty string is 0", () => {
  assert.equal(xWeightedLength(""), 0);
});

test("plain ASCII counts one per character", () => {
  assert.equal(xWeightedLength("hello"), 5);
});

test("280 ASCII characters fit, 281 do not", () => {
  assert.equal(X_LIMIT, 280);
  assert.equal(xOverLimit("a".repeat(280)), false);
  assert.equal(xOverLimit("a".repeat(281)), true);
});

test("a long https URL counts as 23", () => {
  const url = "https://example.com/" + "a".repeat(100);
  assert.ok(url.length > 100);
  assert.equal(xWeightedLength(url), 23);
});

test("text around a long URL: 10 + 23 + 4 = 37", () => {
  const text = "Read this https://example.com/a/very/long/path/that/goes/on/and/on?utm=1 now";
  // "Read this " = 10, URL = 23, " now" = 4
  assert.equal(xWeightedLength(text), 37);
});

test("bare domain counts as 23", () => {
  // "see " = 4, domain = 23, " now" = 4
  assert.equal(xWeightedLength("see example.com now"), 31);
});

test("bare domain with path and query counts as 23", () => {
  assert.equal(xWeightedLength("www.example.co.uk/path?x=1"), 23);
});

test("trailing period after a URL is not part of it", () => {
  // "go to " = 6, URL = 23, "." = 1
  assert.equal(xWeightedLength("go to https://example.com."), 30);
});

test("emoji counts 2", () => {
  assert.equal(xWeightedLength("\u{1F600}"), 2);
});

test("CJK character counts 2", () => {
  assert.equal(xWeightedLength("你"), 2);
});

test("e-acute counts 1", () => {
  assert.equal(xWeightedLength("é"), 1);
});

test("curly quote and em dash (U+2010-U+201F) count 1", () => {
  assert.equal(xWeightedLength("“—"), 2);
});

test("newline counts 1", () => {
  assert.equal(xWeightedLength("\n"), 1);
  assert.equal(xWeightedLength("a\nb"), 3);
});

test("two URLs separated by a space count 23 + 1 + 23 = 47", () => {
  assert.equal(xWeightedLength("https://a.com/x https://b.com/y"), 47);
});

test("270 ASCII + space + URL is over the limit (294)", () => {
  const text = "a".repeat(270) + " https://example.com/some/long/path";
  assert.equal(xWeightedLength(text), 294);
  assert.equal(xOverLimit(text), true);
});

test("250 ASCII + space + URL is not over the limit (274)", () => {
  const text = "a".repeat(250) + " https://example.com/some/long/path";
  assert.equal(xWeightedLength(text), 274);
  assert.equal(xOverLimit(text), false);
});

test("dotted words that are not domains are not links", () => {
  assert.equal(xWeightedLength("we use node.js and file.txt daily"), "we use node.js and file.txt daily".length);
  assert.equal(xWeightedLength("see example.com now"), "see ".length + 23 + " now".length);
  assert.equal(xWeightedLength("visit acme.io/pricing today"), "visit ".length + 23 + " today".length);
});
