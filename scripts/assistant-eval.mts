/**
 * MANUAL live evaluation of the AI CMO against a real model. Never run in CI (it is not matched by
 * tests/*.test.mts and costs real tokens). Refuses to start without a real key in the environment.
 *
 *   ASSISTANT_EVAL_API_KEY=... node --experimental-strip-types scripts/assistant-eval.mts \
 *       --provider openai --model gpt-4o-mini [--only ff-1,tr-1] [--limit 10] [--json out.json]
 *
 * Providers: openai, groq, mistral (full tool loop); anthropic, google (no tool loop in this codebase, so
 * the tool-selection column is n/a and the model only sees the counts-only overview). lmstudio/ollama/custom
 * also work with ASSISTANT_EVAL_BASE_URL. `--dry` replays the CI scripts through the same report code with
 * no network and no key (to check the script itself).
 *
 * The same 50+ questions as CI (tests/fixtures/assistantEval.ts) run through the real runAssistantTurn
 * against FAKE project data. Nothing touches a database or a real user.
 */
import { register } from "node:module";
import { writeFileSync } from "node:fs";
import { EVAL_CASES, type EvalCase } from "../tests/fixtures/assistantEval.ts";
import { runCase, scoreCase, scriptedDriver, type CaseRun, type CaseScore, type DriverFactory } from "../tests/fixtures/assistantEvalHarness.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const dry = has("dry");
const apiKey = process.env.ASSISTANT_EVAL_API_KEY ?? "";
const provider = arg("provider") ?? process.env.ASSISTANT_EVAL_PROVIDER ?? "openai";
const model = arg("model") ?? process.env.ASSISTANT_EVAL_MODEL ?? "";
const baseUrl = process.env.ASSISTANT_EVAL_BASE_URL;

if (!dry) {
  if (process.env.CI) { console.error("Refusing to run in CI: this is a manual, paid evaluation."); process.exit(2); }
  if (apiKey.trim().length < 8) { console.error("Refusing to run: set ASSISTANT_EVAL_API_KEY to a real key (never put it on the command line)."); process.exit(2); }
  if (!model) { console.error("Refusing to run: pass --model (or ASSISTANT_EVAL_MODEL)."); process.exit(2); }
}

/** lib/llm uses extensionless and "@/" imports (bundler style). Teach plain node to resolve them to .ts. */
async function loadLlm(): Promise<{ getDriver: (id: string) => ((req: never) => Promise<{ text?: string }>) | null; providerSupportsTools: (id: string) => boolean }> {
  const root = new URL("../", import.meta.url).href;
  const hooks = `
    const ROOT = ${JSON.stringify(root)};
    export async function resolve(spec, ctx, next) {
      const aliased = spec.startsWith("@/") ? new URL(spec.slice(2), ROOT).href : spec;
      try { return await next(aliased, ctx); } catch (e) {
        if ((aliased.startsWith(".") || aliased.startsWith("file:")) && !/\\.[mc]?[tj]s$/.test(aliased)) return next(aliased + ".ts", ctx);
        throw e;
      }
    }`;
  register(`data:text/javascript,${encodeURIComponent(hooks)}`, import.meta.url);
  const llm = await import(new URL("../lib/llm/index.ts", import.meta.url).href);
  return { getDriver: llm.getDriver, providerSupportsTools: llm.providerSupportsTools };
}

type Row = { id: string; category: string; question: string; run: CaseRun; score: CaseScore };

