import type { HTMLAttributes, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn.ts";
import { FOCUS_RING } from "./variants.ts";
import { tintedNoticeClass, type NoticeTone } from "./premium.ts";

export type TintedNoticeProps = HTMLAttributes<HTMLDivElement> & {
  tone?: NoticeTone;
  icon?: ReactNode;
};

/** Tinted panel (orange on dark orange, green on dark green, ...). Pass role/aria props for live regions. */
export function TintedNotice({ tone = "warning", icon, className, children, ...rest }: TintedNoticeProps) {
  return (
    <div className={tintedNoticeClass({ tone, className: cn(icon && "flex items-start gap-2", className) })} {...rest}>
      {icon ? (
        <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {icon ? <div className="min-w-0 flex-1">{children}</div> : children}
    </div>
  );
}

/** Inner action card for a notice: brand icon, title, caption, chevron. Renders a link. */
export function NoticeActionCard({
  href,
  icon,
  title,
  caption,
  className,
}: {
  href: string;
  icon?: ReactNode;
  title: string;
  caption?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={cn(
        "ui-transition mt-2 flex min-h-11 items-center gap-3 rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-ui-text hover:border-ui-border-strong hover:bg-ui-surface-muted",
        FOCUS_RING,
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-5 font-medium">{title}</span>
        {caption ? <span className="block truncate text-xs leading-4 text-ui-muted">{caption}</span> : null}
      </span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ui-muted" />
    </a>
  );
}
