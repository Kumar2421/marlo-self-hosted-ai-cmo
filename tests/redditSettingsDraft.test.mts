import assert from "node:assert/strict";
import test from "node:test";
import {
  canSave,
  discardDraft,
  isDraftDirty,
  nextSaveStatus,
  settingsForSave,
  type SaveEvent,
  type SaveStatus,
} from "../lib/domain/reddit/redditSettingsDraft.ts";
import { emptyRedditSettings, type RedditSettings } from "../lib/domain/reddit/redditSettings.ts";

const base: RedditSettings = { version: 1, subreddits: ["r/startups", "r/seo"], keywords: ["lead gen", "cold email"], country: "global" };
const with_ = (p: Partial<RedditSettings>): RedditSettings => ({ ...base, ...p });

test("isDraftDirty (table)", () => {
  const rows: Array<[string, RedditSettings, RedditSettings, boolean]> = [
    ["identical", base, base, false],
    ["copy", base, discardDraft(base), false],
    ["empty vs empty", emptyRedditSettings(), emptyRedditSettings(), false],
    ["country changed", base, with_({ country: "us" }), true],
    ["subreddit added", base, with_({ subreddits: [...base.subreddits, "r/saas"] }), true],
    ["subreddit removed", base, with_({ subreddits: ["r/seo"] }), true],
    ["keyword added", base, with_({ keywords: [...base.keywords, "growth"] }), true],
    ["keyword removed", base, with_({ keywords: ["lead gen"] }), true],
    ["subreddits reordered", base, with_({ subreddits: ["r/seo", "r/startups"] }), false],
    ["keywords reordered", base, with_({ keywords: ["cold email", "lead gen"] }), false],
    ["case-only change", base, with_({ keywords: ["LEAD GEN", "Cold Email"] }), false],
    ["whitespace in keyword", base, with_({ keywords: [" lead   gen ", "cold email"] }), false],
    ["duplicates collapse", base, with_({ keywords: ["lead gen", "Lead Gen", "cold email"] }), false],
    ["swapped for a different one", base, with_({ keywords: ["lead gen", "growth"] }), true],
    ["empty draft vs saved", base, emptyRedditSettings(), true],
  ];
  for (const [name, saved, draft, expected] of rows) assert.equal(isDraftDirty(saved, draft), expected, name);
});

test("discardDraft returns an equal but independent copy", () => {
  const copy = discardDraft(base);
  assert.deepEqual(copy, base);
  copy.subreddits.push("r/x");
  assert.equal(base.subreddits.length, 2);
});

test("settingsForSave trims, de-dupes and drops invalid entries", () => {
  const out = settingsForSave({
    version: 1,
    subreddits: ["r/Foo", "foo", "not valid!", "https://reddit.com/r/bar/"],
    keywords: ["  a   b ", "A B", "", "c"],
    country: "us",
  });
  assert.deepEqual(out, { version: 1, subreddits: ["r/Foo", "r/bar"], keywords: ["a b", "c"], country: "us" });
});

test("save status state machine (table)", () => {
  const rows: Array<[SaveStatus, SaveEvent, SaveStatus]> = [
    ["idle", { type: "edit", dirty: true }, "dirty"],
    ["dirty", { type: "edit", dirty: false }, "idle"],
    ["dirty", { type: "edit", dirty: true }, "dirty"],
    ["idle", { type: "save" }, "idle"],
    ["dirty", { type: "save" }, "saving"],
    ["saving", { type: "save" }, "saving"],
    ["saving", { type: "edit", dirty: true }, "saving"],
    ["saving", { type: "succeeded" }, "saved"],
    ["saving", { type: "failed" }, "error"],
    ["idle", { type: "succeeded" }, "idle"],
    ["error", { type: "save" }, "saving"],
    ["error", { type: "edit", dirty: true }, "dirty"],
    ["error", { type: "discard" }, "idle"],
    ["dirty", { type: "discard" }, "idle"],
    ["saving", { type: "discard" }, "saving"],
    ["saved", { type: "fade" }, "idle"],
    ["dirty", { type: "fade" }, "dirty"],
    ["saved", { type: "edit", dirty: true }, "dirty"],
    ["saved", { type: "save" }, "saved"],
  ];
  for (const [from, event, to] of rows) assert.equal(nextSaveStatus(from, event), to, `${from} + ${event.type}`);
});

test("full flows: idle -> dirty -> saving -> saved -> idle, and failure keeps it retryable", () => {
  const run = (events: SaveEvent[], start: SaveStatus = "idle") => events.reduce(nextSaveStatus as (s: SaveStatus, e: SaveEvent) => SaveStatus, start);
  assert.equal(run([{ type: "edit", dirty: true }, { type: "save" }, { type: "succeeded" }, { type: "fade" }]), "idle");
  const failed = run([{ type: "edit", dirty: true }, { type: "save" }, { type: "failed" }]);
  assert.equal(failed, "error");
  assert.equal(canSave(failed), true);
  assert.equal(run([{ type: "save" }, { type: "succeeded" }], failed), "saved");
});

test("canSave only when dirty or retrying", () => {
  const expected: Record<SaveStatus, boolean> = { idle: false, dirty: true, saving: false, saved: false, error: true };
  for (const s of Object.keys(expected) as SaveStatus[]) assert.equal(canSave(s), expected[s], s);
});
