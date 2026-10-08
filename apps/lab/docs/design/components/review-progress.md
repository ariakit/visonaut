# Review progress and completion (review-progress)

Group: workspace
Question: How should the run show what is left, and what should happen when nothing is left?
Description: The run-level counter of changes that need review and the state that replaces it when the review is complete.
Layout: stack

## Scenarios

- `mixed` (In progress): The `changes` run: 33 changes, of which 22 need review, 9 are approved (6 automatically), and 2 are rejected.
- `large` (Large run): The `large` run: 128 changes, of which 79 need review and 49 are approved, beside 472 unchanged variants that must not count.
- `last` (Last change): The `one-change` run with one change left; Approve in the cell completes the review, so the transition is visible.
- `comparing` (Comparing): The `comparing` run: 6 of 16 comparisons are complete and review is not open yet.
- `problems` (Run failed): The `problems` run: five comparisons failed, so the run cannot pass and a rerun is necessary.
- `passed` (Complete, approved): The `passed` run: all 33 changes are approved, the GitHub check updates, and run #4831 waits in the queue.
- `rejected` (Complete, rejected): Every change has a decision and two are rejected, so the check stays failed.
- `read-only` (Read-only): The run that a newer run replaced: the numbers are final and a link opens the newer run.

## Variant `count`: Count only

One mark and one number (`22 left`); at the end the same place says `All approved` and offers the next run.

Ideas:

- The smallest answer to `am I done?`: two words in the header.
- Completion happens in place. No card covers the last image.
- The breakdown is one hover away.

Tradeoffs:

- No picture of how far the review is.
- The end of the task is quiet: a reviewer who looks at the image can miss it.
- `N left` replaces the contract wording `N of M need review` (rule A08).

### Spec

**Sketch**

```
#4863 Migrate component examples to the new style…                    ✕ 2   ○ 22 left
complete:   … ✓ All approved · GitHub check passed      Queue   [Next run ↵]
rejected:   … ✕ 2 rejected · GitHub check failed        Queue   [Next run ↵]
```

**Build**

- Lab cell: a mock header `Frame $layer className='flex h-11 items-center gap-3 border-b px-3'` with the run title (`Text className='truncate text-sm font-medium flex-1'`) and the element at the end.
- Reviewing: `Text className='flex items-center gap-1.5 text-sm tabular-nums'` with a `Circle` mark in `Text $text='warning'` and `22 left`. When a variant is rejected, a second pair before it: `X` in danger and the number.
- The element is a `TooltipAnchor`: `9 approved (6 auto) · 2 rejected · 22 need review`.
- Complete: the same place holds the mark, `All approved`, a check line in ink 60, a `Link` `Queue`, and `Button $size='sm' $layer='brand'` `Next run` with `<Kbd>↵</Kbd>`.
- Check line: a spinner and `Updating GitHub check…` for the simulated 1.2 s (`useSimulatedLoad`), then `GitHub check passed`.
- Data: `session.progress` (`remaining`, `approved`, `rejected`, `automatic`), `session.complete`, `session.readOnlyKind`. The next run is the constant `#4831` from `getInboxData('busy')`.

**Copy** (2 words while reviewing, 9 at the end): `22 left`. `All approved`. `2 rejected`. `Updating GitHub check…`, `GitHub check passed`, `GitHub check failed`. `Next run`, `Queue`. Comparing: `Comparing 6 of 16`. Failed: `5 failed · Rerun needed`. Read-only: `Read-only · Replaced`, `Open newer run`. Live region at the end: `All reviewed.`

**Behavior and keys**

- The number changes with each decision, with no animation.
- At the end, focus moves to `Next run`, so Enter opens it. `Cmd/Ctrl+Z` undoes the last decision and returns to the counter.
- With no next run, the button is `Queue` (brand) and the copy has no `Next run`.

**Scenarios**

- mixed: `✕ 2  ○ 22 left`.
- large: `○ 79 left`.
- last: `○ 1 left`; after Approve, the complete form.
- comparing: a spinner and `Comparing 6 of 16`.
- problems: `TriangleAlert` and `5 failed · Rerun needed` in danger text.
- passed: the complete form with `GitHub check passed`.
- rejected: `✕ 2 rejected · GitHub check failed`, `Queue`, `Next run`.
- read-only: a lock, `Read-only · Replaced`, and `Open newer run`.
- Narrow (container under 30rem): the title hides first; the element keeps one line.

