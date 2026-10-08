# Status mark (status-mark)

Group: inbox
Question: Which mark should show the state of a run and the verdict of a variant?
Description: One mark and one word set for the eight run states and the seven variant states, in each list, table, chip, and header.
Layout: row

## Scenarios

- `run-states` (Run states): The eight run states in the order of a legend.
- `variant-states` (Variant states): The seven states of one variant, with the same marks for the words that runs share.
- `compact` (Compact): The smallest form of each run state, as a dense row or a variant chip uses it.
- `counts` (With counts): The mark next to a count: 79 changes, 22 changes with 2 rejected, capturing 212 of 600, comparing 6 of 16.
- `surfaces` (On surfaces): Needs review and Failed on the canvas, on a raised card, on a selected row, in a table cell, and on a brand surface.

## Variant `glyph-word`: Glyph and word (minimal)

A small colored shape and the state word in normal text, with no surface.

Ideas:

- Each state has its own shape, so the mark works without color.
- No badge surface: a column of states stays quiet.
- The word keeps full text contrast; only the glyph takes the status color.

Tradeoffs:

- Low emphasis: a failed run does not stand out much in a long list.
- The compact form is a glyph alone, so the word is in a tooltip and in the accessible name only.

### Spec

**Sketch**

```text
● Needs review   ✕ Rejected   ▲ Failed   ↻ Rerun needed
◔ Comparing   ◌ Capturing   ✓ Passed   → Replaced
```

**Map** (word, lucide icon, role). Runs: Needs review `CircleDot` warning; Rejected `CircleX` danger; Failed `TriangleAlert` danger; Rerun needed `RefreshCw` warning; Comparing `LoaderCircle` neutral; Capturing `CircleDashed` neutral; Passed `CircleCheck` success; Replaced `CircleArrowRight` neutral. Variants: Needs review, Rejected, Comparing, Failed as for runs; Approved `CircleCheck` success; Auto-approved `CheckCheck` neutral; Unchanged `Minus` neutral.
**Build**

- Root: `Text` with `inline-flex items-center gap-1.5 text-sm whitespace-nowrap`.
- Glyph: the icon at `size-[1em]` inside `Text $text={role}` with `flex`. A neutral glyph uses `ak-ink-60` and no `$text`.
- Word: plain `Text`. `Replaced` and `Unchanged` use `ak-ink-60`.
- No surface and no border.
  **Behavior**
- `LoaderCircle` uses `animate-spin motion-reduce:animate-none`.
- Inside a link the glyph is `aria-hidden` and the link name has the word. Alone, the root has `role='img'` and `aria-label`.
  **Scenarios** (each cell is `w-90 max-w-full`)
- `run-states`: the eight marks in wrapped lines with `gap-x-4 gap-y-2`.
- `variant-states`: the seven marks.
- `compact`: the glyph alone at `size-[1.125em]` with a `Tooltip` that has the word; then five list rows of 1.75em that start with the glyph.
- `counts`: `● 79 changes`; `✕ 22 changes · 2 rejected` (last part in `Text $text='danger'`); `◌ Capturing 212 of 600`; `◔ Comparing 6 of 16`.
- `surfaces`: the same mark on each surface: canvas, `Frame $lighten $border`, `Frame $layer='brand' $mix={12}`, a `Table` cell, `Frame $layer='brand'`.
  **Budget**: one or two words.

## Variant `pill`: Tinted pill

A badge with a 15 percent tint, a ring, an icon, and the word.

Ideas:

- One shape in a card, a row, and a table cell: always a pill.
- The tint makes Rejected and Failed easy to find in a long table.
- A count can be the label of the pill.

Tradeoffs:

- The heaviest option: eight pills in a list compete with the titles.
- Two-word labels make wide pills, for example `Rerun needed`.
- Neutral states look like tags.

### Spec

**Sketch**

