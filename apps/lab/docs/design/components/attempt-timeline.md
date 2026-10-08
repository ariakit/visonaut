# Pull request attempts (attempt-timeline)

Group: inbox
Question: How should a pull request show its commits and attempts?
Description: The runs of one pull request by commit and attempt, with the one run that takes decisions now and a way out of an old run.
Layout: stack

## Scenarios

- `attempts` (Several attempts): #4863 with three runs over two commits: attempt 2 of the latest commit is rejected with 22 changes, attempt 1 failed, the earlier commit was replaced.
- `single` (One run): #4852 with one run that passed with 2 approved changes.
- `many` (Many runs): Seven runs over four commits: the three runs of #4863 and four copies of the replaced run with other commits and ages of 6 h, 9 h, 1 d, and 2 d.
- `old-link` (Old run): The reader opened the replaced run of commit b5745ee from an old link, and a newer run takes the decisions.
- `waiting` (Waiting for CI): #4849 has no run yet; the capture of its latest commit is on its way.
- `capture-failed` (Tests failed): #4849 has no run because the visual tests failed in CI.
- `not-required` (Nothing to review): #4825 changes documentation only and needs no visual tests.
- `loading` (Loading): The first load: a skeleton with the final geometry.

## Variant `current`: Current run only (minimal)

One line for the run that matters now with its action; the earlier runs are one closed disclosure.

Ideas:

- Most visits need only the current run, so only that run is on screen.
- The earlier runs cost one click and no page.
- An old link shows one callout with a link to the current run: no dead end.

Tradeoffs:

- The history of attempts is hidden by default.
- A failed earlier attempt is not visible until the disclosure opens.
- The list of runs of a pull request is not in the API today.

### Spec

**Sketch**

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ✕ Rejected   22 changes · 2 rejected   76a809f · attempt 2 · 12 min ago  [ Review ↵ ]│
└──────────────────────────────────────────────────────────────────────────────────┘
▸ 2 earlier runs
     ▲ Failed     76a809f · attempt 1 · 41 min ago   The Safari capture shard did not…
     → Replaced   b5745ee · attempt 1 · 3 h ago
```

**Build**

- Data: `usePull(scenario)`; the current run is `reviewRun ?? latestRun`.
- Current line: `Frame $lighten $border $rounded='xl' $p='1rem'` with `flex flex-wrap items-center gap-x-4 gap-y-2`: the status mark (glyph in `Text $text={role}` and the word in `font-medium`), the state text, the identity in `Text` with `text-sm ak-ink-60` and the commit in `Code $layer={false}`, then the action with `ms-auto`.
- Action: `Button $layer='brand' render={<LabLink to='review' scenario='changes' />}` with `ButtonLabel` and `ButtonSlot $kind='shortcut'`. A run without decisions gets `Button $lightnessOffset` `Open`.
- Earlier runs: `Disclosure` with `button={<DisclosureButton indicator='chevron-right-start' />}`; inside it a `Nav` with `render={<div />}` and one `NavLink` for each run (mark, word, identity, age, and the error sentence cut at one line).
- Callout: the callout recipe, `Frame $layer='warning' $mix={12} $border $edge='warning' $rounded='xl' $p={3}`.
  **Copy**: `Review` with `↵`; `Open`; `2 earlier runs`; callout `A newer run replaced this one`, `Decisions here do not change the check.`, link `Open the current run`; tag `Viewing`.
  **Behavior and keys**: Enter on the root follows the action. The disclosure is closed at first.
  **Scenarios**
- `attempts`: as in the sketch, closed.
- `single`: `✓ Passed   2 changes approved   775a8c8 · 3 h ago   [ Open ]`; no disclosure.
- `many`: the current line and `6 earlier runs`.
- `old-link`: the callout, the current line, and the disclosure open, with the tag `Viewing` on the replaced run.
- `waiting`: one line: a `ProgressCircular` that turns, `Waiting for CI`, `This page opens the review when the screenshots arrive.`, `Checked now`, and the link `Open on GitHub`.
- `capture-failed`: `▲ Visual tests failed`, `Open the failing check on GitHub.`, and the link `Open check`.
- `not-required`: `✓ Nothing to review`, `This pull request does not need visual tests.`
- `loading`: one skeleton line of the final height.
  **At 390 px**: the line wraps to three lines; the action takes the full width.
  **Budget**: 12 words closed.

## Variant `table`: Runs table

A table with one row for each run: commit, attempt, status, changes, duration, and age, with the action on the run that takes decisions.

Ideas:

- Each run of the pull request is visible and comparable in columns.
- The row of the opened run is marked, which fixes old links.
- Duration shows a capture that was slow or cut short.

Tradeoffs:

- Seven rows for a pull request with many pushes; most are Replaced.
- Duration and the list of runs are not in the API today.
- A pull request view with all its runs reopens the note that a title feature does not need another dashboard (group G21).
- At 390 px three columns must go.

### Spec

**Sketch**

```text
 Commit    Attempt  Status         Changes           Time     When
 76a809f   2        ✕ Rejected     22 · 2 rejected   4m 12s   12 min ago   [ Review ]
 76a809f   1        ▲ Failed       —                 2m 05s   41 min ago
                    The Safari capture shard did not upload its screenshots.
 b5745ee   1        → Replaced     —                 4m 40s   3 h ago
