import test from "node:test";
import assert from "node:assert/strict";
import {
  rankNextActions,
  type RankFinding,
  type RankInput,
} from "../lib/domain/overview/rankNextActions.ts";
import { BANNED_WORDS, COPY, CHECKLIST_COPY } from "../lib/domain/overview/copy.ts";

const NOW = "2026-10-21T12:00:00.000Z";
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

const ALL_ON = { gsc: true, ga4: true, github: true, gmail: true, cms: true };

function finding(over: Partial<RankFinding> & { id: string }): RankFinding {
  return {
    status: "new",
    severity: "warning",
    source: "seo-audit",
    entityId: "heading-h1-missing", // manual fix
    firstSeen: daysAgo(30),
    lastSeen: daysAgo(1),
    recommendation: "Add one H1 heading. More detail follows.",
    evidence: {},
    ...over,
  };
}

function input(over: Partial<RankInput> = {}): RankInput {
  return {
    findings: [],
    openFixPullRequests: [],
    pendingActions: [],
    integrations: { ...ALL_ON },
    leads: { count: 0, withEmail: 0, unsent: 0 },
    lastAuditAt: daysAgo(1),
    now: NOW,
    ...over,
  };
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("finding ordering: severity, then status, table-driven", () => {
  const cases: Array<{ name: string; findings: RankFinding[]; want: string[] }> = [
    {
      name: "critical > warning > info",
      findings: [finding({ id: "i", severity: "info" }), finding({ id: "w" }), finding({ id: "c", severity: "critical" })],
      want: ["finding:c", "finding:w", "finding:i"],
    },
    {
      name: "new > failed > fixing at equal severity",
      findings: [finding({ id: "fx", status: "fixing" }), finding({ id: "fl", status: "failed" }), finding({ id: "nw" })],
      want: ["finding:nw", "finding:fl", "finding:fx"],
    },
    {
      name: "fresher beats older at equal severity and status",
      findings: [finding({ id: "old", firstSeen: daysAgo(60) }), finding({ id: "fresh", firstSeen: daysAgo(1) })],
      want: ["finding:fresh", "finding:old"],
    },
    {
      name: "fixable-with-PR bonus lifts a warning over a same-age warning",
      findings: [finding({ id: "manual" }), finding({ id: "auto", entityId: "meta-title-missing" })],
      want: ["finding:auto", "finding:manual"],
    },
    {
      name: "verified findings never appear",
      findings: [finding({ id: "done", status: "verified", severity: "critical" }), finding({ id: "live", severity: "info" })],
      want: ["finding:live"],
    },
  ];
  for (const c of cases) {
    assert.deepEqual(ids(rankNextActions(input({ findings: c.findings }))), c.want, c.name);
  }
});

test("tie-break is stable by id regardless of input order", () => {
  const a = finding({ id: "a" });
  const b = finding({ id: "b" });
  assert.deepEqual(ids(rankNextActions(input({ findings: [a, b] }))), ["finding:a", "finding:b"]);
  assert.deepEqual(ids(rankNextActions(input({ findings: [b, a] }))), ["finding:a", "finding:b"]);
});

test("cap: default 3, custom max, zero", () => {
  const findings = ["a", "b", "c", "d", "e"].map((id) => finding({ id }));
  assert.equal(rankNextActions(input({ findings })).length, 3);
  assert.equal(rankNextActions(input({ findings }), { max: 2 }).length, 2);
  assert.equal(rankNextActions(input({ findings }), { max: 10 }).length, 5);
  assert.deepEqual(rankNextActions(input({ findings }), { max: 0 }), []);
});

test("an open PR beats a critical new finding", () => {
  const out = rankNextActions(
    input({
      findings: [finding({ id: "crit", severity: "critical", entityId: "meta-title-missing" })],
      openFixPullRequests: [{ id: "42", title: "Add page title" }],
    }),
  );
  assert.equal(out[0].kind, "review_pr");
  assert.equal(out[0].cta.target.type, "pr");
  assert.equal(out[0].cta.target.id, "42");
  assert.equal(out[1].id, "finding:crit");
});

test("a finding covered by an open PR is not listed twice", () => {
  const out = rankNextActions(
    input({
      findings: [finding({ id: "f1", severity: "critical" })],
      openFixPullRequests: [{ id: "7", findingId: "f1" }],
    }),
  );
  assert.deepEqual(ids(out), ["pr:7"]);
});

test("duplicate pull requests and findings collapse to one action each", () => {
  const out = rankNextActions(
    input({
      findings: [finding({ id: "x" }), finding({ id: "x" })],
      openFixPullRequests: [{ id: "9" }, { id: "9" }],
    }),
  );
  assert.deepEqual(ids(out).sort(), ["finding:x", "pr:9"]);
});

test("missing Search Console shows a single connect action targeting settings", () => {
  const out = rankNextActions(input({ integrations: { ...ALL_ON, gsc: false } }));
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "connect_integration");
  assert.deepEqual(out[0].cta.target, { type: "settings", id: "gsc" });
});

