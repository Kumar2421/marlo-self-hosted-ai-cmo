"use client";

import { useEffect, useState, type ComponentType } from "react";

type LottieProps = { className?: string; onReady: () => void };

/**
 * The Marlo ghost loader. First paint is a plain CSS spinner (no JS library, no
 * network); after the page is idle the real Lottie is loaded from our own
 * origin and fades in over it. Size and colour come from the className.
 */
export default function GhostLoader({
  className = "h-6 w-6",
  tone = "dark",
}: {
  className?: string;
  /** "light" for spinners drawn on a dark surface. */
  tone?: "dark" | "light";
}) {
  const [Lottie, setLottie] = useState<ComponentType<LottieProps> | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      import("./GhostLottie").then((mod) => {
        if (!cancelled) setLottie(() => mod.default);
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(load, { timeout: 1500 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(load, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  const ring = tone === "light" ? "border-white/25 border-t-white/80" : "border-gray-300 border-t-gray-600";

  return (
    <span role="status" aria-label="Loading" className={`relative inline-block shrink-0 ${className}`}>
      {!ready && (
        <span className={`absolute inset-[12%] animate-spin rounded-full border-2 ${ring}`} aria-hidden="true" />
      )}
      {Lottie && (
        <span className={`absolute inset-0 transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}>
          <Lottie className="h-full w-full" onReady={() => setReady(true)} />
        </span>
      )}
    </span>
  );
}