## Variant `segments`: Segmented bar and a card

A thin bar with approved, rejected, and remaining segments beside the count; at the end a card in the stage sums up the review.

Ideas:

- One bar replaces the count text, the green native progress bar, and the status sentence.
- The denominator is changes only, so a large run does not start almost full, and a rejection is red, not green.
- The completion card is the clear end of the task: result, check state, next action.

Tradeoffs:

- The card covers the last image (the image is still one Undo away).
- About 14rem of header width for the bar and the count.
- The card needs the GitHub check confirmation and the pull request link, which are not in the review API today.

### Spec

**Sketch**

```
#4863 Migrate component examples…            ▓▓▓▓▓▓▓▓▓▒▒░░░░░░░░░░░░░░░░░░░░   22 left
                                             └ approved ┘rej└ need review ┘
complete (card in the stage):
        ┌────────────────────────────────────────────────┐
        │ (✓)  All approved                              │
        │      33 changes · GitHub check passed          │
        │      [Next run · #4831 ↵]   Queue   Pull request ↗ │
        │      ↶ Undo last decision                      │
        └────────────────────────────────────────────────┘
```

**Build**

- Lab cell: the mock header (`Frame $layer` `h-11 border-b px-3`, run title, element at the end) and under it a mock stage `Frame $darken className='grid h-64 place-items-center'` that is empty while reviewing.
- Bar: `<div role='img' aria-label='9 approved, 2 rejected, 22 need review' className='flex h-1.5 w-40 gap-px overflow-clip rounded-full'>` with three `Frame`s sized by `style={{ flexGrow: count }}`: `$layer='success'`, `$layer='danger'`, and `$lightnessOffset={2}` for the rest. A segment with 0 is not rendered.
- Count: `Text className='text-sm tabular-nums'` `22 left`.
- Bar and count together are a `PopoverDisclosure` (`$layer='transparent'`). The `Popover portal $p={3} $rounded='xl'` has a small `dl`: `Approved 9 (6 auto)`, `Rejected 2`, `Needs review 22`, and one ink 60 line `Changed 27 · Added 4 · Removed 2`.
- Card: `Frame $lighten $border $rounded='2xl' $p='1rem' role='status' className='grid w-[26rem] max-w-full gap-3 shadow-xl'`. A `Frame $layer='success' $mix={15} $rounded='full' $p={2}` with `Check`; `Heading className='mt-0 mb-0 text-base'`; one `Text` line in ink 70; a button row: `Button $layer='brand'` `Next run · #4831` with `<Kbd>↵</Kbd>`, `Button` `Queue`, `Link` `Pull request`; and `Button $size='sm'` `Undo last decision` with `Undo2`.
- Rejected card: the icon frame is `$layer='danger'` with `X`, and the secondary button is `Show rejected` (sets the status filter).

**Copy** (2 words while reviewing, about 14 on the card): `22 left`. Card: `All approved`, `33 changes · GitHub check passed`, `Updating GitHub check…`, `Next run · #4831`, `Queue`, `Pull request`, `Undo last decision`. Rejected card: `2 rejected`, `31 approved · GitHub check failed`, `Show rejected`. Comparing: `Comparing 6 of 16`. Failed: `Run failed · Rerun the visual tests in CI.` Read-only: `Read-only · Replaced by a newer run`, `Open newer run`.

**Behavior and keys**

- Segment widths animate over 150 ms (off with reduced motion).
- The card appears 300 ms after the last decision is shown, and focus moves to `Next run`. Esc closes the card and shows the last image again; the header then keeps `All approved` with a button `Summary`.
- `Cmd/Ctrl+Z` undoes and removes the card.

**Scenarios**

