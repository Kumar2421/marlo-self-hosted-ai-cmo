import test from "node:test";
import assert from "node:assert/strict";
import { cn } from "../components/ui/cn.ts";
import { badgeClass, chipClass, iconButtonClass, tabIndicatorStyle } from "../components/ui/variants.ts";
import { isUiGalleryEnabled } from "../app/dev/ui/guard.ts";

test("cn drops falsy values and lets the last conflicting utility win", () => {
  assert.equal(cn("px-2", false, null, undefined, "px-4"), "px-4");
  assert.equal(cn("text-ui-muted", { "text-ui-text": true }), "text-ui-text");
  assert.equal(cn("a", ["b", { c: true, d: false }]), "a b c");
});

test("cn keeps non-conflicting text size and color together", () => {
  const out = cn("text-[13px]", "text-ui-muted");
  assert.match(out, /text-\[13px\]/);
  assert.match(out, /text-ui-muted/);
});

test("iconButtonClass defaults to ghost/md with a 36px target", () => {
  const cls = iconButtonClass();
  assert.match(cls, /h-9/);
  assert.match(cls, /w-9/);
  assert.match(cls, /hover:bg-ui-surface-sunken/);
});

test("iconButtonClass sm extends the hit area to 36px via ::before", () => {
  const cls = iconButtonClass({ size: "sm", variant: "solid" });
  assert.match(cls, /h-7/);
  assert.match(cls, /before:-inset-1/);
  assert.match(cls, /bg-ui-primary/);
  assert.doesNotMatch(cls, /bg-ui-surface-sunken/);
});

test("iconButtonClass lets a caller override spacing", () => {
  assert.match(iconButtonClass({ className: "-mr-1" }), /-mr-1/);
});

test("badgeClass maps each tone to its own colors", () => {
  assert.match(badgeClass({ tone: "success" }), /bg-ui-success-soft/);
  assert.match(badgeClass({ tone: "danger" }), /text-ui-danger-text/);
  assert.match(badgeClass(), /bg-ui-surface-sunken/);
  assert.doesNotMatch(badgeClass({ tone: "warn" }), /bg-ui-surface-sunken/);
});

test("chipClass switches look when selected", () => {
  assert.match(chipClass({ selected: true }), /bg-ui-primary/);
  assert.match(chipClass({ selected: false }), /bg-ui-surface/);
  assert.doesNotMatch(chipClass({ selected: false }), /bg-ui-primary/);
});

test("tabIndicatorStyle moves by whole segment widths", () => {
  assert.deepEqual(tabIndicatorStyle(0, 4), { width: "calc((100% - 4px) / 4)", transform: "translateX(0%)" });
  assert.equal(tabIndicatorStyle(2, 4).transform, "translateX(200%)");
});

test("tabIndicatorStyle clamps bad input", () => {
  assert.equal(tabIndicatorStyle(-1, 3).transform, "translateX(0%)");
  assert.equal(tabIndicatorStyle(9, 3).transform, "translateX(200%)");
  assert.equal(tabIndicatorStyle(Number.NaN, 3).transform, "translateX(0%)");
  assert.equal(tabIndicatorStyle(0, 0).width, "calc((100% - 4px) / 1)");
});

test("UI gallery is only enabled outside production and outside platform mode", () => {
  assert.equal(isUiGalleryEnabled({ nodeEnv: "development", platformMode: false }), true);
  assert.equal(isUiGalleryEnabled({ nodeEnv: undefined, platformMode: false }), true);
  assert.equal(isUiGalleryEnabled({ nodeEnv: "production", platformMode: false }), false);
  assert.equal(isUiGalleryEnabled({ nodeEnv: "development", platformMode: true }), false);
  assert.equal(isUiGalleryEnabled({ nodeEnv: "production", platformMode: true }), false);
});
