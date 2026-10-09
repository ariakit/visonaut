# Ariakit UI primitive adoption and styling-system audit

Lane key: `ui-primitives`. Finding prefix: `PRIM`. Read-only audit. No file in the repository was changed.

Path conventions in this report:

- `SRC` = `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel/apps/web/src`. A path such as `routes/index.tsx:248` is relative to `SRC`.
- `UP` = `/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src` (upstream, HEAD `643a23af`, 2026-10-05).
- `SCRATCH` = `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-primitives`.
- "Measured: yes" means that I ran the command or the browser probe and read the result. Browser probes ran in Chrome only (Playwright, channel `chrome`), at 1440 × 900, in the dark and light color schemes.

## How it works (map)

### 1. The styling stack, in load order

1. `routes/__root.tsx:2` imports `styles.css`. `styles.css:1` imports `review.css`. `review.css:1-2` imports `tailwindcss` and `components/ariakit/styles/ui.css`. There is no other CSS file. `review.css` contains no rule of its own.
2. `components/ariakit/styles/ui.css:1` imports `@ariakit/tailwind` (0.2.8). `ui.css:3-60` declares the theme: `--color-canvas`, `--color-brand`, `--color-primary: var(--color-brand)`, `--color-secondary`, `--color-success`, `--color-warning`, `--color-danger`, `--font-sans: "Inter Variable", …`, `--radius: 0.25em`, `--spacing: 0.25em`. `ui.css:75-82` sets the dark canvas. `ui.css:89-91` applies `ak-layer ak-layer-canvas` to `body`.
3. The primitives are React components in `components/ariakit/components/*.ariakit.react.tsx`. Each one calls a `clava` recipe (`cv({...})`). A `$prop` is a recipe variant. Example: `<Frame $layer $lighten $border $rounded="2xl" $p={6}>` emits `ak-layer ak-layer-lighten-(--layer-lighten) ak-frame ak-frame-2xl ak-frame-p-(--frame-padding) …` plus inline custom properties.
4. Tailwind 4 scans every source file below the Vite root. So each class string in the vendored folder becomes CSS, also for components that the app never imports.
5. App code then adds plain Tailwind classes through `className` on top of the recipe output.

### 2. Who renders what

| Screen                    | Entry                                      | Shell parts in use                                                                                                                 | Main local components                                                                                               |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Queue, history, service   | `routes/index.tsx:159-381`                 | `Shell`, `ShellHeader` (through `AppHeader`), `ShellMain`, `ShellMainBody`                                                         | `ReviewQueue` (417-558), `RunGroup` (560-603), `RunHistory` (605-752), `RunStatus` (383-395), `OperationsAttention` |
| Pull request waiting page | `routes/pulls.$pullNumber.tsx:150-296`     | same                                                                                                                               | one `Frame` card                                                                                                    |
| Run page states           | `routes/runs.$runId.tsx:55-111`, `217-246` | `RunShell` (55-64)                                                                                                                 | loading text, error card, guest card                                                                                |
| Review workspace          | `review/review-workspace.tsx:527-1298`     | `Shell`, 2 × `ShellSidebar`, `ShellMain`, `ShellMainHeader`, `ShellMainIntro`, `ShellMainBody`, 3 × `ShellMainFull`, `ShellFooter` | `ItemList`, `ScreenshotFilter`, `VariantSummary`, `ReviewStatus`, `ScreenshotViewer`, 4 dialogs                     |
| Header                    | `components/app-shell.tsx:21-71`           | `ShellHeader`, `ShellHeaderCenter`, `Nav`, `NavLink`, `NavIcon`                                                                    | `ControlButton`, `UserMenu`                                                                                         |

### 3. Catalogue for each file (measured with `SCRATCH/catalogue.mjs`, TypeScript parser)

Columns: **Prim** = JSX elements that come from the vendored primitives (the `ControlButton` wrapper is counted here; the number in brackets is how many are the wrapper). **ak** = unstyled `@ariakit/react` or `@ariakit/react-components` elements. **Raw+class** = host elements (`div`, `p`, `span`, `img`, `input`, …) that carry a `className`. **Raw** = host elements without a class. **render** = host elements passed in a `render`, `button`, or `backdrop` prop. **cls** = `className` attributes. **arb** = arbitrary Tailwind values. **ak-\*** = `ak-*` utilities written by hand in a `className`. **!** = `!important` utilities.

| File                                        |    Lines |     Prim |     ak | Raw+class |    Raw | render |     cls |    arb |  ak-\* |      ! | inline style |
| ------------------------------------------- | -------: | -------: | -----: | --------: | -----: | -----: | ------: | -----: | -----: | -----: | -----------: |
| `routes/__root.tsx`                         |       35 |        0 |      0 |         0 |      0 |      0 |       1 |      1 |      0 |      0 |            0 |
| `routes/index.tsx`                          |      752 |   88 (8) |      0 |        17 |     10 |     32 |      72 |      4 |     27 |      0 |            0 |
| `routes/pulls.$pullNumber.tsx`              |      297 |   30 (6) |      0 |         1 |      1 |     11 |      22 |      1 |      5 |      0 |            0 |
| `routes/runs.$runId.tsx`                    |      247 |   14 (2) |      0 |         1 |      2 |      3 |       8 |      2 |      2 |      0 |            0 |
| `components/app-shell.tsx`                  |       71 |   10 (1) |      0 |         1 |      0 |      1 |       5 |      1 |      0 |      0 |            0 |
| `components/control-button.tsx`             |       14 |        1 |      0 |         0 |      0 |      0 |       1 |      1 |      0 |      0 |            0 |
| `components/screenshot-viewer.tsx`          |      265 |       11 |      0 |         3 |      0 |      4 |      10 |     10 |      3 |      1 |            0 |
| `components/user-menu.tsx`                  |       81 |   12 (1) |      0 |         1 |      0 |      1 |       9 |      2 |      1 |      1 |            0 |
| `components/operations-attention/index.tsx` |      518 |   28 (2) |      0 |        10 |      4 |     13 |      30 |      8 |     11 |      1 |            0 |
| `review/item-list.tsx`                      |      403 |       15 |      4 |         6 |      1 |      5 |      17 |      5 |      6 |      3 |            0 |
| `review/review-status.tsx`                  |       39 |        3 |      0 |         0 |      0 |      0 |       1 |      1 |      0 |      0 |            0 |
| `review/review-workspace.tsx`               |     1299 | 121 (25) |     16 |        41 |     38 |      8 |      90 |     18 |      9 |     10 |            0 |
| `review/screenshot-filter.tsx`              |      177 |       11 |     10 |         0 |      0 |      0 |       8 |      3 |      0 |      0 |            0 |
| `review/variant-summary.tsx`                |      137 |        5 |      0 |        10 |      0 |      0 |      14 |      2 |      1 |      2 |            0 |
| **Total**                                   | **4336** |  **349** | **30** |    **91** | **56** | **78** | **288** | **59** | **65** | **18** |        **0** |

Primitive use, by component (count): `Text` 79, `ButtonSlot` 50, `ButtonLabel` 49, `ControlButton` wrapper 45, `Frame` 33, `Button` 6, `TableCell` 6, `Layer` 5, `FlatButton` (the raw `Button`, renamed on import) 5, `Shell` 4, `ShellMain` 4, `ShellMainBody` 4, `Badge` 4, `BadgeLabel` 4, `ButtonGroup` 4, `BadgeSlot` 3, `Nav` 3, `NavLink` 3, `ShellMainFull` 3, then 1 or 2 each for the remaining Shell, Popover, Table, and NavDisclosure parts.

Raw styled host elements, by tag: `div` 46, `p` 14, `img` 9, `span` 9, `ul` 2, `li` 2, `dl` 2, and 1 each of `section`, `input`, `select`, `details`, `nav`, `progress`, `h3`. Raw host elements without a class include 14 `dt`, 14 `dd`, 4 `code`, 3 `br`, 2 `a`, 2 `option`, 1 `strong`.

Reading of the table:

- The count of primitive elements is high (349), but 178 of them (51 %) are `Text`, `ButtonLabel`, and `ButtonSlot`. These three carry almost no design decision.
- `Text` is used 79 times. Only 1 use passes a text variant (`$text`, `components/screenshot-viewer.tsx:98`). 72 uses pass only a `className`. 6 uses pass nothing. See PRIM-07.
- 288 `className` attributes sit beside 349 primitive elements. So the look of the app is decided mostly in utility classes, not in recipe props.

Hand-written `ak-*` utilities (65): `ak-ink-60` 45, `ak-ink-danger` 4, `ak-layer-warning` 4, `ak-text` 4, `ak-text-danger` 2, and 1 each of `ak-ink-warning`, `ak-ink-success`, `ak-ink-50`, `ak-ink-40`, `ak-text-warning`, `ak-text-success`. `ak-ink-*` on a text element is correct by the `@ariakit/tailwind` readme ("`ak-ink-*` is self-contained", readme line 293) and `Text` has no ink prop. On a `Frame` or `Layer` the recipe prop `$ink` exists and is not used (example `components/operations-attention/index.tsx:376-383`). The `ak-layer-warning` and `ak-text` uses are defects or bypasses (PRIM-02, PRIM-12).

Arbitrary values (36 distinct, 59 uses): `text-[10px]` 9, `text-[13px]` 6, `[--shell-header-step:calc(48px/14)]` 4, `border-(--ak-edge)` 4, `text-[11px]` 3, `tracking-[0.14em]` 3, and 1 each of `sm:text-[28px]`, `max-w-[38rem]`, `min-h-[60dvh]`, `h-[min(56vh,650px)]`, `bg-[repeating-conic-gradient(…)]`, `bg-size-[20px_20px]`, `[image-rendering:pixelated]`, `min-h-[380px]`, `bg-(--ak-edge)`, `data-[mode=side]:md:grid-cols-2`, `max-w-[calc(100vw-24px)]`, `max-h-[50dvh]`, `[&_svg]:size-4`, `min-w-[18px]`, `min-h-[18px]`, `w-[min(460px,calc(100vw-24px))]`, `max-h-[min(72dvh,var(--popover-available-height))]`, `max-h-[50%]`, `max-h-[30dvh]`, `inset-[50%_auto_auto_50%]`, `w-[min(540px,calc(100vw-32px))]`, `max-h-[calc(100dvh-32px)]`, `grid-cols-[auto_1fr]`, `[&>dt]:mt-2`, `[&>dt]:opacity-50`, `[&>dd]:wrap-anywhere`, `w-[min(30rem,calc(100vw-2rem))]`, `max-h-[calc(100dvh-2rem)]`, `[--control-inline:0]`, `[font-synthesis:none]`.

Custom CSS rules written by the app: 0. Inline `style` attributes written by the app: 0. (The recipes emit inline custom properties. That is their design.)

Wrappers:

| Wrapper                     | File                                                         | What it adds                                                                                                 | Needed?                                                                                                       |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `ControlButton`             | `components/control-button.tsx:4-13`                         | `$kind="flat"` (already the `Button` default), `$rounded="lg"`, `$p={2.5}`, `text-[13px] leading-5 shrink-0` | The intent (one app button size) is valid. The form is not. See PRIM-11.                                      |
| `AppHeader`                 | `components/app-shell.tsx:21-71`                             | The top bar                                                                                                  | Yes. But it does not own the `Shell`, so 4 callers repeat `[--shell-header-step:calc(48px/14)]`. See PRIM-12. |
| `RunShell`                  | `routes/runs.$runId.tsx:55-64`                               | `Shell` + `AppHeader` + `ShellMain` for 3 states                                                             | Yes, but it differs from the dashboard shell (no `$maxWidth`, no `$p`).                                       |
| `RunStatus`, `ReviewStatus` | `routes/index.tsx:383-395`, `review/review-status.tsx:10-38` | Status badge                                                                                                 | Two components for one concept. See PRIM-14.                                                                  |

### 4. Vendored copy compared with upstream

Vendored folder: `SRC/components/ariakit`. `NOTICE` pins it to upstream commit `fc85b809` (2026-09-22).

Verified facts (measured, see Measurements M2 and M3):

1. The vendored content is the same as the pinned upstream content. After I formatted a copy of the pinned snapshot with the Visonaut formatter, 21 of 38 shared files are byte-identical, including `ui.css`, `shell.ts`, `table.ts`, `badge.ts`, `popover.ts`.
2. The 17 other files differ only in structure. Nine recipes were moved into their component files: `button`, `disclosure` (which also holds the `prose` recipe), `frame`, `kbd`, `layer`, `nav`, `tabs`, `text-frame`, `text`. Five one-line adapter files in `styles/` re-export them (`styles/button.ts`, `frame.ts`, `layer.ts`, `text-frame.ts`, `text.ts`). `control.ts`, `edge.ts`, `glider.ts` differ only in import paths. A line-set comparison of each inlined component against "pinned component + pinned recipe" shows 0 lines that exist on one side only (the `prose` recipe is the one exception: 40 lines sit in the `disclosure` file here).
3. Vendored primitives: 13 (`badge`, `button`, `disclosure`, `frame`, `kbd`, `layer`, `nav`, `popover`, `shell`, `table`, `tabs`, `text-frame`, `text`). Upstream primitives: 27.
4. Missing here, present upstream at the pin and at HEAD: `checkbox`, `code`, `combobox`, `dialog`, `heading`, `input`, `link`, `list`, `option`, `progress`, `prose` (component), `radio`, `separator`, `tooltip`.
5. Vendored but never imported by the app: `kbd` (0 importers) and `tabs` (0 importers). `disclosure` is used only through `NavDisclosure`. `TextFrame` the component is unused; its recipe is used by `control`.

Upstream changes between the pin and HEAD that touch what the app uses (13 commits, 21 files, +790 −279, `git diff --stat fc85b809 HEAD -- packages/ariakit-ui/src`):

