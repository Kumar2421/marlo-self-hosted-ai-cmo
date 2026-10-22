import type { HTMLAttributes, ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "./cn.ts";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Render as the child element (e.g. an <a> or <button>) instead of a div. */
  asChild?: boolean;
  /** Adds hover affordance; use with asChild on a link or button. */
  interactive?: boolean;
};

export function Card({ asChild, interactive, className, ...rest }: CardProps) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      className={cn(
        "rounded-ui-lg border border-ui-border bg-ui-surface shadow-ui-xs",
        interactive && "ui-transition cursor-pointer hover:border-ui-border-strong hover:shadow-ui-sm",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-h-11 items-center justify-between gap-2 border-b border-ui-border px-4 py-2", className)} {...rest} />;
}

export function CardTitle({
  as: Tag = "h3",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4"; children: ReactNode }) {
  return (
    <Tag className={cn("min-w-0 truncate text-[13px] leading-5 font-semibold text-ui-text", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 text-[13px] leading-5 text-ui-text", className)} {...rest} />;
}