- mixed: bar 9 / 2 / 22 and `22 left`.
- large: bar 49 / 0 / 79 and `79 left`.
- last: an empty track and `1 left`; after Approve, the card.
- comparing: the bar is one indeterminate `Progress` (no value) and `Comparing 6 of 16`.
- problems: a danger segment for the 5 failed, and a tinted callout in the stage (`Frame $layer='danger' $mix={12} $border $edge='danger'`): `Run failed · Rerun the visual tests in CI.`
- passed: a full success bar and the card.
- rejected: the bar with a danger segment and the rejected card.
- read-only: the bar in its final state at 60% ink, a lock, and `Open newer run`.
- Narrow (container under 30rem): the bar hides and the count stays; the card takes the full width.

## Variant `ring`: Ring and a done bar

A small ring with the number left inside it; at the end the decision bar is replaced by a bar with the result and the next run.

Ideas:

- The smallest footprint that still shows a proportion: 1.75rem.
- The end state takes the place of the decision controls, where the eyes and the hand already are.
- The ring turns danger red as soon as a variant is rejected.

Tradeoffs:

- A ring has one fill, so approved and rejected are one arc. The color tells that a rejection exists; the count is in the tooltip.
- The done bar needs the slot of the decision bar, so it pairs best with a bar at the bottom.
- A number above 99 is small inside a 1.75rem ring.

### Spec

**Sketch**

```
#4863 Migrate component examples…                                        (◔ 22)
complete (the decision bar becomes a done bar):
┌──────────────────────────────────────────────────────────────────────────────┐
│ ✓ All approved · GitHub check passed            ↶ Undo    Queue    Next run · #4831 ↵ │ 52 px
└──────────────────────────────────────────────────────────────────────────────┘
```

**Build**

- Lab cell: the mock header (`Frame $layer` `h-11 border-b px-3`, run title, ring at the end), a mock stage `Frame $darken className='h-40'`, and at the bottom the place of the decision bar (`h-13`).
- Ring: a `size-7` box with `ProgressCircular aria-label='11 of 33 decided' value={progress.ratio} $thickness={1} fill={{ $layer: progress.rejected ? 'danger' : 'success' }}` and inside `Text className='text-[0.6875rem] font-medium tabular-nums'` with the number left. At 0: a `Check` icon (or `X` when a variant is rejected).
- The ring is a `TooltipAnchor`: `9 approved (6 auto) · 2 rejected · 22 need review`.
- While reviewing, the bar place shows a quiet placeholder of the decision bar (two disabled-looking buttons are not wanted: draw a dashed `Frame` with the text `Decision bar` in ink 40).
- Done bar: `ButtonGroup role='toolbar' aria-label='Review complete' $border className='w-full h-13 items-center'` with a `TextFrame $p={2} role='status' className='flex-1 truncate text-sm'` (mark and text), `Button` `Undo` with `Undo2`, `Button` `Queue`, and `Button $layer='brand'` `Next run · #4831` with a shortcut slot `↵`.
- Rejected done bar: the group gets `$layer='danger' $mix={10}`, and a `Button` `Show rejected` comes before `Queue`.

**Copy** (0 words while reviewing, 9 at the end): the number. Done bar: `All approved · GitHub check passed`, `Updating GitHub check…`, `2 rejected · GitHub check failed`, `Undo`, `Queue`, `Next run · #4831`, `Show rejected`. Comparing: `6/16` beside an indeterminate ring. Failed: `5 failed`. Read-only: `Read-only`, `Open newer run`.

**Behavior and keys**

- The arc animates over 150 ms (off with reduced motion).
- When the last decision is shown, the done bar replaces the decision bar with no change of height, and focus moves to `Next run`.
- `Cmd/Ctrl+Z` undoes and brings the decision bar back.

**Scenarios**

- mixed: a danger arc at one third and `22`.
- large: a success arc at 38% and `79`.
- last: an empty ring and `1`; after Approve, the done bar.
- comparing: `ProgressCircular` without a value and the text `6/16` beside it.
- problems: the ring is replaced by `TriangleAlert` in danger and `5 failed`; the bar place reads `Run failed · Rerun the visual tests in CI.`
- passed: a ring with `Check` and the done bar.
- rejected: a ring with `X` and the rejected done bar.
- read-only: a gray ring (ink 50) in its final state; the bar place reads `Read-only · Replaced by a newer run` with `Open newer run`.
- Narrow (container under 30rem): the done bar has two rows: text, then `Queue` and `Next run` at 48 px.

