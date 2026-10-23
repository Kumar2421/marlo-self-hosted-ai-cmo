import type { ReactNode } from "react";

/** Shared look for the settings pages: one card surface, one header, one set of buttons. Tokens only. */

/** Raised surface with a visible 1px border in both themes. */
export const CARD = "rounded-xl border border-ui-border bg-ui-surface shadow-sm";

/** Dashed placeholder surface (empty states, locked previews). */
export const CARD_DASHED = "rounded-xl border border-dashed border-ui-border-strong bg-ui-surface-muted";

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface";

/** 44px tall on phones, compact from sm up. */
const BTN = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 ${FOCUS_RING}`;
export const BTN_PRIMARY = `${BTN} bg-ui-primary text-ui-inverse hover:bg-ui-primary-hover`;
export const BTN_SECONDARY = `${BTN} border border-ui-border-strong bg-ui-surface text-ui-text hover:bg-ui-surface-sunken`;
export const BTN_GHOST = `${BTN} text-ui-muted hover:bg-ui-surface-sunken hover:text-ui-text`;

export const INPUT = `min-h-11 w-full min-w-0 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] text-ui-text placeholder:text-ui-faint disabled:opacity-50 sm:min-h-9 ${FOCUS_RING}`;

export function SettingsPageHeader({
  title,
  caption,
  actions,
}: {
  title: string;
  caption?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ui-text">{title}</h1>
        {caption && <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ui-muted">{caption}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Heading for a block of cards inside a page. */
export function SettingsSection({
  title,
  caption,
  children,
  className = "",
}: {
  title: string;
  caption?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-8 ${className}`}>
      <h2 className="text-[15px] font-semibold text-ui-text">{title}</h2>
      {caption && <p className="mt-0.5 text-[13px] leading-5 text-ui-muted">{caption}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Green "Connected" chip used by every integration and provider card. */
export function ConnectedChip({ children = "Connected" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-medium text-ui-success-text">
      {children}
    </span>
  );
}
