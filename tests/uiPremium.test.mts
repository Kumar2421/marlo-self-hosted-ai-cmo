import test from "node:test";
import assert from "node:assert/strict";
import {
  iconTileClass,
  initialsOf,
  ringArc,
  scoreAriaLabel,
  scoreBand,
  statusChipClass,
  tintedNoticeClass,
  vitalTone,
} from "../components/ui/premium.ts";

test("scoreBand: <50 bad, 50-89 mid, >=90 good, boundaries exact", () => {
  assert.equal(scoreBand(0), "bad");
  assert.equal(scoreBand(49), "bad");
  assert.equal(scoreBand(49.9), "bad");
  assert.equal(scoreBand(50), "mid");
  assert.equal(scoreBand(89), "mid");
  assert.equal(scoreBand(90), "good");
  assert.equal(scoreBand(100), "good");
});

test("scoreBand: missing or invalid scores have no band (never rendered as 0)", () => {
  for (const v of [undefined, null, NaN, Infinity, -1, 101]) assert.equal(scoreBand(v as number), null);
});

test("scoreAriaLabel reads as text and is honest about unmeasured", () => {
  assert.equal(scoreAriaLabel("Performance", 63), "Performance 63 out of 100");
  assert.equal(scoreAriaLabel("SEO", 62.6), "SEO 63 out of 100");
  assert.equal(scoreAriaLabel("SEO", undefined), "SEO not measured");
});

test("ringArc: full, half and empty arcs", () => {
  const full = ringArc(100, 56, 4);
  assert.equal(full.radius, 26);
  assert.ok(Math.abs(full.circumference - 2 * Math.PI * 26) < 1e-9);
  assert.equal(full.offset, 0);
  const half = ringArc(50, 56, 4);
  assert.ok(Math.abs(half.offset - half.circumference / 2) < 1e-9);
  const none = ringArc(0, 56, 4);
  assert.ok(Math.abs(none.offset - none.circumference) < 1e-9);
});

test("ringArc: unmeasured draws no arc and a degenerate size does not go negative", () => {
  const u = ringArc(undefined, 56, 4);
  assert.equal(u.offset, u.circumference);
  assert.equal(ringArc(50, 2, 4).radius, 0);
});

test("statusChipClass: tone classes, dashed add chip is neutral", () => {
  assert.match(statusChipClass({ tone: "success" }), /bg-tint-success-bg/);
  assert.match(statusChipClass({ tone: "danger" }), /text-tint-danger-fg/);
  const dashed = statusChipClass({ tone: "success", dashed: true });
  assert.match(dashed, /border-dashed/);
  assert.doesNotMatch(dashed, /tint-success/);
  assert.match(statusChipClass(), /text-xs/);
});

test("tintedNoticeClass defaults to warning and keeps caller classes", () => {
  const cls = tintedNoticeClass({ className: "mb-5" });
  assert.match(cls, /bg-tint-warning-bg/);
  assert.match(cls, /border-tint-warning-border/);
  assert.match(cls, /mb-5/);
  assert.match(tintedNoticeClass({ tone: "info" }), /text-tint-info-fg/);
});

test("vitalTone maps statuses and keeps unknown neutral", () => {
  assert.equal(vitalTone("Pass"), "success");
  assert.equal(vitalTone("good"), "success");
  assert.equal(vitalTone("Warn"), "warning");
  assert.equal(vitalTone("Fail"), "danger");
  assert.equal(vitalTone("Unknown"), "neutral");
});

test("initialsOf", () => {
  assert.equal(initialsOf("Ada Lovelace"), "AL");
  assert.equal(initialsOf("grace"), "G");
  assert.equal(initialsOf("  "), "?");
  assert.equal(initialsOf(null), "?");
  assert.equal(initialsOf("jean-luc picard"), "JL");
});

test("iconTileClass: round and size", () => {
  assert.match(iconTileClass({ round: true }), /rounded-full/);
  assert.match(iconTileClass({ tone: "warning", size: "lg" }), /h-10/);
});
