import test from "node:test";
import assert from "node:assert/strict";
import { buildStarterPrompts, offersFromCategory } from "../lib/domain/geo/starterPrompts.ts";

const cases: Array<{ name: string; input: Parameters<typeof buildStarterPrompts>[0]; includes: RegExp[]; count: [number, number] }> = [
  {
    name: "MLForge Studio (custom software, CRM, AI platforms)",
    input: { brand: "MLForge Studio", category: "custom software, CRM and AI platforms", competitors: ["toptal.com", "https://www.hubspot.com/"] },
    includes: [/best custom software options/, /alternatives to Toptal/, /CRM/, /compare to Toptal/],
    count: [4, 5],
  },
  { name: "single offer, no competitors", input: { brand: "Acme", category: "invoicing software" }, includes: [/best invoicing software options/, /choose the right invoicing software/], count: [2, 5] },
  { name: "no category and no competitors gives nothing invented", input: { brand: "Acme", category: "" }, includes: [], count: [0, 0] },
  { name: "competitor equal to brand is skipped", input: { brand: "Acme", category: "", competitors: ["acme.com"] }, includes: [], count: [0, 0] },
];

for (const c of cases) {
  test(`starter prompts: ${c.name}`, () => {
    const out = buildStarterPrompts(c.input);
    assert.ok(out.length >= c.count[0] && out.length <= c.count[1], `got ${out.length}: ${out.join(" | ")}`);
    for (const re of c.includes) assert.ok(out.some((p) => re.test(p)), `${re} not in ${out.join(" | ")}`);
    const brand = c.input.brand.toLowerCase();
    for (const p of out) {
      assert.notEqual(p.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim(), brand.replace(/[^a-z0-9 ]/g, ""), "brand-only query");
      assert.ok(p.endsWith("?"));
    }
    assert.equal(new Set(out.map((p) => p.toLowerCase())).size, out.length);
  });
}

test("only the comparison question names the brand", () => {
  const out = buildStarterPrompts({ brand: "MLForge Studio", category: "custom software", competitors: ["toptal.com"] });
  assert.equal(out.filter((p) => /MLForge/.test(p)).length, 1);
});

test("offersFromCategory splits lists and caps at two", () => {
  assert.deepEqual(offersFromCategory("custom software, CRM and AI platforms"), ["custom software", "CRM"]);
  assert.deepEqual(offersFromCategory("  "), []);
});
