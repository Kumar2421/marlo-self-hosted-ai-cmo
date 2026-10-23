"use client";

import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Send } from "lucide-react";
import { CloseButton } from "@/components/shared/CloseButton";
import { useDialog } from "@/components/shared/useDialog";
import { ApiError } from "@/lib/query/fetchJson";
import { useOutreachPlan, useOutreachSend, useOutreachStatus } from "@/lib/query/useOutreach";
import type { OutreachSendResult, OutreachStatus, OutreachTemplateId } from "@/lib/domain/leads/outreachContract";
import type { OutreachSender } from "@/lib/domain/leads/outreachEmail";
import {
  canReview,
  flowReducer,
  initialFlow,
  mergeResults,
  outreachErrorMessage,
  retryIds,
  summarisePlan,
} from "@/lib/domain/leads/outreachCompose";
import { ComposeStep, type TestResult } from "./ComposeStep";
import { RecipientsStep } from "./RecipientsStep";
import { ResultsStep, SendingState } from "./ResultsStep";
import { ReviewStep } from "./ReviewStep";
import { Stepper } from "./Stepper";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, type LeadLite } from "./ui";
import { useSenderProfile } from "./useSenderProfile";

type Props = {
  leads: LeadLite[];
  /** The connected Gmail address, used as the "from" line in the preview. */
  gmailEmail: string | null;
  initialSubject?: string;
  initialBody?: string;
  onClose: () => void;
  /** Called after every send batch (including a retry) so the lead list can show who was emailed. */
  onSent: (results: OutreachSendResult["results"]) => void;
};

function errorText(e: unknown): string {
  return e instanceof ApiError ? outreachErrorMessage(e.status, e.message) : outreachErrorMessage(0);
}

/**
 * Right-hand drawer for emailing leads: Recipients -> Write -> Preview & send -> Results. Same shell as SidePanel
 * (right edge, Esc closes, focus returns to the trigger) but it ignores backdrop clicks so typed text is never lost,
 * and it refuses to close while a send is in flight.
 */