```text
(● Needs review)  (✕ Rejected)  (▲ Failed)  (↻ Rerun needed)
(◔ Comparing)  (◌ Capturing)  (✓ Passed)  (→ Replaced)
```

**Map** (word, lucide icon, role). Runs: Needs review `CircleDot` warning; Rejected `CircleX` danger; Failed `TriangleAlert` danger; Rerun needed `RefreshCw` warning; Comparing `LoaderCircle` neutral; Capturing `CircleDashed` neutral; Passed `CircleCheck` success; Replaced `CircleArrowRight` neutral. Variants: Needs review, Rejected, Comparing, Failed as for runs; Approved `CircleCheck` success; Auto-approved `CheckCheck` neutral; Unchanged `Minus` neutral.
**Build**

- `Badge $layer={role === 'neutral' ? true : role} $forceRounded` with `BadgeSlot` (icon) and `BadgeLabel` (word).
- Always pass `$forceRounded`: without it the pill is a 2 px rectangle in a table cell (audit finding DASH-11).
  **Behavior**: static; the Comparing icon turns with `motion-reduce:animate-none`.
  **Scenarios** (each cell is `w-90 max-w-full`)
- `run-states`, `variant-states`: one pill for each state, wrapped with `gap-2`.
- `compact`: a pill with the `BadgeSlot` only, which gives a circle, and an `aria-label`.
- `counts`: the label is the state text: `79 changes`; `22 changes` and a second danger pill `2 rejected`; `Capturing 212 of 600`; `Comparing 6 of 16`.
- `surfaces`: the tint follows each surface; the pill stays round in the table cell; on the brand frame use `$invert`.
  **Budget**: one or two words.

## Variant `disc`: Icon disc

A tinted disc of 1.5em with the state icon; the word shows only in a wide container and in a tooltip.

Ideas:

- The smallest footprint: it fits a row of 1.75em and a variant chip.
- Discs form a clean column that the eye can scan by color and shape.
- The word appears from the `@md` container width, so wide tables keep text.

Tradeoffs:

- Below that width the state is an icon without visible text. Rule A09 of the contract asks for text with color.
- A tooltip does not work on touch.
- Eight icons need learning.

### Spec

**Sketch**

```text
(●) Needs review   (✕) Rejected   (▲) Failed   (↻) Rerun needed     wide container
(●) (✕) (▲) (↻) (◔) (◌) (✓) (→)                                     narrow container
```

**Map** (word, lucide icon, role). Runs: Needs review `CircleDot` warning; Rejected `CircleX` danger; Failed `TriangleAlert` danger; Rerun needed `RefreshCw` warning; Comparing `LoaderCircle` neutral; Capturing `CircleDashed` neutral; Passed `CircleCheck` success; Replaced `CircleArrowRight` neutral. Variants: Needs review, Rejected, Comparing, Failed as for runs; Approved `CircleCheck` success; Auto-approved `CheckCheck` neutral; Unchanged `Minus` neutral.
**Build**

- Disc: `Frame $layer={role} $mix={20} $rounded='full' $forceRounded` with `inline-grid size-6 place-items-center`. A neutral disc is `Frame $lightnessOffset={2}`. The icon is `size-3.5` inside `Text $text={role}`.
- Word: `Text` with `text-sm @max-md:sr-only`, so the word is always in the accessibility tree.
- Tooltip: `TooltipProvider`, `TooltipAnchor render={<span />}` around the disc, and `Tooltip` with the word.
  **Scenarios** (each cell is `@container w-90 max-w-full`)
- `run-states`, `variant-states`: disc and word.
- `compact`: the disc alone at `size-5`: eight discs in a line, then a column of five discs as in a dense list.
- `counts`: a disc and `79`; a disc and `22` with a danger disc and `2`; for a run in progress, `ProgressCircular` at `size-6` with the value, then `212 of 600` and `6 of 16`.
- `surfaces`: the disc keeps its circle in the table cell; check the tint on the selected row and on the brand frame.
  **Budget**: one or two words, hidden when narrow.