```

**Build**

- `Table` with parts, `aria-label='Runs of #4863'`, `container={{ $border: true }}`, `$borderInline={false}`, `$p={2}`, and `className='text-sm'`.
- Head cells: Commit (`$fit`), Attempt (`numeric $fit`), Status (`$grow`), Changes (`$fit`), Time (`$fit`), When (`$fit`), and an unnamed action column.
- Commit: `Code $layer={false}`; the latest commit adds `Text` `latest` in `text-xs ak-ink-60`.
- Status: `Badge $layer={role} $forceRounded` with `BadgeSlot` and `BadgeLabel`; a failed run adds its error sentence under the badge in `Text` with `text-xs ak-ink-70`.
- Time: `formatDuration(run.durationMs)`. When: `Text render={<time />}`.
- Action cell: `Button $size='sm' $layer='brand' $forceRounded render={<LabLink />}`; other rows have `Link` `Open`.
  **Copy**: head `Commit`, `Attempt`, `Status`, `Changes`, `Time`, `When`; `latest`; `Review`; `Open`; tag `Viewing`; an em dash with `aria-label='None'` in an empty Changes cell.
  **Behavior and keys**: J, K, and the arrow keys move between rows; Enter opens the focused row.
  **Scenarios**
- `attempts`: as in the sketch.
- `single`: one row: `775a8c8`, `1`, `Passed`, `2 approved`, `8m 09s`, `3 h ago`, `Open`.
- `many`: seven rows; the container has `max-h-80` and the head has `$sticky: 'top'`.
- `old-link`: the table has `role='grid'`; the replaced row has `selected` and the tag `Viewing`; the callout of the variant `current` stands above the table.
- `waiting`, `capture-failed`, `not-required`: no table; one line with the mark, the title, and the sentence: `Waiting for CI` and `This page opens the review when the screenshots arrive.`; `Visual tests failed` and `Open the failing check on GitHub.`; `Nothing to review` and `This pull request does not need visual tests.`
- `loading`: the head row is real; three body rows have bars.
  **At 390 px**: `@max-md:` hides Attempt, Time, and the badge label; the attempt goes after the commit as `· 2`.
  **Budget**: 6 head words; a row has the state word and at most 3 more.

## Variant `rail`: Commit rail

A vertical timeline with one node for each commit and its attempts under it, newest first.

Ideas:

- The order in time is visible: which commit, which attempt, what happened.
- Attempts of one commit stay together, so a rerun reads as a rerun.
- Earlier commits fold into one line when there are many.

Tradeoffs:

- It takes more height than a table for the same runs.
- The current run is not larger than the others; only its button marks it.
- Runs by commit need the list of runs, which is not in the API today.

### Spec

**Sketch**

```text
● 76a809f  latest
│   ✕ Attempt 2 · Rejected · 22 changes · 2 rejected        12 min ago   [ Review ↵ ]
│   ▲ Attempt 1 · Failed · The Safari capture shard did…    41 min ago
○ b5745ee
    → Attempt 1 · Replaced                                   3 h ago