| Upstream change                                                                                                                                                                              | Commit                                | Effect on a refresh of this app                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NavIcon` and `NavLinkSlot` are replaced by `NavSlot`. New `NavLinkContent`, `NavLinkLabel`, `NavLinkDescription`.                                                                           | `59d6791ac`, `9eba558d3`              | `components/app-shell.tsx:5,59-61` imports and renders `NavIcon`. It must become `NavSlot`. `ButtonLabel` inside `NavLink` (`app-shell.tsx:62`) can become `NavLinkLabel`. The sidebar rows in `review/item-list.tsx:231-274` can use `NavLinkContent/Label/Description` instead of `Button*` parts. |
| `Button` accepts a `recipe` prop (`ButtonProps<R>`).                                                                                                                                         | part of `87749801f`                   | This is the upstream way to do what `ControlButton` does. See PRIM-11.                                                                                                                                                                                                                               |
| `BadgeLabel` has its own recipe with text-box trim and a `$truncate` variant. Badge text is centered.                                                                                        | `4474bd3c6`, `8fb2864e8`, `414023445` | `routes/index.tsx:392` passes `className="whitespace-normal"` to `BadgeLabel`. Check it again after a refresh.                                                                                                                                                                                       |
| `ui-selected` treats `aria-current=""` as not current.                                                                                                                                       | `61c9080b2`                           | No app code passes an empty `aria-current`. No effect.                                                                                                                                                                                                                                               |
| Slot sizes and shortcut slots changed (`SLOT_SIZE_CLASSES`, `wrapsSlotChildren`, RTL fix for shortcut slots, avatar font metrics). New registered property `--text-frame-inset` in `ui.css`. | `cc536df95`, `51e9e26d7`              | The app uses `ButtonSlot $kind="shortcut"` 7 times and `$kind="avatar"` 2 times. Expect small pixel shifts. `ui.css` must be refreshed together with `control.ts` and `text-frame.ts`.                                                                                                               |
| Disclosure and nav recipes were restructured (the nav recipes now extend the disclosure recipes). Disclosure content indents to the label.                                                   | `87749801f`, `42c615e44`              | `NavDisclosure` in `review/item-list.tsx:365-397` passes 6 class overrides and `duration-0!`. These are the most likely to break.                                                                                                                                                                    |
| Forced-colors fixes for badges, avatars, folder tabs, combobox items.                                                                                                                        | `77f11a4e3`, `faa29028e`, `6fabdbd15` | Free accessibility gain.                                                                                                                                                                                                                                                                             |

### 5. UI need → current implementation → primitive → example rewrite

"Vendored" means the primitive is already in `SRC/components/ariakit`. "Upstream only" means it must be copied first.

| #   | UI need                                   | Current implementation                                                                                                                                                                                                     | Primitive that fits                                                                                                                       | Example rewrite                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Page and section headings                 | `<Text render={<h1 />} className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3">` (`routes/index.tsx:432`). 20 heading-like `Text` uses with 9 different class sets.                                             | `Heading`, `HeadingLevel` (upstream only)                                                                                                 | `<HeadingLevel><Heading>Review queue</Heading></HeadingLevel>` and `<Heading $level={3}>` when the look must differ from the level                                                                                                                                                |
| 2   | Body copy and descriptions                | `<Text render={<p />} className="text-sm leading-relaxed ak-ink-60 mt-3">` (`routes/index.tsx:435`)                                                                                                                        | `Prose` (upstream only), or a plain `<p className="ak-ink-70">` inside a `Prose` column                                                   | `<Prose $gap={3}><Heading>…</Heading><p>12 views await approval.</p></Prose>`                                                                                                                                                                                                     |
| 3   | Modal dialog                              | `ak.Dialog` + `render={<Frame …/>}` + fixed-position classes + `backdrop={<Layer … className="… bg-black/50!"/>}`, 4 times (`review/review-workspace.tsx:155-159`, `1206-1211`, `1223-1230`, `1242-1248`)                  | `Dialog`, `DialogHeading`, `DialogDescription`, `DialogDismiss`, `DialogScroll` (upstream only)                                           | `<Dialog open={batchValid} onClose={…} unmountOnHide className="flex flex-col gap-4"><DialogHeading>Review all changed views</DialogHeading><DialogDismiss /><DialogDescription>…</DialogDescription>…</Dialog>`                                                                  |
| 4   | Text field                                | `<Frame … render={<label />}>` + raw `<input className="… outline-none focus-visible:underline">` (`routes/index.tsx:646-663`)                                                                                             | `InputGroup`, `InputSlot`, `Input` (upstream only)                                                                                        | `<InputGroup><InputSlot className="ak-ink-60"><SearchIcon /></InputSlot><Input aria-label="Search runs" placeholder="Search…" className="min-w-0 flex-1" /></InputGroup>`                                                                                                         |
| 5   | Select                                    | raw `<select>` inside a `Frame` (`routes/index.tsx:664-687`)                                                                                                                                                               | `ComboboxProvider`, `ComboboxSelect`, `ComboboxPopover`, `ComboboxItem` (upstream only)                                                   | `<ComboboxProvider selectedValue={filter} setSelectedValue={…}><ComboboxSelectLabel>Result</ComboboxSelectLabel><ComboboxSelect /><ComboboxPopover unmountOnHide>{states.map((s) => <ComboboxItem key={s} value={s} checkmark="before" />)}</ComboboxPopover></ComboboxProvider>` |
| 6   | Search with a status filter               | `TagProvider` + `TagControl` + `Tag` + `TagInput` + `ak.Combobox` + `ak.ComboboxPopover`, styled with `Frame` and `Button` (`review/screenshot-filter.tsx:58-175`, 10 unstyled Ariakit parts)                              | `InputGroup` + `Input` for the search, plus `ComboboxSelect` or a `ButtonGroup` of toggles for the status                                 | See redesign idea R9                                                                                                                                                                                                                                                              |
| 7   | Progress                                  | raw `<progress className="hidden sm:block h-1.5 w-16 accent-brand">` (`review/review-workspace.tsx:599-604`)                                                                                                               | `Progress` (upstream only)                                                                                                                | `<Progress value={(total - pending) / Math.max(total, 1)} $thickness={1.5} aria-label="Review progress" className="w-16" />`                                                                                                                                                      |
| 8   | Separator                                 | `<div className="h-5 w-px bg-current/10" />` (`review/review-workspace.tsx:1041`), `border-y border-(--ak-edge)` (`routes/index.tsx:450`), `border-t border-(--ak-edge)` (`components/operations-attention/index.tsx:413`) | `ButtonSeparator` inside a `ButtonGroup` (vendored), `Separator` elsewhere (upstream only)                                                | `<ButtonGroup><Button>Undo</Button><ButtonSeparator /><Button>All 7 changed views…</Button></ButtonGroup>`                                                                                                                                                                        |
| 9   | Tooltip                                   | 14 native `title` attributes, for example `title="Previous screenshot (↑)"` (`review/review-workspace.tsx:655`)                                                                                                            | `TooltipProvider`, `TooltipAnchor`, `Tooltip` (upstream only)                                                                             | `<TooltipProvider><TooltipAnchor render={<Button aria-label="Previous screenshot" />}>…</TooltipAnchor><Tooltip>Previous screenshot <Kbd>↑</Kbd></Tooltip></TooltipProvider>`                                                                                                     |
| 10  | Keyboard key                              | plain text in `<dt>` (`review/review-workspace.tsx:165-182`) and `<ButtonSlot $kind="shortcut">S</ButtonSlot>`                                                                                                             | `Kbd` (vendored, 0 importers)                                                                                                             | `<dt className="inline-flex gap-1"><Kbd>Shift</Kbd><Kbd>A</Kbd></dt>`                                                                                                                                                                                                             |
| 11  | Inline code, commit SHA                   | raw `<code title={sha}>` 4 times (`routes/index.tsx:402,717`, `review/review-workspace.tsx:470`, `components/operations-attention/index.tsx:418`)                                                                          | `Code` (upstream only)                                                                                                                    | `<Code>{sha.slice(0, 7)}</Code>`                                                                                                                                                                                                                                                  |
| 12  | Text link                                 | raw `<a href>` (`review/review-workspace.tsx:474-487`), `<Link className="block … focus-visible:outline-2 focus-visible:outline-offset-4">` (`routes/index.tsx:707-711`)                                                   | `Link` (upstream only) with `render={<RouterLink …/>}`                                                                                    | `<Link render={<RouterLink to="/runs/$runId" params={{ runId }} />}>#5240 · Fix Combobox…</Link>`                                                                                                                                                                                 |
| 13  | Disclosure                                | native `<details>` + `<Text render={<summary />}>` (`components/operations-attention/index.tsx:413-422`)                                                                                                                   | `Disclosure` (vendored)                                                                                                                   | `<Disclosure button="Technical details"><Code>{event.subject}</Code> …</Disclosure>`                                                                                                                                                                                              |
| 14  | Scroll area in a popover                  | `min-h-0 max-h-[50dvh] overflow-auto space-y-3` (`components/operations-attention/index.tsx:364-368`)                                                                                                                      | `PopoverScroll` (vendored)                                                                                                                | `<Popover className="flex flex-col …"><PopoverHeading/>…<PopoverScroll>{alerts}</PopoverScroll></Popover>`                                                                                                                                                                        |
| 15  | Footer bar                                | `<ShellFooter className="flex! flex-wrap items-center gap-x-3 gap-y-0 min-h-10!">` (`review/review-workspace.tsx:1172-1176`)                                                                                               | `ShellFooter` with its own `start` / `center` / `end` props (vendored, `components/ariakit/components/shell.ariakit.react.tsx:190-222`)   | `<ShellFooter $height="sm" start={<><ShortcutHelp /><ShortcutToggle /></>} end={<RecompareButton />} />`                                                                                                                                                                          |
| 16  | Status banner                             | `<p className="text-sm p-3 ak-layer-warning">` 4 times (`review/review-workspace.tsx:689-710`)                                                                                                                             | `Frame` with a color layer and `$mix`                                                                                                     | `<Frame role="alert" $layer="warning" $mix={15} $border $rounded="lg" $p={3}>…</Frame>`                                                                                                                                                                                           |
| 17  | Status badge in a table cell              | `<Badge $layer={color ?? true} $rounded="full" className="text-xs max-w-full">` (`routes/index.tsx:388`)                                                                                                                   | `Badge` with `$forceRounded`, as upstream does (`/Users/diegohaz/Developer/ariakit/app/src/sandbox/ariakit-ui-table/index.react.tsx:916`) | `<Badge $forceRounded $layer="warning"><BadgeSlot><Clock3Icon /></BadgeSlot><BadgeLabel>Needs review</BadgeLabel></Badge>`                                                                                                                                                        |
| 18  | Selected row in a list                    | `$selectedPush={false}` + `$lighten={index === selectedIndex ? 2 : false}` (`review/item-list.tsx:200-201`, `219`)                                                                                                         | `NavLink` with its default selected variants and `aria-current="page"`                                                                    | `<NavLink $rounded="lg" $p={2} aria-current={selected ? "page" : undefined} render={<Link … />} />`                                                                                                                                                                               |
| 19  | Definition list of capture facts          | `<dl className="grid … [&>dt]:mt-2 [&>dt]:opacity-50 [&>dd]:wrap-anywhere">` (`review/review-workspace.tsx:490-522`)                                                                                                       | `Table` with `TableCell header="row"` (vendored), or `List` (upstream only)                                                               | `<Table $borderBlock><TableRowGroup><TableRow><TableCell header="row">Changed pixels</TableCell><TableCell numeric>120 (0.05%)</TableCell></TableRow>…</TableRowGroup></Table>`                                                                                                   |
| 20  | Segmented view switch                     | `ButtonGroup` + 4 `FlatButton aria-pressed` + `ButtonGlider` (`review/review-workspace.tsx:825-892`)                                                                                                                       | The same parts. This use is idiomatic. `Tabs` (vendored) is an alternative if the views become tab panels.                                | Keep. Replace `className="text-xs"` with `$size="xs"`.                                                                                                                                                                                                                            |
| 21  | Card for empty, error, and sign-in states | `Frame` with 6 different prop sets (PRIM-13)                                                                                                                                                                               | One app-level `StateCard` built on `Frame`                                                                                                | `<StateCard icon={<CheckCheckIcon />} title="All reviews are complete." description="New visual changes appear here." />`                                                                                                                                                         |

## Findings

### PRIM-01 · `$layer="primary"` is not a recipe color. Six primary surfaces, including both sign-in buttons, render neutral gray

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Six uses: `routes/index.tsx:301` (`<Frame $layer="primary" $rounded="xl" $p={3} className="w-fit">`), `routes/index.tsx:310` (`<Button $layer="primary" disabled={action !== null} onClick={() => void signIn()}>`), `routes/index.tsx:346`, `routes/index.tsx:508` ("Review changes"), `routes/pulls.$pullNumber.tsx:194` ("Sign in with GitHub"), `routes/pulls.$pullNumber.tsx:226`.
  - The recipe accepts only six names: `components/ariakit/utils/styles.ts:6-13` (`"canvas", "brand", "secondary", "success", "warning", "danger"`). Any other string falls through to a raw CSS value: `components/ariakit/components/layer.ariakit.react.tsx:97-100`

    ```ts
    return {
      class: "ak-layer ak-layer-color-(--layer-color)",
      style: { "--layer-color": value },
    };
    ```

  - The type allows it: `$layer(value?: "transparent" | ColorValues | (string & {}) | boolean)` (`layer.ariakit.react.tsx:79`). So TypeScript does not report an error.
  - Browser probe (`SCRATCH/probe-queue.out`, "Review changes" link): `"inlineStyle": "--layer-color: primary; …"`, `"backgroundColor": "oklch(0.949994 0.0000497986 23.7884)"`, `"colorPrimaryVar": ""`. `primary` is not a CSS color keyword, and the theme variable `--color-primary` is not emitted because no class uses it.
  - Browser probe (`SCRATCH/probe-summary.txt`): `reviewChanges: bg=rgba(238,238,238,1.00)` in the dark scheme and in the light scheme. The working brand button: `approve: bg=rgba(0,106,187,1.00)` (`review/review-workspace.tsx:1081`, `$layer="brand"`).
  - A third sign-in button has no layer at all: `routes/runs.$runId.tsx:236-243` (`<Button disabled={action !== null} onClick={() => void signIn()}>`), see `screens/run-guest-dark-1440.png`.
