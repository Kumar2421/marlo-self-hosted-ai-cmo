"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

type FallbackArgs = { error: Error; reset: () => void };

type Props = {
  /** Names the section in the fallback and the console log, e.g. "Analytics: GEO". */
  label: string;
  /** Replaces the default card. Receives the error and a reset that re-renders the children. */
  fallback?: (args: FallbackArgs) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  /** When any entry changes while the fallback is showing, the boundary resets itself (tab or project switch). */
  resetKeys?: readonly unknown[];
  children: ReactNode;
};

type State = { error: Error | null };

const sameKeys = (a: readonly unknown[] = [], b: readonly unknown[] = []) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** Contains a render crash to one section so the rest of the dashboard keeps working. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary] "${this.props.label}" crashed:`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset });
    return <ErrorCard label={this.props.label} error={error} onReset={this.reset} />;
  }
}

/** Calm fallback card. "Try again" re-fetches failed queries, then re-renders the section. */
export function ErrorCard({ label, error, onReset }: { label: string; error: Error; onReset: () => void }) {
  const queryClient = useQueryClient();
  const retry = () => {
    void queryClient.refetchQueries({ predicate: (q) => q.state.status === "error" || q.state.data === undefined });
    onReset();
  };
  return (
    <div role="alert" data-testid="error-boundary-card" className="m-4 rounded-xl border border-gray-200 bg-white p-5 text-center">
      <AlertTriangle className="mx-auto mb-2 text-amber-500" size={22} aria-hidden />
      <h3 className="text-[13px] font-semibold text-gray-900">This section hit a problem</h3>
      <p className="mx-auto mt-1 max-w-xs text-[12px] leading-5 text-gray-500">
        {label} could not be shown. The rest of the dashboard still works. Trying again often fixes it.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-3 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
      >
        Try again
      </button>
      <details className="mt-3 text-left text-[11px] text-gray-400">
        <summary className="cursor-pointer text-center">Technical detail</summary>
        <p className="mt-1 break-words">{error.message || error.name}</p>
      </details>
    </div>
  );
}
