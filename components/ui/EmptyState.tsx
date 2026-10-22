import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  /** Primary action, e.g. a <button>. */
  action?: ReactNode;
  /**
   * Optional preview of the real content (a locked feature). Rendered blurred,
   * inert and hidden from assistive tech behind the message.
   */
  preview?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, body, action, preview, className }: EmptyStateProps) {
  const message = (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-4 py-8 text-center">
      {icon ? (
        <div aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-ui-surface-sunken text-ui-muted">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[14px] leading-5 font-semibold text-ui-text">{title}</h3>
      {body ? <p className="text-[13px] leading-5 text-ui-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );

  if (!preview) return <div className={cn("flex w-full items-center justify-center", className)}>{message}</div>;

  return (
    <div className={cn("relative w-full overflow-hidden", className)}>
      <div aria-hidden="true" inert className="pointer-events-none opacity-70 blur-[3px] select-none">
        {preview}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-ui-surface/60">
        <div className="rounded-ui-lg border border-ui-border bg-ui-surface shadow-ui-md">{message}</div>
      </div>
    </div>
  );
}
