# Variant switcher (variant-switcher)

Group: workspace
Question: Which control should switch between the variants of one screenshot?
Description: The control that shows every variant of the selected screenshot with its verdict mark and selects one.
Layout: stack

## Scenarios

- `six` (Six variants): The common production shape, Chromium, Firefox, WebKit by Light, Dark: one approved, three need review (Firefox · Light is selected), one rejected, one unchanged.
- `one` (One variant): A screenshot with one variant: there is nothing to switch.
- `twelve` (Twelve variants): Three browsers by two schemes, with and without forced colors: five need review and Firefox · Dark · Forced colors is selected.
- `twenty-four` (Twenty-four variants): React and Solid, three browsers, two schemes, default and more contrast: five need review and nineteen are unchanged.
- `irregular` (Irregular set): The six variants of `dialog/focus/open` in the `changes` run, which do not form a full grid (one Solid variant and one forced colors variant).
- `states` (Every state): Six variants that show needs review, approved by @morikenji, added (auto-approved), failed (selected), comparing, and unchanged.
- `read-only` (Read-only): The `six` set in a run that a newer run replaced: the marks are final and a variant can still be selected.
- `narrow` (Narrow): The `six` set in a container 390 px wide with a coarse pointer.

## Variant `link-strip`: Link strip

Navigation links with a bar glider, a verdict mark, a label of the parts that differ, and the number key; the strip wraps and never scrolls.

Ideas:

- It keeps the approved rule (variant links with a bar glider, contract:192) and repairs it: marks, short labels, wrap.
- The full label of the selected variant is printed one time above the strip (rule A07).
- Above 8 variants, the unchanged ones fold into one `unchanged` button.

Tradeoffs:

- Two words for each variant: six variants need about 52rem on one line, and three lines at 390 px.
- Folding unchanged variants hides them one click away.
- The least new of the options.

### Spec

**Sketch**

```
React · Firefox · Light — Needs review                              label line, one time
[✓ Chromium · Light 1] [○ Chromium · Dark 2] [○ Firefox · Light 3] [○ Firefox · Dark 4]
                                              ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ bar glider
[✕ WebKit · Light 5] [= WebKit · Dark 6]                             wraps, never scrolls
24 variants: the 5 that need review, then [= 19 unchanged ▾]
```

**Build**

- Label line: `Text className='text-sm'` with the full label (`variant.name`, plus `Forced colors` or `More contrast` when set), an em dash, and the status word in `Text $text={role}`. The raw variant key is in a `Tooltip` on the label.
- Strip: `Nav aria-label='Variants' $layout='horizontal' className='flex-wrap'` with `glider={[{ $state: 'hover' }, { $kind: 'bar', $side: 'end' }, { $state: 'focus' }]}`.
- Each variant: `NavLink href='#'` (`aria-current='page'` when selected, `text-sm`) with a `NavSlot` mark, `NavLinkLabel` with the parts that differ inside this screenshot joined by `·` (the full label when nothing differs), and `NavSlot $kind='shortcut'` with the position on the first six.
- One Tab stop: `ak.CompositeProvider`, `ak.Composite render={<Nav … />}`, and `ak.CompositeItem render={<NavLink … />}`. Left and Right inside the strip call `preventDefault`, so the page keys do not run two times.
- Fold: with more than 8 variants, the variants whose status is Unchanged leave the strip. A trailing `PopoverDisclosure $size='sm'` reads `= 19 unchanged` and its `Popover portal` lists them as the same links.
- Marks: `Circle` warning, `Check` success, `X` danger, `Plus` success, `Minus` danger, `Equal` ink 50, `TriangleAlert` danger, `LoaderCircle` spinning. Each mark has an `aria-label` with the status word.

**Copy**: at most three words for each variant. `19 unchanged`. Accessible name of a link: `Firefox, Light. Needs review`.

**Behavior and keys**

- Click or Enter selects. Left and Right select the previous or next variant in declared order and stop at the ends. `1` to `6` select by position.
- After a pointer click, `A`, `X`, and the mode keys still work.
- With one variant, render only the label line.

**Scenarios**

