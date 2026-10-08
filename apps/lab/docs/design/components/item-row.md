# Screenshot list row (item-row)

Group: workspace
Question: Which row should the screenshot list use?
Description: One row of the screenshot list (an item with all its variants), shown as a short list so that density, selection, long names, and state marks can be compared.
Layout: row

## Scenarios

- `mixed` (Mixed states): Eight rows that cover every state: seven screenshots of the `changes` run (Dialog, the long Combobox name, Actions menu, Tooltip, Toolbar, Sortable data table, Legacy installation page) and one unchanged screenshot, with the second row selected.
- `long-names` (Long names): Six production-shaped path names of 25 to 68 characters, where the name is the key, each with three to six variants.
- `problems` (Failed and comparing): Four rows of the `problems` run and two rows of the `comparing` run: failed comparisons, an image that does not load, and comparisons in progress.
- `large` (Large run): The first rows of the `large` run (120 screenshots) in a frame 28rem high that scrolls, to count the rows that fit.
- `passed` (All approved): The `passed` run: every change is approved and nothing needs review.
- `states` (Hover, focus, selected): The same row four times, forced into rest, hover, keyboard focus, and selected, to check the selection and the focus ring in both schemes.
- `loading` (Loading): The list data did not arrive yet: skeleton rows at the final row height.
- `narrow` (Narrow): The mixed rows in a list 16rem (256 px) wide, the width of the `md` sidebar.

## Variant `dense-line`: Dense line

A 32 px row with one status mark, a name that keeps its end, and one number.

Ideas:

- One line and one number for each row: 13 rows fit in 28rem, where 10 fit today.
- The name is cut in the middle, so the last path segment stays readable.
- The number is the count of variants that still need an action. A finished row has no number.

Tradeoffs:

- No thumbnail, so contract rule A11 goes away.
- The row does not say which variant is left. The reviewer opens the screenshot to see it.
- The words `need review` leave the row (contract wording A08). They stay in the accessible name and in the tooltip.

### Spec

**Sketch**

```
┌──────────────────────────────────────┐ 20rem
│ ○ Dialog with initial focus        6 │ 32 px row
│▌○ Combobox with auto…virtual focus 1 │ selected: fill + bar
│ ✕ Actions menu                     2 │
│ ○ Tooltip                       +  2 │ + = has an added variant
│ ○ Toolbar with a pressed toggle    1 │
│ + Sortable data table                │ finished rows: no number
│ − Legacy installation page           │
│ = Dialog with a form                 │ ink 50
└──────────────────────────────────────┘
```

**Build**

- Base: `Nav render={<div aria-label='Screenshots' />}` in `Frame $border $rounded='xl' $p={1}`, `w-80`. Rows are `NavLink href='#'` with `aria-current='page'` on the selected row. `glider={[{ $state: 'hover' }, {}, { $state: 'focus' }, { $kind: 'bar', $side: 'start' }]}`.
- Row height 32 px: `className='[--nav-py:--spacing(1.5)]!'` on the `Nav` and `$p='var(--nav-py)'` on each row, `text-sm`.
- Start `NavSlot`: the status mark of the screenshot (the first of Failed, Needs review, Comparing, Rejected, Approved, Unchanged).
- `NavLinkLabel`: two spans in `flex min-w-0`. Head: `truncate flex-1`. Tail: `flex-none`, the last path segment or the last 14 characters.
- End: an optional 12 px flag (`Plus` when a variant is added; `X` when a variant is rejected and the row status is not Rejected), then `NavSlot $kind='badge'` with the count, `$layer={role} $mix={15}`, `tabular-nums`, `ms-auto`.
- The row is a `TooltipAnchor`. The tooltip has the full name and `3 need review · 1 rejected · 2 approved`.
- Marks (lucide in `Text $text`): `Circle` warning, `Check` success, `X` danger, `Plus` success, `Minus` danger, `Equal` ink 50, `TriangleAlert` danger, `LoaderCircle` spinning.

**Copy** (no words in a row except the name)

- Count: the number of variants in the row status (needs review, rejected, or failed).
- Accessible name: `{name}. 6 need review` · `2 rejected` · `2 failed` · `Approved` · `Auto-approved` · `Unchanged` · `Comparing`.

**Behavior and keys**

- Click or Enter selects the screenshot. Up and Down move the selection and stop at the ends.
- Approved rows use `ak-ink-80`. Unchanged rows use `ak-ink-50`. Hover changes no layout.