- What happens: The four buttons and the icon tile were written to use the brand color. They render light gray (238, 238, 238). In the dark scheme this looks like an inverted white button. In the light scheme it looks like a disabled button, and the icon tile on the sign-in card has no visible fill (`screens/dashboard-guest-light-1440.png`). On `/runs/:id` the sign-in action is a text-only flat button in the middle of a card.
- Impact: The two most important actions of the dashboard (sign in, open a review) have the weakest affordance in the light scheme. The same action has three looks on three pages. The brand color appears only in the review workspace.
- Recommendation: Use the recipe name. One word for each site.

  ```tsx
  // routes/index.tsx:507
  <Button $layer="brand" render={<Link to="/runs/$runId" params={{ runId: run.id }} />}>
  ```

- Alternatives:
  - Minimal: replace `"primary"` with `"brand"` in the six sites and add `$layer="brand"` to the run-page sign-in button.
  - Type-level: narrow the app-side button so that `$layer` accepts only `ColorValues | "transparent" | boolean`. Then a wrong name is a compile error.
  - Design-level: decide one primary-button treatment for the app (`$layer="brand"` flat, or `$layer="brand" $kind="bevel"` as the upstream examples use) and put it in one `PrimaryButton` recipe.
- Maintainer decision needed: yes. Is brand blue the intended color for "Sign in" and "Review changes", or was the neutral inverted button a deliberate look?

### PRIM-02 · Four review banners use `ak-layer-warning` without `ak-layer`. They paint no surface. Warnings have three different looks

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `review/review-workspace.tsx:689-710`

    ```tsx
    {model.run.error && (
      <p role="alert" className="text-sm p-3 ak-layer-warning">
        {model.run.error}
      </p>
    )}
    {model.archived && (
      <p className="text-sm p-3 ak-layer-warning" role="status">
    ```

    The same class string is on lines 690, 695, 701, 706.

  - `@ariakit/tailwind` readme, line 293: "Pair `ak-layer-*`, `ak-state-*`, and `ak-edge-*` with `ak-layer` on the same element".
  - Browser probe (`SCRATCH/probe-summary.txt`, sections `workspace-dark-archived` and `workspace-light-archived`): `errorBanner: {"className":"text-sm p-3 ak-layer-warning","background":"rgba(0, 0, 0, 0)","color":"oklch(1 0 0)"}`. The background is transparent in both schemes.
  - Screenshots: `screens/workspace-dark-banners-closeup.png`, `screens/workspace-light-banners-closeup.png`. The run error and the read-only notice are plain body text between the title and the variant strip. The live preview shows the same for "Preview fixtures are read-only" (`screens/run-dark-1440.png`).
  - The pull-request page does paint a warning, at full saturation: `routes/pulls.$pullNumber.tsx:241-247` (`$layer={state.capture === "failed" ? "warning" : true}`), `screens/pull-failed-light-1440.png`.
  - Status badges use a third look, the tinted badge recipe (`screens/closeup-table-badges-light.png`).
- What happens: The modifier class has no effect alone. A run error with `role="alert"` has the same look as a paragraph.
- Impact: A maintainer can miss "A stored image could not be read" or "This closed run is read-only" and then try to approve. The three warning looks (none, tint, solid yellow) make the severity scale unreadable.
- Recommendation: One `Banner` component on `Frame`. Use a mixed tint, as the readme recommends for status surfaces (readme lines 213-229, `ak-layer-warning ak-layer-mix-15`).

  ```tsx
  function Banner({ tone = "warning", ...props }: BannerProps) {
    return (
      <Frame $layer={tone} $mix={15} $border $rounded="lg" $p={3} className="text-sm" {...props} />
    );
  }
  <Banner role="alert" tone="danger">
    {model.run.error}
  </Banner>;
  ```

- Alternatives:
  - Minimal: add `ak-layer` to the four class strings. The banners then become solid yellow like the pull page.
  - Replace the four stacked paragraphs with one banner slot that shows the most important state only.
  - Move the read-only and "not ready" states into the action bar, where the disabled buttons are.
- Maintainer decision needed: yes. Solid or tinted warning surface? One stacked list of banners or one banner with priority?

### PRIM-03 · Selection is hand-rolled with `$lighten`. In the light scheme the selected sidebar row and the selected variant chip are not visible

- Kind: accessibility
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Sidebar rows turn off the recipe's selected style and add a fixed lighten: `review/item-list.tsx:199-202`

    ```tsx
    $kind="flat"
    $selectedPush={false}
    $lighten={index === selectedIndex ? 2 : false}
    ```

    and `review/item-list.tsx:217-222` for the non-routed `Button`.

  - Variant chips do the same and also change the glider: `review/review-workspace.tsx:719-727` (`glider={{ $kind: "flat", …, $lightnessPush: false, $lightnessOffset: false, $lighten: 2, $border: true }}`) and `:739` (`$selectedPush={false}`).
  - The filter menu repeats the pattern: `review/screenshot-filter.tsx:89`, `:162`.
  - Measured surfaces (`SCRATCH/probe-selection.out`):

    |                                                  | Dark               | Light                                       |
    | ------------------------------------------------ | ------------------ | ------------------------------------------- |
    | Sidebar background                               | rgb(12, 14, 18)    | rgb(252, 253, 253)                          |
    | Selected row background                          | rgb(35, 37, 41)    | rgb(254, 255, 255)                          |
    | Contrast, selected row to sidebar                | 1.258 : 1          | 1.017 : 1                                   |
    | Variant glider (selected chip surface) to canvas | 1.258 : 1          | 1.017 : 1                                   |
    | Selected chip ring                               | `1px` at alpha 0.1 | spread `0px` (no ring); glider ring alpha 0 |
    | Unselected chip ring                             | `1px` at alpha 0.1 | `0 0 0 1px` at alpha 0.1                    |

  - Screenshots: `screens/closeup-variant-selection-light.png` (the selected chip "React · Chromium · Light" is the only chip without an outline), `screens/workspace-light-sidebar.png`, compared with `screens/closeup-variant-selection-dark.png`.
  - The top navigation keeps the recipe defaults and is visible in both schemes (`components/app-shell.tsx:53-58`, `screens/queue-light-1440.png`).
  - Readme lines 181-183: `ak-layer-lighten-*` means "Raised or exposed". A selected row is "Appearance-aware separation … `ak-layer ak-layer-*`".
- What happens: `$lighten` moves a surface toward white. The light canvas is already at 99.33 % lightness (`ui.css:4`). So the selected surface differs by 2 of 255 levels. For the variant chips the selected state is also the one without a ring. Only the font weight (500 against 400) and a thin bar at the sidebar edge remain.
- Impact: In the light scheme a reviewer cannot see which variant the approve action applies to. Approve and reject act on the selected variant. This is the central control of the product.
- Recommendation: Remove the overrides and use the default selected variants of `NavLink` (`$selectedPush`, `$selectedInk`). They are appearance-aware.

  ```tsx
  <NavLink
    $rounded="lg"
    $p={2}
    aria-current={index === selectedIndex ? "page" : undefined}
    render={<Link … />}
  />
  ```

- Alternatives:
  - Minimal: replace `$lighten={2}` with `$lightnessOffset={2}` (appearance-aware) in the five sites.
  - Use a colored selection for variants (a brand ring or a brand glider) so that the target of approve is unmistakable.
  - Replace the chip strip with `Tabs` (vendored) or a variant matrix (redesign idea R5).
- Maintainer decision needed: yes. Neutral tonal selection (recipe default) or a brand-colored selection for the variant that receives the decision?

### PRIM-04 · Nested frames lose their radius. Buttons, icon tiles, badges, and cards are square in five places and rounded elsewhere

- Kind: visual
- Severity: medium. Confidence: high for the measurement, medium for the cause. Measured: yes. Effort: S
- Evidence (computed `border-radius`, `SCRATCH/probe-summary.txt`):

  | Element                                  | Where                                                                                         | Radius             | Same component elsewhere                          |
  | ---------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------- |
  | "Approve & next", "Reject view"          | `review/review-workspace.tsx:1062-1097`, inside `Frame $rounded="none" $p={2}` (`:1018-1029`) | 2px                | "Details" button 6.5px                            |
  | "Open run"                               | `routes/index.tsx:592-597`, inside `Frame $rounded="xl" $p={4}` (`:571-579`)                  | 2px                | "Refresh runs" 6.5px                              |
  | Clock icon tile                          | `routes/index.tsx:580-582`                                                                    | 2px                | PR icon tile in the `$p={6}` card 7px             |
  | Status badge in the history table        | `routes/index.tsx:725-727`                                                                    | 2px                | the same `RunStatus` on the queue card: full pill |
  | Alert card in the popover                | `components/operations-attention/index.tsx:397-406`, popover padding 14px                     | 2px                | the same card on the service page 10.5px          |
  | "Open the operations and recovery guide" | `components/operations-attention/index.tsx:452-462`                                           | 2px in the popover | 6.5px on the page                                 |
  - Screenshots: `screens/closeup-open-run-square-dark.png`, `screens/closeup-action-bar-light.png`, `screens/closeup-table-badges-light.png`, `screens/dashboard-alerts-popover-dark-1440.png` against `screens/dashboard-service-dark-1440.png`.
  - The recipe documents the rule: `components/ariakit/components/frame.ariakit.react.tsx:116-122`: "If the frame is nested, this value will be adjusted to stay concentric with the parent unless `$forceRounded` is used or the parent padding plus the child margin is at least 1rem".
  - Upstream uses `$forceRounded` for exactly this case: `/Users/diegohaz/Developer/ariakit/app/src/sandbox/ariakit-ui-table/index.react.tsx:916` (`<Badge $forceRounded $layer="success">`), 10 occurrences in that file.

- What happens: A child frame inside a parent frame with less than 1rem of padding takes a concentric radius. With a parent radius of 0 or a small one, the result is the 2px floor. Cards with `$p={6}` (21px) are over the 1rem limit, so their children keep the asked radius. The app mixes both cases without intent.
- Impact: The primary decision buttons are the only square buttons in the workspace. The same badge is a pill on one page and a rectangle on the next. The UI reads as unfinished.
- Recommendation: Decide the shape for each context, then state it.

  ```tsx
  // A control that must keep its own shape inside a compact or square parent
  <Button $forceRounded $layer="brand">Approve & next</Button>
  <Badge $forceRounded $layer="warning">…</Badge>
  ```

- Alternatives:
  - Minimal: add `$forceRounded` to `RunStatus`, `ReviewStatus`, and to `ControlButton`.
  - Accept concentric geometry everywhere and adjust parent radius and padding so that the result is intended (for example the action bar as a floating bar with `$rounded="full" $p={1.5}`; see R6).
  - Make the square look a theme decision: override `--radius` once (readme lines 399-408).
- Maintainer decision needed: yes. Should controls keep one radius everywhere, or follow the concentric rule with tuned parents?

### PRIM-05 · Text is muted with `opacity-*` in 13 places. Two measured cases fail WCAG AA in the light scheme

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Sites: `routes/runs.$runId.tsx:69`, `components/app-shell.tsx:38`, `review/item-list.tsx:356`, `review/review-workspace.tsx:490` (`[&>dt]:opacity-50`), `:548`, `:551`, `:596`, `:610`, `:645`, `:801`, `:1154`, `:1253`, `review/screenshot-filter.tsx:146`.
  - Measured contrast (`SCRATCH/probe-summary.txt`, text color blended with the page background):

    | Text                                          | Class        | Size | Dark | Light    |
    | --------------------------------------------- | ------------ | ---- | ---- | -------- |
    | "4 items" (`review-workspace.tsx:551`)        | `opacity-50` | 11px | 5.34 | **3.96** |
    | Run meta strip (`:610`)                       | `opacity-50` | 10px | 5.34 | **3.96** |
    | "0.05% changed · 120 changed pixels" (`:645`) | `opacity-55` | 12px | 6.25 | 4.74     |
    | "Screenshots" label (`:548`)                  | `opacity-60` | 10px | 7.26 | 5.71     |
    | Variant index "1" (`variant-summary.tsx:128`) | `ak-ink-40`  | 10px | 5.30 | 4.59     |
    | Image size (`screenshot-viewer.tsx:103`)      | `ak-ink-50`  | 10px | 5.36 | 4.59     |

  - Readme line 624: "`ak-ink-<number>` … The rendered alpha is the larger of the requested value and the minimum that still meets WCAG AA contrast against the current layer".
- What happens: `ak-ink-40` and `ak-ink-50` are lifted to 4.59 : 1 by the utility. `opacity-50` has no floor and lands at 3.96 : 1. AA needs 4.5 : 1 for text of this size. `opacity` also dims icons and child surfaces inside the element.
- Impact: The run identity strip (commit, attempt, baseline revision, run status) is 10px text at 3.96 : 1 in the light scheme (`screens/closeup-run-meta-strip-light.png`). Not measured: the `dt` labels in the details panel use the same `opacity-50` (`:490`).
- Recommendation: Use ink for text strength everywhere.

  ```tsx
  // before
  <Text className="text-[11px] opacity-50">{model.items.length} items</Text>
  // after
  <span className="text-xs ak-ink-50">{model.items.length} items</span>
  ```

