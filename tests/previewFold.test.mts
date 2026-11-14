import assert from "node:assert/strict";
import test from "node:test";
import {
  LINKEDIN_FOLD_CHARS,
  REDDIT_BODY_FOLD_CHARS,
  foldText,
  linkedinFold,
  redditBodyFold,
} from "../lib/domain/social/previewFold.ts";

test("short text is not truncated and hidden is empty", () => {
  assert.deepEqual(foldText("  hello world  ", 100), {
    visible: "hello world",
    hidden: "",
    truncated: false,
  });
});

test("text exactly at the limit is not truncated", () => {
  const text = "x".repeat(210);
  assert.deepEqual(foldText(text, 210), { visible: text, hidden: "", truncated: false });
});

test("text one char over the limit is truncated", () => {
  const text = "x".repeat(211);
  const fold = foldText(text, 210);
  assert.equal(fold.truncated, true);
  assert.equal(fold.visible.length, 210);
  assert.equal(fold.hidden, "x");
});

test("cut moves back to a word boundary", () => {
  const text = "word ".repeat(40).trim();
  // Index 12 is "r" preceded by "o", so the cut must move back to a space.
  const fold = foldText(text, 12);
  assert.equal(fold.truncated, true);
  assert.ok(fold.visible.endsWith("word"), `visible was: ${JSON.stringify(fold.visible)}`);
  assert.equal(fold.visible, "word word");
  assert.ok(fold.hidden.startsWith("word word "), `hidden was: ${JSON.stringify(fold.hidden)}`);
});

test("a single 500-char word with no spaces is cut exactly at the limit", () => {
  const text = "a".repeat(500);
  const fold = foldText(text, 100);
  assert.equal(fold.truncated, true);
  assert.equal(fold.visible, "a".repeat(100));
  assert.equal(fold.hidden, "a".repeat(400));
});

test("a long URL is cut exactly at the limit", () => {
  const url = "https://example.com/" + "segment".repeat(60);
  const fold = foldText(url, 50);
  assert.equal(fold.truncated, true);
  assert.equal(fold.visible, url.slice(0, 50));
  assert.equal(fold.hidden, url.slice(50));
});

test("leading and trailing whitespace is trimmed", () => {
  assert.deepEqual(foldText("\n\n   padded text \t\n", 100), {
    visible: "padded text",
    hidden: "",
    truncated: false,
  });
});

test("newlines act as word boundaries", () => {
  const text = "a".repeat(200) + "\n" + "b".repeat(50);
  // Index 210 and 209 are both non-whitespace, so the cut moves back to the newline at 200.
  const fold = foldText(text, 210);
  assert.equal(fold.truncated, true);
  assert.equal(fold.visible, "a".repeat(200));
  assert.equal(fold.hidden, "b".repeat(50));
});

test("linkedinFold joins hook and body with a blank line and folds at 210", () => {
  const hook = "Hook line";
  const body = "x".repeat(300);
  const fold = linkedinFold(hook, body);
  const joined = `${hook}\n\n${body}`;
  assert.equal(LINKEDIN_FOLD_CHARS, 210);
  assert.equal(fold.truncated, true);
  assert.equal(fold.visible.length, 210);
  assert.equal(fold.visible, joined.slice(0, 210));
  assert.ok(fold.visible.startsWith("Hook line\n\n"));
  assert.equal(fold.visible + fold.hidden, joined.slice(0, 210) + joined.slice(210));
});

test("linkedinFold with an empty body returns just the hook", () => {
  assert.deepEqual(linkedinFold("Just a hook", ""), {
    visible: "Just a hook",
    hidden: "",
    truncated: false,
  });
});

test("redditBodyFold uses a 300 char limit", () => {
  assert.equal(REDDIT_BODY_FOLD_CHARS, 300);
  const atLimit = "y".repeat(300);
  assert.deepEqual(redditBodyFold(atLimit), { visible: atLimit, hidden: "", truncated: false });

  const over = "y".repeat(301);
  const fold = redditBodyFold(over);
  assert.equal(fold.truncated, true);
  assert.equal(fold.visible.length, 300);
  assert.equal(fold.hidden, "y");
});

test("limit 0 hides everything", () => {
  assert.deepEqual(foldText("  hello  ", 0), { visible: "", hidden: "hello", truncated: true });
  assert.deepEqual(foldText("   ", 0), { visible: "", hidden: "", truncated: false });
});

test("negative limit behaves like limit 0", () => {
  assert.deepEqual(foldText("hello", -5), { visible: "", hidden: "hello", truncated: true });
  assert.deepEqual(foldText("", -1), { visible: "", hidden: "", truncated: false });
});

test("visible plus hidden never loses a non-whitespace character", () => {
  const inputs = [
    "word ".repeat(80),
    "a".repeat(400),
    "https://example.com/" + "path/".repeat(80),
    "line one\nline two\n\n" + "lorem ipsum dolor sit amet ".repeat(20),
    "  mixed\twhitespace   \n and words that keep going ".repeat(15),
    "émoji 🙂 café naïve " .repeat(30),
  ];
  const limits = [0, 1, 5, 10, 25, 50, 100, 210, 300];

  for (const text of inputs) {
    for (const limit of limits) {
      const fold = foldText(text, limit);
      assert.equal(
        fold.visible.replace(/\s+/g, "") + fold.hidden.replace(/\s+/g, ""),
        text.replace(/\s+/g, ""),
        `lost characters for limit ${limit}`,
      );
      assert.equal(fold.visible, fold.visible.trimEnd(), `visible has trailing space (limit ${limit})`);
      assert.equal(fold.hidden, fold.hidden.trimStart(), `hidden has leading space (limit ${limit})`);
    }
  }
});