**Scenarios**

- mixed: as in the sketch.
- long-names: `ariakit-ui-com…conditional-content`; the tooltip has the full key.
- problems: `TriangleAlert` with the failed count. Comparing rows show the spinner and no number. The row with the broken image is a normal Needs review row.
- large: 13 rows fit. No group headers.
- passed: marks only (`Check`, `Plus`, `Minus`), no numbers.
- states: rest, hover fill, focus ring inside the frame padding (not clipped), selected fill with the start bar.
- loading: 8 rows of `Frame $lightnessOffset={2} animate-pulse` bars (a dot and a 60% name bar), `aria-busy='true'`.
- narrow: `w-64`. The tail is 8 characters. Flags hide.

## Variant `variant-marks`: Variant marks

One mark for each variant, in declared order, replaces the count sentence.

Ideas:

- The row shows the verdict of every variant without a word. The variant switcher uses the same marks.
- The position of a mark equals the number key of the variant (`1` to `6`).
- More than 8 variants fold into counted marks, so the row width is constant.

Tradeoffs:

- 36 px rows: 12 rows in 28rem.
- A mark has a shape and a color but no number. The count is in the accessible name only, which stretches rule A09 (counts and text with color).
- A 14 px mark is a pointer convenience, not a real target. The row is the target.

### Spec

**Sketch**

```
│ Dialog with initial focus     ○○○○○○ │ 36 px row
│▌Combobox with a…virtual focus   ✓✓○= │ selected
│ Actions menu                    ✕✕== │
│ Tooltip                          ○○+ │
│ Toolbar with a pressed toggle    ✓○= │
│ Sortable data table              +++ │
│ Legacy installation page          −− │
│ Dialog with a form                == │
12 variants: ○○○○✓✓✓✓✕✕==      24 variants: ○5 ✓12 ✕1 =6
```

**Build**

- Base: `Nav render={<div aria-label='Screenshots' />}` in `Frame $border $rounded='xl' $p={1}`, `w-80`. Rows are `NavLink href='#'` with `aria-current='page'`. `glider={[{ $state: 'hover' }, {}, { $state: 'focus' }, { $kind: 'bar', $side: 'start' }]}`. Row padding `--nav-py: --spacing(2)`, `text-sm`.
- No start slot. `NavLinkLabel` as head (`truncate flex-1`) and tail (`flex-none`, last path segment or last 12 characters).
- End: `<span aria-hidden className='ms-auto flex items-center gap-px'>` with one 14 px mark for each variant in declared order, each in `Text $text={role}`.
- More than 8 variants: counted marks (mark and number, `text-xs tabular-nums`, `gap-1.5`) in the order Needs review, Approved, Rejected, Failed, Comparing, Unchanged.
- Each mark is a `TooltipAnchor` with `Firefox · Dark · Needs review`. Marks are not Tab stops.
- Marks: `Circle` warning, `Check` success, `X` danger, `Plus` success, `Minus` danger, `Equal` ink 50, `TriangleAlert` danger, `LoaderCircle` spinning.

**Copy**: no visible words. Accessible name: `{name}. 1 of 3 need review, 2 approved, 1 unchanged`.

**Behavior and keys**

- Click or Enter on the row selects the screenshot. A pointer click on one mark selects that variant: `session.select({ itemKey, variantKey })`.
- Up and Down move between rows. Left, Right, and `1` to `6` then follow the mark order.
- When a decision is saved, only that mark changes.

**Scenarios**

- mixed: as in the sketch.
- long-names: the name truncates first; the marks never truncate.
- problems: `TriangleAlert` and spinner marks in place; a row can read `○○!!`.
- large: 12 rows fit. Most rows read `=====` in ink 50, so the rows with work stand out.
- passed: all `Check`, `Plus`, `Minus`.
- states: as the base gliders.
- loading: skeleton name bar and a 5rem mark bar.
- narrow: `w-64`. More than 5 variants fold into counted marks.

## Variant `fingerprint`: Fingerprint

A tiny browser-by-scheme grid in each row shows which variants changed, so a pattern such as `only WebKit` shows while scanning the list.

Ideas:

- Columns are always Chromium, Firefox, WebKit. Rows are light, dark, then the other axes. 84% of real screenshots are exactly this 3 by 2 grid.
- The list becomes a heat map: one filled column down the list means that one browser regressed.
- A sticky header labels the three columns with the browser marks one time for the whole list.

