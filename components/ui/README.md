# components/ui

Shared UI primitives. Radix handles behavior and accessibility; Tailwind classes use the tokens in `app/globals.css` (`bg-ui-surface`, `text-ui-muted`, `rounded-ui-md`, `shadow-ui-sm`, `z-(--z-modal)`, `--dur-*`, `--ease-out`).

No business logic lives here. No dashboard component uses these yet: migrations come later, one screen at a time.

- Merge classes with `cn()` from `./cn.ts` (clsx + tailwind-merge). Pass `className` to override.
- Type scale is 11/12/13/14/16 px. Do not add other sizes.
- Pure class builders live in `variants.ts` and are unit-tested (`tests/uiVariants.test.mts`).
- Preview every primitive at 280/360/480/720px: run `next dev --webpack` and open `/dev/ui`. It 404s when `NODE_ENV === "production"` or `FEATURES.PLATFORM_MODE` is true, so it cannot be reached on a Vercel production deploy (Vercel builds set both).
- Note: the root layout creates a Supabase browser client on every page, so the dev server needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set. Those vars switch on platform mode, so also set `NEXT_PUBLIC_SELF_HOST=true` (any non-empty URL/key works) or the gallery will 404.

## Tokens

| Group | Variables |
| --- | --- |
| Surface | `--ui-surface`, `-muted`, `-sunken`, `--ui-overlay` |
| Border | `--ui-border`, `--ui-border-strong` |
| Text | `--ui-text`, `--ui-text-muted`, `--ui-text-subtle`, `--ui-text-inverse` |
| Brand | `--ui-primary` (#111111), `--ui-accent` (#00ab92), `--ui-accent-strong` (#007a69, use for accent text on white), `--ui-accent-soft` |
| Status | `--ui-danger`, `--ui-warn`, `--ui-success`, `--ui-info`, each with `-soft` and `-text` |
| Radii | `rounded-ui-sm` 6, `rounded-ui-md` 8, `rounded-ui-lg` 12 |
| Shadows | `shadow-ui-xs`, `-sm`, `-md` |
| Motion | `--dur-fast` 120ms, `--dur-base` 180ms, `--ease-out` |
| Z-index | `--z-sticky` 10, `--z-dropdown` 40, `--z-overlay` 50, `--z-modal` 60, `--z-popover` 70, `--z-tooltip` 80, `--z-toast` 90 |
| Focus | `--focus-ring-color/width/offset`; use `FOCUS_RING` / `FOCUS_RING_INSET` from `variants.ts` |

`@media (prefers-reduced-motion: reduce)` shortens all animations and transitions to ~0 and turns the skeleton shimmer off. The spinner stops rotating but keeps its static ring and its screen-reader label.

## Primitives

### Tabs (`Tabs`, `TabsList`, `TabsContent`)
- Props: `Tabs` takes `value` + `onValueChange` (controlled) or `defaultValue` (uncontrolled). `TabsList` takes `items: {value, label, count?, icon?, disabled?}[]` and a required `aria-label`.
- A11y: Radix roving focus. Left/Right arrows, Home and End move and activate; `role=tablist/tab/tabpanel`, `aria-selected`.
- Use for: every segmented tab bar. Equal-width segments, white active pill that slides with a CSS transform, labels truncate (fits 280px), optional count badge.
- Replaces: the 6 hand-rolled tab bars.

### Dialog (`Dialog`, `DialogTrigger`, `DialogContent`, `DialogClose`)
- Props on `DialogContent`: `title` (required), `description?`, `hideTitle?`, `size` sm/md/lg, `footer?`.
- A11y: focus trap, Esc, scroll lock, focus returns to the trigger, `aria-labelledby`/`describedby`.
- Use for: confirmations and short forms. Centered at 640px and up; below that a bottom sheet with a drag-handle look, max 90dvh, body scrolls.
- Replaces: the 20 hand-rolled modals.

### Sheet (`Sheet`, `SheetTrigger`, `SheetContent`, `SheetClose`)
- Props on `SheetContent`: `title` (required), `subtitle?`, `width` md/lg/xl, `toolbar?`, `footer?`.
- Same Radix behavior as Dialog. Right panel at 640px and up, bottom sheet (max 90dvh) below.
- Use for: data that does not fit in a column (details, long lists).
- Replaces: `components/shared/SidePanel.tsx` (not edited yet; migrate callers later). Differences: small screens get a bottom sheet instead of full width, and open state is Radix-controlled (`open`/`onOpenChange`).

### Popover (`Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverClose`)
- Non-modal floating panel. Esc and outside click close it; collision-aware.
- Use for: filters, small pickers. Do not use for anything that must block the page (use Dialog).

### Tooltip (`Tooltip`)
- Props: `content`, one focusable child, `side?`, `delayDuration?` (default 300ms).
- Shows on hover and keyboard focus. Touch users never see it: never put essential info only in a tooltip, and keep an `aria-label` on icon-only triggers.

### DropdownMenu (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`)
- Arrow-key navigation, typeahead, Esc. `DropdownMenuItem` takes `icon?` and `destructive?`.
- Use for: overflow ("more") and action menus.

### Card (`Card`, `CardHeader`, `CardTitle`, `CardBody`)
- `Card` takes `asChild` (render as `<a>`/`<button>`) and `interactive` (hover affordance). `CardTitle` takes `as` h2/h3/h4 and truncates.
- Replaces: the 213 ad-hoc `rounded border bg-white` cards.

### Stat
- Props: `label`, `value`, `hint?`. Tabular numbers, truncates. The value is 16px (the top of our scale).

### Badge and Chip
- `Badge`: static, `tone` neutral/success/warn/danger/info, optional `dot`. `Chip`: a toggle button (`selected` sets `aria-pressed`), optional `onRemove` with a labelled remove button.

### SectionHeader
- Props: `label`, `action?`, `as?`. Uppercase 11px label, same look as `.dash-section-label`.

### Skeleton, SkeletonText
- `Skeleton` requires `height` so the final layout space is reserved (no shift on load). `width`, `rounded` optional. Decorative (`aria-hidden`); put `aria-busy` on the loading region.
- Replaces: the 13 one-off skeletons.

### EmptyState
- Props: `icon?`, `title`, `body?`, `action?`, `preview?`. With `preview`, the real content is shown blurred, `inert` and hidden from assistive tech behind the message (locked-feature look).

### Spinner
- CSS only, no Lottie. `size` sm/md/lg, inherits text color, `role=status` with an `sr-only` label.

### IconButton
- `aria-label` is required by the type. `icon` is hidden from assistive tech. `size` md is 36px; `sm` is 28px visually with a pointer target extended to 36px. `variant` ghost/subtle/solid.