- Alternatives:
  - Minimal: search and replace `opacity-50|55|60` on text elements with `ak-ink-50|55|60`.
  - Define two text roles in one place (`meta` = `text-xs ak-ink-60`, `faint` = `text-xs ak-ink-40`) and remove all per-site values (see PRIM-07).
  - Raise the minimum font size to 12px for the meta strip. The contrast floor does not help with a 10px size.
- Maintainer decision needed: no.

### PRIM-06 · A disabled brand button keeps its full brand fill. "Approve & next" looks active on read-only runs

- Kind: accessibility
- Severity: medium. Confidence: high for the measurement, medium for the cause. Measured: yes. Effort: S
- Evidence:
  - `review/review-workspace.tsx:1080-1097`: `<Button $layer="brand" disabled={!ready || reviewBlocked || …}>`.
  - Browser probe after `archived: true` (`SCRATCH/probe-summary.txt`): `approveDisabled: bg=rgba(0,106,187,1.00) … disabled=true`, `approveColor: "oklch(1 0 0 / 0.733357)"`, `approveOpacity: "1"`. Enabled: `approve: bg=rgba(0,106,187,1.00) … disabled=null`. The fill is identical. Only the label alpha changes, from 1 to 0.73.
  - The neighbor shows the intended disabled look: `rejectDisabled` is dimmed (`screens/workspace-dark-banners.png`, `screens/workspace-dark-summary-expired.png`).
  - Disabled classes in the vendored recipe: `components/ariakit/styles/control.ts:69-77` (`"disabled ak-disabled cursor-not-allowed!"`, `"bg-none! ak-ink-0! *:ak-ink-0!"`). `bg-none` removes a background image, not the layer color.
- What happens: When the run is archived, failed, or still comparing, the approve button is disabled but still a saturated blue button with white text.
- Impact: The maintainer presses a key or clicks and nothing happens. Together with PRIM-02 (the reason text is not visible) the state is hard to understand. The upstream recipe has the same classes at HEAD (no change to `$disabled` in the `control.ts` diff), so a refresh does not change this. Not verified in a browser against upstream HEAD.
- Recommendation: Drop the color when disabled, in the app component that owns the decision buttons.

  ```tsx
  const canApprove = ready && !reviewBlocked && …;
  <Button $layer={canApprove ? "brand" : true} disabled={!canApprove}>
  ```

- Alternatives:
  - Hide the decision group and show one read-only notice in the bar when the run cannot be reviewed.
  - Report upstream that a disabled control with a color layer keeps its fill, and wait for a recipe fix.
  - Keep the fill and add a lock icon and a tooltip with the reason.
- Maintainer decision needed: yes. Is the solid fill on a disabled colored button the intended Ariakit UI behavior?

### PRIM-07 · `Text` is used 79 times but only once with a text variant. Typography is 48 ad-hoc class sets and 13 font sizes

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `SCRATCH/typography.out`: `Text usage: {"total":79,"withVariantProp":1,"classOnly":72,"bare":6,…}` and `distinct typography class combinations: 48`.
  - `Text` has no size, weight, or ink variant. Its recipe is a marker class plus color variants: `components/ariakit/components/text.ariakit.react.tsx:21-23` (`export const text = cv({ class: "text", variants: { $text(…) …`). The component comment says what it is for: "A span that serves as a text-color target for the text system" (`:11-15`).
  - Sizes in source: `text-[10px]` 9, `text-[11px]` 3, `text-xs` 61, `text-[13px]` 6, `text-sm` 36, `text-base` 3, `text-lg` 2, `text-xl` 3, `text-2xl` 9, `sm:text-[28px]` 1, `text-3xl` 7, `text-4xl` 4, `text-5xl` 1.
  - Sizes on screen (`SCRATCH/probe-summary.txt`): workspace `10px ×22, 11px ×4, 12px ×58, 13px ×16, 16px ×5, 28px ×1`; dashboard `10, 12, 13, 14, 16, 24, 30, 36px`.
  - The same role has several spellings. Eyebrow label: `text-xs uppercase tracking-widest font-medium ak-ink-60` (5), `text-xs uppercase tracking-widest font-semibold ak-ink-60` (2), `text-[10px] uppercase tracking-[0.14em] font-semibold opacity-60` (3). Page title: `text-3xl sm:text-4xl` (3), `text-2xl sm:text-3xl` (3), `text-2xl sm:text-[28px]` (1), `text-2xl` (4), `text-4xl sm:text-5xl` (1).
  - One stray size: the "Accepted (1)" disclosure button renders at 16px beside 13px rows (`acceptedToggle … font=16px`, `review/item-list.tsx:376-380`, `screens/workspace-dark-sidebar.png`).
  - Redundant restatements of recipe defaults: `routes/index.tsx:388` passes `$rounded="full"` and `className="text-xs"` to `Badge`; both are the defaults (`components/ariakit/styles/badge.ts:16-22`, `$rounded: "full"`, `$size: "xs"`).
- What happens: `Text render={<p />} className="…"` is a `<p>` with a class named `text`. The primitive adds no typography. Each call site then picks a size, weight, tracking, and ink value by hand.
- Impact: This is the main source of the "bloated with text" impression: each screen stacks an uppercase eyebrow, a 36px title that ends with a period, a sentence, a stats row, and uppercase section labels, in up to 8 sizes. A refresh of the primitives cannot improve it, because the decisions are not in the primitives.
- Recommendation: Copy `Heading` and `Prose` from upstream, and add a small app layer with 4 text roles. Keep `Text` for its real job (`$text` color).

  ```tsx
  // ui/typography.ts — the only place where sizes are written
  export const eyebrow = cv({ class: "text-xs font-medium uppercase tracking-widest ak-ink-60" });
  export const meta = cv({ class: "text-xs ak-ink-60 tabular-nums" });

  // routes/index.tsx
  <HeadingLevel>
    <Heading $level={2}>Review queue</Heading>
    <p className={meta.class()}>2 runs · 16 views pending · 2 rejected</p>
  </HeadingLevel>;
  ```

- Alternatives:
  - Minimal: keep `Text`, but move the 48 class sets into 5 or 6 exported constants and use only those.
  - Use `Prose` for every reading column (state cards, alerts, dialogs) and let its `:where()` rules size `p`, `strong`, and headings.
  - Cut content first (one title, one meta line per screen), then choose the scale.
- Maintainer decision needed: yes. Which type scale (how many sizes, is 13px the base, is 10px allowed)?

### PRIM-08 · Fourteen upstream primitives are not vendored. The app hand-rolls an equivalent for ten of them

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence: The table in "How it works", section 5, rows 1 to 12 and 19. Counts: 4 dialogs, 1 raw `<input>`, 1 raw `<select>`, 1 tag-combobox (10 unstyled Ariakit parts), 1 raw `<progress>`, 5 hand-made separators, 14 `title` tooltips, 4 raw `<code>`, 3 raw links, 2 raw `<dl>`, 20 heading-like `Text` elements.
- What happens: Each hand-rolled part brings its own focus ring, radius, padding, and color handling. Examples: the dialog backdrop is `bg-black/50!` on a `Layer` (4 copies); the input wrapper is a `Frame` rendered as `label`; the tooltip is the browser default with a delay and no keyboard access.
- Impact: The app does not look like one system, and each part must be maintained here. The missing primitives are the ones with the most accessibility logic (dialog viewport capping, input group focus, tooltip, combobox).
- Recommendation: Vendor the missing primitives from the same upstream revision as the rest (see PRIM-15), then replace in this order of visible gain: `Dialog`, `Heading` + `Prose`, `Input` + `Combobox`, `Tooltip`, `Progress`, `Separator`, `Code`, `Link`, `List`.
- Alternatives:
  - Minimal: copy only `dialog`, `heading`, `input`, `separator`, `tooltip` and their recipes (`dialog.ts` extends `popover.ts`, which is already here).
  - Keep the native `<select>` and `title` on purpose (zero JavaScript, good on mobile) and style only the wrappers. Then record that decision.
  - Wait for a published `@ariakit/ui` package and depend on it instead of a copy (upstream `package.json` is `"private": true` today).
- Maintainer decision needed: yes. Which missing primitives should the app adopt, and is a native `<select>` acceptable?

### PRIM-09 · Four hand-rolled dialogs have three different looks. The keyboard-help dialog has an unstyled heading

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:

  | Dialog                   | Lines                                 | Frame                   | Position                                                                                            | Heading                            | Description                            |
  | ------------------------ | ------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- |
  | Keyboard help            | `review/review-workspace.tsx:155-186` | `$rounded="lg" $p={5}`  | `fixed inset-[50%_auto_auto_50%] -translate-x-1/2 -translate-y-1/2 w-[min(540px,calc(100vw-32px))]` | `<ak.DialogHeading>` with no class | `<ak.DialogDescription>` with no class |
  | Screenshots (narrow)     | `:1206-1222`                          | `$rounded="2xl" $p={5}` | `fixed inset-4`                                                                                     | no class                           | none                                   |
  | Capture details (narrow) | `:1223-1241`                          | `$rounded="2xl" $p={5}` | `fixed inset-4 overflow-auto`                                                                       | no class                           | none                                   |
  | Review all changed views | `:1242-1296`                          | `$rounded="2xl" $p={6}` | `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(30rem,calc(100vw-2rem))]`          | `text-lg font-semibold`            | `text-sm opacity-60 mt-2`              |
  - The backdrop is copied 4 times: `backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}` (`:158`, `:1211`, `:1230`, `:1248`).
  - Screenshots: `screens/workspace-dark-help-dialog.png` (title "Review with the keyboard" is body-size regular text, the dialog has the canvas color, "Close help" is a text-only button), `screens/workspace-dark-batch-dialog.png` (styled title, lifted surface), `screens/workspace-dark-390-items-dialog.png`.
  - Upstream recipe: `UP/styles/dialog.ts` (viewport insets, `--dialog-max-width`, max height from the visual viewport, `ui-backdrop:bg-(--ak-layer)/10 ak-dark:ui-backdrop:bg-(--ak-layer)/30 ui-backdrop:backdrop-blur-xs`, heading `text-xl font-medium`).

- What happens: Each dialog sets its own position math, z-index, radius, padding, and text styles.
- Impact: The help dialog looks like an unstyled HTML page fragment. The key list is plain text, so "A / X" and "Shift+A / Shift+X" are hard to scan.
- Recommendation: Vendor `Dialog` and use one composition for all four.

  ```tsx
  <DialogProvider>
    <DialogDisclosure $p={1.5} aria-label="Keyboard help">
      <ButtonSlot>
        <Keyboard />
      </ButtonSlot>
    </DialogDisclosure>
    <Dialog className="flex flex-col gap-4">
      <DialogHeading>Keyboard shortcuts</DialogHeading>
      <DialogDismiss />
      <dl className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 text-sm">
        <dt>Approve, then next</dt>
        <dd>
          <Kbd>A</Kbd>
        </dd>
        <dt>Approve the whole item</dt>
        <dd className="inline-flex gap-1">
          <Kbd>Shift</Kbd>
          <Kbd>A</Kbd>
        </dd>
      </dl>
    </Dialog>
  </DialogProvider>
  ```

- Alternatives:
  - Minimal: one local `AppDialog` wrapper that holds the `Frame` props, the backdrop, and the heading class.
  - Render the narrow "Screenshots" and "Capture details" dialogs as `ShellSidebar` sheets instead of dialogs.
  - Replace the help dialog with a popover anchored to the keyboard button.
- Maintainer decision needed: no.

### PRIM-10 · Two vendored primitives have no importer (`Kbd`, `Tabs`), and three others are bypassed. The dead files add about 10 % to the stylesheet

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `grep -rln 'kbd.ariakit.react' SRC` returns nothing. `grep -rln 'tabs.ariakit.react' SRC` returns only the file itself. Sizes: `components/ariakit/components/kbd.ariakit.react.tsx` 92 lines, `tabs.ariakit.react.tsx` 777 lines.
  - Stylesheet compiled in memory with the same compiler as the Vite plugin (`SCRATCH/css-weight.out`):

    ```
    all sources (Vite default): candidates=9071 bytes=371158 gzip=47886 rules~=2326
    without tabs.ariakit.react.tsx: candidates=8885 bytes=336336 gzip=43213 rules~=2190
    without tabs + kbd: candidates=8834 bytes=332500 gzip=42522 rules~=2163
    ```

    Removing both saves 38,658 bytes (10.4 %) before minification and 5,364 bytes gzip (11.2 %).

  - The existing production stylesheet contains the unused rules: `grep -o 'ui-folder' dist/client/assets/index-CXm4JU5N.css | wc -l` → 24; `tabs` → 204; `ui-bevel` → 32.
  - Bypassed but present: `Disclosure` (native `<details>` in `components/operations-attention/index.tsx:413-422`), `PopoverScroll` (`:364-368`), `ShellFooter` parts (`review/review-workspace.tsx:1172-1176`), `Kbd` (the shortcut list in `review/review-workspace.tsx:165-182`), `ButtonSeparator` (`:1041`).
- What happens: Tailwind scans the whole source tree. A vendored file costs CSS even with zero importers.
- Impact: About 5 KB of render-blocking gzip CSS on every page for components that are not on screen. Low, but free to fix.
- Recommendation: Use `Kbd` (it is the right primitive for the shortcut list and hints). Decide on `Tabs`.
- Alternatives:
  - Delete `tabs.ariakit.react.tsx` until a screen needs it.
  - Keep it and exclude it from the scan: `@source not "./components/ariakit/components/tabs.ariakit.react.tsx";` in `review.css`.
  - Use `Tabs` for the variant strip or the view switch (redesign idea R5), which makes the file live.
