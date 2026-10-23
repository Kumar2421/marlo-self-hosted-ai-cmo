"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/query/fetchJson";
import type { PageSpeedCarrier } from "@/lib/domain/seo/pageSpeedFallback";
import {
  combineStatuses, createStartGuard, guardKey, nextRetryDelayMs, shouldAutoStart, strategiesToMeasure,
  type PsiStatus,
} from "@/lib/domain/seo/pageSpeedAuto";
import type { PageSpeedStrategy } from "@/lib/domain/seo/pageSpeedInsights";

export type AutoMeasureState = "idle" | "measuring" | "failed" | "no_key";

/** The route may take up to 60s; give the browser a little longer before it gives up on the request. */
const REQUEST_TIMEOUT_MS = 70_000;

const memoryGuard = new Set<string>();
const startGuard = createStartGuard(() => (typeof window === "undefined" ? null : window.sessionStorage), memoryGuard);

async function measureOne(strategy: PageSpeedStrategy): Promise<PsiStatus> {
  try {
    const out = await fetchJson<{ status?: PsiStatus }>("/api/agents/seo/pagespeed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy }),
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    return out.status ?? "error";
  } catch {
    return "error";
  }
}

/**
 * Re-measures PageSpeed on its own when the stored audit has none because PSI was too slow or failed.
 * Starts once per project and audit (sessionStorage guard), runs mobile and desktop in parallel, then retries
 * up to twice (2 and 5 minutes later) while the page stays open. `onChanged` runs after any call that stored
 * a result so the caller can refetch the audit.
 */
export function usePageSpeedAutoMeasure(input: {
  projectId: string | undefined;
  hasProjectUrl: boolean;
  audit: (PageSpeedCarrier & { pageSpeedUnavailable?: string }) | null | undefined;
  auditStamp: string | null | undefined;
  onChanged: () => void;
}): { state: AutoMeasureState; retry: () => void } {
  const { projectId, hasProjectUrl, audit, auditStamp, onChanged } = input;
  const scope = projectId && auditStamp ? `${projectId}|${auditStamp}` : "";
  // The state belongs to one project+audit; a different scope reads as idle without any reset effect.
  const [tracked, setTracked] = useState<{ scope: string; value: AutoMeasureState }>({ scope: "", value: "idle" });
  const state: AutoMeasureState = tracked.scope === scope ? tracked.value : "idle";
  const runningRef = useRef(false);
  const noKeyRef = useRef(false);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auditRef = useRef(audit);
  const onChangedRef = useRef(onChanged);
  const scopeRef = useRef(scope);
  const runRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    auditRef.current = audit;
    onChangedRef.current = onChanged;
    runRef.current = async () => {
      if (runningRef.current) return;
      const strategies = strategiesToMeasure(auditRef.current);
      if (strategies.length === 0) return;
      const runScope = scopeRef.current;
      runningRef.current = true;
      setTracked({ scope: runScope, value: "measuring" });
      const statuses = await Promise.all(strategies.map(measureOne));
      runningRef.current = false;
      if (runScope !== scopeRef.current) return; // project or audit changed meanwhile
      if (statuses.includes("measured")) onChangedRef.current();
      const overall = combineStatuses(statuses);
      if (overall === "measured") {
        setTracked({ scope: runScope, value: "idle" });
        return;
      }
      if (overall === "no_key") {
        noKeyRef.current = true;
        setTracked({ scope: runScope, value: "no_key" });
        return;
      }
      setTracked({ scope: runScope, value: "failed" });
      const delay = nextRetryDelayMs(retriesRef.current);
      if (delay !== null) {
        retriesRef.current += 1;
        timerRef.current = setTimeout(() => void runRef.current(), delay);
      }
    };
  });

  useEffect(() => {
    scopeRef.current = scope;
    retriesRef.current = 0;
    noKeyRef.current = false;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      runningRef.current = false;
    };
  }, [scope]);

  useEffect(() => {
    if (!projectId || !auditStamp) return;
    const key = guardKey(projectId, auditStamp);
    const start = shouldAutoStart({
      hasProjectUrl,
      audit,
      auditStamp,
      alreadyStarted: startGuard.has(key),
      running: runningRef.current,
      noKey: noKeyRef.current,
    });
    if (!start) return;
    startGuard.mark(key);
    void runRef.current();
  }, [projectId, auditStamp, hasProjectUrl, audit]);

  const retry = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    void runRef.current();
  };

  return { state, retry };
}