```

**Build**

- Data: `usePull(scenario).commits` (newest commit first, attempts newest first).
- Rail: `List $guide $gap={4}` with one `ListItem` for each commit: the commit in `Code` and, for the latest commit, `Text` `latest` in `text-xs ak-ink-60`.
- Attempts under a commit: a `Nav` with `render={<div />}`, `$slotSize={5}`, and hover and focus gliders; each attempt is `NavLink render={<LabLink />}` with `NavSlot` (state icon in `Text $text={role}`), `NavLinkLabel` (attempt, state word, state text or error), and the age at the end.
- Action: `Button $size='sm' $layer='brand' $forceRounded` after the row of the run that takes decisions; it is not inside the link.
- Fold: `Disclosure` with a `DisclosureButton` that has `indicator='chevron-right-start'`.
  **Copy**: `latest`; `Attempt 2 · Rejected · 22 changes · 2 rejected`; `Attempt 1 · Failed` and the error sentence; `Attempt 1 · Replaced`; `Review` with `↵`; `2 earlier commits`; tag `Viewing`.
  **Behavior and keys**: J, K, and the arrow keys move between attempt rows; Enter opens the focused one.
  **Scenarios**
- `attempts`: as in the sketch.
- `single`: one node `775a8c8  latest` with `✓ Attempt 1 · Passed · 2 changes approved`.
- `many`: the two newest commits are open; `2 earlier commits` holds the rest.
- `old-link`: the replaced attempt has `aria-current='true'` and the tag `Viewing`; the callout of the variant `current` stands above the rail.
- `waiting`: one node `3f61a93  latest` with a row `Waiting for CI` and a `ProgressCircular` that turns; under it `This page opens the review when the screenshots arrive.`
- `capture-failed`: the node with `▲ Visual tests failed` and the link `Open check`.
- `not-required`: the node `5d485b5  latest` with `✓ Nothing to review`.
- `loading`: two skeleton nodes with one and two row bars.
  **At 390 px**: an attempt row has two lines: the label, then the age and the action.
  **Budget**: 6 words in an attempt row.

## Variant `stepper`: Stage stepper

Four steps for the newest run: Capture, Compare, Review, Passed; the earlier runs are one closed line.

Ideas:

- `Waiting for screenshots` becomes a real stage: the reader sees where the run is.
- A failure points at the step that failed.
- The same four steps serve waiting, review, and done, so the view does not change shape.

Tradeoffs:

- The history of attempts is hidden.
- The API does not say today if a failed run stopped at capture or at compare; the lab reads the error text.
- Four step words on each visit are more words than one status word.

### Spec

**Sketch**

```text
 (✓) Capture ────── (✓) Compare ────── (✕) Review ────── ( ) Passed
                                        22 changes · 2 rejected          [ Review ↵ ]
 76a809f · attempt 2 · 12 min ago                                ▸ 2 earlier runs
```

**Build**

- Steps: an `ol` with `flex items-center gap-2`; each `li` has a disc and a word, and a connector follows it.
- Disc: `Frame $layer={role} $mix={20} $rounded='full' $forceRounded` with `inline-grid size-6 place-items-center` and the icon in `Text $text={role}`. A step that is not reached is `Frame $border $borderType='dashed' $rounded='full' $forceRounded` with `size-6`. The active step of a run in progress holds `ProgressCircular`.
- Connector: `Separator $line='solid' $gap={0}` with `flex-1`; a done connector has `$edgeWeight='bold'`.
- The active step has `aria-current='step'` and its word in `font-medium`.
- Under the steps: the state text, the action (`Button $layer='brand'` with `ButtonSlot $kind='shortcut'`), the identity line in `text-sm ak-ink-60`, and the `Disclosure` of the variant `current` for the earlier runs.
  **Copy**: `Capture`, `Compare`, `Review`, `Passed`; `Review` with `↵`; `2 earlier runs`.
  **Scenarios**
- `attempts`: Capture and Compare done (success `Check`), Review active with a danger `X`, Passed not reached.
- `single`: four success steps; `2 changes approved`; `Open`.
- `many`: as `attempts`, with `6 earlier runs`.
- `old-link`: the steps show the current run; the callout of the variant `current` stands above them.
- `waiting`: Capture active with a ring that turns; under it `Waiting for CI` and `This page opens the review when the screenshots arrive.`
- `capture-failed`: Capture with a danger `X`; `Visual tests failed`; the link `Open check`.
- `not-required`: no steps; one line `✓ Nothing to review` and `This pull request does not need visual tests.`
- `loading`: four skeleton discs and connectors.
  **At 390 px**: the list is vertical (`@max-md:flex-col @max-md:items-start`) and the connectors hide.
  **Budget**: 4 step words and at most 8 more.

## Variant `tabs`: Attempt tabs

One tab for each run; the panel of the selected run shows its state, its thumbnails, and its action in place.

Ideas:

- The reader can look at an old attempt without leaving the page.
- The tab of each run carries its status mark, so the strip is the history.
- The panel has room for thumbnails and the error text.

Tradeoffs:

- Seven tabs need a strip that scrolls.
- The contract replaced tabs with links for variants, as a tab that changes the route breaks modified clicks; these tabs change a panel only.
- The panel needs `previews`, which is not in the API today.

### Spec

**Sketch**

```text
 [ ✕ 76a809f · 2 ]  [ ▲ 76a809f · 1 ]  [ → b5745ee · 1 ]
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ Rejected · 22 changes · 2 rejected · 12 min ago · 4m 12s                        │
 │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                              [ Review ↵ ]  │
 │ └──────┘ └──────┘ └──────┘ └──────┘                                            │
 └───────────────────────────────────────────────────────────────────────────────┘