- Maintainer decision needed: yes. Keep `Tabs` for the redesign, or remove it now?

### PRIM-11 · The `ControlButton` wrapper is imported as `Button`, the real `Button` is imported as `FlatButton`, and font size is overridden by class 18 times

- Kind: dx
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - The wrapper: `components/control-button.tsx:4-13`

    ```tsx
    export function ControlButton({ className = "", ...props }: ButtonProps) {
      return (
        <Button
          $kind="flat"
          $rounded="lg"
          $p={2.5}
          className={`text-[13px] leading-5 shrink-0 ${className}`}
          {...props}
        />
      );
    }
    ```

    `$kind="flat"` is already the default (`components/ariakit/components/button.ariakit.react.tsx:171`).

  - Naming: `routes/index.tsx:17`, `routes/pulls.$pullNumber.tsx:21`, `routes/runs.$runId.tsx:9`, `components/operations-attention/index.tsx:6`, and `review/review-workspace.tsx:25` all write `import { ControlButton as Button }`. `review/review-workspace.tsx:26-27` then imports the primitive as `Button as FlatButton`. Both are flat buttons.
  - The wrapper defaults are copied by hand where a different element is needed: `components/user-menu.tsx:36-42` (`PopoverDisclosure $kind="flat" $rounded="lg" $p={2} … className="shrink-0 text-[13px] leading-5"`), `components/operations-attention/index.tsx:480-485`, `review/item-list.tsx:217-222`.
  - Font size by class instead of the `$size` variant (`components/ariakit/styles/control.ts:19-26`): `className="text-xs"` on buttons 15 times, `text-[13px]` 2, `text-[11px]` 1 (`SCRATCH/typography.out`, "Button-like variant props"). `$size` is used once (`components/screenshot-viewer.tsx:118`). The fixed `leading-5` of the wrapper stays when a caller sets `text-xs`.
  - Upstream now has a typed way to do this: `UP/components/button.ariakit.react.tsx` (`recipe?: R`), and the recipe guide: "extend that component's base recipe and pass the extension through the prop" (`/Users/diegohaz/.claude/skills/ariakit-ariakit-ui-styles/references/composition-and-variants.md:62-72`).
- What happens: A reader of `review-workspace.tsx` sees `<Button>` and `<FlatButton>` and must open two files to learn that `Button` is the wrapper. The 13px size is off the recipe scale (`xs` 12px, `sm` 14px), so every other control size is also set by hand.
- Impact: Developer friction and small visual drift (three button heights in one screen: 25px, 26px, 35px in `SCRATCH/probe-summary.txt`).
- Recommendation: After the upstream refresh, replace the wrapper with a recipe.

  ```ts
  // ui/button.ts
  export const appButton = cv({
    extend: [button],
    class: "shrink-0",
    defaultVariants: { $size: "sm", $rounded: "lg", $p: 2 },
  });
  // usage
  <Button recipe={appButton} $border>Refresh</Button>
  ```

- Alternatives:
  - Minimal: keep the wrapper, stop the alias (`import { ControlButton }`), and replace `className="text-xs"` with `$size="xs"`.
  - Set the base once on the shell (`<Shell className="text-sm">`) and let every control inherit with `$size="auto"`; then no button sets a size.
  - Keep 13px as the product base by setting it on `body` and using the `em`-based recipes as they are.
- Maintainer decision needed: yes. Is 13px the intended control size, or should controls use the recipe scale (12px or 14px)?

### PRIM-12 · Eighteen `!important` overrides and repeated internal custom properties fight the Shell and Nav recipes

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `!important` utilities (`SCRATCH/catalogue.out`): `review/review-workspace.tsx` 10 (`bg-black/50!` ×4, `overflow-hidden!` and `pt-0!` on `ShellSidebarBody` `:555-558`, `py-0!` on `ShellMainIntro` `:609`, `pb-0!` on `ShellMainBody` `:623`, `flex!` and `min-h-10!` on `ShellFooter` `:1172-1176`); `review/item-list.tsx` 3 (`flex!` on `Nav` `:308`, `duration-0!` and `flex!` on `NavDisclosure` `:367`); `review/variant-summary.tsx` 2 (`flex-nowrap! gap-3!` `:91`); and 1 each in `components/user-menu.tsx:58` (`text-base!`), `components/operations-attention/index.tsx:493` (`rounded-full!`), `components/screenshot-viewer.tsx:211` (`max-md:grid-cols-1!`).
  - The same internal channel is set in four files: `[--shell-header-step:calc(48px/14)]` at `routes/index.tsx:248`, `routes/pulls.$pullNumber.tsx:151`, `routes/runs.$runId.tsx:57`, `review/review-workspace.tsx:529`. The channel is defined in `components/ariakit/styles/shell.ts:30-31`.
  - `[--control-inline:0]` on a plain `span` (`review/variant-summary.tsx:94`). The channel belongs to `control.ts:38-43`.
  - The edge color is read directly instead of through `$border` or a separator: `border-(--ak-edge)` at `routes/index.tsx:450`, `:458`, `components/operations-attention/index.tsx:413`, `review/review-workspace.tsx:609`; `bg-(--ak-edge)` as a grid gap color at `components/screenshot-viewer.tsx:211`.
  - `ak-text ak-text-danger` written by hand where `Text $text="danger"` exists: `routes/runs.$runId.tsx:232`, `review/item-list.tsx:272`.
  - The Nav is turned into a flex column that contains scroll areas and a second composite: `review/item-list.tsx:297-340` (`list={false}`, `$p="unset"`, `$cover`, `className="review-items flex! flex-col min-h-0 flex-1 my-0 py-0"`), with `ak.CompositeItem … role={undefined} render={<NavLink item={false} …/>}` at `:191-216`.
- What happens: The recipes set padding, display, and motion. The app needs something else and overrides with `!`. A recipe refresh can silently change which side wins.
- Impact: These lines are the most likely to break in the upstream refresh (the nav and disclosure recipes were restructured in `87749801f`). They also show where the screen layout does not match what the Shell parts are for: `ShellMainIntro` is used as a 10px metadata strip, and `ShellFooter` as a button row.
- Recommendation: Use the prop that exists, and move the one valid override into one wrapper.

  ```tsx
  // one place
  export function AppShell(props: ShellProps) {
    return <Shell $layer="canvas" className="[--shell-header-step:calc(48px/14)]" {...props} />;
  }
  // props instead of !
  <ShellSidebarBody $p="none" className="flex flex-col">
  <ShellFooter $height="sm" start={…} end={…} />
  ```

- Alternatives:
  - Minimal: keep the overrides and add one comment for each that names the recipe rule it beats.
  - Restructure the workspace so that the metadata strip is part of `ShellMainHeader` and the footer content moves into the action bar (see R4). Then 6 of the 10 workspace overrides disappear.
  - Build the item list on `ak.Composite` and `Button` only, without `Nav`, because it is a virtualized listbox and not a navigation list.
- Maintainer decision needed: no.

### PRIM-13 · Surfaces: 26 prop sets for 33 `Frame` uses, six "card" variants, and raised cards that do not separate from the light canvas

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `SCRATCH/typography.out`, "Frame prop combinations: 26". The card-like ones:

    | Props                                                        | Count | Sites                                                                                                       |
    | ------------------------------------------------------------ | ----: | ----------------------------------------------------------------------------------------------------------- |
    | `$border $layer $lighten $p={7} $rounded="2xl"`              |     3 | `routes/index.tsx:300`, `routes/pulls.$pullNumber.tsx:161`, `components/operations-attention/index.tsx:429` |
    | `$border $layer $lighten $p={6} $rounded="2xl"`              |     2 | `routes/index.tsx:322`, `:475`                                                                              |
    | `$border $layer $lighten $p={8} $rounded="2xl"`              |     1 | `routes/index.tsx:523`                                                                                      |
    | `$border $layer $lighten $p={4} $rounded="xl"`               |     2 | `routes/index.tsx:571`, `components/operations-attention/index.tsx:376`                                     |
    | `$border $layer $lighten $p={5} $rounded="xl"`               |     1 | `components/operations-attention/index.tsx:397`                                                             |
    | `$border $layer $lighten $p={7} $rounded="xl"`               |     1 | `routes/index.tsx:736`                                                                                      |
    | `$border $layer="canvas" $lighten={2} $p={6} $rounded="2xl"` |     2 | `routes/runs.$runId.tsx:86`, `:219`                                                                         |
    | `$border $p={6} $rounded="xl"` (no layer)                    |     1 | `review/review-workspace.tsx:1008`                                                                          |

  - Raised cards in the light scheme (`SCRATCH/probe-summary.txt`): `readyCard: bg=rgba(254,255,255,1.00)` on canvas rgb(252, 253, 253). The card is separated only by its 1px ring. Dark: `rgba(23,25,29)` on rgb(12, 14, 18).
  - Icon tiles use a recessed layer: `$layer $darken={3}` (`routes/index.tsx:486`, `:580`, `routes/pulls.$pullNumber.tsx:170`). Measured: `rgba(1,1,2)` (black) in dark, `rgba(205,206,206)` (mid gray) in light. They are the darkest objects on the page and hold a decorative icon.
  - Screenshots: `screens/dashboard-queue-dark-1440.png`, `screens/dashboard-queue-light-1440.png`, `screens/dashboard-alerts-popover-light-1440.png` (in the light popover the alert cards have no visible surface).
- What happens: Each screen builds its cards from the raw `Frame` props. Padding steps 4, 5, 6, 7, 8 and radii `lg`, `xl`, `2xl` are mixed without a rule. The light canvas (99.33 % lightness, `ui.css:4`) leaves no room for "raised = lighter".
- Impact: The dashboard is a column of large boxes of slightly different size. In the light scheme the hierarchy is carried only by hairlines. This matches the maintainer's "kind of ugly" remark more than any single bug.
- Recommendation: Name the surfaces once and reuse them.

  ```ts
  // ui/surface.ts
  export const card = cv({
    extend: [frame],
    defaultVariants: { $layer: true, $lighten: true, $border: true, $rounded: "xl", $p: 4 },
  });
  export const well = cv({
    extend: [frame],
    defaultVariants: { $layer: true, $darken: true, $rounded: "lg", $p: 3 },
  });
  ```

- Alternatives:
  - Lower the light canvas lightness (for example to 97 %) so that raised cards read without a border. This is one token.
  - Remove most cards: render the queue and the alerts as rows in one `Table` or list on the canvas (R2). Fewer surfaces, fewer decisions.
  - Keep borders only (`$layer="transparent" $border`) and reserve fills for interactive or semantic materials, as the readme's "Judge the whole scene" list suggests (lines 440-449).
- Maintainer decision needed: yes. Card-based or row-based dashboard? Is the near-white light canvas fixed?

### PRIM-14 · Status has four renderings and two vocabularies. The preview fixture state `reviewing` has a label but no color

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Rendering 1, run badge: `routes/index.tsx:383-395` (`RunStatus`, icons `CheckCheckIcon` / `CircleAlertIcon` / `Clock3Icon`).
  - Rendering 2, variant badge: `review/review-status.tsx:10-38` (`ReviewStatus`, icons `Check`, `X`, `Minus`, `Circle`, `Clock3`, `CircleAlert`, `$p={2}`, `text-[11px]`).
  - Rendering 3, sidebar dot: `review/item-list.tsx:270-274` (a filled `Circle` with `ak-text ak-text-danger|warning|success`).
  - Rendering 4, group rows: `routes/index.tsx:580-582` always shows `Clock3Icon`, also for "Run failed" and "Replaced by a newer run" (`screens/dashboard-queue-dark-1440.png`, "Needs attention" group), and the state is plain text (`:588-590`).
  - Vocabulary A: `routes/index.tsx:130-140` ("Needs review", "Waiting for screenshots", "Comparing images", "Run failed", "Replaced by a newer run", "New capture needed"). Vocabulary B for the same states: `review/use-review-session.ts:57-80` ("Changes need review", "Waiting for the complete capture", "Comparing stored captures", "Capture or comparison failed", "A newer attempt is active", "A new comparison is required").
  - The color gap: `routes/index.tsx:132` (`if (state === "needs-review" || state === "reviewing") return "Needs review";`) against `routes/index.tsx:144` (`if (state === "needs-review" || state === "comparing" || state === "incomplete")`). The preview fixture sends `state: "reviewing"` (`review/preview-fixtures.ts:84`). Measured on `http://127.0.0.1:4310/`: the badge class list has no `ak-layer-warning` and its background is `oklch(0.2634 0.0091 264.28)` (neutral), see `screens/queue-dark-1440.png`. The real API returns `summary.status` (`api/dashboard.ts:125`), which never is `reviewing` (code reading only).
- What happens: The same run is "Needs review" on the queue and "Changes need review" in the workspace header. A failed run has a clock icon.
- Impact: Extra words to learn, and the queue's "Needs attention" group does not show which rows are errors. The `reviewing` gap is visible only in the preview deployment.
- Recommendation: One status module that maps a state to `{ label, tone, icon }`, and one component with three sizes.

  ```tsx
  const status = runStatus(run.state); // { label: "Needs review", tone: "warning", icon: CircleDot }
  <Status tone={status.tone} icon={status.icon}>{status.label}</Status>      // badge
  <Status tone={status.tone} icon={status.icon} $kind="dot" />               // sidebar, table
  ```

- Alternatives:
  - Minimal: add `"reviewing"` to `stateColor`, and pass the status icon to `RunGroup`.
  - Send `label` and `tone` from the API so that the two clients cannot drift.
  - Reduce the visible vocabulary to five tones (neutral, in progress, needs review, rejected or failed, passed) and show the detail in a tooltip.
- Maintainer decision needed: yes. Which wording is canonical?

