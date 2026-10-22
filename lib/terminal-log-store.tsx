"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { LogLine } from "./mock-terminal";
import { doneLineType } from "@/lib/domain/integrations/logLine";

type Ctx = {
  lines: LogLine[];
  /** Append a real status line as an agent actually does something — never
   * scripted/fake, callers pass text describing the real request in flight. */
  log: (text: string) => void;
  logDone: (text: string) => void;
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
    setLines((prev) => [...prev, { type: "cmd", text }]);
  }, []);

  const logDone = useCallback((text: string) => {
    setLines((prev) => [...prev, { type: doneLineType(text), text }]);
  }, []);

  return <TerminalLogCtx.Provider value={{ lines, log, logDone }}>{children}</TerminalLogCtx.Provider>;
}