async function main() {
  let cases: EvalCase[] = EVAL_CASES;
  const only = arg("only");
  if (only) { const ids = new Set(only.split(",")); cases = cases.filter((c) => ids.has(c.id)); }
  const limit = Number(arg("limit") ?? 0);
  if (limit > 0) cases = cases.slice(0, limit);

  let supportsTools = true;
  let factoryFor: (c: EvalCase) => DriverFactory;
  if (dry) {
    factoryFor = (c) => scriptedDriver(c.script);
  } else {
    const llm = await loadLlm();
    const driver = llm.getDriver(provider);
    if (!driver) { console.error(`No driver wired for provider "${provider}".`); process.exit(2); }
    supportsTools = llm.providerSupportsTools(provider);
    factoryFor = () => () => driver as never;
  }

  const rows: Row[] = [];
  for (const c of cases) {
    const run = await runCase(c, factoryFor(c), { provider, model: model || "dry", apiKey: apiKey || "dry", baseUrl, supportsTools: dry ? true : supportsTools });
    rows.push({ id: c.id, category: c.category, question: c.question, run, score: scoreCase(c, run) });
    process.stderr.write(`${run.error ? "E" : scoreCase(c, run).pass ? "." : "x"}`);
  }
  process.stderr.write("\n");

  const toolApplicable = supportsTools || dry ? rows : [];
  const n = rows.length;
  const lat = rows.map((r) => r.run.ms).sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.max(0, Math.ceil((p / 100) * lat.length) - 1))] ?? 0;
  const summary = {
    provider: dry ? "dry-run(scripts)" : provider, model: dry ? "dry" : model, cases: n, toolLoop: supportsTools || dry,
    toolSelectionHitRate: toolApplicable.length ? toolApplicable.filter((r) => r.score.toolHit).length / toolApplicable.length : null,
    passRate: rows.filter((r) => r.score.pass).length / n,
    groundingFlaggedCases: rows.filter((r) => r.score.groundingFlags > 0).length,
    groundingFlagsTotal: rows.reduce((s, r) => s + r.score.groundingFlags, 0),
    forbiddenClaimCases: rows.filter((r) => r.score.claimedForbidden.length > 0).length,
    errors: rows.filter((r) => r.run.error).length,
    latencyMs: { p50: pct(50), p95: pct(95), max: lat[lat.length - 1] ?? 0 },
  };
  const result = {
    summary,
    cases: rows.map((r) => ({
      id: r.id, category: r.category, pass: r.score.pass, toolHit: r.score.toolHit, missingTools: r.score.missingTools, extraTools: r.score.extraTools,
      called: r.run.called, rejectedCalls: r.score.rejectedCalls, groundingFlags: r.score.groundingFlags, unverified: r.run.grounding.unverified,
      claimedForbidden: r.score.claimedForbidden, missedMentions: r.score.missedMentions, neverAuditedSeen: r.score.neverAuditedSeen,
      ms: r.run.ms, error: r.run.error,
    })),
  };

  console.log(JSON.stringify(result, null, 2));
  const json = arg("json");
  if (json) writeFileSync(json, JSON.stringify(result, null, 2));

  const pad = (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}~` : s.padEnd(w));
  const lines = [pad("id", 7) + pad("category", 14) + pad("tools", 6) + pad("ground", 7) + pad("claims", 7) + pad("ms", 7) + "result / notes"];
  for (const r of rows) {
    const s = r.score;
    const notes = [r.run.error ? `ERROR ${r.run.error.slice(0, 60)}` : "", s.missingTools.length ? `missing ${s.missingTools.join("+")}` : "", s.extraTools.length ? `extra ${s.extraTools.join("+")}` : "",
      s.claimedForbidden.length ? "forbidden claim" : "", s.missedMentions.length ? "missed mention" : "", s.neverAuditedSeen === false ? "neverAudited not seen" : ""].filter(Boolean).join("; ");
    lines.push(pad(r.id, 7) + pad(r.category, 14) + pad(supportsTools || dry ? (s.toolHit ? "ok" : "MISS") : "n/a", 6) + pad(String(s.groundingFlags), 7) + pad(s.claimedForbidden.length ? "BAD" : "ok", 7) + pad(String(r.run.ms), 7) + (s.pass ? "PASS" : "FAIL") + (notes ? `  ${notes}` : ""));
  }
  lines.push("", `${summary.provider}/${summary.model}: ${n} cases, pass ${(summary.passRate * 100).toFixed(0)}%, tool hit ${summary.toolSelectionHitRate === null ? "n/a" : `${(summary.toolSelectionHitRate * 100).toFixed(0)}%`}, grounding-flagged cases ${summary.groundingFlaggedCases}, errors ${summary.errors}, latency p50 ${summary.latencyMs.p50}ms p95 ${summary.latencyMs.p95}ms`);
  console.error(lines.join("\n"));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
