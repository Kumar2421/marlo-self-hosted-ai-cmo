"use client";

import { useEffect, useState } from "react";
export function WebsiteIcon({ url, size = 8 }: { url: string; size?: number }) {
  const [favicon, setFavicon] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Resolved on the server (guarded fetch): the browser never fetches the user-supplied site.
    async function load() {
      let fav: string | null = null;
      try {
        const res = await fetch(`/api/favicon?url=${encodeURIComponent(url)}`);
        if (res.ok) fav = ((await res.json()) as { favicon?: string | null }).favicon ?? null;
      } catch {
        fav = null;
      }
      if (mounted) {
        setFavicon(fav);
        setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [url]);

  const sizeClass = {
    6: "h-6 w-6",
    7: "h-7 w-7",
    8: "h-8 w-8",
    10: "h-10 w-10",
    12: "h-12 w-12",
  }[size] || `h-${size} w-${size}`;

  if (loading) {
    return <div className={`${sizeClass} shrink-0 rounded bg-gray-100`} />;
  }

  if (favicon) {
    return (
      <img
        src={favicon}
        alt=""
        className={`${sizeClass} shrink-0 rounded object-contain`}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  // Fallback to emoji if favicon not found
  return (
    <span className={`${sizeClass} shrink-0 flex items-center justify-center bg-white text-sm`}>
      🌐
    </span>
  );
}
