import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  nextThemePreference,
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
} from "../lib/theme.ts";

test("resolveTheme: explicit choices ignore the OS, system follows it", () => {
  const cases: Array<[ThemePreference, boolean, "light" | "dark"]> = [
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["dark", true, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
  ];
  for (const [pref, sys, want] of cases) assert.equal(resolveTheme(pref, sys), want, `${pref}/${sys}`);
});

test("parseThemePreference: valid values pass, everything else is the default (system)", () => {
  assert.equal(DEFAULT_THEME_PREFERENCE, "system");
  const cases: Array<[unknown, ThemePreference]> = [
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    [null, "system"],
    [undefined, "system"],
    ["", "system"],
    ["DARK", "system"],
    ["auto", "system"],
    [1, "system"],
    [{}, "system"],
  ];
  for (const [raw, want] of cases) assert.equal(parseThemePreference(raw), want, String(raw));
});

test("nextThemePreference cycles light -> dark -> system -> light", () => {
  const cases: Array<[ThemePreference, ThemePreference]> = [
    ["light", "dark"],
    ["dark", "system"],
    ["system", "light"],
  ];
  for (const [from, to] of cases) assert.equal(nextThemePreference(from), to);
});

test("the inline init script uses the shared storage key and is guarded", () => {
  assert.ok(THEME_INIT_SCRIPT.includes(JSON.stringify(THEME_STORAGE_KEY)));
  assert.ok(THEME_INIT_SCRIPT.includes("try{"));
  assert.ok(THEME_INIT_SCRIPT.includes("prefers-color-scheme: dark"));
  assert.doesNotThrow(() => new Function(THEME_INIT_SCRIPT));
});

function runInit(stored: string | null, systemDark: boolean, storageThrows = false) {
  const attrs: Record<string, string> = {};
  const style: { colorScheme?: string } = {};
  const fakeWindow = { matchMedia: () => ({ matches: systemDark }) };
  const fakeStorage = {
    getItem: () => {
      if (storageThrows) throw new Error("blocked");
      return stored;
    },
  };
  const fakeDocument = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), style } };
  new Function("localStorage", "window", "document", THEME_INIT_SCRIPT)(fakeStorage, fakeWindow, fakeDocument);
  return { theme: attrs["data-theme"], colorScheme: style.colorScheme };
}

test("the inline init script agrees with resolveTheme for every stored value", () => {
  const stored: Array<string | null> = [null, "light", "dark", "system", "garbage"];
  for (const s of stored) {
    for (const sys of [false, true]) {
      const want = resolveTheme(parseThemePreference(s), sys);
      assert.deepEqual(runInit(s, sys), { theme: want, colorScheme: want }, `${s}/${sys}`);
    }
  }
  // Storage that throws behaves like "system".
  assert.deepEqual(runInit(null, true, true), { theme: "dark", colorScheme: "dark" });
  assert.deepEqual(runInit(null, false, true), { theme: "light", colorScheme: "light" });
});