- six: one line of six links at the full width.
- one: the label line only.
- twelve: two lines of six; the third label part is `Forced colors`.
- twenty-four: five links and `= 19 unchanged`.
- irregular: labels such as `Solid · Chromium · Light` only where the framework differs; the others drop the framework.
- states: `TriangleAlert` on the selected link; the label line reads `— Failed`.
- read-only: the same; key hints stay because selecting still works.
- narrow: three lines of two; no key hints; links at least 44 px high.

## Variant `matrix`: Matrix

A grid with the browsers as columns and the schemes as rows, where each cell is a verdict mark that selects the variant.

Ideas:

- The grid mirrors how variants are defined. A pattern such as `only WebKit changed` shows at once.
- No label repeats: `Firefox` and `Dark` are printed one time, as headers.
- It scales by rows: forced colors, contrast, and framework add rows, not width.

Tradeoffs:

- It is two or more rows high (about 5rem for six variants), so it does not fit a 44 px toolbar. It needs a taller slot or a popover.
- Replaces the variant links of contract:192 (decision U03) with a radio grid.
- Left and Right follow the declared order, which can differ from the visual order. Up and Down stay screenshot keys (U04).
- A set that is not a grid has empty cells.

### Spec

**Sketch**

```
            C Chromium   F Firefox   W WebKit
sun  Light    [ ✓ ]1       [▣○ ]3      [ ✕ ]5      ▣ = selected cell (inverted)
moon Dark     [ ○ ]2       [ ○ ]4      [ = ]6
React · Firefox · Light — Needs review
```

**Build**

- Wrapper: `Frame $border $rounded='xl' $p={2}` with `inline-grid gap-1 items-center`, and columns `auto repeat(3, 2.5rem)`.
- Column headers: the browser icon (`src/fixtures/icons`, 14 px) and a word in `text-xs ak-ink-70`. The word hides under a container width of 30rem. Row headers: `Sun` or `Moon` and the word; other axes are added as words (`Dark · Forced colors`). Headers are `aria-hidden`.
- Cells: `ak.RadioProvider` and `ak.RadioGroup aria-label='Variants'` with `display: contents`. Each cell is `ak.Radio render={<Button $size='sm' $rounded='md' />}` with the mark in a `ButtonSlot` and a corner number (`text-[0.625rem]` is too small: use a `ButtonSlot $kind='shortcut'` after the mark, for the first six only).
- Selected look from state: `$invert` on the selected cell. Other cells: `$lightnessOffset`.
- Rows: the distinct combinations of color scheme, forced colors, contrast, and framework in declared order. With two frameworks, add a row group label (`React`, `Solid`) in `text-xs ak-ink-60`.
- A combination that does not exist is a `Text` middle dot in ink 30. It is not focusable.
- Under the grid: the label line (`Text className='text-sm'`): the full label, an em dash, and the status word in `Text $text={role}`.
- Each cell is a `TooltipAnchor` with the full label, the status, and the key.

**Copy**: header words only (`Chromium`, `Firefox`, `WebKit`, `Light`, `Dark`, `Forced colors`, `More contrast`, `React`, `Solid`). Accessible name of a cell: `Firefox, Light. Needs review`.

**Behavior and keys**

- Click selects. The group is one Tab stop; Left and Right inside it move in declared order and call `preventDefault`. `1` to `6` select by position. Up and Down are not handled here.
- With one variant, render only the label line.

**Scenarios**

- six: a 3 by 2 grid.
- one: the label line only.
- twelve: four rows (`Light`, `Dark`, `Light · Forced colors`, `Dark · Forced colors`).
- twenty-four: two row groups (`React`, `Solid`) of four rows each. This is the tall case, about 17rem.
- irregular: four rows with dots: `Light` has three cells; `Dark`, `Solid · Light`, and `Light · Forced colors` have one cell each.
- states: the failed cell is selected; the comparing cell spins.
- read-only: the same.
- narrow: header words hide; cells grow to 44 px.

## Variant `axis-segments`: Axis controls

One segmented control for each axis that varies; the chosen values together select the variant.

Ideas:

- It answers the real question in two clicks: which browser, which scheme.
- Each browser segment carries the marks of its variants, so all verdicts stay visible.
- Axes that do not vary inside the screenshot do not render.

Tradeoffs:

