import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Settings that nothing reads must not be written by the Settings UI.
const DEAD_KEYS = ["personalization_name", "personalization_notes", "personalization_language", "agents_region", "agents_reddit_prompt", "agents_toggle_"];

for (const file of ["app/settings/agents/page.tsx", "app/settings/personalization/page.tsx"]) {
  test(`${file} does not write unconsumed settings`, () => {
    const src = readFileSync(file, "utf8");
    for (const key of DEAD_KEYS) assert.equal(src.includes(key), false, `${file} still references ${key}`);
    assert.equal(src.includes("/api/settings"), false);
  });
}

test("user menu theme icon is wired to the real theme setting (no dead icon)", () => {
  const src = readFileSync("components/dashboard/TerminalLog.tsx", "utf8");
  // The theme button is allowed (Sun/Moon/Monitor) only as the display of a working setting.
  assert.equal(src.includes("Moon") ? src.includes("useTheme") && src.includes("setPreference(nextTheme)") : true, true);
});
