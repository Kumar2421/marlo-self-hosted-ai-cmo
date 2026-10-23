"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { X } from "lucide-react";

type ToastCtx = { show: (msg: string) => void };
const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);

  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3000);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {msg && (
        <div className="fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-medium text-gray-800 shadow-xl">
          <div className="flex items-center gap-3">
            {msg}
            <button onClick={() => setMsg(null)} className="text-ui-subtle hover:text-gray-600">
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
