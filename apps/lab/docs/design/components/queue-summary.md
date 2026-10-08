# Queue summary (queue-summary)

Group: inbox
Question: How should the Queue show its counts and its refresh state?
Description: The one element at the top or the bottom of the Queue that says how much work waits, replaces the page title, the sentence, and the three counters, and holds the refresh state.
Layout: stack

## Scenarios

- `busy` (Busy): Eight runs: 4 to review with 109 changes and 2 rejected, 2 in progress, 2 that need attention.
- `single` (One run): One run with one change.
- `attention-only` (Nothing to review): No run to review, 2 runs in progress, and 2 that need attention.
- `empty` (Empty): No run needs anything, and the summary must not print zeros.
- `refreshing` (Refreshing): A refresh runs: the counts stay on screen and the control shows the wait.
- `stale` (Refresh failed): The refresh failed and the counts come from the last good answer, 18 minutes old.
- `loading` (Loading): The first load: a skeleton with the final geometry.

## Variant `sentence`: One sentence (minimal)

One line of text states the work once: runs to review, changes, and rejected, then the other groups in soft text.

Ideas:

- Each number appears one time on the page.
- A part that is zero is left out, so the line gets shorter as the Queue empties.
- It replaces the page title, the sentence, and the three counters: about 140 px become one line.

Tradeoffs:

- Numbers in a sentence are slower to scan than tiles.
- The line is not a control: it does not filter the list.
- There is no visible page title; the active navigation item names the page and a hidden `h1` stays.

### Spec

**Sketch**

```text
4 to review · 109 changes · 2 rejected     2 in progress · 2 need attention     Updated now ⟳
```

**Build**

- Root: a `div` with `flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1`.
- Title for assistive technology: `Heading` with `sr-only` and the text `Queue`.
- Main text: `Text` with `font-medium tabular-nums`; `2 rejected` in `Text $text='danger'`. Other groups: `Text` with `ak-ink-60`.
- End: `Text` with `text-xs ak-ink-60` for the freshness, then an icon `Button` with `aria-label='Refresh'` inside a `TooltipAnchor`.
- Data: `useInbox(scenario)`; changes are `counts.pending - counts.rejected`.
  **Copy**
- `busy`: as in the sketch.
- `single`: `1 to review · 1 change`.
- `attention-only`: `Nothing to review` and `2 in progress · 2 need attention`.
- `empty`: only `Updated now` and the refresh button; the empty state under it says the rest.
- `refreshing`: the icon turns (`animate-spin motion-reduce:animate-none`), the button has `aria-busy='true'`, and the freshness reads `Updating`.
- `stale`: `Could not refresh` in `Text $text='warning'`, `Updated 18 min ago`, and `Button $size='sm' $border` with `Retry`.
- `loading`: one skeleton bar with `h-4 w-64`.
  **Behavior**: the refresh keeps the line on screen; only the numbers change.
  **At 390 px**: the soft groups wrap to a second line.
  **Budget**: 12 words.

## Variant `tabs`: Counts as tabs

A tab strip with a count on each tab filters the list: To review, In progress, Needs attention, All.

Ideas:

- Each number is a control, so the counters do work.
- A failed run is one click away and never under 22 cards.
- The strip is the page heading: no title, sentence, or section label is necessary.

Tradeoffs:

- The list shows one group at a time, so a reviewer can miss a failed run; the danger tone of the count is the only cue.
- A tab with zero stays in place and is disabled, which costs width at 390 px.
- It is close to one merged list with filters, the option `recent-clear` that U05 rejected; here History stays a separate page.

### Spec

**Sketch**

```text
 To review 4    In progress 2    Needs attention 2    All 8          109 changes · 2 rejected  ⟳
 ━━━━━━━━━━━
```

**Build**

- The page tabs recipe: `Tabs $border={false} $p='none' $panelRoundedTop={false}` with `defaultSelectedId`.
- `TabList aria-label='Queue' $layer='transparent' $darken={false}` with `border-b items-center`.
- `Tab $kind='flat' $selectedOffset={false}` with an `id`, `TabLabel`, and `TabSlot $kind='badge' $p='md'` for the count: `$layer='warning'` on To review, `$layer='danger'` on Needs attention, neutral on the others. `TabGlider $kind='bar'`.
- End of the strip: `Text` with the changes, then the refresh icon `Button`.
- `TabPanels $layer='transparent' $lighten={false} $p='none'` with `TabPanel single`: in the lab it lists the titles of the selected group as soft text, to show that the tabs work.
  **Copy**: `To review`, `In progress`, `Needs attention`, `All`; `109 changes · 2 rejected`.
  **Behavior and keys**: arrow keys move between tabs (the tab list owns them). A tab with zero runs is `disabled` and has no count.
  **Scenarios**
- `busy`: as in the sketch.
- `single`: `To review 1` and `All 1`; the other tabs are disabled.
- `attention-only`: the first tab with runs is selected: `In progress 2`.
- `empty`: no strip; only the refresh button at the end of the row.
- `refreshing`: a `Progress` without a value and with `$thickness={0.5}` lies on the bottom border of the strip.
- `stale`: `Could not refresh` in `Text $text='warning'` and a `Retry` button replace the changes text.
- `loading`: the tab words render at once; the counts are skeleton pills.
  **At 390 px**: `TabList $size='sm'`; the changes text moves to a line under the strip.
  **Budget**: 10 words.