- Replaces the variant links of contract:192 (decision U03).
- With four axes, a browser segment holds up to eight marks. They fold into counted marks.
- An irregular set has disabled segments, and a choice can jump to the nearest variant that exists.
- The number keys no longer match a visible position, so the position shows only in the label line.

### Spec

**Sketch**

```
[C Chromium ✓○] [F Firefox ○○] [W WebKit ✕=]      [sun Light] [moon Dark •]
 ▔▔▔▔▔▔▔▔▔▔▔▔▔▔ glider on Firefox                  ▔▔▔▔▔▔▔▔▔▔ glider on Light
React · Firefox · Light — Needs review · 3 of 6
12 variants add:   [Default] [Forced colors •]
```

**Build**

- A `flex flex-wrap items-center gap-3` row of segmented controls, then the label line.
- Each axis: `ak.RadioProvider` and `ak.RadioGroup aria-label='Browser' render={<ButtonGroup $border $size='sm' />}` with `ak.Radio render={<Button />}` segments, `<ButtonGlider $kind='bevel' />`, and `<ButtonGlider $state='focus' />` (see the recipe `Segmented control`).
- Browser segments: the browser icon, a `ButtonLabel`, and then the marks of the variants of that browser across the other chosen axes, in declared order (`aria-hidden`, 12 px, `gap-px`). More than 4 marks: counted marks.
- The other axes (`Scheme`, `Colors`, `Contrast`, `Framework`): an icon or a word, and a 6 px dot (`Frame $layer='warning' $rounded='full' $forceRounded className='size-1.5'`) when a variant with that value needs review. The dot has the `aria-label` `has variants that need review`.
- Render an axis only when it has two or more values in this screenshot. Order: Browser, Scheme, Colors, Contrast, Framework.
- A value that has no variant with the other chosen values is `disabled`.
- Label line: the full label, an em dash, the status word in `Text $text={role}`, and the position `3 of 6` in ink 60.

**Copy**: `Chromium`, `Firefox`, `WebKit`, `Light`, `Dark`, `Default`, `Forced colors`, `More contrast`, `React`, `Solid`. Group names are in `aria-label` only.

**Behavior and keys**

- A click on a value keeps the other axes and selects the matching variant. If none matches, select the nearest variant in declared order with that value.
- Left, Right, and `1` to `6` select in declared order; the segments follow.
- Each group is one Tab stop.
- With one variant, render only the label line.

**Scenarios**

- six: Browser and Scheme.
- one: the label line only.
- twelve: Browser, Scheme, and Colors, with `Forced colors` selected.
- twenty-four: Browser, Scheme, Contrast, and Framework; browser segments show counted marks.
- irregular: Browser, Scheme, Colors, and Framework, with several disabled values. This is the weak case.
- states: the Chromium segment shows `○✓`, Firefox `+!`, WebKit `◌=` (use the fixture order).
- read-only: the same.
- narrow: the groups stack in two rows; browser words hide; segments at least 44 px high.

## Variant `stepper`: Stepper with a list

A fixed-width control: previous, the selected variant with its position, next, and a list that opens on request.

Ideas:

- A constant width for 2 or 24 variants. It always names the selected variant.
- A row of marks beside it shows every verdict and where the selection is.
- The best fit for a phone and for a one-row toolbar.

Tradeoffs:

- The labels of the other variants are hidden until the list opens.
- A jump to a far variant takes two clicks or a number key.
- Replaces the variant links of contract:192 (decision U03) with a select.

### Spec

**Sketch**

```
[‹] [ ○ Firefox · Light        3 / 6 ▾ ] [›]     ✓○◉○✕=    marks: the selected one has a ring
list (opens from the middle button):
   ✓ Chromium · Light          1
   ○ Chromium · Dark           2
 ▌ ○ Firefox · Light           3
   ○ Firefox · Dark            4
   ✕ WebKit · Light            5
   = WebKit · Dark             6
```

**Build**

