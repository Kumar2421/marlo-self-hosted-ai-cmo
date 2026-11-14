/**
 * Real-world check of company lead search: runs the actual web search and reads the actual company sites for ten
 * profiles, then prints how many companies were kept or dropped and why. It makes real network calls (about 30
 * searches and a few hundred page reads) and needs a search key in the environment. Never run it in CI.
 *
 *   TAVILY_API_KEY=... node --experimental-strip-types scripts/evalCompanyLeads.mts [case-id] [--json out.json]
 *
 * Read the kept leads by eye after each run: counts say how many, only reading them says whether they are right.
 */
import { writeFileSync } from "node:fs";
import { searchCompanyLeads } from "../lib/domain/leads/company/companyLeads.ts";
import { tavilyProvider } from "../lib/domain/websearch/searchProvider.ts";
import { enrichBusiness } from "../lib/domain/leads/local/websiteContact.ts";

const CASES: { id: string; industries: string[]; locations: string[] }[] = [
  { id: "dental-chennai", industries: ["dental clinics"], locations: ["Chennai"] },
  { id: "yoga-bangalore", industries: ["yoga studios"], locations: ["Bangalore"] },
  { id: "agencies-austin", industries: ["digital marketing agencies"], locations: ["Austin"] },
  { id: "restaurants-madurai", industries: ["restaurants"], locations: ["Madurai"] },
  { id: "realestate-dubai", industries: ["real estate agencies"], locations: ["Dubai"] },
  { id: "hotels-goa", industries: ["boutique hotels"], locations: ["Goa"] },
  { id: "accounting-toronto", industries: ["accounting firms"], locations: ["Toronto"] },
  { id: "ecommerce-any", industries: ["online clothing stores"], locations: [] },
  { id: "coaching-coimbatore", industries: ["coaching institutes"], locations: ["Coimbatore"] },
  { id: "saas-london", industries: ["B2B SaaS startups"], locations: ["London"] },
];

const key = process.env.TAVILY_API_KEY?.trim();
if (!key) {
  console.error("Set TAVILY_API_KEY to run this check.");
  process.exit(1);
}

const args = process.argv.slice(2);
// --custom "industries a, b|locations x" runs one profile that is not in the list above.
const customAt = args.indexOf("--custom");
if (customAt >= 0) {
  const [inds = "", locs = ""] = String(args[customAt + 1] ?? "").split("|");
  const split = (v: string) => v.split(",").map((t) => t.trim()).filter(Boolean);
  CASES.length = 0;
  CASES.push({ id: "custom", industries: split(inds), locations: split(locs) });
}
const jsonAt = args.indexOf("--json");
const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : null;
const only = args.find((a, i) => !a.startsWith("--") && (jsonAt < 0 || i !== jsonAt + 1) && (customAt < 0 || i !== customAt + 1));

const report: unknown[] = [];
for (const c of CASES.filter((x) => !only || x.id === only)) {
  const started = Date.now();
  let sitesRead = 0;
  const res = await searchCompanyLeads(
    {
      provider: tavilyProvider(key),
      knownHosts: async () => new Set<string>(),
      enrich: async (site: string) => {
        sitesRead += 1;
        return enrichBusiness(site);
      },
    },
    { profile: { industries: c.industries, locations: c.locations } },
  );
  const secs = Math.round((Date.now() - started) / 100) / 10;
  console.log(`\n## ${c.id}  ${secs}s  sites read ${sitesRead}  kept ${res.leads.length}  no contact ${res.droppedNoContact}  no fit ${res.droppedNoFit}`);
  for (const l of res.leads) console.log(`  - ${l.name.padEnd(30)} ${l.host.padEnd(30)} ${l.email ?? (l.whatsapp ? `whatsapp ${l.whatsapp}` : "")}${l.signals.length ? `  [${l.signals.join(", ")}]` : ""}`);
  report.push({ id: c.id, secs, sitesRead, kept: res.leads.length, droppedNoContact: res.droppedNoContact, droppedNoFit: res.droppedNoFit, leads: res.leads });
}
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2));
