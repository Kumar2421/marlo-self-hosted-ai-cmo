"use client";

import type { IconType } from "react-icons";
import { SiAnthropic, SiGooglegemini, SiMistralai, SiOpenrouter, SiLmstudio, SiOllama } from "react-icons/si";
import { SiGmail, SiGooglecloud, SiGoogleanalytics, SiGooglesearchconsole, SiLighthouse, SiGithub } from "react-icons/si";

/** Real Simple Icons brand SVGs, keyed by our own provider/service ids.
 * Not every brand has one available (OpenAI, Groq, xAI, Tavily aren't in
 * Simple Icons' current set) — those fall back to the caller's glyph rather
 * than faking a logo. */
const ICONS: Record<string, IconType> = {
  anthropic: SiAnthropic,
  google: SiGooglegemini,
  mistral: SiMistralai,
  openrouter: SiOpenrouter,
  lmstudio: SiLmstudio,
  ollama: SiOllama,
  gmail: SiGmail,
  "google-cloud": SiGooglecloud,
  "google-analytics": SiGoogleanalytics,
  "search-console": SiGooglesearchconsole,
  lighthouse: SiLighthouse,
  github: SiGithub,
};

export default function BrandIcon({
  id,
  color,
  fallback,
  size = 17,
  className = "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white ring-1 ring-inset ring-ui-border-strong",
}: {
  id: string;
  color: string;
  fallback: string;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[id];
  return (
    <span className={className} style={{ backgroundColor: color }}>
      {Icon ? <Icon size={size} color="#ffffff" aria-hidden="true" focusable="false" /> : fallback}
    </span>
  );
}