Tradeoffs:

- A cell is 8 px, so color and fill carry the state. The row also prints the count, and the words are in the accessible name (rule A09 needs a decision).
- Sets that are not a browser-by-scheme grid add rows. More than four rows fold into `+n`.
- A new idea that is not in the audit. The reviewer must learn the grid.

### Spec

**Sketch**

```
│  C F W                               │ sticky header: chrome, firefox, safari marks, 12 px
│  ■ ■ ■  ariakit-ui-kbd/page/sizes  6 │ 44 px row, grid = 3 browsers x 2 schemes
│  ■ ■ ■                               │ ■ needs review (solid warning)
│▌ ▣ ■ □  …/page/…conditional-con…   1 │ ▣ approved (success tint)   □ unchanged (edge only)
│  ▣ □ □                               │
│  ▩ □ ·  Actions menu               2 │ ▩ rejected (solid danger)   · no variant
│  ▩ · ·                               │
```

**Build**

- Base: `Nav render={<div aria-label='Screenshots' />}` in `Frame $border $rounded='xl' $p={1}`, `w-80`. Rows are `NavLink href='#'` with `aria-current='page'`. `glider={[{ $state: 'hover' }, {}, { $state: 'focus' }, { $kind: 'bar', $side: 'start' }]}`. Fixed 44 px rows, `text-sm`.
- Header: `Frame $layer` (`sticky top-0`, `border-b`) with three 12 px browser icons from `src/fixtures/icons`, aligned with the grid columns, `aria-hidden`.
- Glyph (start of the row, `aria-hidden`): CSS grid `grid-cols-3 gap-0.5`, cells `size-2` `Frame $rounded='xs' $forceRounded`.
- Columns: `axes.browser` (chromium, firefox, webkit). Rows: the distinct combinations of framework, color scheme, contrast, and forced colors in declared order. At most 4 rows; then the last row is the text `+n` (`text-xs`).
- Cell fills: needs review `$layer='warning'`. Rejected `$layer='danger'`. Approved and auto-approved `$layer='success' $mix={40}`. Unchanged `$border $edgeWeight='light'`. Failed `$border $borderType='dashed' $edge='danger' $edgeRaw`. Comparing `$lightnessOffset={2}` with `animate-pulse`. A missing combination is an empty grid place.
- Then `NavLinkLabel` (head `truncate`, tail = last path segment) and `NavSlot $kind='badge'` with the count of variants that need review (rejected or failed count when none need review).
- Each cell is a `TooltipAnchor`: `WebKit · Dark · Rejected`.

**Copy**: the count only. Accessible name: `{name}. 1 of 6 need review. Chromium light approved, …` (list the variants that are not unchanged).

**Behavior and keys**

- Click or Enter selects the screenshot. A pointer click on a cell selects that variant.
- Up and Down move between rows.

**Scenarios**

- mixed: the fixture sets are irregular (for example Dialog has four rows with one cell in three of them). This shows the weak case.
- long-names: every row is a clean 3 by 2 grid. This shows the strong case.
- problems: dashed danger cells and pulsing cells.
- large: 10 rows fit. Rows whose cells are all edge-only recede.
- passed: all cells success tint.
- states: as the base gliders.
- loading: a pulsing 3 by 2 block and a name bar.
- narrow: `w-64`. The count hides; the glyph and the name stay.

## Variant `thumbnail`: Diff thumbnail

A 96 px crop of the first changed region with the diff tint makes the row show what changed.

Ideas:

- The thumbnail is a crop of the change at a readable scale, not the whole screenshot at 26 px.
- Variant marks and the largest change ratio are under the name.
- Added, removed, failed, and unchanged rows each have their own thumbnail treatment.

Tradeoffs:

- 72 px rows: 6 rows in 28rem. A run with 626 screenshots needs a filter first.
- The crop needs `regions` and `diffPreview` (not in the API today). The stored mask works as an overlay today, but it gives no crop.
- Replaces contract rule A11 (the thumbnail is the first declared candidate variant).
- One more image request for each row.

### Spec

**Sketch**

```
│ ┌──────────┐ Dialog with initial     │ 72 px row
│ │ ░░▓▓░░░░ │ focus                   │ crop around the first changed region
│ │ ░░▓▓░░░░ │ ○○○○○○           0.15%  │ marks + largest ratio
│ └──────────┘                         │
│ ┌──────────┐ Sortable data table     │
│ │ current +│ +++                     │ added: current image, `Plus` corner
│ └──────────┘                         │
```

