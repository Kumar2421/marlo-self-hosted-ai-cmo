"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Check, Loader2, Play, Plus, Trash2 } from "lucide-react";
import SidePanel from "@/components/shared/SidePanel";
import { SkeletonCard, SkeletonLines } from "@/components/shared/Skeleton";
import { useProject } from "@/lib/project-store";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useGoogleConnection } from "@/lib/query/useGoogleConnection";
import { referralNotice } from "@/lib/domain/integrations/googleHealthView";
import { RECONNECT_IN_TRAFFIC_HINT } from "@/lib/googleOAuthScopes";
import { useToast } from "@/components/dashboard/Toast";
import type { GeoOverview, PromptRow, ReferralView } from "@/lib/domain/geo/geoService";
import type { ReadinessResult } from "@/lib/domain/geo/readiness";
import type { AnswerMethod, GeoPrompt, GeoRunRow } from "@/lib/domain/geo/types";

const METHOD_LABEL: Record<AnswerMethod, string> = {
  "gemini-grounded": "Gemini + Google Search",
  simulated: "Simulated",
};

function MethodBadge({ method }: { method: AnswerMethod }) {
  const simulated = method === "simulated";
  return (
    <span
      title={simulated ? "Not a real AI assistant. Web search results plus an answer written by a free model." : "A real Gemini answer that used Google Search."}
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${simulated ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
    >
      {METHOD_LABEL[method]}
    </span>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function TrendIcon({ trend }: { trend: PromptRow["methods"][number]["trend"] }) {
  if (trend === "up") return <span title="Mentioned more than last time" className="text-[#00ab92]"><ArrowUp size={12} /></span>;
  if (trend === "down") return <span title="Mentioned less than last time" className="text-red-500"><ArrowDown size={12} /></span>;
  if (trend === "flat") return <span title="About the same as last time" className="text-ui-subtle"><ArrowRight size={12} /></span>;
  return <span title="Not enough history yet" className="text-xs text-ui-subtle">new</span>;
}

function Block({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
      {subtitle ? <p className="mb-3 mt-0.5 text-[12px] text-gray-500">{subtitle}</p> : <div className="mb-3" />}
      {children}
    </div>
  );
}

function Readiness({ pid }: { pid: string | undefined }) {
  const { show } = useToast();
  const query = useQuery({
    queryKey: qk.geoReadiness(pid),
    enabled: Boolean(pid),
    staleTime: 5 * 60_000,
    queryFn: () => fetchJson<ReadinessResult & { domain: string }>("/api/geo/readiness"),
  });
  const track = useMutation({
    mutationFn: (checkId: string) => fetchJson("/api/geo/readiness", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkId }) }),
    onSuccess: () => {
      window.dispatchEvent(new CustomEvent("marlo:findings-updated"));
      show("Added to your findings.");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not add this to findings."),
  });

  return (
    <Block title="AI readiness" subtitle="Can AI tools find, read and understand your site? This is a checklist of facts, not a ranking.">
      {query.isPending ? (
        <SkeletonCard rows={5} />
      ) : query.isError ? (
        <p className="text-[12px] text-gray-500">{query.error.message}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2.5">
            <span className="text-[12px] text-gray-600">Readiness score for {query.data.domain}</span>
            <span className="text-[15px] font-semibold text-gray-900">{query.data.score}/100</span>
          </div>
          {query.data.checks.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-3 border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-gray-800">
                  {c.status === "pass" ? <Check size={12} className="text-[#00ab92]" /> : c.status === "fail" ? <AlertTriangle size={12} className="text-amber-600" /> : <span className="text-gray-300">?</span>}
                  {c.label}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">{c.status === "fail" ? c.fix : c.detail}</div>
              </div>
              {c.status === "fail" && (
                <button
                  onClick={() => track.mutate(c.id)}
                  disabled={track.isPending}
                  className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Track as a fix
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

function Referrals({ pid }: { pid: string | undefined }) {
  const query = useQuery({
    queryKey: qk.geoReferral(pid),
    enabled: Boolean(pid),
    staleTime: 5 * 60_000,
    queryFn: () => fetchJson<ReferralView & { unavailable?: boolean }>("/api/geo/referral"),
  });
  const health = useGoogleConnection(pid);
  const notice = query.isPending
    ? null
    : referralNotice(health, query.isError || ("unavailable" in query.data && query.data.unavailable) ? "unavailable" : "notConnected" in query.data ? "not_connected" : "ok");
  return (
    <Block title="AI referral visits" subtitle="Visits from ChatGPT, Perplexity, Claude, Gemini and Copilot in the last 28 days (a floor; some visits carry no referrer).">
      {query.isPending ? (
        <SkeletonLines rows={2} />
      ) : notice ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-4 text-[12px] text-gray-500">
          <p>{notice.text}</p>
          {notice.showReconnect && (
            <p className="mt-1">{RECONNECT_IN_TRAFFIC_HINT}</p>
          )}
        </div>
      ) : query.data && "total" in query.data ? (
        <div className="rounded-xl border border-gray-200 p-3">
          <div className="text-[20px] font-semibold text-gray-900">{query.data.total} <span className="text-[12px] font-normal text-gray-500">visits</span></div>
          {query.data.bySource.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No visits with an AI assistant as the referrer yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-[12px] text-gray-700">
              {query.data.bySource.map((s) => (
                <li key={s.source} className="flex justify-between"><span>{s.source}</span><span>{s.sessions}</span></li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Block>
  );
}

function PromptHistory({ pid, prompt, onClose }: { pid: string | undefined; prompt: string | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: qk.geoHistory(pid, prompt ?? ""),
    enabled: Boolean(pid && prompt),
    queryFn: () => fetchJson<{ runs: GeoRunRow[] }>(`/api/geo/history?prompt=${encodeURIComponent(prompt ?? "")}`),
  });
  return (
    <SidePanel open={Boolean(prompt)} onClose={onClose} title="Run history" subtitle={prompt ?? ""} width="lg">
      {query.isPending ? (
        <SkeletonCard rows={5} />
      ) : query.isError ? (
        <p className="text-[12px] text-gray-500">{query.error.message}</p>
      ) : query.data.runs.length === 0 ? (
        <p className="text-[13px] text-gray-500">No runs yet for this prompt.</p>
      ) : (
        <div className="space-y-2">
          {query.data.runs.map((r, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3 text-[12px]">
              <div className="mb-1 flex items-center justify-between gap-2">
                <MethodBadge method={r.method} />
                <span className="text-ui-subtle">{new Date(r.runAt).toLocaleString()}</span>
              </div>
              <div className="text-gray-800">
                {r.mentioned ? "You were mentioned" : "You were not mentioned"}
                {" · "}
                {r.cited ? "your site was a source" : "your site was not a source"}
              </div>
              {r.competitors.length > 0 && <div className="mt-0.5 text-gray-500">Also named: {r.competitors.join(", ")}</div>}
              {r.answerExcerpt && <p className="mt-1.5 line-clamp-4 text-gray-500">{r.answerExcerpt}</p>}
            </div>
          ))}
        </div>
      )}
    </SidePanel>
  );
}

function Prompts({ pid, overview }: { pid: string | undefined; overview: GeoOverview }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const save = useMutation({
    mutationFn: (prompts: GeoPrompt[]) => fetchJson("/api/geo/prompts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompts }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.geoOverview(pid) }),
    onError: (e) => show(e instanceof Error ? e.message : "Could not save prompts."),
  });
  const suggest = useMutation({
    mutationFn: () => fetchJson("/api/geo/prompts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "suggest" }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.geoOverview(pid) }),
    onError: (e) => show(e instanceof Error ? e.message : "Could not load suggestions."),
  });

  const trackGap = useMutation({
    mutationFn: (prompt: string) => fetchJson("/api/geo/gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }),
    onSuccess: () => {
      window.dispatchEvent(new CustomEvent("marlo:findings-updated"));
      qc.invalidateQueries({ queryKey: qk.geoOverview(pid) });
      show("Added to your findings.");
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not add this to findings."),
  });

  const asPrompts = (rows: PromptRow[]): GeoPrompt[] => rows.map((r) => ({ prompt: r.prompt, source: r.source, active: r.active }));
  const activeCount = overview.prompts.filter((p) => p.active).length;

  return (
    <Block title="Questions we track" subtitle="Questions a buyer might ask an AI assistant. Each one is asked three times and we report how often you come up.">
      <div className="overflow-hidden rounded-xl border border-gray-200">
        {overview.prompts.length === 0 && (
          <div className="p-4 text-[12px] text-gray-500">No questions yet. Connect Search Console and we will suggest some from your top searches, or add your own below.</div>
        )}
        {overview.prompts.map((p) => (
          <div key={p.prompt} className={`border-t border-gray-100 px-3 py-2.5 first:border-t-0 ${p.active ? "" : "opacity-50"}`}>
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => setOpenPrompt(p.prompt)} className="min-w-0 text-left text-[13px] text-gray-800 hover:underline">{p.prompt}</button>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-gray-500">
                  <input
                    type="checkbox"
                    checked={p.active}
                    disabled={!p.active && activeCount >= 10}
                    onChange={(e) => save.mutate(asPrompts(overview.prompts).map((x) => (x.prompt === p.prompt ? { ...x, active: e.target.checked } : x)))}
                  />
                  Track
                </label>
                {p.gap?.tracked ? (
                  <span title={`Finding status: ${p.gap.findingStatus ?? "new"}`} className="rounded-md bg-gray-100 px-2 py-0.5 font-medium text-gray-600">Tracked</span>
                ) : p.gap?.open ? (
                  <button
                    onClick={() => trackGap.mutate(p.prompt)}
                    disabled={trackGap.isPending}
                    className="rounded-md border border-gray-200 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    Track as a fix
                  </button>
                ) : null}
                <button aria-label="Remove question" onClick={() => save.mutate(asPrompts(overview.prompts).filter((x) => x.prompt !== p.prompt))} className="text-ui-subtle hover:text-red-500"><Trash2 size={12} /></button>
              </div>
            </div>
            {p.methods.length === 0 ? (
              <div className="mt-1 text-xs text-ui-subtle">Not run yet.</div>
            ) : (
              <div className="mt-1.5 space-y-1">
                {p.methods.map((m) => (
                  <div key={m.method} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-600">
                    <MethodBadge method={m.method} />
                    <span>Mentioned in <b className="text-gray-900">{Math.round(m.mentionRate * m.runs)} of {m.runs}</b> answers ({pct(m.mentionRate)})</span>
                    <TrendIcon trend={m.trend} />
                    {m.competitors.length > 0 && <span className="text-gray-500">Named instead: {m.competitors.slice(0, 3).join(", ")}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text) return;
          save.mutate([...asPrompts(overview.prompts), { prompt: text, source: "manual", active: activeCount < 10 }]);
          setDraft("");
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a question, e.g. What is the best CRM for a small team?" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px]" />
        <button type="submit" className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"><Plus size={12} /> Add</button>
        <button type="button" onClick={() => suggest.mutate()} disabled={suggest.isPending} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">Suggest from Search Console</button>
      </form>
      <PromptHistory pid={pid} prompt={openPrompt} onClose={() => setOpenPrompt(null)} />
    </Block>
  );
}

function MethodsExplainer() {
  return (
    <div className="mb-6 rounded-xl border border-dashed border-gray-200 p-4 text-[12px] leading-5 text-gray-600">
      <div className="mb-1 text-[13px] font-semibold text-gray-900">How we measure AI visibility</div>
      <ul className="list-disc space-y-1 pl-4">
        <li><b>Gemini + Google Search</b>: we ask Google&apos;s Gemini the question with live search switched on, three times, and count how often you are named or used as a source. This is a real answer, but only from Gemini.</li>
        <li><b>Simulated</b>: we run a web search and have a free model write an answer from the results. It is a rough stand-in, <b>not</b> ChatGPT, Perplexity or any real assistant, and it is never combined with the other numbers.</li>
        <li><b>Readiness</b>: facts about your site that help AI tools read it.</li>
        <li><b>AI referral visits</b>: real visits from AI assistants that show up in Google Analytics.</li>
      </ul>
    </div>
  );
}

type RunSummary = {
  ran: number;
  skippedCap: number;
  skippedAlreadyDone: number;
  failed: unknown[];
  skipped: Array<{ prompt: string; method: "gemini-grounded" | "simulated"; reason: "cap" | "rotation" | "budget" }>;
  runsPerPrompt: Partial<Record<"gemini-grounded" | "simulated", number>>;
};

const METHOD_NAME = { "gemini-grounded": "Gemini with Google Search", simulated: "Simulated" } as const;
const SKIP_REASON = {
  cap: "the daily limit was reached",
  rotation: "the daily limit is smaller than your prompt list, so the starting prompt rotates each day",
  budget: "the run ran out of time",
} as const;

function SkippedPrompts({ summary }: { summary: RunSummary }) {
  const reduced = (Object.entries(summary.runsPerPrompt) as Array<["gemini-grounded" | "simulated", number]>).filter(([, n]) => n < 3);
  if (summary.skipped.length === 0 && reduced.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {reduced.map(([m, n]) => (
        <p key={m}>
          {METHOD_NAME[m]}: the daily limit allows only {n} run{n === 1 ? "" : "s"} per prompt today instead of 3.
        </p>
      ))}
      {summary.skipped.length > 0 && <p className="mt-1 font-medium">Not checked in this run:</p>}
      <ul className="list-disc pl-4">
        {summary.skipped.map((s) => (
          <li key={s.method + s.prompt + s.reason}>
            {s.prompt} ({METHOD_NAME[s.method]}): {SKIP_REASON[s.reason]}.
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function GeoVisibility() {
  const { project } = useProject();
  const pid = project?.id;
  const qc = useQueryClient();
  const { show } = useToast();

  const overview = useQuery({
    queryKey: qk.geoOverview(pid),
    enabled: Boolean(pid),
    queryFn: () => fetchJson<GeoOverview>("/api/geo/overview"),
  });
  const [lastSummary, setLastSummary] = useState<RunSummary | null>(null);
  const run = useMutation({
    mutationFn: () => fetchJson<{ summary: RunSummary }>("/api/geo/run", { method: "POST" }),
    onSuccess: ({ summary }) => {
      setLastSummary(summary);
      qc.invalidateQueries({ queryKey: qk.geoOverview(pid) });
      qc.invalidateQueries({ queryKey: ["project", pid ?? "none", "geo-history"] });
      show(
        summary.ran > 0
          ? `Ran ${summary.ran} checks.`
          : summary.skippedAlreadyDone > 0
            ? "Already checked today. Come back tomorrow for a new reading."
            : summary.skippedCap > 0
              ? "Daily limit for checks reached. It resets tomorrow."
              : "Nothing to run.",
      );
    },
    onError: (e) => show(e instanceof Error ? e.message : "Could not run the check."),
  });

  const cap = overview.data?.capabilities;

  return (
    <div className="mb-8">
      <MethodsExplainer />
      <Readiness pid={pid} />
      <Referrals pid={pid} />
      {overview.isPending ? (
        <SkeletonCard rows={5} />
      ) : overview.isError ? (
        <p className="text-[12px] text-gray-500">{overview.error.message}</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => run.mutate()}
              disabled={run.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-60"
            >
              {run.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {run.isPending ? "Running..." : "Run now"}
            </button>
            <span className="text-xs text-gray-500">
              {overview.data.lastRunAt ? `Last run ${new Date(overview.data.lastRunAt).toLocaleDateString()}. ` : "Not run yet. "}
              Runs automatically once a week.
              {cap?.geminiAvailable && cap.geminiDailyCap !== null ? ` Gemini checks today: ${cap.geminiUsedToday} of ${cap.geminiDailyCap}.` : ""}
              {cap?.simulatedAvailable && cap.simulatedDailyCap !== null ? ` Simulated checks today: ${cap.simulatedUsedToday} of ${cap.simulatedDailyCap}.` : ""}
              {cap && !cap.geminiAvailable && !cap.simulatedAvailable ? " No method is set up yet: add a Gemini key (or Tavily plus Groq) in Settings." : ""}
            </span>
          </div>
          {lastSummary && <SkippedPrompts summary={lastSummary} />}
          <Prompts pid={pid} overview={overview.data} />
        </>
      )}
    </div>
  );
}
