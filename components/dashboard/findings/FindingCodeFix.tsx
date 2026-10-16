"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, GitPullRequest, Loader2, Wrench } from "lucide-react";
import type { Finding } from "@/lib/domain/findings/findingTypes";
import { classifyFinding } from "@/lib/domain/codefix/fixCatalog";
import { CMS_LABEL, classifyForCms } from "@/lib/domain/cms/cmsFixCatalog";
import type { FixChange } from "@/lib/domain/codefix/catalogFix";
import { closedPullRequestOf, pullRequestUrlOf } from "@/lib/domain/fixes/linkPullRequest";
import { implementationOf } from "@/lib/domain/search/actionOutcome";
import type { ActionWithOutcome } from "@/lib/domain/search/outcomeService";
import SidePanel from "@/components/shared/SidePanel";
import { useTerminalLog } from "@/lib/terminal-log-store";
import { useCodeFix, useGithubStatus, type PreparedFix } from "./useCodeFix";
import FindingCmsFix, { CmsConnectPrompt } from "./FindingCmsFix";
import { useCmsStatus } from "./useCmsFix";

type AutoFix = Extract<PreparedFix, { mode: "auto" }>;

const box = "rounded-xl border border-gray-200 p-3";

function ChangeEditor({ change, onChange }: { change: FixChange; onChange: (next: FixChange) => void }) {
  const textarea = "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 font-mono text-[12px] leading-5 text-gray-800 focus:border-gray-400 focus:outline-none";
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[12px]">
        <span className="min-w-0 truncate font-mono font-medium text-gray-800">{change.path}</span>
        {change.type === "create" && (
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">New file</span>
        )}
      </div>
      <div className="space-y-2 p-3">
        {change.type === "edit" ? (
          <>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Now</div>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 font-mono text-[12px] leading-5 text-red-800">{change.oldSnippet}</pre>
            </div>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Marlo will change it to (you can edit this)</span>
              <textarea
                value={change.newSnippet}
                onChange={(e) => onChange({ ...change, newSnippet: e.target.value })}
                rows={Math.min(12, Math.max(3, change.newSnippet.split("\n").length + 1))}
                spellCheck={false}
                className={textarea}
              />
            </label>
          </>
        ) : (
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">File content (you can edit this)</span>
            <textarea
              value={change.content}
              onChange={(e) => onChange({ ...change, content: e.target.value })}
              rows={Math.min(16, Math.max(4, change.content.split("\n").length + 1))}
              spellCheck={false}
              className={textarea}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function PreviewPanel({
  finding,
  fix,
  onClose,
  approve,
}: {
  finding: Finding;
  fix: AutoFix;
  onClose: () => void;
  approve: ReturnType<typeof useCodeFix>["approve"];
}) {
  const [changes, setChanges] = useState<FixChange[]>(fix.changes);
  const prUrl = approve.data?.prUrl ?? null;
  const { log, logDone } = useTerminalLog();

  const submit = () => {
    log(`Opening a pull request on ${fix.repoFullName} for ${finding.entityId}...`);
    approve.mutate(
      { ticket: fix.ticket, changes, explanation: fix.explanation, edited: JSON.stringify(changes) !== JSON.stringify(fix.changes) },
      {
        onSuccess: (data) => logDone(`Applied fix: ${fix.label}. Pull request opened: ${data.prUrl}`),
        onError: (error) => logDone(`Couldn't open the pull request: ${error.message}`),
      },
    );
  };

  return createPortal(
    <SidePanel
      open
      onClose={onClose}
      title={`Fix in code: ${fix.label}`}
      subtitle={<span>Preview for <span className="font-mono">{fix.repoFullName}</span>. Nothing has been changed yet.</span>}
      footer={
        prUrl ? (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[12px] text-emerald-700"><Check size={14} /> Pull request opened</span>
            <a href={prUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black">
              View on GitHub <ExternalLink size={12} />
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            {approve.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{approve.error.message}</div>}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] leading-4 text-gray-500">Opens a pull request. Marlo never merges: you review and merge it on GitHub.</p>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={onClose} disabled={approve.isPending} className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" onClick={submit} disabled={approve.isPending} className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50">
                  {approve.isPending ? <Loader2 size={13} className="animate-spin" /> : <GitPullRequest size={13} />}
                  Approve and open PR
                </button>
              </div>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-3">
        <p className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] leading-5 text-gray-700">{fix.explanation}</p>
        {changes.map((change, index) => (
          <ChangeEditor key={`${change.path}-${index}`} change={change} onChange={(next) => setChanges((prev) => prev.map((c, i) => (i === index ? next : c)))} />
        ))}
      </div>
    </SidePanel>,
    document.body,
  );
}

/** The finding's code-fix area: connect GitHub, prepare a previewed fix, then follow its pull request. */
export default function FindingCodeFix({ finding, actions }: { finding: Finding; actions: ActionWithOutcome[] }) {
  const verdict = classifyFinding(finding);
  const status = useGithubStatus(verdict.mode === "auto");
  const cmsStatus = useCmsStatus(verdict.mode === "auto");
  const { prepare, approve, hasModel } = useCodeFix(finding.id);
  const [fix, setFix] = useState<AutoFix | null>(null);
  const { log, logDone } = useTerminalLog();

  if (verdict.mode === "manual") {
    return (
      <div className={`${box} bg-gray-50`} data-testid="codefix-manual">
        <div className="text-[12px] font-semibold text-gray-900">This needs a manual change</div>
        <p className="mt-1 text-[11px] leading-4 text-gray-600">{verdict.reason}</p>
        <p className="mt-2 text-[12px] leading-5 text-gray-700">{finding.recommendation}</p>
      </div>
    );
  }

  const linked = actions.find((a) => pullRequestUrlOf(a.result));
  const prUrl = linked ? pullRequestUrlOf(linked.result) : null;
  if (prUrl && !fix) {
    const merged = implementationOf(linked!.result)?.via === "github_pr";
    return (
      <div className={`${box} flex items-center justify-between gap-3`} data-testid="codefix-pr">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-900">
            <GitPullRequest size={13} />
            {merged ? "Pull request merged" : "Pull request open"}
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase ${merged ? "border-violet-200 bg-violet-50 text-violet-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {merged ? "Merged" : "Open"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">{merged ? "Marlo is measuring what the change did." : "Review and merge it on GitHub. Marlo never merges for you."}</p>
        </div>
        <a href={prUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline">
          View <ExternalLink size={11} />
        </a>
      </div>
    );
  }

  // A PR that was closed without merging: say so once, above the prepare controls, so a new fix can be made.
  const closedPr = !prUrl && !fix ? actions.map((a) => closedPullRequestOf(a.result)).find((c) => c !== null) ?? null : null;
  const closedNode = closedPr ? (
    <div className={`${box} flex items-center justify-between gap-3`} data-testid="codefix-pr-closed">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-900">
          <GitPullRequest size={13} />
          Pull request closed without merging
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[9px] font-semibold uppercase text-red-700">Closed</span>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">Nothing was merged. Prepare a new fix when you are ready.</p>
      </div>
      <a href={closedPr.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline">
        View <ExternalLink size={11} />
      </a>
    </div>
  ) : null;

  if (status.isPending || cmsStatus.isPending) return <div className="h-12 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />;
  const gh = status.data;
  const ghUsable = !(status.isError || !gh || (gh.mode === "app" && !gh.configured));
  const ghConnected = ghUsable && Boolean(gh?.connected);

  // A connected CMS that can apply this exact fix directly (WordPress, Webflow): no GitHub needed.
  const connections = cmsStatus.data?.connections ?? [];
  const cmsFix = connections.map((c) => ({ conn: c, verdict: classifyForCms(c.cms, finding) })).find((c) => c.verdict.fixable);
  const cmsNode = cmsFix && cmsFix.verdict.fixable ? <FindingCmsFix finding={finding} cms={cmsFix.conn.cms} cmsLabel={CMS_LABEL[cmsFix.conn.cms]} label={cmsFix.verdict.label} /> : null;

  const githubPrompt = () => {
    if (!gh || !ghUsable) return null;
    if (gh.mode === "pat") {
      return (
        <div className={box}>
          <p className="text-[12px] text-gray-700">Add a GitHub token in Settings to let Marlo open a pull request for this fix.</p>
          <a href="/settings/api-credentials" className="mt-2 inline-block text-[12px] font-medium text-blue-600 hover:underline">Open settings</a>
        </div>
      );
    }
    if (gh.needsRepo) {
      return (
        <div className={box}>
          <p className="text-[12px] text-gray-700">GitHub is connected. Choose which repository Marlo may use.</p>
          <a href="/settings/integrations" className="mt-2 inline-block text-[12px] font-medium text-blue-600 hover:underline">Choose repository</a>
        </div>
      );
    }
    const returnTo = `/dashboard?finding=${encodeURIComponent(finding.id)}`;
    return (
      <div className={`${box} flex flex-wrap items-center justify-between gap-3`}>
        <p className="min-w-0 text-[12px] leading-5 text-gray-700">Connect GitHub to let Marlo open a pull request</p>
        <a href={`/api/github/app/install?returnTo=${encodeURIComponent(returnTo)}`} className="shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black">
          Connect GitHub
        </a>
      </div>
    );
  };

  if (!ghConnected) {
    if (cmsNode) {
      return (
        <div className="space-y-2">
          {cmsNode}
          {githubPrompt()}
        </div>
      );
    }
    // Nothing can apply this yet: offer both ways to connect (or say why the connected CMS can't).
    const cmsReason = connections.length > 0 ? classifyForCms(connections[0].cms, finding) : null;
    const gp = githubPrompt();
    if (!gp && connections.length > 0) return null;
    return (
      <div className="space-y-2">
        {gp}
        <CmsConnectPrompt note={cmsReason && !cmsReason.fixable ? cmsReason.reason : undefined} />
      </div>
    );
  }

  if (!gh) return null;

  const runPrepare = () => {
    log(`Reading ${gh.repoFullName} to prepare: ${verdict.label}...`);
    prepare.mutate(undefined, {
      onSuccess: (data) => {
        if (data.mode === "auto") {
          logDone(`Prepared a fix for ${verdict.label}. Review it before anything is opened.`);
          setFix(data);
        } else logDone("This one needs a manual change.");
      },
      onError: (error) => logDone(`Couldn't prepare a fix: ${error.message}`),
    });
  };

  const githubNode = (
    <div className={box} data-testid="codefix-ready">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-gray-900">Fix in code: {verdict.label}</div>
          <p className="mt-0.5 text-[11px] leading-4 text-gray-500">
            Marlo drafts the change for <span className="font-mono">{gh.repoFullName}</span> and shows it to you first.
          </p>
        </div>
        <button
          type="button"
          onClick={runPrepare}
          disabled={prepare.isPending || !hasModel}
          title={hasModel ? undefined : "Select a model in Settings first"}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {prepare.isPending ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
          {prepare.isPending ? "Preparing..." : "Prepare fix"}
        </button>
      </div>
      {!hasModel && <p className="mt-2 text-[11px] text-amber-700">Select a model in Settings to prepare fixes.</p>}
      {prepare.error && <p className="mt-2 text-[11px] text-red-600">{prepare.error.message}</p>}
      {fix && <PreviewPanel finding={finding} fix={fix} approve={approve} onClose={() => { setFix(null); approve.reset(); }} />}
    </div>
  );

  const main = cmsNode ? (
    <div className="space-y-2">
      {cmsNode}
      {githubNode}
    </div>
  ) : (
    githubNode
  );
  return closedNode ? (
    <div className="space-y-2">
      {closedNode}
      {main}
    </div>
  ) : (
    main
  );
}
