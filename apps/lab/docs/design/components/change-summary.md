# Change summary (change-summary)

Group: viewer
Question: How much does the viewer say about the size and the place of a change?
Description: The facts about one comparison: changed pixels, ratio, changed regions, and size.
Layout: row

## Scenarios

- `tiny` (One small region): A 640 x 400 image with one 18 px region (scene checkbox).
- `several` (Five regions): A 1280 x 720 page with five regions (scene page).
- `large` (Large change): A tall form where most of the image changed (scene form).
- `size-changed` (Size changed): 640 x 400 became 640 x 422; the ratio is 100% and says nothing (scene disclosure).
- `added` (Added): No baseline, so no number exists (scene tooltip, 320 x 120).
- `tolerated` (Within tolerance): 3 changed pixels of 256,000, which is 0.001% (lab only: fixed numbers).
- `many` (Many regions): 23 regions and 1,840 px, as a noisy mask gives (lab only: fixed numbers on scene table).
- `comparing` (Comparing): The comparison is not done, so no number exists.

## Variant `one-line`: One line (minimal)

One quiet line of at most three facts, with the fact that matters for the state first.

Ideas:

- The format `0.13% · 324 px · 1 region` in place of `0.13% changed · 324 changed pixels`.
- A size change shows the two sizes and the delta, not `100%`.
- No `0.00%`, no `1 changed pixels`, and no dash for a missing number.

Tradeoffs:

- Numbers only: they tell how much, not where.
- The region count needs `regions` (not in the API today); without it the line has two facts.
- `px` and `%` without the word 'changed' depend on the context of the viewer.

### Spec

**Words at rest: 1 to 3.**

```text
 0.13% · 324 px · 1 region
```

**Build**

- Cell: `w-90`, no surface.
- One `Text` with `text-sm tabular-nums ak-ink-70`. The separators are middle dots in `ak-ink-40`. The first fact is in full ink with `font-medium`.
- The first fact has a `Tooltip` with the exact ratio (four decimals) and the tolerance sentence of the variant (`threshold`).
- The line has an `aria-label` with the facts in words: `0.13 percent changed, 324 pixels, 1 region`.

**Format**: `formatRatio`; below 0.01% write `< 0.01%`; pixels with a thousands separator and `px`; `1 region`, `5 regions`. The numbers come from the fixture set (`ratio`, `changedPixels`, `regions`); the examples below show the format.

**Copy by scenario**

- tiny: `0.13% · 324 px · 1 region`
- several: `0.42% · 3,870 px · 5 regions`
- large: `38% · 486,400 px · 1 region`
- size-changed: `640 × 400 → 640 × 422 · +22 px`
- added: `Added · 320 × 120`
- tolerated: `< 0.01% · 3 px · within tolerance`
- many: `0.2% · 1,840 px · 23 regions`
- comparing: `Comparing`

## Variant `fact-chips`: Fact chips

Each fact is a small chip with an icon, and the region chip is a button that goes to the first region.

Ideas:

- Each fact has its own shape, so the eye finds the same fact in the same place.
- The region chip is the jump control, so the summary and the navigation are one part.
- Color only tells the kind of the variant (added, size changed), never the size of a change.

Tradeoffs:

- Four boxed chips are heavier than one line and can look like status badges.
- More ink for the same facts.
- The region chip needs `regions` (not in the API today).

### Spec

**Words at rest: 1 to 2.**

```text
 (◔ 0.13%) (▦ 324 px) (⌖ 1 region) (⤢ 640 × 400)
```

**Build**

- Cell: `w-90`, no surface. A `div` with `flex flex-wrap gap-1.5`.
- Fact chip: `Badge $forceRounded` with a `BadgeSlot` icon (`Percent`, `Grid2x2`, `Scaling`) and a `BadgeLabel` with `tabular-nums`. Neutral.
- Region chip: `Button $border $size='xs' $rounded='full'` with a `Crosshair` slot and a `ButtonLabel`; `aria-label='Go to region 1 of 5'`; `Tooltip` with a `Kbd` `C`.
- Kind chips: `Badge $layer='success' $forceRounded` `Added`; `Badge $layer='warning' $forceRounded` for the size change.