### PRIM-15 · The vendored copy is restructured and reformatted, so a refresh cannot be a file copy. Upstream has 13 newer commits with API changes

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `diff -ru` of the pinned snapshot against the vendored folder: 6,369 diff lines. After formatting the snapshot with `.oxfmtrc.jsonc` (print width 100): 4,140 diff lines in 17 files; 21 files identical (Measurements M2).
  - Structure: `components/ariakit/styles/button.ts` is one line (`export { button, buttonSlot } from "../components/button.ariakit.react.tsx";`); the recipe body is at `components/ariakit/components/button.ariakit.react.tsx:116-253`. The same for `frame`, `layer`, `text`, `text-frame`. `NOTICE` lines 5-7 describe this ("Existing inlined base recipes are re-exported through styles/* adapters").
  - `SCRATCH/compare-inlined.mjs` output: `button … only-vendored 0, only-pinned 0` and the same for `frame`, `kbd`, `layer`, `tabs`, `text-frame`, `text`; `disclosure … only-vendored 40` and `nav … only-pinned 40` (the moved `prose` recipe).
  - Upstream since the pin: `git log fc85b809..HEAD -- packages/ariakit-ui/src` → 13 commits; `git diff --stat` → 21 files, +790 −279. The changes that affect this app are in "How it works", section 4.
  - `components/app-shell.tsx:5,59` uses `NavIcon`, which no longer exists upstream.
- What happens: To refresh, a person must apply each upstream recipe change by hand into the merged component files, or first undo the inlining.
- Impact: The copy will drift. The 14 missing primitives (PRIM-08) also depend on recipe files that the upstream layout expects at `styles/*.ts` (`dialog.ts` imports `./button.ts` and `./popover.ts`; `heading.ts` imports `./text.ts`). The adapters make those imports work, but each new file must be checked.
- Recommendation: Restore the upstream file layout (recipes in `styles/`, thin components) and keep the files byte-identical to upstream after formatting. Then a refresh is: copy, format, run the browser tests.

  ```sh
  # the check that should stay empty after a refresh
  diff -rq <formatted upstream snapshot>/packages/ariakit-ui/src apps/web/src/components/ariakit
  ```

- Alternatives:
  - Add the vendored folder to the formatter and linter ignore lists so that files can be byte-identical without a format step.
  - Write a small sync script that copies a list of upstream files at a given commit and updates `NOTICE`.
  - Keep the current structure and refresh only when a needed fix lands; record the manual steps in `NOTICE`.
- Maintainer decision needed: yes. Restore the upstream layout now (before the redesign adds 14 more files) or keep the inlined layout?

### PRIM-16 · The theme names "Inter Variable" as the first font, but the app ships no font. Text renders in the platform font

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `components/ariakit/styles/ui.css:12-14`: `--font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif, …`.
  - No font file or import: `grep -rn "fontsource\|@font-face\|fonts.googleapis" apps/web/src apps/web/package.json apps/web/public` returns nothing.
  - Browser (`SCRATCH/probe-summary.txt`, `workspace-dark-fonts`): `documentFonts: []`, `h1PlatformFonts: [{"familyName":".SF NS","postScriptName":".SFNS-Bold","isCustomFont":false,"glyphCount":14}]`.
  - `routes/__root.tsx:21` sets `[font-synthesis:none]`.
- What happens: The token came with the upstream `ui.css`. On macOS the result is San Francisco. On Windows and Linux it is Segoe UI or the distribution default. A machine that has Inter installed gets Inter.
- Impact: Text metrics differ between maintainers. The recipes size padding and icons from `1cap`, `1lh`, and `1em`, so control sizes shift a little with the font.
- Recommendation: Decide and make the token match. For the system font:

  ```css
  /* review.css, after the ui.css import */
  @theme {
    --font-sans: ui-sans-serif, system-ui, sans-serif;
  }
  ```

- Alternatives:
  - Ship Inter (for example `@fontsource-variable/inter`, self-hosted on the Worker assets) with `font-display: swap`.
  - Use a mono or tabular face only for SHAs and counts and keep the system font for the rest.
- Maintainer decision needed: yes. System font or bundled Inter?

### PRIM-17 · Stylesheet and DOM weight of the primitive layer: 59 KB gzip of CSS, and about 1.6 KB of class names for each control

- Kind: cost
- Severity: low. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - Existing build output (built 2026-10-05 16:23, not built by me): `apps/web/dist/client/assets/index-CXm4JU5N.css` = 464,666 bytes; `gzip -9` = 59,384 bytes; `brotli -q 11` = 32,868 bytes. It is the only stylesheet and it loads on every route.
  - In-memory compile (`SCRATCH/css-weight.out`): all sources 371,158 bytes; without the vendored recipes and components 78,185 bytes. So about 79 % of the unminified CSS comes from the recipes.
  - DOM (`SCRATCH/probe-summary.txt`, `weight`): review workspace `elements: 581, controls: 43, averageControlClassChars: 1667, classChars: 153129, styleChars: 18209, bodyHtmlChars: 248154`. Class attributes are 62 % of the body HTML. Dashboard: `elements: 196, classChars: 49046, bodyHtmlChars: 68713` (71 %).
  - One button's class list is in `SCRATCH/probe-queue.out` (the `reviewChanges.className` value, 1,706 characters, plus 386 characters of inline style).
- What happens: Each recipe emits its full variant machinery as utilities on each element. This is the design of Ariakit UI recipes, not an app mistake.
- Impact: The CSS is render-blocking, but it is small next to the JavaScript in the same build (`index-MxeSnhFR.js` 319,611 bytes, 101,093 gzip). The class strings matter for server-rendered HTML size and hydration. The dashboard route renders only the loading state on the server, so the effect today is small. I did not measure style recalculation time. This finding does not explain the slow page loads that the maintainer reports; other lanes cover the request waterfall.
- Recommendation: No structural change. Take the two cheap steps: remove dead primitives from the scan (PRIM-10, −11 % gzip) and keep the count of controls on screen low (the redesign should not add a button for each row when a row link is enough).
- Alternatives:
  - Virtualize or paginate long lists (the sidebar list is already virtualized, `review/item-list.tsx:344-354`).
  - If the dashboard becomes server-rendered with data, check the HTML size of 100 history rows first (each row has a link, a badge, and cells with recipe classes).
- Maintainer decision needed: no.

### PRIM-18 · 34 marker classes have no CSS rule, 15 of them have no consumer, and `review.css` holds no review styles

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `SCRATCH/markers.out`: `marker classes: 34`, `markers with no CSS rule, no source selector, and no test reference: 15`. The 15: `dashboard`, `dashboard-main`, `review-accepted-group`, `review-accepted-toggle`, `review-empty-image`, `review-evidence`, `review-items`, `review-main`, `review-result`, `review-sidebar-body`, `review-thumbnail`, `review-thumbnail-empty`, `review-variant-index`, `review-variant-summary`, `review-view-controls`.
  - 16 are used only as test selectors (for example `review-save-state`, `review-pane`); 3 are used by source code as DOM hooks (`review-item`, `review-item-scroll`, `review-variants`).
  - `review.css` is two lines (`@import "tailwindcss"; @import "./components/ariakit/styles/ui.css";`). `styles.css` is one line that imports it. `review.css` is imported again at `review/review-workspace.tsx:66`, `routes/runs.$runId.tsx:21`, and `components/operations-attention/__tests__/fixture.tsx:4`.
- What happens: The names look like a BEM stylesheet that was removed. A reader searches for `.review-result` rules and finds none.
- Impact: Confusion only. There is no runtime cost.
- Recommendation: Use `data-testid` or roles for tests, delete the 15 unused names, rename `review.css` to `app.css`, and import it once from the root.
- Alternatives:
  - Keep the test hooks as classes but prefix them (`t-save-state`) so that their purpose is visible.
  - Leave as is.
- Maintainer decision needed: no.

### PRIM-19 · Horizontal strips overflow without any sign: 7 variants need 2,079px in a 1,120px strip, and the view switch is cut on a phone

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `SCRATCH/probe-selection.out`: `variantsScroll: {"clientWidth":1120,"scrollWidth":2079,"overflowX":"auto"}` for the fixture item with 7 variants at 1440px.
  - Each chip repeats the full label: icon + "React", icon + "Chromium", icon + "Light", "1280 × 720", index (`review/variant-summary.tsx:89-135`). Six of seven chips share "Chromium · Light · 1280 × 720".
  - Screenshots: `screens/closeup-variant-selection-dark.png` (the fourth chip is cut at "12"), `screens/workspace-dark-390.png` (the view switch ends at "Baselir"; the group has `overflow-x-auto`, `review/review-workspace.tsx:831`).
  - Keyboard shortcuts cover only the first six variants (`review/review-workspace.tsx:424`, `/^[1-6]$/`; `review/variant-summary.tsx:124`, `index < 6`).
- What happens: The strip scrolls, but there is no scrollbar, fade, or count. Variants 4 to 7 are off screen at 1440px.
- Impact: A reviewer can approve the visible variants and not notice that more exist. The sidebar text "7 of 7 need review" is the only hint.
- Recommendation: Show only what differs between variants, and make the overflow explicit.

  ```tsx
  // chip shows the differing dimensions only; shared ones go to a caption
  <span className="text-xs ak-ink-60">Chromium · Light · 1280 × 720</span>
  <Nav $layout="horizontal" …>{variants.map((v) => <NavLink …>{v.differing}</NavLink>)}</Nav>
  ```

- Alternatives:
  - A variant matrix (rows = browser, columns = scheme) with one status cell each (R5).
  - Wrap the chips onto several lines instead of scrolling.
  - A `ComboboxSelect` with a count ("Variant 1 of 7") and previous / next buttons.
- Maintainer decision needed: yes. Which variant picker?

### PRIM-20 · The hand-rolled history search shows keyboard focus only as an underline on its text. The select draws its focus ring inside the field border

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `routes/index.tsx:656-662`: `<input … className="min-w-0 w-full bg-transparent text-sm outline-none focus-visible:underline" />` inside `<Frame $layer $lighten $border $rounded="lg" $p={3} render={<label />} …>` (`:646-654`).
  - `routes/index.tsx:674-679`: `<select … className="bg-transparent min-w-0 max-w-48 focus-visible:outline-2 focus-visible:outline-offset-2">`.
  - Browser, keyboard focus (`SCRATCH/probe-focus.out`): search `"outline": "none 1px", "textDecoration": "underline", "wrapperOutline": "none 3px"`; select `"outline": "solid 2px"`, wrapper unchanged.
  - Screenshots: `screens/closeup-history-search-focus-dark.png` (only the placeholder text is underlined), `screens/closeup-history-select-focus-dark.png` (a box inside the box).
  - Every button in the app uses the recipe ring instead (`ui-focus-visible:outline-2 ak-outline ak-outline-brand outline-offset-1`, visible in `SCRATCH/probe-queue.out`). The sidebar filter uses a third style: `focus-within:outline-2 focus-within:outline-brand` on its `Frame` (`review/screenshot-filter.tsx:71`).
- What happens: Three focus styles for three fields. The search field's indicator is a 1px text underline, which is also how a link looks.
- Impact: Keyboard users can lose the focus position on the history page. WCAG 2.4.7 asks for a visible focus indicator; an underline under placeholder text is a weak one.
- Recommendation: `InputGroup` from upstream handles the group focus ring and click-to-focus (row 4 of the table in "How it works", section 5).
- Alternatives:
  - Minimal: add `focus-within:outline-2 focus-within:ak-outline focus-within:ak-outline-brand` to both `Frame` wrappers and remove the inner outlines.
  - Use the vendored `focusWithin` recipe (`components/ariakit/styles/focus.ts`) in a local `Field` recipe.
- Maintainer decision needed: no.

## Screenshots

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-primitives/screens/`. I opened and read each file in this list.

Live preview app (`http://127.0.0.1:4310`, preview fixtures):

| File                                          | Caption                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queue-dark-1440.png`, `queue-light-1440.png` | Queue with the preview fixture. "Review changes" is white (dark) or light gray (light), not brand blue. The "Needs review" badge is neutral because the fixture state is `reviewing`. |
| `history-dark-1440.png`                       | History with one row. Rectangular status badge inside the table.                                                                                                                      |
| `service-dark-1440.png`                       | Service status, no alerts. Six text blocks for one "no alerts" fact.                                                                                                                  |
| `run-dark-1440.png`, `run-light-1440.png`     | Review workspace. The read-only notice is plain text. In light, the selected variant chip has no outline.                                                                             |

Fixture harness (`http://127.0.0.1:4311`), review workspace:

| File                                                                                                                                     | Caption                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `workspace-dark-1440.png`, `workspace-light-1440.png`                                                                                    | Default state, 4 items, 7 variants. Four stacked bars above the images.                           |
| `workspace-dark-sidebar.png`, `workspace-light-sidebar.png`                                                                              | Sidebar. The selected row is visible in dark, not in light.                                       |
| `workspace-dark-variants.png`, `workspace-light-variants.png`                                                                            | Title, variant strip (cut at the right), view switch.                                             |
| `workspace-dark-actions.png`, `workspace-light-actions.png`                                                                              | Action bar. Reject and Approve are square; other buttons are rounded.                             |
| `workspace-dark-details.png`, `workspace-light-details.png`                                                                              | Details sidebar open. Raw `dl`, dimmed `dt` labels.                                               |
| `workspace-dark-filter-open.png`, `workspace-light-filter-open.png`                                                                      | Status filter popover (tag + combobox).                                                           |
| `workspace-dark-help-dialog.png`, `workspace-light-help-dialog.png`                                                                      | Keyboard help. Unstyled heading, keys as plain text.                                              |
| `workspace-dark-batch-dialog.png`, `workspace-light-batch-dialog.png`                                                                    | "Review all changed views". Styled heading, different radius and padding from the help dialog.    |
| `workspace-dark-diff-200.png`, `workspace-light-diff-200.png`                                                                            | Difference view at 200 % with pan buttons.                                                        |
| `workspace-dark-banners.png`, `workspace-light-banners.png`, `workspace-dark-banners-closeup.png`, `workspace-light-banners-closeup.png` | Run error + archived run. Both banners have no surface. Approve is disabled but still solid blue. |
| `workspace-dark-terminal-failed.png`                                                                                                     | Failed comparison. "Comparison failed" and "Recompare now" are plain text in a row.               |
| `workspace-dark-summary-expired.png`                                                                                                     | Image history expired. The action bar floats in the middle of an empty page.                      |
| `workspace-dark-save-error.png`, `workspace-dark-save-error-closeup.png`                                                                 | Save error. "Retry same command" and "Refresh current state" are text-only buttons under the bar. |
| `workspace-dark-390.png`, `workspace-dark-390-full.png`, `workspace-light-390.png`, `workspace-light-390-full.png`                       | Phone width. The view switch is cut ("Baselir"). Decision buttons wrap to a second row.           |
| `workspace-dark-390-items-dialog.png`, `workspace-dark-390-details-dialog.png`                                                           | Phone dialogs for the item list and the details.                                                  |