## Variant `pill`: State pill and a countdown

One badge beside the title carries the whole run state in one or two words; at the end the page offers to open the next run after five seconds.

Ideas:

- One word set for every run state replaces the four text banners: to review, Comparing, Failed, Read-only, Passed, Rejected.
- The long sentence for a state is in the popover of the pill, one click away.
- The queue keeps moving: the next run opens by itself unless the reviewer stays.

Tradeoffs:

- Automatic navigation can surprise. The maintainer must choose between stay, offer, and go (WORK-15).
- A timed control needs a way to stop it (WCAG 2.2.1): `Stay` and Esc do that.
- No picture of the proportion: only the number.
- `22 to review` replaces the contract wording `N of M need review` (rule A08).

### Spec

**Sketch**

```
#4863 Migrate component examples…  (○ 22 to review)
                                   (✕ 2 rejected · 20 to review)   (◌ Comparing 6/16)   (lock Read-only)
complete:
#4863 …  (✓ Passed)
┌──────────────────────────────────────────────────────────────┐
│ Next run in 5 s · #4831 Update dependency @playwright/test…   Stay Esc   [Go now ↵] │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░                                      │
└──────────────────────────────────────────────────────────────┘
```

**Build**

- Lab cell: the mock header (`Frame $layer` `h-11 border-b px-3`) with the run title and the pill right after it, and a mock stage `Frame $darken className='relative h-40'`.
- Pill: `PopoverProvider` and `PopoverDisclosure render={<Badge $layer={role} $forceRounded $size='sm' />}` with a `BadgeSlot` mark and a `BadgeLabel`. If a badge cannot be the disclosure, use `Button $size='xs' $rounded='full' $layer={role} $mix={15}`.
- Popover (`portal $p={3} $rounded='xl' className='grid max-w-72 gap-2 text-sm'`): the numbers (`Approved 9 (6 auto)`, `Rejected 2`, `Needs review 22`) and, for a state that blocks review, one sentence and one action.
- Countdown: `Frame $lighten $border $rounded='xl' $p={3} role='status' className='absolute inset-x-4 top-4 grid gap-2 shadow-md'` with one text line, `Button $size='sm'` `Stay` with `<Kbd>Esc</Kbd>`, `Button $size='sm' $layer='brand'` `Go now` with `<Kbd>↵</Kbd>`, and `Progress aria-label='Time until the next run opens' value={elapsed} $thickness={0.5}`.
- The countdown floats over the stage top. It adds no row.

**Copy** (2 or 3 words): `22 to review`, `2 rejected · 20 to review`, `Comparing 6/16`, `Failed`, `Read-only`, `Passed`, `Rejected`. Popover sentences: `Review opens when every comparison is complete.` `Five comparisons failed. Rerun the visual tests in CI.` `A newer run replaced this run.` with `Open newer run`. Countdown: `Next run in 5 s · #4831 …`, `Stay`, `Go now`. With no next run: `Queue is empty` and `Queue`. Rejected: no countdown; the pill reads `Rejected` and the strip reads `2 rejected · GitHub check failed` with `Show rejected` and `Next run`.

**Behavior and keys**

- The countdown starts when the last decision is saved (not when it is shown). Enter goes now. Esc or `Stay` stops it and leaves the pill `Passed`. `Cmd/Ctrl+Z` stops it and undoes.
- The countdown never starts after a rejection, in a read-only run, or with reduced motion (then the strip waits for a click).

**Scenarios**

- mixed: `✕ 2 rejected · 20 to review` (danger tint).
- large: `○ 79 to review` (warning tint).
- last: `○ 1 to review`; after Approve, `Passed` and the countdown.
- comparing: a neutral pill with a spinner, `Comparing 6/16`.
- problems: a danger pill `Failed`; show its popover content inline in the stage for the lab.
- passed: `✓ Passed` and the countdown at 3 s.
- rejected: `✕ Rejected` and the strip without a countdown.
- read-only: a neutral pill with a lock; show its popover content inline in the stage for the lab.
- Narrow (container under 30rem): the pill keeps its words; the countdown buttons go under the text.