- `ButtonGroup $border aria-label='Variant'` with three parts. Previous: a `Button aria-label='Previous variant'` with `ChevronLeft`, wrapped as a `TooltipAnchor` (`Previous variant` and `<Kbd>←</Kbd>`). Middle: `ComboboxProvider` with the selected variant key, and `ComboboxSelect $layer='transparent' chevron='after' className='w-64 justify-start'` that shows the mark, the label of the parts that differ, and `3 / 6` in `ms-auto tabular-nums ak-ink-60`. Next: the mirror of Previous with `ChevronRight` and `→`.
- `ComboboxPopover unmountOnHide` with one `ComboboxItem` for each variant: a `ComboboxItemSlot` mark, `ComboboxItemLabel`, and a `ComboboxItemSlot $kind='shortcut'` position for the first six.
- Marks pager beside the group (`aria-hidden`, hidden under a container width of 28rem): one 14 px mark for each variant; the selected one sits in a `Frame $border $rounded='full' $forceRounded`. More than 12 variants: counted marks.
- The full label is the `Tooltip` of the middle button. The middle button text is the full label when the screenshot has no differing parts.

**Copy**: `3 / 6`. Accessible name of the middle button: `Variant: React, Firefox, Light. Needs review. 3 of 6`.

**Behavior and keys**

- Previous and Next stop at the ends (the button is `disabled` there). Left, Right, and `1` to `6` work from anywhere on the page.
- The list opens with a click, Enter, or Down on the middle button. Typing in the open list moves to a matching variant.
- With one variant, render the label as plain text: no group.

**Scenarios**

- six: as in the sketch.
- one: plain text `React · Chromium · Light — Needs review`.
- twelve: `11 / 12`; the pager shows 12 marks.
- twenty-four: `3 / 24`; the pager shows `○5 =19`.
- irregular: labels include the framework or `Forced colors` only where they differ.
- states: the middle button shows `TriangleAlert` and `Firefox · Dark`.
- read-only: the same.
- narrow: the group takes the full width; the pager hides; buttons are 44 px high.

## Variant `thumb-strip`: Thumbnail strip

Each variant is a small picture of its current image with a mark, so light, dark, and forced colors are told apart by sight.

Ideas:

- The reviewer recognizes a variant by its picture, not by reading a label.
- The diff mask glows on each thumbnail, so the variant with the largest change shows before it is opened.
- The selected thumbnail always scrolls into view.

Tradeoffs:

- The strip is about 4.5rem high.
- Browsers look almost the same in a thumbnail, so each one still needs its browser mark.
- One more image for each variant (the thumbnail image exists in the API; the mask overlay loads the diff early, which touches decision P02).
- Replaces the variant links of contract:192 (decision U03).

### Spec

**Sketch**

```
┌─────┐ ┌─────┐ ┏━━━━━┓ ┌─────┐ ┌─────┐ ┌─────┐
│light│ │dark │ ┃light┃ │dark │ │light│ │dark │   current image, 5rem x 3.125rem
│ ▓   │ │ ▓   │ ┃ ▓   ┃ │ ▓   │ │ ▓   │ │     │   ▓ = diff mask at 60%
└─────┘ └─────┘ ┗━━━━━┛ └─────┘ └─────┘ └─────┘
 ✓ C 1   ○ C 2   ○ F 3   ○ F 4   ✕ W 5   = W 6    mark, browser mark, key
React · Firefox · Light — Needs review
```

**Build**

- `ak.RadioProvider` and `ak.RadioGroup aria-label='Variants' className='flex gap-1.5 overflow-x-auto scroll-smooth'` (one Tab stop).
- Each variant: `ak.Radio render={<Button $p={1} $rounded='lg' className='flex-col gap-1 flex-none' />}`. Inside: `Frame $darken $rounded='sm' className='relative w-20 aspect-[8/5] overflow-clip'` with an `img` (`candidate?.url ?? reference?.url`, `object-cover object-top`) and, for a changed variant, the `diff` image on top (`absolute inset-0`, 60% opacity). Then a caption row (`flex items-center gap-1 text-xs`): the mark, the browser icon (12 px), and the position in ink 60.
- Selected look from state: `$border={2} $edge='brand' $edgeRaw` on the selected button; `$border $edgeWeight='light'` on the others.
- No image (failed, comparing, expired): a centered icon (`ImageOff`, `LoaderCircle`) in ink 40.
- Removed: the baseline image at 50% opacity. Added: no mask.
- Overflow: edge fades with a `mask-image` gradient, and a `Badge $forceRounded` count (`24`) at the end.
- Label line under the strip: the full label, an em dash, and the status word.
- Each thumbnail is a `TooltipAnchor` with the full label and the status.