**Build**

- Base: `Nav render={<div aria-label='Screenshots' />}` in `Frame $border $rounded='xl' $p={1}`, `w-80`. Rows are `NavLink href='#' $p={2}` with `aria-current='page'`. `glider={[{ $state: 'hover' }, {}, { $state: 'focus' }, { $kind: 'bar', $side: 'start' }]}`.
- Thumb: `Frame $darken $border $rounded='md'` with `w-24 aspect-[8/5] overflow-clip relative flex-none`. Inside, an absolutely positioned `img` of `diffPreview.url` (first variant that needs review, else the first changed variant). Scale it so that `regions[0]` takes about half of the thumb width, at most 2x and at least fit-to-width, and center the region. Compute the inline `width`, `left`, and `top` from the image size.
- `NavLinkContent`: `NavLinkLabel` with `line-clamp-2`, then `NavLinkDescription` as a flex row: variant marks (14 px, declared order, counted marks above 8) and `formatRatio(maxRatio)` with `ms-auto tabular-nums`.
- Treatments: added = current image fit to width and a `Badge $layer='success' $forceRounded` corner with `Plus`. Removed = baseline image at 50% opacity and a `Minus` corner. Failed or image error = centered `ImageOff` in ink 40. Unchanged = current image fit, row in ink 60, no ratio. Size changed = the text `Size changed` in place of the ratio.
- Marks: `Circle` warning, `Check` success, `X` danger, `Plus` success, `Minus` danger, `Equal` ink 50, `TriangleAlert` danger, `LoaderCircle` spinning.

**Copy**: the ratio only (`0.15%`), or `Size changed`. Accessible name: `{name}. 6 need review. Largest change 0.15%`.

**Behavior and keys**

- Click or Enter selects the screenshot. Up and Down move between rows.
- The image loads lazily and fades in over the pulse placeholder. The row height never changes.

**Scenarios**

- mixed: crops for changed rows; added, removed, and unchanged treatments.
- long-names: the name wraps to two lines, then truncates with the tail kept.
- problems: `ImageOff` thumbs; the broken image row falls back to the baseline crop.
- large: 6 rows fit.
- passed: crops stay; marks are all final.
- states: as the base gliders; the thumb keeps its edge on the selected fill.
- loading: a pulsing thumb frame and two text bars.
- narrow: `w-64`, thumb `w-16`; the ratio hides.

## Variant `tree`: Tree

The selected screenshot opens into its variants, so the list is also the variant switcher.

Ideas:

- Each variant is a list row with its mark, the parts of its label that differ, and its number key.
- Only the selected screenshot is open. Closed rows show folded variant marks.
- The horizontal variant strip and its hidden selection go away.

Tradeoffs:

- Couples two picks: with this row, the variant switcher is not necessary on a wide screen.
- An open screenshot takes 32 px plus 28 px for each variant. Twelve variants push the next screenshots off screen.
- Vertical variant rows suggest Up and Down, but the keys stay Left and Right (decisions U04 and K5).

### Spec

**Sketch**

```
│ ▸ Dialog with initial focus   ○○○○○○ │ 32 px, closed: folded marks
│ ▾ Combobox with a…virtual focus    1 │ open = selected screenshot
│     ✓ Chromium · Light             1 │ 28 px variant row, number key
│     ✓ Chromium · Dark              2 │
│   ▌ ○ Firefox · Light              3 │ selected variant
│     = WebKit · Light               4 │
│ ▸ Actions menu                  ✕✕== │
│ ▸ Tooltip                        ○○+ │
```

**Build**

- Base: `Nav aria-label='Screenshots'` in `Frame $border $rounded='xl' $p={1}`, `w-80`, `glider={[{ $state: 'hover' }, {}, { $state: 'focus' }, { $kind: 'bar', $side: 'start' }]}`.
- Each screenshot: `NavDisclosure` with `open` equal to `item.key === session.item?.key` and `button={<NavDisclosureButton>…</NavDisclosureButton>}`. The button has the name (head `truncate`, tail kept) and at the end either the folded marks (closed) or a `NavSlot $kind='badge'` count of variants that need review (open).
- Children: `NavList` of `NavLink href='#'` rows (`text-sm`, 28 px) with `aria-current='page'` on the selected variant: a start `NavSlot` mark, `NavLinkLabel` with the parts that differ inside this screenshot (`Chromium · Dark`; print the full label when nothing differs), and an end `NavSlot $kind='shortcut'` with the position for the first six.
- Marks: `Circle` warning, `Check` success, `X` danger, `Plus` success, `Minus` danger, `Equal` ink 50, `TriangleAlert` danger, `LoaderCircle` spinning.