Fixture harness, dashboard and other routes (mocked API):

| File                                                                                                                       | Caption                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `dashboard-queue-dark-1440.png`, `dashboard-queue-light-1440.png`                                                          | Queue with 8 runs in all states. Three card sizes, clock icon for failed runs, square "Open run" buttons. |
| `dashboard-queue-dark-390.png`, `dashboard-queue-light-390.png`                                                            | Queue on a phone. About 1,650px tall for 7 runs.                                                          |
| `dashboard-history-dark-1440.png`, `dashboard-history-light-1440.png`, `dashboard-history-dark-390.png`                    | History table. Rectangular badges; on a phone the badges wrap to two lines.                               |
| `dashboard-service-dark-1440.png`, `dashboard-service-light-1440.png`, `dashboard-service-dark-390.png`                    | Service status with 3 alerts and capacity. Native `<details>` markers.                                    |
| `dashboard-alerts-popover-dark-1440.png`, `dashboard-alerts-popover-light-1440.png`                                        | Alerts popover. The same cards as the page, here with square corners; in light they have no surface.      |
| `dashboard-account-popover-dark.png`, `dashboard-account-popover-light.png`                                                | Account popover: heading, one sentence, one button.                                                       |
| `dashboard-guest-dark-1440.png`, `dashboard-guest-light-1440.png`                                                          | Signed-out page. In light the icon tile is invisible and the sign-in button is light gray.                |
| `dashboard-forbidden-dark-1440.png`                                                                                        | No repository access.                                                                                     |
| `dashboard-empty-dark-1440.png`                                                                                            | Empty queue. A row of three zeros above the empty card.                                                   |
| `dashboard-loading-dark-1440.png`, `run-loading-dark-1440.png`                                                             | The two loading states. Plain text at two different positions.                                            |
| `run-error-dark-1440.png`, `run-guest-dark-1440.png`                                                                       | Run page error and sign-in. Text-only buttons centered in a wide card at the top of the page.             |
| `pull-pending-dark-1440.png`, `pull-failed-dark-1440.png`, `pull-failed-light-1440.png`, `pull-not-required-dark-1440.png` | Pull-request page states. The failed state is a solid yellow block.                                       |
| `operations-popover-dark.png`, `operations-popover-light.png`                                                              | Alerts popover in isolation.                                                                              |

Close-ups of the worst mismatches (2× scale):

| File                                                                             | Caption                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `closeup-primary-cta-dark.png`, `closeup-primary-cta-light.png`                  | PRIM-01: the "Review changes" button without the brand color.          |
| `closeup-open-run-square-dark.png`, `closeup-open-run-square-light.png`          | PRIM-04: square icon tile and square "Open run" inside a rounded card. |
| `closeup-table-badges-dark.png`, `closeup-table-badges-light.png`                | PRIM-04: rectangular status badges in the table.                       |
| `closeup-variant-selection-dark.png`, `closeup-variant-selection-light.png`      | PRIM-03: selected chip in dark and in light.                           |
| `closeup-action-bar-dark.png`, `closeup-action-bar-light.png`                    | PRIM-04: square decision buttons.                                      |
| `closeup-view-controls-dark.png`, `closeup-view-controls-light.png`              | View switch and zoom group.                                            |
| `closeup-run-meta-strip-dark.png`, `closeup-run-meta-strip-light.png`            | PRIM-05: 10px meta strip at 50 % opacity.                              |
| `closeup-footer-dark.png`, `closeup-footer-light.png`                            | Footer with three text-only buttons.                                   |
| `closeup-history-filters-dark.png`, `closeup-history-filters-light.png`          | Hand-rolled search field and native select.                            |
| `closeup-history-search-focus-dark.png`, `closeup-history-select-focus-dark.png` | PRIM-20: keyboard focus on the two fields.                             |

## Redesign ideas

Each idea names the primitives to use. All sketches assume that the missing upstream primitives are vendored (PRIM-08).

### R1 · A thin app kit between the primitives and the screens

- What changes: A folder `ui/` with about 10 recipes and components: `appButton`, `card`, `well`, `Banner`, `Status`, `StateCard`, `eyebrow`, `meta`, `PageHeader`, `Field`. Screens stop passing `$p`, `$rounded`, and `text-*` values.
- Why it is better: The 48 type sets, 26 frame sets, and 18 `!` overrides come from deciding at each call site. A kit makes the redesign variants cheap: change one recipe, see every screen.
- Sketch:

  ```tsx
  <PageHeader title="Review queue" meta="ariakit/ariakit · baseline 42" actions={<Button recipe={appButton} $border>Refresh</Button>} />
  <StateCard tone="success" icon={<CheckCheckIcon />} title="All reviews are complete." />
  ```

### R2 · Queue as one dense list instead of cards

- What changes: Replace the stats row, the three card groups, and the "View history" footer with one `Table` (or a `Nav` list) on the canvas. One row per run: status dot, `#PR title`, pending and rejected counts, age, a row link. Groups become row-group headers.
- Why it is better: 7 runs take 1,420px today (`dashboard-queue-dark-1440.png`). A row list shows about 15 runs in one screen. The whole row is the link, so the "Open run" and "Review changes" buttons disappear.
- Sketch:

  ```
  Review queue                              ariakit/ariakit · baseline 42   [↻]
  ───────────────────────────────────────────────────────────────────────────
  NEEDS YOUR REVIEW  2
  ● #5240  Fix Combobox popover placement in dialogs     12 pending        2h
  ● #5238  Add the Shell primitive and migrate…           4 pending · 2 ✕   5h
  IN PROGRESS  2
  ◌ #5231  Update menu styles                             comparing        1m
  ◌ #5229  Tabs folder kind                               uploading        3m
  NEEDS ATTENTION  3
  ▲ main   New capture needed                                              1d
  ```

  ```tsx
  <Table $borderBlock container={{ $layer: "transparent" }}>
    <TableRowGroup group="head">
      <TableRow>
        <TableCell colSpan={4}>
          Needs your review <Badge>2</Badge>
        </TableCell>
      </TableRow>
    </TableRowGroup>
    <TableRowGroup>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </TableRowGroup>
  </Table>
  ```

### R3 · Inbox layout: list on the left, run preview on the right

- What changes: Use `ShellSidebar` for the run list and `ShellMain` for a preview of the selected run (title, thumbnails of changed items, one "Start review" action). History is a filter of the same list, not a separate view.
- Why it is better: One layout for queue, history, and review. Selecting a run costs no navigation, which also hides the access-check wait behind already visible content.
- Sketch:

  ```
  ┌ Runs ─────────────┬ #5240 Fix Combobox popover placement ───────────┐
  │ [Search…] [Open▾] │ 12 views need review · attempt 1 · a1aaaaa       │
  │ ● #5240  12       │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                      │
  │ ● #5238  4·2✕     │ │    │ │    │ │    │ │ +8 │   [Start review  ⏎] │
  │ ◌ #5231           │ └────┘ └────┘ └────┘ └────┘                      │
  └───────────────────┴──────────────────────────────────────────────────┘
  ```

### R4 · Review workspace with two rows of chrome instead of five

- What changes: Today there are five bands above the images: main header (back, run title, progress), meta strip, item title row, variant strip, view-switch bar. Merge them into one `ShellMainHeader` row (breadcrumb, item title, status, progress) and one toolbar row (variant picker left, view switch and zoom right). Move commit, attempt, and baseline into the details panel.
- Why it is better: At 1440 × 900 the images start near y = 365 (`workspace-dark-1440.png`). With two rows they start near y = 150. The meta strip is the 10px low-contrast text of PRIM-05.
- Sketch:

  ```
  ← Queue / Dialog focus styles / Success dialog  ● Needs review      9 of 11 ▓▓░░  ⓘ
  [React ▪ Solid ▪ Dark ▪ Contrast ▪ Firefox ▪ WebKit ▪ Wide]   [Compare|Diff|New|Old] [Fit 100 200]
  ┌──────────────── Baseline ────────────────┬──────────────── Current ───────────────┐
  ```

  ```tsx
  <ShellMainHeader $height="sm" $border>
    <ShellMainFull className="flex items-center justify-between px-4">
      <Breadcrumb … /> <Progress value={done / total} className="w-24" />
    </ShellMainFull>
  </ShellMainHeader>
  ```

### R5 · Variant picker options: differing-part tabs, matrix, or select

- What changes: (a) `Tabs` or `Nav` chips that show only the parts that differ between variants, with shared parts in a caption. (b) A matrix: rows = browser or framework, columns = color scheme; each cell is a status dot button. (c) `ComboboxSelect` "Variant 3 of 7" with previous and next.
- Why it is better: Removes the 2,079px strip (PRIM-19). The matrix shows the review progress of an item at a glance and scales to 20 variants.
- Sketch:

  ```
  (a)  Chromium · Light · 1280×720     [React] [Solid] [Dark] [Contrast] [Firefox] [WebKit] [Wide]
  (b)            Light  Dark  Contrast
       React      ●      ○      ○          ● needs review   ✓ approved   ✕ rejected   – unchanged
       Solid      ✓      ✓      –
  ```

  ```tsx
  <TabProvider selectedId={variant.id} setSelectedId={select}>
    <TabList>
      {variants.map((v) => (
        <Tab key={v.id} id={v.id}>
          <TabSlot>
            <StatusDot />
          </TabSlot>
          <TabLabel>{v.differing}</TabLabel>
        </Tab>
      ))}
    </TabList>
  </TabProvider>
  ```

### R6 · Decision bar options: floating pill, docked footer, or header actions

- What changes: (a) A floating bar: `Frame $layer $lighten $border $rounded="full" $p={1.5}` centered at the bottom with Reject, Approve, and a menu for "all 7". (b) Put the decisions in `ShellFooter` and remove the current footer row. (c) Put them at the right end of the toolbar from R4.
- Why it is better: Fixes the square buttons (PRIM-04) by giving the bar an intended shape, removes one full-width band, and makes room for the save state as a small status inside the bar.
- Sketch:

  ```
                 ╭────────────────────────────────────────────────────╮
                 │ ↶  │  ✕ Reject  X  │  ✓ Approve & next  A  │  ⋯ 7 │
                 ╰────────────────────────────────────────────────────╯
  ```

  ```tsx
  <Frame
    $layer
    $lighten={2}
    $border
    $rounded="full"
    $p={1.5}
    className="fixed bottom-4 left-1/2 -translate-x-1/2 flex gap-1 shadow-xl"
  >
    <Button $rounded="full" aria-label="Undo">
      <ButtonSlot>
        <Undo2 />
      </ButtonSlot>
    </Button>
    <ButtonSeparator />
    <Button $rounded="full" $layer="brand">
      Approve & next <Kbd>A</Kbd>
    </Button>
  </Frame>
  ```

### R7 · One status language with three sizes

- What changes: `Status` component with `tone` (neutral, progress, attention, danger, success) and `$kind` (`badge`, `dot`, `row`). Used by the queue, history, sidebar, variant picker, batch dialog.
- Why it is better: Replaces four renderings and two vocabularies (PRIM-14). The dot form removes most badge text from dense lists.
- Sketch:

  ```tsx
  <Status tone="attention">Needs review</Status>            // ◐ Needs review   (Badge, $forceRounded)
  <Status tone="danger" $kind="dot" label="Rejected" />     // ●  with a Tooltip
  ```

### R8 · Banner and inline notice family

- What changes: `Banner` (tinted `Frame`, icon, text, optional action) for run-level states; an inline notice (icon + `ak-ink-70` text) inside the action bar for "why is this disabled".
- Why it is better: Fixes PRIM-02 and PRIM-06 together. One place shows the reason and the recovery action ("Recompare now").
- Sketch:

  ```
  ┌ ⚠  This run is closed. Decisions are read-only.                [View history] ┐
  ```

  ```tsx
  <Banner
    tone="warning"
    icon={<LockIcon />}
    action={
      <Button $size="sm" $border>
        Recompare
      </Button>
    }
  >
    This run is closed.
  </Banner>
  ```

### R9 · Filter bar: search field plus visible status toggles

- What changes: Replace the tag-combobox in the sidebar with `InputGroup` (search) and a `ButtonGroup` of four toggles with counts (All 4, Review 3, Approved 1, Rejected 0). Use the same bar for history.
- Why it is better: The current control hides four options behind a 30px "All ▾" tag inside the search field (`workspace-dark-filter-open.png`) and needs 10 unstyled Ariakit parts. Toggles show the counts, which the header repeats today as "4 items".
- Sketch:

  ```
  [🔍 Search screenshots…           ]
  [All 4] [Needs review 3] [Approved 1] [Rejected 0]
  ```

  ```tsx
  <InputGroup $size="sm"><InputSlot><SearchIcon /></InputSlot><Input aria-label="Search screenshots" /></InputGroup>
  <ButtonGroup $p={0.5} $rounded="md" aria-label="Review status">{filters.map((f) => <Button key={f.value} aria-pressed={filter === f.value}>{f.label} {f.count}</Button>)}<ButtonGlider /></ButtonGroup>
  ```