test("at most one connect_integration even when everything is missing", () => {
  const none = { gsc: false, ga4: false, github: false, gmail: false, cms: false };
  const out = rankNextActions(input({ integrations: none, leads: { count: 5, withEmail: 5, unsent: 5 } }), { max: 10 });
  assert.equal(out.filter((a) => a.kind === "connect_integration").length, 1);
  assert.equal(out[0].id, "connect:gsc");
});

test("GitHub is prioritised over Analytics only when fixable findings exist", () => {
  const base = { gsc: true, ga4: false, github: false, gmail: true, cms: true };
  const manualOnly = rankNextActions(input({ integrations: base }));
  assert.equal(manualOnly[0].id, "connect:ga4");
  const withFixable = rankNextActions(input({ integrations: base, findings: [finding({ id: "a", entityId: "meta-title-missing", severity: "info" })] }), { max: 10 });
  assert.ok(ids(withFixable).includes("connect:github"));
  assert.ok(!ids(withFixable).includes("connect:ga4"));
});

test("stale audit (over 7 days) suggests run_audit; exactly 7 days does not", () => {
  const stale = rankNextActions(input({ lastAuditAt: daysAgo(8) }));
  assert.equal(stale[0].kind, "run_audit");
  assert.deepEqual(stale[0].cta.target, { type: "audit" });
  const fresh = rankNextActions(input({ lastAuditAt: daysAgo(7) }));
  assert.equal(fresh[0].kind, "celebrate");
  const custom = rankNextActions(input({ lastAuditAt: daysAgo(3) }), { staleAuditDays: 2 });
  assert.equal(custom[0].kind, "run_audit");
});

test("never audited asks for the first check", () => {
  const out = rankNextActions(input({ lastAuditAt: null }));
  assert.equal(out[0].kind, "run_audit");
  assert.equal(out[0].title, COPY.runAudit.neverTitle);
});

test("fixed-but-unconfirmed findings become verify_fix, below an open PR", () => {
  const out = rankNextActions(
    input({ findings: [finding({ id: "v", status: "fixed" })], openFixPullRequests: [{ id: "1" }] }),
  );
  assert.deepEqual(ids(out), ["pr:1", "finding:v"]);
  assert.equal(out[1].kind, "verify_fix");
});

test("outreach needs email connected and leads with an address", () => {
  const leads = { count: 12, withEmail: 8, unsent: 20 };
  const ready = rankNextActions(input({ leads }));
  assert.equal(ready[0].kind, "send_outreach");
  assert.match(ready[0].title, /8 queued emails/);
  assert.equal(rankNextActions(input({ leads: { count: 3, withEmail: 0, unsent: 3 } }))[0].kind, "celebrate");
  const noMail = rankNextActions(input({ leads, integrations: { ...ALL_ON, gmail: false } }));
  assert.equal(noMail[0].id, "connect:gmail");
});

test("empty state is a single celebrate item with the next-check date", () => {
  const out = rankNextActions(input({ lastAuditAt: daysAgo(2) }));
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "celebrate");
  assert.match(out[0].why, /2026-10-26/); // last audit 2 days ago + 7 day cycle
  assert.ok(out[0].reasons.includes("next check 2026-10-26"));
});

test("empty state next check is never in the past", () => {
  const out = rankNextActions(input({ lastAuditAt: daysAgo(7) }));
  assert.equal(out[0].kind, "celebrate");
  assert.match(out[0].why, /2026-10-22/);
});

test("pending actions mark the finding but do not add a separate item", () => {
  const out = rankNextActions(input({ findings: [finding({ id: "p" })], pendingActions: [{ id: "a1", findingId: "p" }] }));
  assert.deepEqual(ids(out), ["finding:p"]);
  assert.ok(out[0].reasons.some((r) => r.includes("already waiting")));
});