## Variant `edge`: Edge bar

The state is a bar of 4 px on the start edge of the row and one soft word at the end of the row.

Ideas:

- No icon column: the title starts at the edge of the list.
- Runs of the same state form one colored line down the list.
- The bar can also mark a group in a split layout.

Tradeoffs:

- The bar is color only. The word must always be visible to meet rule A09.
- It does not work for a mark in a sentence or a header; there it falls back to a short bar before the word.
- Comparing and Capturing are both neutral bars, and Needs review and Rerun needed are both warning bars: only the word tells them apart.

### Spec

**Sketch**

```text
▌ #4831  Update dependency @playwright/test…        Needs review
▌ #4844  Add forced colors styles to Checkbox…            Failed
▌ Needs review   ▌ Rejected   ▌ Failed                (inline form)
```

**Map** (word, role; this variant has no icons). Runs: Needs review warning; Rejected danger; Failed danger; Rerun needed warning; Comparing neutral; Capturing neutral; Passed success; Replaced neutral. Variants: Needs review, Rejected, Comparing, Failed as for runs; Approved success; Auto-approved neutral; Unchanged neutral.
**Build**

- Row form: the host row is `Frame $layer $edge={role} $edgeRaw $p={2}` with `border-s-4 flex items-center justify-between gap-3`. A neutral state has no `$edge` and uses `$edgeWeight='normal'`.
- Word: `Text` with `text-sm ak-ink-70` at the row end.
- Inline form: `Frame $layer={role} $rounded='full' $forceRounded` with `inline-block h-[1em] w-1`, then the word.
  **Behavior**: the Comparing bar uses `animate-pulse motion-reduce:animate-none`.
  **Scenarios** (each cell is `w-90 max-w-full`)
- `run-states`: eight short rows with the state word as the only text.
- `variant-states`: seven rows.
- `compact`: the bar alone with a visually hidden word; five rows of 1.75em show the colored line.
- `counts`: the row end has the state text: `79 changes`, `22 changes · 2 rejected`, `Capturing 212 of 600`, `Comparing 6 of 16`.
- `surfaces`: the bar on the canvas, a raised card, a selected row, a table row (the first cell has the border), and the brand frame.
  **Budget**: one or two words.

## Variant `pipeline`: Pipeline steps

Four small segments for capture, compare, review, and done: the state is the segment that is lit, with the word next to it.

Ideas:

- A state becomes a position, so the reader sees how far the run is and where it stopped.
- The same mark serves queue rows, the pull request view, and the workspace header.
- A variant uses two segments: compare and review.
- Not in the audit: a new idea.

Tradeoffs:

- Wider than an icon: about 3em for four segments.
- Failed does not know its step in the API today. The lab reads the error text; the API needs a field.
- Replaced and Rerun needed are not steps: they use a muted bar and a warning bar.
- A new visual language to learn; its compact form has no visible word (rule A09).

### Spec

**Sketch**

```text
▰▱▱▱ Capturing    ▰▰▱▱ Comparing    ▰▰▰▱ Needs review    ▰▰▰▱ Rejected (third is danger)
▰▰▰▰ Passed       ▰▱▱▱ Failed (first is danger)    ▰▰▱▱ Rerun needed    ▱▱▱▱ Replaced
```

**Map** (word, role). Runs: Needs review warning; Rejected danger; Failed danger; Rerun needed warning; Comparing neutral; Capturing neutral; Passed success; Replaced neutral. Variants: Needs review, Rejected, Comparing, Failed as for runs; Approved success; Auto-approved neutral; Unchanged neutral.
**Build**

- Root: `span` with `inline-flex items-center gap-2 text-sm`.
- Bar: `span` with `role='img'`, the word as `aria-label`, and `inline-flex gap-0.5`. A run has four segments: capture, compare, review, done. A variant has two: compare, review.
- Segment: `Frame $rounded='full' $forceRounded` with `h-1.5 w-2.5`. Off: `$lightnessOffset={3}`. Done: `$lightnessOffset={8}`. Lit: `$layer={role}`.
- Word: `Text` after the bar.
  **Lit segments**
