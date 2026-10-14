import test from "node:test";
import assert from "node:assert/strict";
import {
  countDraftsToReview,
  formatDraftsToReview,
  hasUnreviewedDrafts,
  isSocialPlatform,
  resolveSocialPlatform,
  socialNavTargetFromPayload,
} from "../lib/domain/social/socialNav.ts";

test("isSocialPlatform accepts only the registered networks", () => {
  assert.equal(isSocialPlatform("x"), true);
  assert.equal(isSocialPlatform("linkedin"), true);
  assert.equal(isSocialPlatform("reddit"), true);
  assert.equal(isSocialPlatform("tiktok"), false);
  assert.equal(isSocialPlatform(undefined), false);
  assert.equal(isSocialPlatform(42), false);
});

test("resolveSocialPlatform falls back to x for anything invalid", () => {
  assert.equal(resolveSocialPlatform("reddit"), "reddit");
  assert.equal(resolveSocialPlatform("facebook"), "x");
  assert.equal(resolveSocialPlatform(null), "x");
  assert.equal(resolveSocialPlatform({ platform: "linkedin" }), "x");
});

test("socialNavTargetFromPayload only opens for open === 'social'", () => {
  assert.deepEqual(socialNavTargetFromPayload({ open: "social", platform: "linkedin" }), { open: "social", platform: "linkedin" });
  assert.deepEqual(socialNavTargetFromPayload({ open: "social" }), { open: "social", platform: "x" });
  assert.deepEqual(socialNavTargetFromPayload({ open: "social", platform: "bogus" }), { open: "social", platform: "x" });
  assert.equal(socialNavTargetFromPayload({ open: "billing", platform: "x" }), null);
  assert.equal(socialNavTargetFromPayload({ platform: "x" }), null);
  assert.equal(socialNavTargetFromPayload(null), null);
  assert.equal(socialNavTargetFromPayload(undefined), null);
});

test("countDraftsToReview counts only status draft", () => {
  const drafts = [{ status: "draft" }, { status: "completed" }, { status: "draft" }, { status: "archived" }, { status: "pending" }];
  assert.equal(countDraftsToReview(drafts), 2);
  assert.equal(countDraftsToReview([]), 0);
  assert.equal(countDraftsToReview(undefined), 0);
  assert.equal(countDraftsToReview(null), 0);
});

test("formatDraftsToReview pluralises and handles zero", () => {
  assert.equal(formatDraftsToReview(0), "No drafts to review");
  assert.equal(formatDraftsToReview(-3), "No drafts to review");
  assert.equal(formatDraftsToReview(1), "1 draft to review");
  assert.equal(formatDraftsToReview(7), "7 drafts to review");
});

test("hasUnreviewedDrafts is true when any network has a draft", () => {
  assert.equal(hasUnreviewedDrafts({ x: 0, linkedin: 0, reddit: 0 }), false);
  assert.equal(hasUnreviewedDrafts({}), false);
  assert.equal(hasUnreviewedDrafts({ x: 0, reddit: 2 }), true);
  assert.equal(hasUnreviewedDrafts({ linkedin: 1 }), true);
});