**Copy**: no words in the strip. Accessible name: `Firefox, Light. Needs review`.

**Behavior and keys**

- Click selects. Left, Right, and `1` to `6` select in declared order. On every selection change, call `scrollIntoView({ inline: 'nearest', block: 'nearest' })` on the selected thumbnail.
- With one variant, render only the label line.

**Scenarios**

- six: six thumbnails, no scroll.
- one: the label line only.
- twelve: twelve thumbnails; they fit from 68rem, else the strip scrolls with fades.
- twenty-four: the strip scrolls; the count badge reads `24`; the selected thumbnail is in view.
- irregular: the Solid and forced colors thumbnails are visibly different pictures (forced colors palette).
- states: `ImageOff` on the failed one (selected), a spinner on the comparing one, no mask on the added one.
- read-only: the same.
- narrow: thumbnails `w-16`; the strip scrolls with snap (`snap-x`); no key numbers.

## Variant `change-groups`: Change groups

Variants are grouped by an equal diff: `Same change` first, then the ones that differ, then the unchanged ones.

Ideas:

- A visual change usually hits all variants in the same way. The group says so, and the outlier stands alone.
- After one look at a group, the reviewer knows what the whole-screenshot decision covers.
- Chips are compact: browser mark, scheme icon, verdict mark.

Tradeoffs:

- Needs a diff fingerprint from the backend (not in the API today). The lab compares `regions`, which are also not in the API today.
- The visual order is no longer the declared order. The number keys keep the declared positions, which are printed on the chips.
- It can invite the approval of variants that were not opened (the concern of decision D02). The scope of a decision does not change.
- Replaces the variant links of contract:192 (decision U03). A new idea that is not in the audit.

### Spec

**Sketch**

```
Same change  [○ C sun 1][○ C moon 2][▣○ F sun 3][○ F moon 4]    Differs  [✕ W sun 5]    Unchanged  [= W moon 6]
React · Firefox · Light — Needs review · same change as 3 others
```

**Build**

- A `flex flex-wrap items-center gap-x-4 gap-y-2` row of groups, then the label line.
- Group: `TextFrame $p={1} $ink={60} className='text-xs'` label, then `ak.Radio render={<Button $size='sm' $rounded='md' />}` chips. All chips belong to one `ak.RadioGroup aria-label='Variants'` (one Tab stop).
- Chip: a mark `ButtonSlot`, the browser icon (14 px), `Sun` or `Moon`, words only for rare axes (`Forced`, `Contrast`, `Solid`), and a `ButtonSlot $kind='shortcut'` with the declared position for the first six. Selected look from state: `$invert`.
- Grouping: key = `JSON.stringify(variant.regions)` for changed variants. The largest bucket is `Same change` (only when it has two or more variants). Every other changed variant goes to `Differs`. Then `Added`, `Removed`, `Failed`, `Comparing`, `Unchanged`, each only when it has variants.
- Label line: the full label, an em dash, the status word, and `same change as 3 others` in ink 60 when the variant is in the `Same change` group.
- Each chip is a `TooltipAnchor` with the full label and the status.

**Copy**: group labels `Same change`, `Differs`, `Added`, `Removed`, `Failed`, `Comparing`, `Unchanged`. Label line addition: `same change as {n} others`.

**Behavior and keys**

- Click selects. Left, Right, and `1` to `6` follow the declared order, so the selection can jump between groups.
- `Shift+A` and `Shift+X` keep their meaning (all changes of the screenshot). No group decision exists.
- With one variant, render only the label line.

**Scenarios**

- six: `Same change` with four chips, `Differs` with one, `Unchanged` with one.
- one: the label line only.
- twelve: `Same change` with ten chips (wraps), `Unchanged` with two.
- twenty-four: `Same change` with five chips; `Unchanged` folds into one chip `= 19` that opens a `Popover` with the list.
- irregular: `Same change` with six chips (the same dialog regression in all variants).
- states: `Added`, `Failed`, `Comparing`, and `Unchanged` groups of one, and a `Differs` group of two.
- read-only: the same.
- narrow: groups stack, one for each line; chips are 44 px high.