## Variant `waffle`: Waffle

Every change is one small cell, grouped by screenshot and colored by verdict; a click on a cell opens that variant.

Ideas:

- Progress, map, and navigation in one element: the rejected cells are visible places, not a number.
- The cell of the variant on screen has a ring, so the reviewer sees the position in the whole run.
- At the end the waffle is the summary: nothing new appears, the cells are all final.

Tradeoffs:

- 33 cells need about 21rem of header width. Above 160 changes it shows one cell for each screenshot.
- The cells are 8 px: color carries the state, with a tooltip and the count beside it (rule A09 needs a decision).
- A new idea that is not in the audit.

### Spec

**Sketch**

```
#4863 Migrate component…   ■■■■■■ ▣▣■ ▩▩ ■■ ■■ ■■▣ ▣■ ■■■■ ■■ ■■ ▣▣▣ ▣▣    22 left
                           dialog  comb menu tabs …                     one group for each screenshot
                              ▲ ring = the variant on screen
complete:                  ▣▣▣▣▣▣ ▣▣▣ ▩▩ ▣▣ …    ✕ 2 rejected · GitHub check failed   [Next run ↵]
```

**Build**

- Lab cell: the mock header (`Frame $layer className='flex min-h-11 items-center gap-3 border-b px-3 py-2'`) with the run title, the waffle, and the count.
- Waffle: `<div role='group' aria-label='Changes' className='flex max-w-[34rem] flex-wrap gap-x-1.5 gap-y-1'>`. One inner `flex gap-0.5` group for each screenshot that has changes, in list order.
- Cell: `Button $p='none' $rounded='xs' className='size-2 min-h-0'` (a real button for the pointer; `tabIndex={-1}`) with the fill from the verdict: needs review `$layer='warning'`, approved and auto-approved `$layer='success' $mix={40}`, rejected `$layer='danger'`, failed `$border $borderType='dashed' $edge='danger' $edgeRaw`, comparing `$lightnessOffset={2}` with `animate-pulse`.
- The cell of the selected variant: an outline ring (`outline-2 outline-offset-1` in the ink color through `ak-` edge classes, or `$border={2}` with a larger box).
- Each cell is a `TooltipAnchor`: `Dialog with initial focus · Firefox · Dark · Needs review`.
- Count: `Text className='text-sm tabular-nums'` `22 left`.
- Above 160 changes: one cell for each screenshot (the fill is the screenshot status), and the count stays.
- Under a container width of 40rem: the waffle moves into a `Popover` behind a `PopoverDisclosure` that reads `22 left`.
- Complete: the waffle stays. The count becomes the result text, with `Button $size='sm' $layer='brand'` `Next run` and `<Kbd>↵</Kbd>`.

**Copy** (2 words): `22 left`. End: `All approved · GitHub check passed`, `2 rejected · GitHub check failed`, `Updating GitHub check…`, `Next run`. Comparing: `Comparing 6 of 16`. Failed: `5 failed · Rerun needed`. Read-only: `Read-only`, `Open newer run`. Accessible name of the group: `33 changes: 9 approved, 2 rejected, 22 need review`.

**Behavior and keys**

- A click on a cell selects that variant (`session.select`). The waffle is not in the Tab order; keyboard users have the list and the arrow keys.
- A cell changes fill when its decision is shown. No other motion.
- At the end, focus moves to `Next run`. `Cmd/Ctrl+Z` undoes.

**Scenarios**

- mixed: 33 cells in 10 groups, as in the sketch.
- large: 128 cells in two wrapped rows.
- last: one warning cell with a ring; after Approve it turns success and the end text appears.
- comparing: 16 cells, 10 of them pulsing.
- problems: 3 warning cells and 5 dashed danger cells.
- passed: all success cells.
- rejected: two danger cells stay visible; a click on one returns to it.
- read-only: final cells at 60% opacity; cells still select.
- Narrow: the `22 left` button with the waffle in its popover.

## Variant `receipt`: Families and a receipt

The count opens a list of what is left by family; at the end a receipt in the mono font lists what was decided.