**Format**: as in One line.

**Copy by scenario**

- tiny: `0.13%`, `324 px`, `1 region`, `640 × 400`
- several: `0.42%`, `3,870 px`, `5 regions`, `1280 × 720`
- large: `38%`, `486,400 px`, `1 region`, `800 × 1600`; the ratio chip has `$lightnessOffset={3}` from 10%
- size-changed: `640 × 400 → 640 × 422` and `+22 px`, both in `warning`
- added: `Added`, `320 × 120`
- tolerated: `< 0.01%`, `3 px`, and a chip with a `Check` slot: `Within tolerance`
- many: `0.2%`, `1,840 px`, `23 regions`, `1280 × 720`
- comparing: one chip with a `ProgressCircular` slot: `Comparing`

## Variant `region-list`: Region list

The one-line summary opens a small table with one row for each region: a crop, its size, and its place; a row goes to the region.

Ideas:

- An overview for an image with many regions, and a simple way for a keyboard user to move between them.
- Each row has a crop of the region, so the list is a preview.
- Closed by default: the cost at rest is the one line.

Tradeoffs:

- Open, it is the most text and the most height of this surface.
- Coordinates are numbers that few reviews need.
- Needs `regions` (not in the API today), and the image for the crops.
- A noisy mask gives a long list; it stops at 8 rows.

### Spec

**Words at rest: 1 to 3 closed; 2 column heads more when open.**

```text
 ▾ 0.42% · 3,870 px · 5 regions
 ┌───┬──────┬───────────┬───────────┐
 │ # │      │ Size      │ At        │
 │ 1 │ [▫]  │ 132 × 22  │ 262, 121  │
 │ 2 │ [▫]  │ 208 × 32  │ 20, 150   │
 │ 3 │ [▫]  │ 96 × 24   │ 540, 318  │
 └───┴──────┴───────────┴───────────┘
```

**Build**

- Cell: `w-90`, no surface.
- `Disclosure` whose `button` is a `DisclosureButton` with `indicator='chevron-right-start'` and the One line text; closed by default.
- Content: `Table` with `role='grid'`, `aria-label='Changed regions'`, `container={{ $border: true }}`, `$borderInline={false}`, `$p={2}`, `className='text-sm'`. Columns: `#` (`$fit`), the crop (`$fit`, no head text), `Size` (`numeric`), `At` (`numeric`).
- Crop cell: `Frame $border $rounded='none' $forceRounded` with `overflow-clip`, 2.5rem by 1.75rem; the current image moved and scaled so that the region fills the box.
- Row: `TableRow selected` for the region in view. The `#` cell holds a `Button $size='xs'` with `aria-label='Go to region 3'`.
- More than 8 rows: a `Button $size='sm'` `Show 15 more` under the table.

**Copy**: `Size`, `At`, `Show 15 more`, `Baseline`, `Current`.

**Behavior and keys**

- A click on a row, or `C` / `Shift+C` in the viewer, goes to the region and marks the row.
- The open state is stored.

**Scenarios** (show each cell open, except where no list exists)

- tiny: the line and one row.
- several: five rows.
- large: one row; the crop shows the whole region.
- size-changed: the line `640 × 400 → 640 × 422 · +22 px`; open: two rows, `Baseline` `640 × 400` and `Current` `640 × 422`.
- added: the line only, with no disclosure arrow.
- tolerated: the line only (no mask exists for a tolerated pair).
- many: 8 rows and `Show 15 more`.
- comparing: `Comparing`, with no disclosure arrow.

## Variant `magnitude-glyph`: Magnitude glyph (new)

No words: five bars show how much changed on a log scale, and a tiny map of the image shows where.

Ideas:

- A reviewer reads 'small, lower left' in a glance; the numbers are in the tooltip.
- The same glyph can stand in a list row or on a variant chip, so the list and the viewer speak one language.
- A log scale tells 0.01% from 1% from 10%, which a percent with two decimals does not.
- Not in the audit lanes.