test("impact and effort follow severity and fixability", () => {
  const [auto] = rankNextActions(input({ findings: [finding({ id: "a", severity: "critical", entityId: "meta-title-missing" })] }));
  assert.equal(auto.impact, "high");
  assert.equal(auto.effort, "minutes");
  const [manual] = rankNextActions(input({ findings: [finding({ id: "m", severity: "info" })] }));
  assert.equal(manual.impact, "low");
  assert.equal(manual.effort, "hour");
});

test("determinism: same input, same output", () => {
  const i = input({
    findings: [finding({ id: "a" }), finding({ id: "b", severity: "critical" }), finding({ id: "c", status: "failed" })],
    openFixPullRequests: [{ id: "1", openedAt: daysAgo(2) }],
    integrations: { ...ALL_ON, ga4: false },
    lastAuditAt: daysAgo(9),
  });
  assert.deepEqual(rankNextActions(i), rankNextActions(i));
  assert.deepEqual(rankNextActions(i), rankNextActions(structuredClone(i)));
});

test("does not mutate its input", () => {
  const i = input({
    findings: [finding({ id: "b" }), finding({ id: "a", severity: "critical" })],
    openFixPullRequests: [{ id: "1" }],
    pendingActions: [{ id: "x", findingId: "a" }],
    lastAuditAt: daysAgo(10),
  });
  const before = structuredClone(i);
  rankNextActions(i);
  assert.deepEqual(i, before);
});

test("accepts a Date for now and tolerates unusable dates", () => {
  const out = rankNextActions(input({ now: new Date(NOW), findings: [finding({ id: "z", firstSeen: "not a date" })] }));
  assert.equal(out[0].id, "finding:z");
});

test("every action is complete and its copy has no banned jargon", () => {
  const none = { gsc: false, ga4: false, github: false, gmail: false, cms: false };
  const scenarios: RankInput[] = [
    input({ findings: [finding({ id: "a", severity: "critical", entityId: "canonical-missing" }), finding({ id: "f", status: "failed" }), finding({ id: "v", status: "fixed" })], openFixPullRequests: [{ id: "1" }] }),
    input({ lastAuditAt: null, integrations: none, leads: { count: 4, withEmail: 4, unsent: 4 } }),
    input({ lastAuditAt: daysAgo(30) }),
    input({ leads: { count: 4, withEmail: 4, unsent: 4 } }),
    input(),
  ];
  for (const integration of Object.keys(none) as Array<keyof typeof none>) {
    scenarios.push(input({ integrations: { ...ALL_ON, [integration]: false }, leads: { count: 1, withEmail: 1, unsent: 0 } }));
  }
  for (const scenario of scenarios) {
    for (const a of rankNextActions(scenario, { max: 20 })) {
      assert.ok(a.id && a.title && a.why && a.cta.label, `complete: ${a.id}`);
      assert.ok(["high", "medium", "low"].includes(a.impact));
      assert.ok(["minutes", "hour"].includes(a.effort));
      assert.ok(a.reasons.length > 0);
      assert.equal(a.why.split(/(?<=[.!?])\s/).length, 1, `one sentence: ${a.why}`);
      const text = `${a.title} ${a.why} ${a.cta.label}`.toLowerCase();
      for (const word of BANNED_WORDS) {
        // finding labels come from the audit itself; only check the copy we own
        if (a.kind === "fix_finding" || a.kind === "verify_fix") continue;
        assert.ok(!text.includes(word), `"${word}" in ${a.id}: ${text}`);
      }
    }
  }
});

test("static copy table has no banned jargon", () => {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (typeof v === "function") {
      const fn = v as (...args: unknown[]) => unknown;
      for (const arg of [[3], ["Sample label"], [], ["2026-10-26"]]) {
        try {
          const r = fn(...arg);
          if (typeof r === "string") strings.push(r);
        } catch {
          /* wrong arity for this probe */
        }
      }
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(COPY);
  walk(CHECKLIST_COPY);
  assert.ok(strings.length > 20);
  for (const s of strings) {
    for (const word of BANNED_WORDS) assert.ok(!s.toLowerCase().includes(word), `"${word}" in "${s}"`);
  }
});