**Copy**: variant labels of one to three words. Rare axes as words: `Forced colors`, `More contrast`. Accessible name of a variant row: `Firefox, Light. Needs review`.

**Behavior and keys**

- Up and Down select the previous or next screenshot and open it (the old one closes). Left, Right, and `1` to `6` select a variant. A click on a closed row selects its remembered variant.
- The opened group scrolls into view with `block: 'nearest'`.

**Scenarios**

- mixed: the second screenshot is open with four variant rows.
- long-names: the open screenshot shows six rows `Chromium · Light` to `WebKit · Dark`.
- problems: variant rows with `TriangleAlert` and the spinner; a failed variant row shows no key hint change.
- large: 13 closed rows fit, or 8 with one open screenshot.
- passed: one open screenshot with all `Check` rows.
- states: closed rest, closed hover, focused variant row, selected variant row.
- loading: skeleton rows; no chevrons.
- narrow: `w-64`; labels drop the browser word when only the scheme differs.

## Variant `families`: Families

Rows are grouped by the first path segment, and each row prints only the rest of the path.

Ideas:

- The shared prefix (`ariakit-ui-combobox`) is printed one time, as a sticky group label with the count that is left.
- Rows become short: `page/select-content`, in the mono font.
- A family with nothing left folds to one line.

Tradeoffs:

- Adds headers to the declared order (rule A12, decision D29). The order inside a family does not change.
- Display names such as `Dialog with initial focus` move to the tooltip. In production the name is the key already.
- A family with one screenshot gets no header, so the `changes` fixture looks flat. The `large` scenario shows the idea.
- Arrow keys must open a folded family when they enter it.

### Spec

**Sketch**

```
│ ariakit-ui-combobox               8 │ sticky family label, 28 px, count left
│  ▌○ page/…conditional-content     2 │ 28 px row, mono, selected
│   ○ narrow-list/popover-with-l…   6 │
│ ariakit-ui-list                   ✕ │
│   ✕ forced-colors/page/list-di…   1 │
│ ▸ ariakit-ui-button               ✓ │ folded: nothing left
│   ○ ariakit-tailwind-7466/appli…  3 │ one screenshot in its family: no header, full key
```

**Build**

- Base: `Nav list={false} aria-label='Screenshots'` in `Frame $border $rounded='xl' $p={1}`, `w-80`, `glider={[{ $state: 'hover' }, {}, { $state: 'focus' }, { $kind: 'bar', $side: 'start' }]}`.
- Group by the first segment of `item.key`. A family with two or more screenshots is a `NavDisclosure` (`defaultOpen` when the family has a variant that needs review, is rejected, or failed): `NavDisclosureButton` with the family name (`text-xs font-medium ak-ink-70`, `sticky top-0` on a `$layer` surface) and an end slot: the count that needs review, or the final mark.
- Rows: `NavLink href='#'` with a start mark `NavSlot`, `NavLinkLabel className='font-mono text-xs'` with the key without the family (head `truncate`, last segment kept), and an end `NavSlot $kind='badge'` count.
- A family with one screenshot renders as a plain row with the full key.
- The row is a `TooltipAnchor` with the display name and the full key.
- Marks: `Circle` warning, `Check` success, `X` danger, `Plus` success, `Minus` danger, `Equal` ink 50, `TriangleAlert` danger, `LoaderCircle` spinning.

**Copy**: family names and keys only. Accessible name of a label: `ariakit-ui-combobox, 8 need review`.

**Behavior and keys**

- Click or Enter on a label folds or opens the family. Up and Down move through rows and open a folded family on entry.
- The label of the family of the selected row stays sticky while the family scrolls.

**Scenarios**

- mixed: twelve families of one, so a flat list of full keys in mono (`dialog/focus/open`).
- long-names: as in the sketch.
- problems: a family label shows `TriangleAlert` when a variant failed.
- large: families `button`, `checkbox`, `combobox` with six rows each; families with nothing left are folded. About 14 lines fit.
- passed: flat list, all final marks.
- states: label rest and hover, row focus, row selected.
- loading: two label bars and six row bars.
- narrow: `w-64`; middle segments collapse to `…`.
