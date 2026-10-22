"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { LogLine } from "./mock-terminal";
import { lineType, stripWarning } from "@/lib/domain/integrations/logLine";

type Ctx = {
  lines: LogLine[];
  /** Append a real status line as an agent actually does something — never
   * scripted/fake, callers pass text describing the real request in flight. */
  log: (text: string) => void;
  logDone: (text: string) => void;
  /** Append a failure line. The warning sign is added/normalised here, so callers pass plain text. */
  logError: (message: string) => void;
};

const TerminalLogCtx = createContext<Ctx | null>(null);

export function useTerminalLog() {
  const ctx = useContext(TerminalLogCtx);
  if (!ctx) throw new Error("useTerminalLog must be used within TerminalLogProvider");
  return ctx;
}

export default function TerminalLogProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<LogLine[]>([]);

  const log = useCallback((text: string) => {
    setLines((prev) => [...prev, { type: lineType(text, "cmd"), text, at: Date.now() }]);
  }, []);

  const logDone = useCallback((text: string) => {
    setLines((prev) => [...prev, { type: lineType(text, "done"), text, at: Date.now() }]);
  }, []);

  const logError = useCallback((message: string) => {
    setLines((prev) => [...prev, { type: "error", text: `⚠ ${stripWarning(message)}`, at: Date.now() }]);
  }, []);

  return <TerminalLogCtx.Provider value={{ lines, log, logDone, logError }}>{children}</TerminalLogCtx.Provider>;
}
