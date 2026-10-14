import test from "node:test";
import assert from "node:assert/strict";
import {
  branchPrefixFor,
  decideFixLink,
  firstOpenPr,
  linkedPrCandidates,
  matchesBranchPrefix,
  openPrForBranchPrefix,
  openPrForHead,
} from "../lib/domain/codefix/openPrPolicy.ts";
import { openOrReuseFixPr, type OpenFixPorts } from "../lib/domain/codefix/openFixPr.ts";
import { branchNameFor } from "../lib/domain/codefix/catalogFix.ts";
import type { PRInfo } from "../lib/domain/fixes/FixDelivery.ts";

const LABEL = "Missing JSON-LD and llms.txt";
const PREFIX = branchPrefixFor(LABEL);
const OLD_PR = "https://github.com/acme/site/pull/3";
const NEW_PR = "https://github.com/acme/site/pull/9";

/** Status map standing in for GitHub: unknown PRs are closed. */
function statusFake(open: string[], throwFor: string[] = []) {
  const calls: string[] = [];
  const status = async (url: string): Promise<PRInfo> => {
    calls.push(url);
    if (throwFor.includes(url)) throw new Error("network down");
    return open.includes(url) ? { state: "open" } : { state: "closed" };
  };
  return { status, calls };
}

function ports(over: Partial<OpenFixPorts> & { open?: string[] } = {}) {
  const calls = { openPr: 0, list: 0, prStatus: [] as string[] };
  const st = statusFake(over.open ?? []);
  const p: OpenFixPorts = {
    linkedPrUrls: over.linkedPrUrls ?? (async () => []),
    prStatus: async (url) => {
      calls.prStatus.push(url);
      return st.status(url);
    },
    listOpenPullRequests: async () => {
      calls.list += 1;
      return over.listOpenPullRequests ? over.listOpenPullRequests() : [];
    },
    openPr: async () => {
      calls.openPr += 1;
      return { prUrl: NEW_PR, branch: "marlo/new", files: ["app/page.tsx"] };
    },
  };
  return { p, calls };
}

test("linkedPrCandidates puts the code_fixes link first, keeps action links, and drops duplicates and blanks", () => {
  const actions = [
    { result: { pullRequest: { url: OLD_PR } } },
    { result: { pullRequest: { url: OLD_PR } } },
    { result: null },
    { result: { implementation: {} } },
  ];
  assert.deepEqual(linkedPrCandidates(NEW_PR, actions as never), [NEW_PR, OLD_PR]);
  assert.deepEqual(linkedPrCandidates(null, []), []);
});

test("firstOpenPr returns the first candidate GitHub reports open, and skips one that cannot be checked", async () => {
  const st = statusFake([NEW_PR], [OLD_PR]);
  assert.equal(await firstOpenPr([OLD_PR, NEW_PR], st.status), NEW_PR);
  assert.equal(await firstOpenPr(["https://github.com/acme/site/pull/1"], st.status), null);
});

test("branch prefix matches the timestamp suffix only, not a longer slug", () => {
  const branch = branchNameFor(LABEL, Date.UTC(2026, 9, 14));
  assert.ok(branch.startsWith(PREFIX));
  assert.equal(matchesBranchPrefix(branch, PREFIX), true);
  assert.equal(matchesBranchPrefix("marlo/missing-json-ld-and-llms-txt-extra-abc123", PREFIX), false);
  assert.equal(matchesBranchPrefix("marlo/missing-json-ld-and-llms-txt-", PREFIX), false);
  assert.equal(matchesBranchPrefix("feature/missing-json-ld-and-llms-txt-abc", PREFIX), false);
});

test("openPrForHead finds a PR by exact head branch", () => {
  const prs = [{ url: OLD_PR, headRef: "marlo/other-x" }, { url: NEW_PR, headRef: "marlo/a-b" }];
  assert.equal(openPrForHead(prs, "marlo/a-b")?.url, NEW_PR);
  assert.equal(openPrForHead(prs, "marlo/a"), null);
  assert.equal(openPrForBranchPrefix(prs, "marlo/a-")?.url, NEW_PR);
});

test("a PR that is still open is reused: nothing is opened", async () => {
  const { p, calls } = ports({ linkedPrUrls: async () => [OLD_PR], open: [OLD_PR] });
  const out = await openOrReuseFixPr(p, { branchPrefix: PREFIX });
  assert.deepEqual(out, { kind: "existing", prUrl: OLD_PR, branch: "" });
  assert.equal(calls.openPr, 0);
  assert.equal(calls.list, 0);
});

test("a linked PR that is closed is not reused: a new PR is opened", async () => {
  const { p, calls } = ports({ linkedPrUrls: async () => [OLD_PR], open: [] });
  const out = await openOrReuseFixPr(p, { branchPrefix: PREFIX });
  assert.equal(out.kind, "opened");
  assert.equal(out.prUrl, NEW_PR);
  assert.equal(calls.openPr, 1);
});

test("retry after an unrecorded PR: the open PR on the label's branch is found and linked, not duplicated", async () => {
  const branch = `${PREFIX}abc123`;
  const { p, calls } = ports({ listOpenPullRequests: async () => [{ url: NEW_PR, headRef: branch }] });
  const out = await openOrReuseFixPr(p, { branchPrefix: PREFIX });
  assert.deepEqual(out, { kind: "existing", prUrl: NEW_PR, branch });
  assert.equal(calls.openPr, 0);
});

test("a failed PR lookup throws instead of guessing that nothing is open", async () => {
  const { p, calls } = ports({ listOpenPullRequests: async () => { throw new Error("GitHub 502"); } });
  await assert.rejects(openOrReuseFixPr(p, { branchPrefix: PREFIX }), /GitHub 502/);
  assert.equal(calls.openPr, 0);
});

test("a linked PR whose status cannot be checked does not block opening a new one", async () => {
  const st = statusFake([], [OLD_PR]);
  const out = await openOrReuseFixPr(
    { ...ports().p, linkedPrUrls: async () => [OLD_PR], prStatus: st.status, openPr: async () => ({ prUrl: NEW_PR, branch: "marlo/n", files: [] }) },
    { branchPrefix: PREFIX },
  );
  assert.equal(out.kind, "opened");
});

test("decideFixLink: same PR, or no earlier link, records the new PR", async () => {
  const never = async () => { throw new Error("should not be asked"); };
  assert.deepEqual(await decideFixLink({ existingPrUrl: null, newPrUrl: NEW_PR, isOpen: never }), { storePrUrl: NEW_PR });
  assert.deepEqual(await decideFixLink({ existingPrUrl: NEW_PR, newPrUrl: NEW_PR, isOpen: never }), { storePrUrl: NEW_PR });
});

test("decideFixLink keeps a different link that is still open and reports the new PR as a duplicate", async () => {
  const d = await decideFixLink({ existingPrUrl: OLD_PR, newPrUrl: NEW_PR, isOpen: async (url) => url === OLD_PR });
  assert.deepEqual(d, { storePrUrl: OLD_PR, duplicatePrUrl: NEW_PR });
});

test("decideFixLink replaces a different link that is closed", async () => {
  const d = await decideFixLink({ existingPrUrl: OLD_PR, newPrUrl: NEW_PR, isOpen: async () => false });
  assert.deepEqual(d, { storePrUrl: NEW_PR });
});

test("decideFixLink does not overwrite the link when the open check fails", async () => {
  await assert.rejects(
    decideFixLink({ existingPrUrl: OLD_PR, newPrUrl: NEW_PR, isOpen: async () => { throw new Error("GitHub down"); } }),
    /GitHub down/,
  );
});