```

**Build**

- `Tabs` (the default folder kind) with `defaultSelectedId` set to the run that takes decisions, or to the viewed run in `old-link`.
- `TabList aria-label='Runs'` with `overflow-x-auto`; each `Tab` has an `id`, a `TabSlot` with the state icon in `Text $text={role}`, and a `TabLabel` with the commit in the mono font and the attempt.
- One `TabPanel tabId` for each run with `grid gap-3`: a facts line in `Text` (`text-sm`), the thumbnails (`Frame $darken $border $rounded='md' $forceRounded` with `w-24 aspect-[8/5] overflow-clip`), and the action.
- Action: `Button $layer='brand' $forceRounded render={<LabLink />}` with `ButtonSlot $kind='shortcut'`; a run without decisions gets `Button $lightnessOffset $forceRounded` `Open`.
  **Copy**: tab `76a809f · 2`; facts `Rejected · 22 changes · 2 rejected · 12 min ago · 4m 12s`; `Review` with `↵`; `Open`; callout as in the variant `current`.
  **Behavior and keys**: arrow keys move between tabs and show the panel at once. No route change.
  **Scenarios**
- `attempts`: as in the sketch. The failed tab shows `Failed · 41 min ago · 2m 05s` and the error sentence in `Text $text='danger'`.
- `single`: one tab `775a8c8 · 1`; panel `Passed · 2 changes approved · 3 h ago · 8m 09s` and `Open`.
- `many`: seven tabs; the strip scrolls inside its box.
- `old-link`: the replaced tab is selected; its panel starts with the callout and has no Review button; the tab of the current run has a brand dot in a `TabSlot`.
- `waiting`, `capture-failed`, `not-required`: no tabs; one line with the mark, the title, and the sentence, as in the variant `current`.
- `loading`: three skeleton tabs and a panel with two bars.
  **At 390 px**: the strip scrolls; the panel stacks and shows three thumbnails.
  **Budget**: 2 tokens in a tab; 10 words in a panel.

## Variant `lanes`: Commit lanes

One lane for each commit with a dot for each attempt in time order; the newest attempt of the latest commit is larger and has the summary and the action.

Ideas:

- Seven runs take four short lines: the form stays compact with many pushes.
- Dots show the story at a glance: failed, then rejected; replaced.
- A soft line under the latest commit says what carried over from the earlier commit.
- Not in the audit: a new idea.

Tradeoffs:

- Dots are icons without words; the summary names only the newest attempt of each commit.
- `9 approvals carried over` is not in the API today; the lab shows it as a fixed example.
- Dots are small targets: 1.25em.

### Spec

**Sketch**

```text
 76a809f  latest   (▲)──(✕)        Rejected · 22 changes · 2 rejected · 12 min ago   [ Review ↵ ]
                    1    2         9 approvals carried over from b5745ee
 b5745ee           (→)             Replaced · 3 h ago
                    1
```

**Build**

- Data: `usePull(scenario).commits`; inside a lane the attempts go from the oldest to the newest.
- Root: a `div` with `grid grid-cols-[auto_auto_1fr] items-start gap-x-4 gap-y-3`.
- Commit: `Code $layer={false}`, and `Text` `latest` in `text-xs ak-ink-60`.
- Lane: a `div` with `flex items-center`. Dot: `Button render={<LabLink />} $layer={role} $mix={20} $rounded='full' $forceRounded $p='none'` with `size-5`, the state icon, and an `aria-label` such as `Attempt 1, failed`. Under each dot the attempt number in `text-xs ak-ink-60 tabular-nums`. Between dots: `Frame $lightnessOffset={3}` with `h-px w-4`.
- The newest dot of the latest commit has `size-7`.
- Summary: `Text` with the state word in `font-medium`, the state text, and the age; then the action `Button $layer='brand'` with `ButtonSlot $kind='shortcut'`.
- Carried-over line: `Text` with `text-sm ak-ink-60`.
  **Copy**: `latest`; `Rejected · 22 changes · 2 rejected · 12 min ago`; `9 approvals carried over from b5745ee`; `Replaced · 3 h ago`; `Review` with `↵`; `2 earlier commits`; tag `Viewing`.
  **Behavior and keys**: each dot is a link with a `Tooltip` that has the attempt, the state word, and the error sentence.
  **Scenarios**
- `attempts`: as in the sketch.
- `single`: one lane with one success dot; `Passed · 2 changes approved · 3 h ago`; `Open`.
- `many`: four lanes; the two oldest fold into a `Disclosure` `2 earlier commits`.
- `old-link`: the replaced dot has `$border={2} $edge='brand'` and the tag `Viewing` in its summary; the callout of the variant `current` stands above the lanes.
- `waiting`: one lane with an empty dashed dot that pulses; `Waiting for CI`; `This page opens the review when the screenshots arrive.`
- `capture-failed`: a danger dot; `Visual tests failed`; the link `Open check`.
- `not-required`: a neutral dot with a check; `Nothing to review`.
- `loading`: two skeleton lanes.
  **At 390 px**: the summary goes under the lane.
  **Budget**: 8 words in a lane.