export default function OutreachPanel({ leads: initialLeads, gmailEmail, initialSubject, initialBody, onClose, onSent }: Props) {
  // The selection can change behind the panel (it is cleared after a send). The panel keeps the leads it opened with.
  const [leads] = useState(initialLeads);
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const leadIds = useMemo(() => leads.map((l) => l.id), [leads]);

  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [templateId, setTemplateId] = useState<OutreachTemplateId>("plain");
  const [acceptGuessed, setAcceptGuessed] = useState(false);
  const [guessedSeen, setGuessedSeen] = useState(0);
  const [results, setResults] = useState<OutreachSendResult["results"]>([]);
  const [latestStatus, setLatestStatus] = useState<OutreachStatus | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [sendingCount, setSendingCount] = useState(0);
  const [profile, updateProfile] = useSenderProfile();

  const planQuery = useOutreachPlan(leadIds, acceptGuessed);
  const statusQuery = useOutreachStatus();
  const send = useOutreachSend();
  const testSend = useOutreachSend();
  const inFlight = useRef(false);

  const plan = planQuery.data;
  const planLoading = planQuery.isFetching || planQuery.isPlaceholderData;
  const planReady = Boolean(plan) && !planLoading;
  const planError = planQuery.isError && !plan ? errorText(planQuery.error) : null;

  const sender = useMemo<OutreachSender>(
    () => ({ name: profile.name.trim() || null, email: gmailEmail ?? "you@example.com", company: profile.company.trim() || null, address: profile.address.trim() || null }),
    [profile, gmailEmail],
  );
  const sampleLeads = useMemo(() => (plan ? plan.sendable.map((id) => byId.get(id)).filter((l): l is LeadLite => Boolean(l)) : []), [plan, byId]);

  const titleId = useId();
  const busy = flow.step === "sending";
  const closeIfIdle = () => {
    if (!inFlight.current) onClose();
  };
  const panelRef = useDialog<HTMLDivElement>(true, closeIfIdle);

  // Move focus to the step content when the step changes, so keyboard and screen reader users land on the new step.
  const contentRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    contentRef.current?.focus();
  }, [flow.step]);

  function toggleGuessed(next: boolean) {
    if (next && plan) setGuessedSeen(plan.guessedIds.length);
    setAcceptGuessed(next);
  }
  const guessedCount = acceptGuessed ? Math.max(guessedSeen, plan?.guessedIds.length ?? 0) : (plan?.guessedIds.length ?? 0);

  async function runSend(ids: string[], kind: "send" | "retry") {
    if (inFlight.current) return;
    if (kind === "send" ? flow.step !== "review" : flow.step !== "results") return;
    inFlight.current = true;
    setError(null);
    setSendingCount(ids.length);
    dispatch({ type: kind === "send" ? "submit" : "retry" });
    try {
      const data = await send.mutateAsync({ leadIds: ids, subject, body, templateId, acceptGuessed });
      setResults((prev) => (kind === "retry" ? mergeResults(prev, data.results) : data.results));
      setLatestStatus(data.status);
      onSent(data.results);
      dispatch({ type: "done" });
    } catch (e) {
      setError(errorText(e));
      dispatch({ type: "fail" });
    } finally {
      inFlight.current = false;
    }
  }

  async function sendTest() {
    const first = sampleLeads[0];
    if (!first || testSend.isPending) return;
    setTestResult(null);
    try {
      const data = await testSend.mutateAsync({ leadIds: [first.id], subject, body, templateId, acceptGuessed, test: true });
      const row = data.results[0];
      setTestResult(
        row?.status === "sent"
          ? { kind: "ok", message: `Test sent to ${gmailEmail ?? "your inbox"}. Check your inbox, and your spam folder if it does not show up.` }
          : { kind: "error", message: row?.error?.trim() ? `The test did not go through: ${row.error}` : "The test did not go through. Nothing was sent to your leads." },
      );
    } catch (e) {
      setTestResult({ kind: "error", message: errorText(e) });
    }
  }

  const summary = plan ? summarisePlan(leads.length, plan) : null;
  const sendCount = plan?.sendable.length ?? 0;
  const failedIds = retryIds(results);
  const status = latestStatus ?? plan?.status ?? statusQuery.data;

  let footer: React.ReactNode;
  if (flow.step === "recipients") {
    footer = (
      <>
        <button type="button" onClick={onClose} className={BTN_GHOST}>
          Cancel
        </button>
        <button type="button" onClick={() => dispatch({ type: "next" })} disabled={!planReady || !summary?.canContinue} className={BTN_PRIMARY} data-testid="to-compose">
          Write email <ArrowRight size={14} aria-hidden="true" />
        </button>
      </>
    );
  } else if (flow.step === "compose") {
    footer = (
      <>
        <button type="button" onClick={() => dispatch({ type: "back" })} className={BTN_GHOST}>
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
        <button type="button" onClick={() => dispatch({ type: "next" })} disabled={!canReview(subject, body)} className={BTN_PRIMARY} data-testid="to-review">
          Preview & send <ArrowRight size={14} aria-hidden="true" />
        </button>
      </>
    );
  } else if (flow.step === "review") {
    footer = (
      <>
        <button type="button" onClick={() => dispatch({ type: "back" })} className={BTN_GHOST}>
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
        <button type="button" onClick={() => void runSend(plan?.sendable ?? [], "send")} disabled={sendCount === 0 || busy} className={BTN_PRIMARY} data-testid="confirm-send">
          <Send size={14} aria-hidden="true" /> Send {sendCount} email{sendCount === 1 ? "" : "s"}
        </button>
      </>
    );
  } else if (flow.step === "sending") {
    footer = (
      <button type="button" disabled className={BTN_PRIMARY}>
        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Sending...
      </button>
    );
  } else {
    footer = (
      <>
        {failedIds.length > 0 ? (
          <button type="button" onClick={() => void runSend(failedIds, "retry")} className={BTN_SECONDARY} data-testid="retry-failed">
            Retry failed ({failedIds.length})
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onClose} className={BTN_PRIMARY} data-testid="close-results">
          Done
        </button>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="outreach-panel"
        className="relative flex h-full w-full max-w-5xl flex-col border-l border-gray-200 bg-white shadow-2xl outline-none motion-safe:animate-[slideIn_160ms_ease-out]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-[15px] font-semibold text-gray-900">
              Email {leads.length} lead{leads.length === 1 ? "" : "s"}
            </h2>
            <div className="mt-1.5">
              <Stepper step={flow.step} />
            </div>
          </div>
          {!busy && <CloseButton onClick={onClose} label="Close panel" />}
        </header>

        <div ref={contentRef} tabIndex={-1} className="okara-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none sm:px-5">
          <div className={flow.step === "compose" ? "" : "mx-auto max-w-2xl"}>
            {flow.step === "recipients" && (
              <RecipientsStep
                leads={leads}
                selectedCount={leads.length}
                plan={plan}
                loading={planLoading}
                errorMessage={planError}
                onRetry={() => void planQuery.refetch()}
                acceptGuessed={acceptGuessed}
                guessedCount={guessedCount}
                onToggleGuessed={toggleGuessed}
                fallbackStatus={statusQuery.data}
              />
            )}
            {flow.step === "compose" && (
              <ComposeStep
                subject={subject}
                body={body}
                onSubject={setSubject}
                onBody={setBody}
                templateId={templateId}
                onTemplate={setTemplateId}
                sender={sender}
                senderProfile={profile}
                onSenderProfile={updateProfile}
                sampleLeads={sampleLeads}
                onSendTest={() => void sendTest()}
                testing={testSend.isPending}
                testResult={testResult}
                canTest={canReview(subject, body) && sampleLeads.length > 0}
                errorMessage={null}
              />
            )}
            {flow.step === "review" && plan && (
              <ReviewStep
                count={sendCount}
                templateId={templateId}
                subject={subject}
                credits={plan.creditCost}
                status={plan.status}
                guessedIncluded={acceptGuessed ? plan.guessedIds.length : 0}
                errorMessage={error}
              />
            )}
            {flow.step === "sending" && <SendingState count={sendingCount} />}
            {flow.step === "results" && <ResultsStep leads={leads} results={results} status={status} errorMessage={error} />}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-5">{footer}</footer>
      </div>
    </div>
  );
}
