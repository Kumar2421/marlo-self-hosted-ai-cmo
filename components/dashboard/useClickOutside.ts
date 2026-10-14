"use client";

import { useEffect, useRef } from "react";

/** Calls onOutside on a mousedown that lands outside the returned ref's element. */
export function useClickOutside<T extends HTMLElement = HTMLDivElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}
