# Empty state (empty-state)

Group: inbox
Question: Which pattern should a list with nothing to show use?
Description: One pattern for a list without rows: all caught up, first use, no match, no alerts, nothing to review, and could not load.
Layout: row

## Scenarios

- `caught-up` (All caught up): The Queue has no runs and a baseline exists.
- `first-use` (First use): No baseline and no runs yet.
- `no-match` (No match): The search text datepicker has no result in History.
- `no-alerts` (No alerts): The Status page has no unresolved alert; the last check was a moment ago.
- `not-required` (Nothing to review): A documentation pull request that needs no visual tests.
- `error` (Could not load): The run list did not load on the first request, with an Error ID.

## Variant `line`: One line (minimal)

An icon, two or three words, an optional soft sentence, and at most one small action, in the height of one list row.

Ideas:

- It has the height of a run row, so the list does not jump when data arrives.
- One statement for each state: the empty Queue of today makes five.
- No card and no border: an empty page stays quiet.

Tradeoffs:

- It is easy to miss on a large empty page.
- There is no room for guidance on first use beyond one sentence.

### Spec

**Sketch**

```text
✓  All caught up
◌  No runs yet                                         Open workflow ↗
   Run the visual tests in CI to create the baseline.
⌕  No match                                            Clear filters
▲  Could not load runs                                 Retry
   Try again in a moment. Error ID req_01JZ8Q2N5K
```

**Build**

- Root: a `div` with `role='status'` (`role='alert'` for the error), `w-90 max-w-full`, and `grid min-h-11 grid-cols-[auto_1fr_auto] items-center gap-x-3 px-3`.
- Icon: in `Text $text={role}` with `flex`; a neutral icon uses `ak-ink-60`.
- Title: `Text` with `font-medium`. Sentence: `Text render={<p />}` with `col-start-2 text-sm ak-ink-60`.
- Action: `Button $size='sm' $border`, or `Link` with `ArrowUpRight` for a GitHub link.
- Error ID: `Code $layer={false}` in the sentence line.
  **Copy** (the same in each variant)
- `caught-up`: `All caught up`. Icon `CircleCheck`, success.
- `first-use`: `No runs yet`; `Run the visual tests in CI to create the baseline.`; link `Open workflow`. Icon `CircleDashed`, neutral.
- `no-match`: `No match`; button `Clear filters`. Icon `SearchX`, neutral.
- `no-alerts`: `No alerts`; `Checked now`. Icon `CircleCheck`, success.
- `not-required`: `Nothing to review`; `This pull request does not need visual tests.`; link `Open on GitHub`. Icon `CircleCheck`, neutral.
- `error`: `Could not load runs`; `Try again in a moment.`; `Error ID req_01JZ8Q2N5K`; button `Retry`. Icon `TriangleAlert`, danger.
  **Behavior**: `Retry` calls `refresh()`; while it runs the button has `aria-busy='true'`.
  **Budget**: a title of at most 4 words, a sentence of at most 10, one action.

## Variant `card`: Centered card

A dashed frame with a tinted icon disc, a short title, one sentence, and one button.

Ideas:

- The familiar pattern, with a strict word budget.
- One width for each message, so the card does not change size between states (audit finding DASH-26).
- The icon takes a status color through `$text`, which the app fails to do today (DASH-06).

Tradeoffs:

- A card for the words `All caught up` is a lot of frame.
- It takes about 160 px of height.
- Six states with the same card can look alike; only the icon and the color differ.

### Spec

**Sketch**