Tradeoffs:

- A symbol that the reviewer must learn; no text at rest (rule A09 asks for text with color; the accessible name and the tooltip have it).
- The size of a change is not its importance: a 1 px regression can be the bug.
- The map needs `regions` (not in the API today), or the mask at first paint (reopens P02).
- Five steps hide the exact number.

### Spec

**Words at rest: 0.**

```text
 ▂▃▅▁▁  ┌──────────┐
        │  ·       │      bars: how much (5 steps)     map: where
        │       ·  │
        └──────────┘
```

**Build**

- Cell: `w-90`, no surface. A `div` with `flex items-end gap-3`, `role='img'`, and `aria-label='0.13 percent changed, 324 pixels, 1 region, left'`. One `Tooltip` on it with the One line text.
- Bars: five `Frame $rounded='xs'` bars in `flex items-end gap-0.5`, each `w-1`, with heights `h-1`, `h-2`, `h-3`, `h-4`, `h-5`. Filled bars: `$layer='brand'`. Empty bars: `$lightnessOffset={3}`. Steps by ratio: under 0.01%, under 0.1%, under 1%, under 10%, 10% or more.
- Map: `Frame $border $rounded='none'`, `w-14`, with the shape of the image (at most `h-16`), and one `Layer $layer='danger'` rect for each region, at least 0.1875rem on each side.

**Copy**: the tooltip text of One line; `+22 px`, `Added`, `Comparing`.

**Scenarios**

- tiny: 3 bars; one dot at the left.
- several: 3 bars; five dots.
- large: 5 bars; one rect over most of a tall map.
- size-changed: in place of the bars, the icon `MoveVertical` and `Text $text='warning'` `text-xs` `+22 px`; the map has a hatched band at the bottom.
- added: in place of the bars, `Badge $layer='success' $forceRounded` `Added`; the map is a filled outline (`$lightnessOffset={3}`).
- tolerated: 1 bar, drawn as an outline only (`$border`, no fill); an empty map.
- many: 3 bars; 23 dots.
- comparing: the bars pulse (`animate-pulse`); an empty map; `Text` `ak-ink-60 text-xs` `Comparing`.

## Variant `plain-sentence`: Plain sentence (new)

One short sentence that a person would say, made from the facts: how many regions, how large, and where; the numbers are in a tooltip.

Ideas:

- `5 small regions, spread out` tells more than `0.42% · 3,870 px`.
- The quiet option for a reviewer who does not want numbers.
- The place words come from a 3 by 3 grid over the image.
- Not in the audit lanes: they shortened the numbers and did not replace them.

Tradeoffs:

- Words where numbers were: against the word budget, though each sentence has at most five words.
- The tool judges 'small' and 'large' for the reviewer, and a rule can be wrong for a case.
- Needs `regions` (not in the API today), or the mask at first paint (reopens P02).
- The rules need tests, and the words need care in each change.

### Spec

**Words at rest: 1 to 5.**

```text
 5 small regions, spread out
```

**Build**

- Cell: `w-90`, no surface.
- One `Text` with `text-sm`. A `Tooltip` on it gives the numbers (the One line text).

**Rules**

- Count: the number of regions.
- Size word, from the longer side of the largest region in image px: `tiny` (under 16), `small` (under 96), `large` (96 or more). A region over 40% of the image: `Most of the image changed`.
- Place, from a 3 by 3 grid over the image: `top left`, `top`, `top right`, `left`, `center`, `right`, `bottom left`, `bottom`, `bottom right`. Regions in more than two cells: `spread out`.
- No sentence ends with a period.

**Copy by scenario**

- tiny: `1 small region, left`
- several: `5 small regions, spread out`
- large: `Most of the image changed`
- size-changed: `22 px taller`
- added: `Added`
- tolerated: `No visible change`
- many: `23 small regions, spread out`
- comparing: `Comparing`
