"use client";

import { createContext, useContext, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "./cn.ts";
import { FOCUS_RING_INSET, tabIndicatorStyle } from "./variants.ts";

const ActiveTabContext = createContext<string>("");

type TabsRootBase = Omit<ComponentPropsWithoutRef<typeof RadixTabs.Root>, "value" | "defaultValue" | "onValueChange" | "orientation" | "dir">;

export type TabsProps = TabsRootBase & {
  onValueChange?: (value: string) => void;
  children: ReactNode;
} & ({ value: string; defaultValue?: never } | { defaultValue: string; value?: never });

/**
 * Tabs root. Wraps Radix Tabs (roving focus, arrow/Home/End keys, aria) and
 * tracks the active value so TabsList can slide its indicator.
 */
export function Tabs({ value, defaultValue, onValueChange, className, children, ...rest }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  return (
    <ActiveTabContext.Provider value={current}>
      <RadixTabs.Root
        value={current}
        onValueChange={(next) => {
          setInner(next);
          onValueChange?.(next);
        }}
        className={className}
        {...rest}
      >
        {children}
      </RadixTabs.Root>
    </ActiveTabContext.Provider>
  );
}

export type TabItem = {
  value: string;
  label: string;
  /** Optional count badge. */
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
};

export type TabsListProps = {
  items: TabItem[];
  /** Accessible name for the tablist. */
  "aria-label": string;
  className?: string;
};

/**
 * Segmented tab bar: equal-width segments, white active pill with a subtle
 * shadow that slides via a CSS transform. Labels truncate, so it stays inside
 * a 280px column.
 */
export function TabsList({ items, className, ...rest }: TabsListProps) {
  const active = useContext(ActiveTabContext);
  const activeIndex = Math.max(0, items.findIndex((item) => item.value === active));
  const indicator = tabIndicatorStyle(activeIndex, items.length);

  return (
    <RadixTabs.List
      className={cn("relative grid w-full rounded-ui-md bg-ui-surface-sunken p-0.5", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}
      {...rest}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-ui-sm bg-ui-surface shadow-ui-sm transition-transform duration-(--dur-base) ease-(--ease-out)"
        style={indicator}
      />
      {items.map((item) => (
        <RadixTabs.Trigger
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          title={item.label}
          className={cn(
            "ui-transition relative z-10 flex h-8 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-ui-sm px-2 text-[12px] leading-4 font-medium text-ui-muted hover:text-ui-text",
            "data-[state=active]:text-ui-text disabled:pointer-events-none disabled:opacity-40",
            FOCUS_RING_INSET,
          )}
        >
          {item.icon ? (
            <span aria-hidden="true" className="inline-flex shrink-0">
              {item.icon}
            </span>
          ) : null}
          <span className="min-w-0 truncate">{item.label}</span>
          {typeof item.count === "number" ? (
            <span className="shrink-0 rounded-full bg-ui-surface-sunken px-1.5 text-xs leading-4 text-ui-muted tabular-nums">
              {item.count}
            </span>
          ) : null}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

export type TabsContentProps = ComponentPropsWithoutRef<typeof RadixTabs.Content>;

export function TabsContent({ className, ...rest }: TabsContentProps) {
  return <RadixTabs.Content className={cn("outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]", className)} {...rest} />;
}