```text
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│               (✓)                │
│          All caught up           │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│               (▲)                │
│       Could not load runs        │
│     Try again in a moment.       │
│   Error ID req_01JZ8Q2N5K        │
│           [ Retry ]              │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**Build**

- The empty state recipe: `Frame $border $borderType='dashed' $rounded='2xl' $p='2rem'` with `grid w-90 max-w-full justify-items-center gap-3 text-center`, and `role='status'` (`role='alert'` for the error).
- Icon disc: `Frame $layer={role} $mix={15} $rounded='full' $p={3}` with the icon at `size-6` in `Text $text={role}`. A neutral disc is `Frame $lightnessOffset={2}`.
- Title: `Heading` with `mt-0 mb-0 text-base`. Sentence: `Text` with `text-sm ak-ink-70`.
- Action: `Button $lightnessOffset $size='sm'`. A GitHub link is `Button render={<a />}` with an `ArrowUpRight` slot.
- Error ID: `Text` with `text-xs ak-ink-60` and `Code`.
  **Copy**
- `caught-up`: `All caught up`.
- `first-use`: `No runs yet`; `Run the visual tests in CI to create the baseline.`; `Open workflow`.
- `no-match`: `No match`; `Clear filters`.
- `no-alerts`: `No alerts`; `Checked now`.
- `not-required`: `Nothing to review`; `This pull request does not need visual tests.`; `Open on GitHub`.
- `error`: `Could not load runs`; `Try again in a moment.`; `Error ID req_01JZ8Q2N5K`; `Retry`.
- Icons and roles as in the variant `line`: `CircleCheck` success, `CircleDashed` neutral, `SearchX` neutral, `CircleCheck` success, `CircleCheck` neutral, `TriangleAlert` danger.
  **Behavior**: `Retry` keeps the card and sets `aria-busy='true'` on the button.
  **Budget**: a title of at most 4 words, a sentence of at most 10, one action.

## Variant `context`: Empty with context

The empty place shows the next useful thing: recent passed runs, the setup steps, the active filters, or the capacity meters.

Ideas:

- An empty page becomes useful, not only quiet.
- First use shows three steps, so the reader knows what is missing.
- No match shows the active filters as badges that can be removed one by one.
- No alerts shows the two capacity meters, which the Status page has in any case.

Tradeoffs:

- More words than the other variants: up to 30.
- The content differs for each state, so it is six small designs, not one.
- The recent runs are a second list on the Queue.

### Spec

**Sketch**

```text
✓ All caught up
Recently passed
✓ main   Refactor Form field spacing tokens (#4840)      1 d
✓ #4840  Refactor Form field spacing tokens              1 d
✓ #4837  Fix Disclosure content height when the text…    1 d
```

**Build**

- Root: a `div` with `role='status'` (`role='alert'` for the error) and `grid w-90 max-w-full gap-3`.
- Head line: the icon in `Text $text={role}` and the title in `Text` with `font-medium`.
- Section label: `Text` with `text-xs ak-ink-60`.
- `caught-up`: the three newest passed runs of `recentRuns` as rows of the run row `line` (a `Nav` with `NavLink`, mark, number, title, age).
- `first-use`: `List $gap={2}` with three `ListItem checked={false}` steps; package and command names in `Code`. Then `Link` `Open workflow`.
- `no-match`: the search text as `Badge $forceRounded` with a remove `Button`; then `Button $size='sm' $border` `Clear filters`; then `Text` with `text-xs ak-ink-60`.
- `no-alerts`: two meters: a label line and `Progress` with `value={412.6 / 900}`; a label line and `Progress` with `value={1 / 8}`.
- `not-required`: the sentence, the head commit in `Code`, and `Link` `Open on GitHub`.
- `error`: the sentence, `Button $size='sm' $lightnessOffset` `Retry`, the Error ID in `Code`, and `Link render={<LabLink to='status' />}`.
  **Copy**
- `caught-up`: `All caught up`; `Recently passed`.
- `first-use`: `No runs yet`; steps `Capture with @visonaut/playwright`, `Run visonaut submit in CI`, `Approve the first run on main`; `Open workflow`.
- `no-match`: `No match`; badge `datepicker`; `Clear filters`; `Search covers the latest 100 runs`.
- `no-alerts`: `No alerts`; `Checked now`; `Database 412.6 of 900 MiB`; `Active runs 1 of 8`.
- `not-required`: `Nothing to review`; `This pull request does not need visual tests.`; `5d485b5`; `Open on GitHub`.
- `error`: `Could not load runs`; `Try again in a moment.`; `Retry`; `Error ID req_01JZ8Q2N5K`; `Check Status`.
  **Behavior and keys**: the recent rows are links; J, K, and Enter work in them as in a run list.
  **Budget**: 30 words at most.

## Variant `pair`: Baseline equals current

A small picture in the visual language of the product: two equal screenshots for nothing changed, an empty baseline frame for first use, a broken frame for an error.

Ideas:

- The empty state says what the product does: it compares two images.
- Two equal thumbnails with an equals sign say `nothing changed` without a sentence.
- The pictures use the mock screenshots and the theme tokens, so the look controls apply.
- Not in the audit: a new idea.

Tradeoffs:

- It is decoration: about 120 px for a state that needs three words.
- Production needs static pictures or the last baseline thumbnails, which is new data.
- No alerts has no picture that fits; it falls back to the line form.

### Spec

**Sketch**

```text
┌────────┐   ┌────────┐        ┌ ─ ─ ─ ─┐   ┌────────┐       ┌────────┐
│ Button │ = │ Button │        │         │ → │ Button │       │   ⚠    │
└────────┘   └────────┘        └ ─ ─ ─ ─┘   └────────┘       └────────┘
 All caught up                  No runs yet                   Could not load runs
```

**Build**

- Root: a `div` with `role='status'` (`role='alert'` for the error) and `grid w-90 max-w-full justify-items-center gap-3 text-center`.
- Picture frame: `Frame $darken $border $rounded='md'` with `w-28 aspect-[8/3] overflow-clip`, and an `img` with `alt=''` and `size-full object-cover`.
- Images: `getScreenshot({ scene: 'button', scheme, state: 'baseline' })`, where `scheme` is `usePreview().theme`.
- Sign between the frames: `Text` with `ak-ink-50` and the icon `Equal` or `ArrowRight`.
- Empty frame: `Frame $border $borderType='dashed' $rounded='md'` of the same size.
- Title: `Heading` with `mt-0 mb-0 text-base`. Sentence: `Text` with `text-sm ak-ink-70`. Action: `Button $lightnessOffset $size='sm'`.
  **Pictures**
- `caught-up`: two equal baseline frames and `Equal`.
- `first-use`: an empty dashed frame, `ArrowRight`, and one screenshot frame.
- `no-match`: one screenshot frame with `$mix`-free low ink: put `Frame $layer $lighten` over it at 70 percent opacity, and `SearchX` in the center.
- `no-alerts`: no picture; the line form with a success `CircleCheck`.
- `not-required`: two empty dashed frames and `Equal`.
- `error`: one frame with `$edge='danger'` and `TriangleAlert` in `Text $text='danger'` in its center.
  **Copy**
- `caught-up`: `All caught up`.
- `first-use`: `No runs yet`; `Run the visual tests in CI to create the baseline.`; `Open workflow`.
- `no-match`: `No match`; `Clear filters`.
- `no-alerts`: `No alerts`; `Checked now`.
- `not-required`: `Nothing to review`; `This pull request does not need visual tests.`; `Open on GitHub`.
- `error`: `Could not load runs`; `Try again in a moment.`; `Error ID req_01JZ8Q2N5K`; `Retry`.
  **Budget**: a title of at most 4 words, a sentence of at most 10, one action.

## Variant `live`: Live

The empty state shows that the page watches for work: a small ring counts down to the next check, and an error retries by itself.

Ideas:

- An empty Queue is a waiting state, so it shows the wait: `Checks again in 15 s`.
- The reader does not need the Refresh button, which blanks the page today.
- A failed load retries three times before it asks for a click.
- Not in the audit as an empty state: a new idea.

Tradeoffs:

- The run list does not poll in the app today; the audit asks for a decision on the cost (DASH-19).
- A countdown is motion on a quiet page; it must stop with reduced motion.
- A wrong promise if the tab is hidden and the poll pauses.

### Spec

**Sketch**

```text
✓ All caught up                 (◔) Checks again in 15 s
◌ No runs yet                   (◌) This page updates when a run arrives
▲ Could not load runs           (◔) Retrying in 5 s        [ Retry now ]
  Error ID req_01JZ8Q2N5K
```

**Build**

- Root: a `div` with `role='status'` (`role='alert'` for the error) and `grid w-90 max-w-full gap-2`.
- Head line: the icon in `Text $text={role}` and the title in `Text` with `font-medium`.
- Live line: `Text` with `flex items-center gap-2 text-sm ak-ink-60 tabular-nums`; first a `span` with `size-[1lh] p-0.5` that holds `ProgressCircular` with `aria-hidden` and `$thickness={0.75}`; the value is the share of the interval that passed. Without a value the ring turns.
- Countdown: local state that an interval lowers each second; at zero call `refresh()` and start again. With `prefers-reduced-motion` the ring is static and the text stays.
- Action: `Button $size='sm' $border`.
  **Copy**
- `caught-up`: `All caught up`; `Checks again in 15 s`.
- `first-use`: `No runs yet`; `This page updates when a run arrives`; link `Open workflow`.
- `no-match`: `No match`; button `Clear filters`. No live line.
- `no-alerts`: `No alerts`; `Checks again in 60 s`.
- `not-required`: `Nothing to review`; `This pull request does not need visual tests.`; link `Open on GitHub`. No live line.
- `error`: `Could not load runs`; `Retrying in 5 s`; button `Retry now`; `Error ID req_01JZ8Q2N5K`. After three tries the live line reads `Try again in a moment.` and the button reads `Retry`.
- Icons and roles as in the variant `line`.
  **Behavior**: only the number in the live line changes; do not announce each second: the live line has `aria-live='off'`, and the title line carries the status role.
  **Budget**: 10 words.
