"use client";

import { useCallback, useEffect, useState } from "react";
import { DotLottieReact, setWasmUrl, type DotLottie } from "@lottiefiles/dotlottie-react";

// The player's wasm and the animation both ship from our own origin: no
// third-party CDN on the critical path, and the browser caches each once.
setWasmUrl("/dotlottie-player.wasm");

let animationData: Promise<ArrayBuffer> | null = null;

/** One fetch of the .lottie for the whole page, however many ghosts are mounted. */
function loadAnimation(): Promise<ArrayBuffer> {
  if (!animationData) {
    animationData = fetch("/ghost-loader.lottie")
      .then((res) => {
        if (!res.ok) throw new Error(`ghost-loader.lottie ${res.status}`);
        return res.arrayBuffer();
      })
      .catch((err) => {
        animationData = null; // let a later mount retry
        throw err;
      });
  }
  return animationData;
}

/** Only ever loaded after first paint (see GhostLoader). Each instance gets its own copy of the shared bytes. */
export default function GhostLottie({ className, onReady }: { className?: string; onReady: () => void }) {
  const [data, setData] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    let alive = true;
    loadAnimation()
      .then((buf) => {
        if (alive) setData(buf.slice(0));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const refCallback = useCallback(
    (instance: DotLottie | null) => {
      instance?.addEventListener("load", onReady);
    },
    [onReady],
  );

  if (!data) return null;
  return <DotLottieReact data={data} autoplay loop className={className} dotLottieRefCallback={refCallback} />;
}
