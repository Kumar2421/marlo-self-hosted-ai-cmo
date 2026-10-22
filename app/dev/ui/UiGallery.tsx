"use client";

import { useState, type ReactNode } from "react";
import { Bell, ChevronDown, Lock, MoreHorizontal, Search, Settings, Trash2 } from "lucide-react";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/Sheet";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { Stat } from "@/components/ui/Stat";
import { Tabs, TabsContent, TabsList } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";

/** Dashboard column widths the primitives must hold up at. */
const WIDTHS = [280, 360, 480, 720] as const;

const TABS = [
  { value: "context", label: "Context" },
  { value: "analytics", label: "Analytics", count: 4 },
  { value: "agents", label: "Agents" },
  { value: "chat", label: "Chat", count: 128 },
];

const btn =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-ui-sm border border-ui-border bg-ui-surface px-3 text-[13px] font-medium text-ui-text hover:bg-ui-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]";
const btnPrimary =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-ui-sm bg-ui-primary px-3 text-[13px] font-medium text-ui-inverse hover:bg-ui-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} data-testid={`section-${id}`} className="border-t border-ui-border py-6">
      <h2 className="mb-4 text-[16px] leading-6 font-semibold text-ui-text">{title}</h2>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function AtWidths({ children }: { children: (width: number) => ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      {WIDTHS.map((w) => (
        <div key={w} data-testid={`w-${w}`} style={{ width: w, maxWidth: "100%" }} className="rounded-ui-md border border-dashed border-ui-border p-2">
          <div className="mb-2 text-xs leading-4 text-ui-subtle tabular-nums">{w}px</div>
          {children(w)}
        </div>
      ))}
    </div>
  );
}