## Variant `tiles`: Counters, fixed

Three compact stat tiles keep the pattern of today, with clear nouns, no zeros, and half the height.

Ideas:

- For a maintainer who likes the large numbers: they stay, and each has one meaning.
- Rejected is not counted inside the changes.
- A tile is a button that filters the list to its runs.

Tradeoffs:

- It is still a second statement of what the list shows.
- It takes about 56 px of height for three numbers.
- It keeps the pattern that the audit calls ambiguous (DASH-25); only the ambiguity goes away.

### Spec

**Sketch**

```text
┌────────────────┐ ┌────────────┐ ┌────────────┐
│ 4              │ │ 109        │ │ 2          │   2 in progress · 2 need attention   ⟳
│ runs to review │ │ changes    │ │ rejected   │
└────────────────┘ └────────────┘ └────────────┘
```

**Build**

- Root: a `div` with `role='group'`, `aria-label='Queue summary'`, and `flex flex-wrap items-center gap-2`.
- Tile: `Button $lightnessOffset $rounded='lg' $p={3}` with `aria-pressed` and `grid min-w-32 justify-items-start text-start`. Number: `Text` with `text-2xl font-semibold tabular-nums`. Noun: `Text` with `text-xs ak-ink-60`. The rejected number is in `Text $text='danger'`.
- A pressed tile takes `$lightnessOffset={3}` from state.
- After the tiles: `Text` with `text-sm ak-ink-60` for the other groups, then the refresh icon `Button` with `ms-auto`.
  **Copy**: `runs to review` (`run to review` for 1), `changes` (`change`), `rejected`; `2 in progress · 2 need attention`.
  **Behavior**: a tile toggles a filter on the list (local state in the lab). A tile with zero is not rendered.
  **Scenarios**
- `busy`: as in the sketch.
- `single`: two tiles: `1 run to review`, `1 change`.
- `attention-only`: no tiles; the text `2 in progress · 2 need attention` in normal ink.
- `empty`: only the refresh button.
- `refreshing`: the numbers stay; the refresh icon turns.
- `stale`: `Could not refresh · Updated 18 min ago` in `Text $text='warning'` and a `Retry` button.
- `loading`: three skeleton tiles of the final size.
  **At 390 px**: three tiles share one line with `flex-1`; the soft text wraps under them.
  **Budget**: 11 words.

## Variant `strip`: Workload strip

One horizontal bar in which each run is a segment, sized by its open changes and colored by its state.

Ideas:

- The shape of the Queue is visible at once: one large run and three small ones.
- Each segment is a link to its run, with the title in a tooltip.
- The legend under the bar carries the counts, so there is no other sentence.
- Not in the audit: a new idea that needs no new data.

Tradeoffs:

- A chart for four runs can be more design than the data needs.
- A run without open changes gets a fixed small width, which is not to scale.
- Segments are small pointer targets; the list stays the main way in.

### Spec

**Sketch**

```text
[ #4831  79                                    ][ #4863  22 ][ 5 ][ 3 ][◌][◔][▲][↻]
● 4 to review · 109 changes   ✕ 2 rejected   ◌ 2 in progress   ▲ 2 need attention         ⟳
```

**Build**

- Bar: `ak.CompositeProvider` and `ak.Composite` with `aria-label='Runs by open changes'` and `flex h-8 gap-0.5`. The bar is one tab stop.
- Segment: `ak.CompositeItem render={<Button render={<LabLink />} $layer={role} $mix={40} $rounded='sm' $forceRounded $p='none' />}` with `style={{ flexGrow: changes, flexBasis: '1.75rem' }}`, `overflow-clip`, and an `aria-label` such as `#4831, 79 changes`. Inside: `Text` with `text-xs tabular-nums truncate px-1`.
- A neutral run uses `$lightnessOffset={3}` and its state icon.
- Tooltip for each segment: the title and the state text.
- Legend: a line of `Text` items with `text-sm`, each with its glyph; then the refresh icon `Button` with `ms-auto`.
  **Copy**: legend `4 to review · 109 changes`, `2 rejected`, `2 in progress`, `2 need attention`. A part that is zero is left out.
  **Behavior and keys**: Left and Right move in the bar, Enter opens the run. Order: runs to review from the largest to the smallest, then in progress, then needs attention.
  **Scenarios**
- `busy`: as in the sketch.
- `single`: one segment of the full width: `#4835  1`; legend `1 to review · 1 change`.
- `attention-only`: four small segments of equal width and the legend.
- `empty`: no bar and no legend; only the refresh button.
- `refreshing`: the bar stays; the refresh icon turns.
- `stale`: under the legend `Could not refresh · Updated 18 min ago` in `Text $text='warning'` and a `Retry` button.
- `loading`: one skeleton bar with `h-8`.
  **At 390 px**: the bar stays; the legend wraps to two lines.
  **Budget**: 12 words.