### R10 · Keyboard help as a key map built from `Kbd`

- What changes: A `Dialog` (or a popover from the keyboard button) with a two-column list of actions and `Kbd` caps. Show the same caps inside tooltips and on the decision buttons.
- Why it is better: Keys become scannable. `Kbd` is already vendored and unused.
- Sketch:

  ```
  Keyboard shortcuts                                   ✕
  Next / previous item         ↓  ↑
  Select variant               ←  →   1 … 6
  Approve · reject             A  ·  X
  Whole item                   ⇧ A  ·  ⇧ X
  View                         S  D  F  G
  ```

### R11 · Capture details as a compact facts table or a popover

- What changes: Replace the right sidebar's stacked sentences and `dl` with a two-column `Table` (`header="row"`), `Code` for IDs, and copy buttons. Option: a `Popover` from the "Details" button instead of a sidebar.
- Why it is better: The panel repeats the variant label, verdict, and run status that are already on screen (`workspace-dark-details.png`). A facts table is half the height and aligns values.
- Sketch:

  ```
  Changed pixels     120 (0.05 %)
  Dimensions         600 × 400 → 600 × 400
  Engine · codec     rgba-v1 · png-v1
  Threshold          0.0005 (test-policy)
  Run                run-42 · attempt 2 · aabbccd   ⧉
  ```

### R12 · Loading and empty states that keep the layout

- What changes: One `Skeleton` built from `Frame $layer $lightnessOffset` blocks (or `Progress` without a value for the indeterminate bar) that mirrors the final layout: header, list rows. The same component for `/`, `/runs/:id`, `/pulls/:n`.
- Why it is better: Today each route shows one sentence at a different position (`dashboard-loading-dark-1440.png`, `run-loading-dark-1440.png`) and then the whole page jumps in. A stable skeleton makes the access check feel shorter even before the backend is faster.
- Sketch:

  ```tsx
  <ShellMainBody aria-busy="true">
    <Progress aria-label="Loading runs" className="h-0.5" />
    {rows.map((row) => (
      <Frame key={row} $layer $lightnessOffset $rounded="md" className="h-10" />
    ))}
  </ShellMainBody>
  ```

### R13 · Navigation options: top tabs with counts, or a left rail

- What changes: (a) Keep the top `Nav` but add counts ("Queue 2", "Alerts 3") and merge the bell into the "Service" link. (b) A narrow `ShellSidebar` rail with icons, which frees the header for the run context.
- Why it is better: The header shows three links, a repository label, a bell with its own popover, and an account button. The bell and "Service status" lead to the same content.
- Sketch:

  ```
  ◎ visonaut   ariakit/ariakit ▾        Queue 2 · History · Service ●3              ◔
  ```

### R14 · Surface and color tokens for the light scheme

- What changes: Try a light canvas near 97 % lightness, or switch the card model in light to "bordered, same plane". Use `$kind="bevel"` for the one primary action as an option.
- Why it is better: Raised cards and the selected state gain visible separation without extra borders (PRIM-03, PRIM-13).
- Sketch:

  ```css
  @theme {
    --color-canvas: oklch(97.2% 0.003 250);
  }
  ```

  ```tsx
  <Button $layer="brand" $kind="bevel">
    Approve & next
  </Button>
  ```

### R15 · Service status as a timeline with meters

- What changes: Capacity as two `Progress` meters ("Database 312 of 450 MiB", "Captures 2 of 8"). Alerts as a list of `Disclosure` rows: title, age, one-line action; the long recovery text and the technical details open on demand.
- Why it is better: The page shows about 160 words for three alerts (`dashboard-service-dark-1440.png`), and the capacity card is two sentences of numbers.
- Sketch:

  ```
  Database  ▓▓▓▓▓▓▓░░░  312 / 450 MiB        Captures  ▓▓░░░░░░  2 / 8
  ▸ ▲ A backup needs attention                                   2 min ago
  ▸ ▲ A GitHub check needs attention                             2 min ago
  ```

## Measurements (command, raw result, limits)

All scripts are in `SCRATCH`. They read the repository and write only to `SCRATCH`.

| #   | Command                                                                                                                                                                                                           | Raw result                                                                                                                                                                                                                                            | Limits                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | `node SCRATCH/catalogue.mjs` (TypeScript parser over the 14 files)                                                                                                                                                | `TOTALS {"primitive":349,"ak":30,"rawStyled":91,"rawUnstyled":56,"renderRaw":78,"arbitrary":59,"akUtilities":65,"important":18,"inlineStyle":0,"classNameAttrs":288}`. Full output: `SCRATCH/catalogue.out`, `SCRATCH/catalogue.json`.                | Counts JSX elements in source, not rendered elements. A token counts as arbitrary when it contains `[...]` or `-(--…)`. Classes built at run time from variables are not seen.                                                                                                 |
| M2  | `git -C /Users/diegohaz/Developer/ariakit archive fc85b809 packages/ariakit-ui/src` → extract → `diff -ru <snapshot> SRC/components/ariakit \| wc -l`; then `oxfmt -c .oxfmtrc.jsonc` on a copy and the same diff | `6369` lines before formatting, `4140` after. After formatting, 17 files differ and 21 are identical.                                                                                                                                                 | The formatter ran on a copy in `SCRATCH/pinned-fmt`.                                                                                                                                                                                                                           |
| M3  | `node SCRATCH/compare-inlined.mjs`                                                                                                                                                                                | `button`, `frame`, `kbd`, `layer`, `tabs`, `text-frame`, `text`: `only-vendored 0, only-pinned 0`. `disclosure`: `only-vendored 40`. `nav`: `only-pinned 40` (the `prose` recipe moved).                                                              | Line-set comparison that ignores import lines and blank lines. It does not prove the same order of lines.                                                                                                                                                                      |
| M4  | `git -C /Users/diegohaz/Developer/ariakit log --format='%h %cd %s' --date=short fc85b809..HEAD -- packages/ariakit-ui/src` and `git diff --stat fc85b809 HEAD -- packages/ariakit-ui/src`                         | 13 commits; `21 files changed, 790 insertions(+), 279 deletions(-)`                                                                                                                                                                                   | Upstream HEAD was `643a23af` on 2026-10-05.                                                                                                                                                                                                                                    |
| M5  | `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/shot.mjs --url http://127.0.0.1:4310/ --out … --script SCRATCH/probe-queue.mjs`                                                                                   | "Review changes": `"inlineStyle": "--layer-color: primary; …"`, `"backgroundColor": "oklch(0.949994 0.0000497986 23.7884)"`. `"loadedFonts": []`. Full output: `SCRATCH/probe-queue.out`.                                                             | Dev server with preview fixtures. Dark scheme.                                                                                                                                                                                                                                 |
| M6  | `node SCRATCH/probe-all.mjs` then `node SCRATCH/summarize-probe.mjs`                                                                                                                                              | `SCRATCH/probe-summary.txt` (radius, background, disabled state, contrast, DOM weight, platform font for dark and light). Raw JSON: `SCRATCH/probe-all.json`.                                                                                         | Fixture harness on port 4311 with mocked `/api`. Contrast is computed from the computed text color, the product of ancestor opacities, and the first opaque ancestor background, converted to sRGB through a canvas. Text over the checkerboard or over images is not covered. |
| M7  | `node SCRATCH/probe-selection.mjs`                                                                                                                                                                                | Light: `"selectedItemVsSidebar": 1.017`, glider `"vsCanvas": 1.017`. Dark: `1.258`. `variantsScroll: {"clientWidth":1120,"scrollWidth":2079,"overflowX":"auto"}`. Output: `SCRATCH/probe-selection.out`.                                              | Fixture item with 7 variants.                                                                                                                                                                                                                                                  |
| M8  | `node SCRATCH/typography.mjs`                                                                                                                                                                                     | `distinct typography class combinations: 48`; `Text usage: {"total":79,"withVariantProp":1,"classOnly":72,"bare":6}`; `Frame prop combinations: 26`. Output: `SCRATCH/typography.out`.                                                                | A "typography token" is a size, weight, tracking, leading, `uppercase`, `ak-ink-*`, `opacity-*`, or `tabular-nums` class.                                                                                                                                                      |
| M9  | `node SCRATCH/css-weight.mjs` (`@tailwindcss/node` `compile()` + `@tailwindcss/oxide` `Scanner`, the versions that the Vite plugin uses)                                                                          | `all sources (Vite default): candidates=9071 bytes=371158 gzip=47886`; `without tabs + kbd: … bytes=332500 gzip=42522`; `without the vendored ariakit folder (theme + app classes only): … bytes=78185 gzip=12260`. Output: `SCRATCH/css-weight.out`. | Unminified output without Lightning CSS. The "all sources" result is byte-equal to the dev server stylesheet (`curl 'http://127.0.0.1:4311/src/review.css?direct' \| wc -c` → `371158`), which validates the method. Production numbers differ (M10).                          |
| M10 | `ls -la apps/web/dist/client/assets`, `gzip -9 -c index-CXm4JU5N.css \| wc -c`, `brotli -q 11 -c … \| wc -c`                                                                                                      | CSS `464666` bytes, gzip `59384`, brotli `32868`. JS: `index-MxeSnhFR.js` `319611` (gzip `101093`), `app-shell-rQLLgOsf.js` `139641` (gzip `40101`), `runs._runId-QUJlDVZ1.js` `137841` (gzip `43838`).                                               | I did not run the build. The `dist` folder existed with a timestamp of 2026-10-05 16:23. I assume that it comes from this worktree.                                                                                                                                            |
| M11 | `node SCRATCH/markers.mjs`                                                                                                                                                                                        | `marker classes: 34`, `markers with no CSS rule, no source selector, and no test reference: 15`. Output: `SCRATCH/markers.out`.                                                                                                                       | A consumer is a `.name` selector string in app source or in a test file.                                                                                                                                                                                                       |
| M12 | `node SCRATCH/probe-focus.mjs`                                                                                                                                                                                    | search: `"outline": "none 1px", "textDecoration": "underline", "wrapperOutline": "none 3px"`; select: `"outline": "solid 2px"`. Output: `SCRATCH/probe-focus.out`.                                                                                    | Keyboard focus through Tab. Dark scheme only.                                                                                                                                                                                                                                  |
| M13 | `node SCRATCH/capture.mjs`, `node SCRATCH/capture-closeups.mjs`, `node SCRATCH/probe-focus.mjs`, and 7 runs of `shot.mjs`                                                                                         | 87 PNG files in `SCRATCH/screens` (86 are listed above; `_probe.png` is a by-product of M5). One planned capture failed in the first run (`run-guest`, wrong mock) and was captured by the second script.                                             | Chrome only. No Firefox, no Safari, no forced-colors, no `prefers-contrast: more`.                                                                                                                                                                                             |
| M14 | `grep -rln 'kbd.ariakit.react' SRC`; `grep -rln 'tabs.ariakit.react' SRC`                                                                                                                                         | no result; only `components/ariakit/components/tabs.ariakit.react.tsx`                                                                                                                                                                                | —                                                                                                                                                                                                                                                                              |

## Open questions and items not verified

1. Intent of `$layer="primary"`. I assume that brand blue was intended, because `ui.css:6` defines `--color-primary: var(--color-brand)` and the workspace uses `$layer="brand"` for its primary action. Not confirmed.
2. The cause of the 2px radius (PRIM-04). I measured the result and read the rule in the `frame` documentation comment. I did not trace the exact formula in the `@ariakit/tailwind` output.
3. Disabled colored buttons (PRIM-06). I verified the behavior with the vendored recipe. I read the upstream HEAD diff and saw no change to `$disabled`, but I did not run upstream HEAD in a browser.
4. Contrast of the details panel labels (`[&>dt]:opacity-50`, `review/review-workspace.tsx:490`) and of the batch dialog description (`opacity-60`, `:1253`). Not measured. They use the same classes as the measured cases.
5. The `reviewing` state (PRIM-14). I conclude from `api/dashboard.ts:100-125` and `packages/service/src/review-status.ts` that the production API never returns it. I did not call the production API.
6. Forced-colors mode, `prefers-contrast: more`, right-to-left layout, Firefox, and Safari were not tested. The recipes contain specific code for all of them.
7. `dist/` provenance (M10). The folder was present; I did not build. The production CSS is larger than the unminified dev CSS (464,666 against 371,158 bytes). I assume that Lightning CSS adds color fallbacks and prefixes. Not verified.
8. Style recalculation and layout cost of the recipe classes (PRIM-17). Only static sizes were measured.
9. Whether the `ButtonGroup` + `aria-pressed` + `ButtonGlider` view switch is the pattern that upstream recommends for exclusive toggles, or whether `Tabs` is preferred. I treated the current code as idiomatic. Not confirmed against the upstream button sandbox.
10. After the upstream refresh: which of the 18 `!important` overrides still win. `NavDisclosure` (`review/item-list.tsx:365-397`) is the highest risk because its recipes were restructured in `87749801f`.
11. The font decision (PRIM-16) changes control metrics. The pixel values in this report (button heights, radii in px) were measured with the macOS system font.
12. The 14 native `title` tooltips include disabled-reason text (`review/review-workspace.tsx:1071`, `:1089`, `:1192`). A native `title` does not show on a disabled button in every browser. Not tested.
13. The `Tabs` sketch in R5 uses the vendored `Tabs` parts by name only. I did not check which variant props the vendored `TabList` accepts.