- Runs. Capturing: 1 lit neutral with `animate-pulse`. Comparing: 1 done, 2 lit with pulse. Needs review: 1 and 2 done, 3 warning. Rejected: 1 and 2 done, 3 danger. Passed: all success. Failed: the failed step is danger (1 for capture, 2 for compare), the rest off. Rerun needed: 1 and 2 warning, 3 and 4 off. Replaced: all off, word in `ak-ink-60`.
- Variants. Comparing: 1 with pulse. Needs review: 1 done, 2 warning. Approved: both success. Auto-approved: both done. Rejected: 2 danger. Unchanged: both off. Failed: 1 danger.
  **Scenarios** (each cell is `w-90 max-w-full`)
- `run-states`, `variant-states`: bar and word.
- `compact`: the bar alone.
- `counts`: bar and state text; for Capturing the first segment is `Progress` with `w-8` and `value={212 / 600}`.
- `surfaces`: the off segments must stay visible on each surface, also on the brand frame.
  **Budget**: one or two words.

## Variant `ring`: Progress ring

A ring of 1.25em that shows the state by color and glyph and, for a run in review, the share of decided changes.

Ideas:

- One mark gives state and progress: a ring at 38 percent says that the review started.
- A run in progress uses the same ring for capture and comparison progress.
- Variant verdicts are full or empty rings, so runs and variants share one shape.
- Not in the audit as a status mark: a new idea.

Tradeoffs:

- Progress needs `counts` and `progress`, which are not in the API today. Without them the ring is only empty or full.
- At 1.25em the difference between 30 and 40 percent is hard to see.
- Rings that move on many rows distract; only Comparing and Capturing move.

### Spec

**Sketch**

```text
◔ Needs review (38% decided)   ◕ Rejected   ● Failed   ○ Rerun needed
◑ Comparing (6 of 16)   ◔ Capturing (212 of 600)   ● Passed   ○ Replaced
```

**Map** (word, role). Runs: Needs review warning; Rejected danger; Failed danger; Rerun needed warning; Comparing neutral; Capturing neutral; Passed success; Replaced neutral. Variants: Needs review, Rejected, Comparing, Failed as for runs; Approved success; Auto-approved neutral; Unchanged neutral.
**Build**

- Root: `span` with `inline-flex items-center gap-1.5 text-sm`.
- Ring: a `span` with `size-[1.25em]` that holds `ProgressCircular` with `aria-label`, `value`, `$thickness={0.75}`, and `fill={{ $layer: role }}`. A center glyph of `size-[0.6em]` is the child.
- Run values. Needs review: approved changes divided by all changes, warning fill, a `Circle` dot. Rejected: the decided share, danger fill, `X`. Passed: 1, success, `Check`. Failed: 1, danger, an exclamation mark. Rerun needed: 0, `RefreshCw` in `Text $text='warning'`. Replaced: 0, `ArrowRight` in `ak-ink-60`. Capturing and Comparing: the progress value with the default fill; no value gives the ring that turns.
- Variant values. Needs review: 0 with a warning dot. Approved: 1, success, `Check`. Auto-approved: 1, default fill, `Check`. Rejected: 1, danger, `X`. Unchanged: 0, `Minus`. Comparing: no value. Failed: 1, danger.
- Word: `Text` after the ring.
  **Scenarios** (each cell is `w-90 max-w-full`)
- `run-states`: take the values from the busy runs: #4831 gives 49 of 128.
- `variant-states`: seven rings.
- `compact`: the ring alone; its name is `Needs review, 49 of 128 decided`.
- `counts`: ring and state text: `79 changes`, `22 changes · 2 rejected`, `Capturing 212 of 600`, `Comparing 6 of 16`.
- `surfaces`: the ring track must stay visible on each surface.
  **Budget**: one or two words.