## Variant `next-up`: Next up

The summary is an action: it names the next run to review with one Review button, then counts the rest.

Ideas:

- It answers the question of each visit: what do I review now?
- Enter starts the next review from the summary.
- A main or merge queue run comes first, as it holds the baseline (audit finding JOUR-09).
- The rest of the Queue is one short phrase.

Tradeoffs:

- It needs an order rule. The API sorts newest first today, and the audit lists the queue order as an open question.
- The next run appears two times: here and in the list.
- With one run the summary and the list say the same.

### Spec

**Sketch**

```text
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Next   ● main  Version Packages (#4828)    3 changes · Baseline waits   [ Review ↵ ] │
└────────────────────────────────────────────────────────────────────────────────────┘
3 more to review · 2 in progress · 2 need attention                                ⟳
```

**Build**

- Card: `Frame $lighten $border $rounded='xl' $p='1rem'` with `flex flex-wrap items-center gap-3`.
- Parts: `Text` `Next` with `text-xs ak-ink-60`; the status mark; the identity; the title with `flex-1 truncate font-medium`; the state text in `ak-ink-70`.
- Action: `Button $layer='brand' render={<LabLink to='review' scenario='changes' />}` with `ButtonLabel` and `ButtonSlot $kind='shortcut'` that holds `Kbd`.
- Under the card: `Text` with `text-sm ak-ink-60`, then the refresh icon `Button` with `ms-auto`.
- Order rule in the lab: runs to review of kind main or merge queue first, then the oldest run.
  **Copy**: `Next`; `Baseline waits` (only for a main run); `Review` with `↵`; `3 more to review · 2 in progress · 2 need attention`.
  **Behavior and keys**: Enter on the root follows the Review link when the focus is not on another control.
  **Scenarios**
- `busy`: as in the sketch.
- `single`: `Next  ● #4835  Update Popover shadow tokens   1 change   [ Review ↵ ]`; no second line.
- `attention-only`: no card; the line reads `Nothing to review · 2 in progress · 2 need attention`.
- `empty`: only the refresh button.
- `refreshing`: the card stays; the refresh icon turns.
- `stale`: the second line reads `Could not refresh · Updated 18 min ago` in `Text $text='warning'` with a `Retry` button.
- `loading`: a skeleton card with one bar.
  **At 390 px**: the title takes its own line (`line-clamp-2`), and the button takes the full width.
  **Budget**: 14 words besides the title.

## Variant `status-line`: Status line

A thin bar at the bottom of the Queue, like the status bar of an editor: counts at the start, freshness and the keys at the end.

Ideas:

- The top of the page belongs to the runs; the summary moves out of the way.
- The keys are always visible: J K, Enter, slash, question mark.
- Freshness and the refresh state have one fixed place, so a refresh never moves the list.
- The audit has a status line for the workspace only; here it is the Queue summary.

Tradeoffs:

- Counts at the bottom are easy to miss for a new reader.
- A sticky bar takes 2em on a phone; there the key hints hide.
- The key hints are words that an expert does not need on each visit.

### Spec

**Sketch**

```text
│ ● 4 to review · 109 changes · ✕ 2 rejected │ ◌ 2 │ ▲ 2 │      Updated now ⟳ │ J K move · ↵ open · / filter · ? │
```

**Build**

- Bar: `ButtonGroup role='toolbar' aria-label='Queue status' $size='sm' $p={1} $rounded='none'` with `sticky bottom-0 w-full items-center border-t text-xs`. Give it `$layer` so that it covers the list under it.
- Static text: `TextFrame $p={1} $ink={70}` with `tabular-nums`; glyphs in `Text $text={role}`.
- Dividers: `ButtonSeparator`; the one before the end group has `ms-auto`.
- Refresh: an icon `Button` with `aria-label='Refresh'`.
- Key hints: `Text` with `ak-ink-60 flex items-center gap-3`, each hint is `Kbd` and one word.
- Key list: a `PopoverDisclosure` with `Kbd` `?` and `aria-label='Keys'`; `Popover portal` with `grid w-64 gap-2` and one row for each key.
  **Copy**: `4 to review · 109 changes`, `2 rejected`; `2` with the name `2 in progress`; `2` with the name `2 need attention`; `Updated now`; `move`, `open`, `filter`; popover rows `Next row`, `Previous row`, `Open`, `Filter`, `Keys`.
  **Behavior and keys**: `?` on the root opens the key list; Escape closes it.
  **Scenarios**
- `busy`: as in the sketch.
- `single`: `● 1 to review · 1 change`.
- `attention-only`: `Nothing to review │ ◌ 2 │ ▲ 2`.
- `empty`: the start is empty; freshness and keys stay.
- `refreshing`: the refresh icon turns and the freshness reads `Updating`.
- `stale`: `Could not refresh` in `Text $text='warning'` and a `Retry` button replace the freshness; `Updated 18 min ago` stays.
- `loading`: skeleton bars for the counts; the key hints are real.
  **At 390 px**: the key hints hide with `@max-md:hidden`; the `?` button stays.
  **Budget**: 14 words.