Ideas:

- The reviewer sees where the work is (`dialog 6, combobox 1`), not only how much.
- A family row is a jump target to its first variant that needs review.
- The receipt is a small, playful end that can be read back: each family with its result.

Tradeoffs:

- The most words of the options at the end (about 25).
- The receipt covers the last image.
- A family is the first path segment. In the `changes` fixture each family has one screenshot; the `large` scenario shows the idea better.
- A new idea that is not in the audit.

### Spec

**Sketch**

```
#4863 Migrate component examples…                                    22 left ▾
popover (by family):
  dialog       ○○○○○○          6
  combobox     ✓✓○             1
  menu         ✕✕              ✕
  tabs         ○○              2
  … 6 more
complete (receipt in the stage, mono):
  ┌────────────────────────────────┐
  │ Review complete                │
  │ #4863 · attempt 2 · 9f8e7d6    │
  │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
  │ dialog ................. 6 ✓   │
  │ combobox ............... 3 ✓   │
  │ menu ................... 2 ✕   │
  │ … 7 more                       │
  │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
  │ Approved 31       Rejected 2   │
  │ GitHub check      failed       │
  │ [Next run ↵]   Queue           │
  └────────────────────────────────┘
```

**Build**

- Lab cell: the mock header (`Frame $layer` `h-11 border-b px-3`) with the run title and the count button at the end, and a mock stage `Frame $darken className='grid min-h-80 place-items-center p-4'`.
- Count: `PopoverProvider` and `PopoverDisclosure $size='sm'` with `ButtonLabel` `22 left` and a `ChevronDown` slot.
- Popover (`portal $p={2} $rounded='xl' className='grid w-72 gap-0.5'`): one `Button className='w-full justify-start text-start' $size='sm'` row for each family that has changes: the family name (`ButtonLabel`, mono `text-xs`), its variant marks (12 px, counted marks above 8), and a `ButtonSlot $kind='badge' $p='md'` count that needs review or the final mark. At most 8 rows, then `… 6 more` as a row that expands the list in place.
- For the lab, show the popover content inline in the stage in the `mixed` and `large` scenarios.
- Receipt: `Frame $lighten $border $rounded='lg' $p='1rem' role='status' className='grid w-80 gap-2 font-mono text-xs shadow-xl'`. A `Heading className='mt-0 mb-0 text-sm font-semibold'`; a line with run number, attempt, and `shortSha`; `Separator` (the default dashed line); family rows as `flex` with a dotted leader (`flex-1 border-b border-dotted` on a spacer); `Separator`; two total rows; a button row with `Button $size='sm' $layer='brand'` `Next run` and `Link` `Queue`.
- Data: group `session.items` by the first segment of `item.key`.

**Copy**: `22 left`. Popover: family names and `… 6 more`. Receipt: `Review complete`, `#4863 · attempt 2 · 9f8e7d6`, `Approved 31`, `Rejected 2`, `GitHub check passed`, `GitHub check failed`, `GitHub check updating…`, `Next run`, `Queue`. Comparing: `Comparing 6 of 16`. Failed: `5 failed`. Read-only: `Read-only`, `Open newer run`.

**Behavior and keys**

- A click on a family row selects its first variant that needs review and closes the popover.
- The receipt appears 300 ms after the last decision is shown; focus moves to `Next run`. Esc closes it. `Cmd/Ctrl+Z` undoes and closes it.
- The receipt rows are at most 8, then `… 7 more`.

**Scenarios**

- mixed: `22 left` and the family list inline.
- large: `79 left`; the list shows 8 of 20 families.
- last: `1 left`; after Approve, a receipt with one family row.
- comparing: the button reads `Comparing 6 of 16` with a spinner and is disabled.
- problems: `5 failed` in danger text; the list shows families with `TriangleAlert`.
- passed: the receipt with `Approved 33`, `Rejected 0`, `GitHub check passed`.
- rejected: the receipt as in the sketch, and `Show rejected` in place of `Queue`.
- read-only: `Read-only` with a lock in the header; the receipt shows the final numbers with `Open newer run` as its only button.
- Narrow: the receipt takes the full width.
