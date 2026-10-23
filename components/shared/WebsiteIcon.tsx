"use client";

import { useEffect, useState } from "react";
import { createFaviconLoader } from "@/lib/domain/shared/faviconClient";

// Shared by every icon on the page: one request per host, failures remembered for the session.
const loader = createFaviconLoader((u) => fetch(u));

// Explicit class names so Tailwind keeps them (h-${size} would be purged).
const SIZE_CLASS: Record<number, string> = {
  4: "h-4 w-4",
  5: "h-5 w-5",
  6: "h-6 w-6",
  7: "h-7 w-7",
  8: "h-8 w-8",
  9: "h-9 w-9",
  10: "h-10 w-10",
  11: "h-11 w-11",
  12: "h-12 w-12",
  14: "h-14 w-14",
  16: "h-16 w-16",
};

export function WebsiteIcon({ url, size = 8 }: { url: string; size?: number }) {
  // Result is tied to the url it was resolved for, so a changed url shows the placeholder, not a stale icon.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; favicon: string | null } | null>(null);

  useEffect(() => {
    let mounted = true;
    // Resolved on the server (guarded fetch): the browser never fetches the user-supplied site.
    loader.load(url).then((fav) => {
      if (mounted) setResult({ url, favicon: fav });
    });
    return () => {
      mounted = false;
    };
  }, [url]);

  const known = loader.peek(url);
  const loading = known === undefined && result?.url !== url;
  const favicon = known !== undefined ? known : result?.url === url ? result.favicon : null;

  const sizeClass = SIZE_CLASS[size] ?? SIZE_CLASS[8];

  if (loading) {
    return <div className={`${sizeClass} shrink-0 rounded bg-gray-100`} />;
  }

  if (favicon && failedSrc !== favicon) {
    return (
      <img
        src={favicon}
        alt=""
        className={`${sizeClass} shrink-0 rounded object-contain`}
        onError={() => setFailedSrc(favicon)}
      />
    );
  }

  // Fallback to a globe when there is no favicon or the value is not a website.
  return (
    <span className={`${sizeClass} shrink-0 flex items-center justify-center bg-white text-sm`} aria-hidden="true">
      🌐
    </span>
  );
}