export default function UiGallery() {
  const [tab, setTab] = useState("context");
  const [chipOn, setChipOn] = useState(true);
  const [chips, setChips] = useState(["SEO", "Leads"]);
  const [checked, setChecked] = useState(true);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8" data-testid="ui-gallery">
      <h1 className="text-[16px] leading-6 font-semibold text-ui-text">UI primitives</h1>
      <p className="mt-1 text-[13px] leading-5 text-ui-muted">
        Dev-only gallery (404 in production and in platform mode). Every primitive and state, at dashboard widths.
      </p>

      <Section id="tabs" title="Tabs">
        <AtWidths>
          {() => (
            <Tabs defaultValue="context">
              <TabsList aria-label="Dashboard sections" items={TABS} />
              <TabsContent value="context" className="pt-2 text-[13px] text-ui-muted">Context panel</TabsContent>
              <TabsContent value="analytics" className="pt-2 text-[13px] text-ui-muted">Analytics panel</TabsContent>
              <TabsContent value="agents" className="pt-2 text-[13px] text-ui-muted">Agents panel</TabsContent>
              <TabsContent value="chat" className="pt-2 text-[13px] text-ui-muted">Chat panel</TabsContent>
            </Tabs>
          )}
        </AtWidths>
        <div style={{ width: 360, maxWidth: "100%" }}>
          <div className="mb-2 text-xs text-ui-subtle">Controlled, with a disabled tab, 3 items</div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList
              aria-label="Controlled"
              items={[
                { value: "context", label: "Overview" },
                { value: "analytics", label: "Details", count: 12 },
                { value: "agents", label: "Disabled", disabled: true },
              ]}
            />
          </Tabs>
        </div>
      </Section>

      <Section id="buttons" title="IconButton">
        <div className="flex flex-wrap items-center gap-3">
          {(["ghost", "subtle", "solid"] as const).map((variant) =>
            (["sm", "md"] as const).map((size) => (
              <IconButton key={`${variant}-${size}`} aria-label={`${variant} ${size}`} variant={variant} size={size} icon={<Settings className="h-4 w-4" />} />
            )),
          )}
          <IconButton aria-label="Disabled" disabled icon={<Settings className="h-4 w-4" />} />
        </div>
      </Section>

      <Section id="overlays" title="Dialog, Sheet, Popover, Tooltip, DropdownMenu">
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className={btn}>Open dialog</button>
            </DialogTrigger>
            <DialogContent
              title="Delete project"
              description="This removes the project and its documents. This cannot be undone."
              footer={
                <>
                  <DialogClose asChild>
                    <button type="button" className={btn}>Cancel</button>
                  </DialogClose>
                  <button type="button" className={btnPrimary}>Delete</button>
                </>
              }
            >
              <p>Body text. Tab cycles inside; Esc and the backdrop close it.</p>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className={btn}>Dialog with long body</button>
            </DialogTrigger>
            <DialogContent title="Long content" description="The body scrolls; header and footer stay put." footer={<DialogClose asChild><button type="button" className={btnPrimary}>Done</button></DialogClose>}>
              {Array.from({ length: 40 }, (_, i) => (
                <p key={i} className="py-1">Line {i + 1}: scrolling body content that exceeds the available height.</p>
              ))}
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <button type="button" className={btn}>Open sheet</button>
            </SheetTrigger>
            <SheetContent
              title="Competitor details"
              subtitle="Updated 3 minutes ago"
              toolbar={<Tabs defaultValue="a"><TabsList aria-label="Sheet tabs" items={[{ value: "a", label: "Overview" }, { value: "b", label: "Pages", count: 9 }]} /></Tabs>}
              footer={<SheetClose asChild><button type="button" className={btnPrimary}>Close</button></SheetClose>}
            >
              {Array.from({ length: 30 }, (_, i) => (
                <p key={i} className="py-1">Row {i + 1}</p>
              ))}
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={btn}>Popover <ChevronDown aria-hidden className="h-3.5 w-3.5" /></button>
            </PopoverTrigger>
            <PopoverContent>
              <SectionHeader label="Filters" />
              <p className="mt-2 text-ui-muted">Anything non-modal goes here.</p>
            </PopoverContent>
          </Popover>

          <Tooltip content="Notifications (300ms delay)">
            <IconButton aria-label="Notifications" icon={<Bell className="h-4 w-4" />} />
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More actions" icon={<MoreHorizontal className="h-4 w-4" />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem icon={<Search className="h-3.5 w-3.5" />}>Search</DropdownMenuItem>
              <DropdownMenuItem disabled>Disabled item</DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={checked} onCheckedChange={setChecked}>Show archived</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive icon={<Trash2 className="h-3.5 w-3.5" />}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Section>

      <Section id="cards" title="Card, Stat, SectionHeader">
        <AtWidths>
          {() => (
            <div className="flex flex-col gap-3">
              <Card>
                <CardHeader>
                  <CardTitle>Organic traffic with a very long title that must truncate</CardTitle>
                  <IconButton aria-label="Card menu" size="sm" icon={<MoreHorizontal className="h-4 w-4" />} />
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Sessions" value="12,408" hint="vs last 7 days" />
                    <Stat label="Conversion rate" value="3.42%" />
                  </div>
                </CardBody>
              </Card>
              <Card asChild interactive>
                <a href="#cards" className="block p-3 text-[13px]">Interactive card (link)</a>
              </Card>
              <SectionHeader label="Recent findings" action={<button type="button" className="text-[12px] font-medium text-ui-accent-strong">View all</button>} />
            </div>
          )}
        </AtWidths>
      </Section>

      <Section id="badges" title="Badge and Chip">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="success" dot>Verified</Badge>
          <Badge tone="warn" dot>Needs review</Badge>
          <Badge tone="danger" dot>Failed</Badge>
          <Badge tone="info">Info</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip selected={chipOn} onClick={() => setChipOn((v) => !v)}>Toggle</Chip>
          <Chip onClick={() => undefined}>Unselected</Chip>
          <Chip disabled>Disabled</Chip>
          {chips.map((c) => (
            <Chip key={c} selected onRemove={() => setChips((all) => all.filter((x) => x !== c))} removeLabel={`Remove ${c}`}>
              {c}
            </Chip>
          ))}
        </div>
      </Section>

      <Section id="loading" title="Skeleton and Spinner">
        <AtWidths>
          {() => (
            <div className="flex flex-col gap-3">
              <Skeleton height={20} width="40%" />
              <SkeletonText lines={3} />
              <div className="flex items-center gap-3">
                <Skeleton height={32} width={32} rounded="full" />
                <div className="min-w-0 flex-1"><SkeletonText lines={2} lineHeight={10} /></div>
              </div>
              <Skeleton height={96} rounded="lg" />
            </div>
          )}
        </AtWidths>
        <div className="flex items-center gap-4 text-ui-muted">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </div>
      </Section>

      <Section id="empty" title="EmptyState">
        <AtWidths>
          {() => (
            <EmptyState
              icon={<Search className="h-4 w-4" />}
              title="No leads yet"
              body="Run the Lead Finder to see matches here."
              action={<button type="button" className={btnPrimary}>Find leads</button>}
            />
          )}
        </AtWidths>
        <div data-testid="empty-locked" className="max-w-xl rounded-ui-lg border border-ui-border">
          <EmptyState
            icon={<Lock className="h-4 w-4" />}
            title="Upgrade to unlock Technical audits"
            body="See crawl errors and fixes for every page."
            action={<button type="button" className={btnPrimary}>Upgrade</button>}
            preview={
              <div className="grid gap-2 p-4">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="flex items-center justify-between rounded-ui-sm border border-ui-border p-3 text-[13px]">
                    <span>/page-{i + 1}</span>
                    <Badge tone="danger">Error</Badge>
                  </div>
                ))}
              </div>
            }
          />
        </div>
      </Section>
    </main>
  );
}
