# Service alert (alert-card)

Group: inbox
Question: How should one service alert look on the Status page and in the header popover?
Description: One unresolved service alert: what is wrong, what it blocks, since when, and what to do.
Layout: stack

## Scenarios

- `critical` (Critical): The GitHub check alert: critical, 47 minutes old, seen 6 times, last 2 minutes ago, with a link to its run.
- `warning` (Warning with capacity): The database capacity alert: 742.4 of 900 MiB, 2 days old, seen 213 times.
- `expanded` (Details open): The backup alert with its action text of 34 words and its details open.
- `unknown` (Unknown kind): An alert of the kind staged-retention with the code delete-failed, for which the client has no title, impact, or action text.
- `popover` (In a popover): The three alerts in a 360 px wide header popover.
- `overflow` (Fifty alerts): Fifty alerts with more on the server: the list and its note.
- `stale` (Out of date): The last refresh failed and the three alerts on screen can be old.

## Variant `line`: One line (minimal)

A row with the severity mark, a short title, the subject, and the age; it opens to the impact, the action, and the details.

Ideas:

- Seven alerts fit where two cards fit today.
- The title is a noun of one or two words: `GitHub check`, not `A GitHub check needs attention`.
- The age is on the face and is relative.
- The prose is one disclosure away, for one alert at a time.

Tradeoffs:

- The recovery action and the last-seen time are behind the disclosure; the review guide lists them as parts of each alert.
- The severity is an icon with a hidden word.
- `severity`, `impact`, and `occurrences` are not in the API today.

### Spec

**Sketch**

```text
▲  GitHub check        dc0dd58c            47 min  ⌄
△  Database capacity   742.4 of 900 MiB    2 d     ⌄
△  Backup              backup-2026-10-04…  14 h    ⌃
   The newest recovery point is older than one day.
   Check backup access and storage, then inspect the backup row state. …
   Kind backup · Code copy-failed · Seen 14 times, last 1 h ago          Recovery guide ↗
```

**Build**

- Data: `useStatus('alerts')`; for `overflow` use `useStatus('overflow')`.
- List: `DisclosureGroup $border $rounded='xl' $p={1}`; one `Disclosure` for each alert.
- Row: `DisclosureButton` with `indicator='chevron-down-end'` and `icon` set to the severity icon in `Text $text={role}` (`OctagonAlert` danger for critical, `TriangleAlert` warning for warning, with a visually hidden word).
- In the button: the title in `font-medium`, the subject in `Code $layer={false}` (8 characters, the full value in `title`), and the age in `Text render={<time />}` from `firstSeenAt` without `ago`.
- Content: the impact in `Text`; the action in `Text` with `text-sm ak-ink-70`; a details line in `text-xs ak-ink-60` with `Code` values; links at the end.
  **Copy**
- Titles: `GitHub check`, `Database capacity`, `Backup`; an unknown kind: `Service operation`.
- Details: `Kind`, `Code`, `Seen 6 times, last 2 min ago`. Links: `Open run` (when `runId` exists), `Recovery guide`.
- Notes: `Showing the latest 50`; `These alerts may be out of date.` with a `Retry` button.
  **Behavior and keys**: Enter or Space opens a row; the arrow keys of the disclosure group move between rows.
  **Scenarios**
- `critical`: one closed row; the open content has `Open run`.
- `warning`: the subject place has `742.4 of 900 MiB`.
- `expanded`: the backup row open, as in the sketch, with the full action text.
- `unknown`: `Service operation` and `staged-retention` in `Code`; the content has only the details line and `Recovery guide`.
- `popover`: three rows in `w-90`; the subject hides.
- `overflow`: the 50 rows in a `Frame` with `max-h-96 overflow-auto`; then the note.
- `stale`: the note above the list in `Text $text='warning'`; the rows use `ak-ink-70`.
  **At 390 px**: as in the popover.
  **Budget**: 5 words on the face.

## Variant `impact`: Impact first

A tinted row of two lines that starts with what the alert blocks for a reviewer, then names the system and the links.

Ideas:

- The reader is a reviewer: the first line says what they lose, not which system has a fault.
- The tint and the edge color give the severity at a glance.
- The capacity alert shows a meter in place of two sentences of numbers.

Tradeoffs:

- `impact` and `severity` are not in the API today; an unknown kind has no impact sentence.
- A sentence on each row: three alerts are about 40 words.
- A list of 50 tinted rows is loud.

### Spec

**Sketch**

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▲  The pull request does not show its Visonaut result.               47 min  │
│    GitHub check · seen 6 times · Open run · Recovery guide ↗         Steps ⌄ │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Build**

- Row: the callout recipe: `Frame $layer={role} $mix={12} $border $edge={role} $rounded='xl' $p={3}` with `flex items-start gap-3`; rows stack with `gap-2`.
- Icon: in `Text $text={role}` with `flex h-lh items-center`.
- Text block: `grid flex-1 gap-0.5`: the impact in `Text` with `font-medium`; then `Text` with `text-sm ak-ink-70` for the title, the count, and the links (`Link` with `text-sm`).
- Age: `Text render={<time />}` in `text-sm ak-ink-60`.
- Steps: `ak.DisclosureProvider`, `ak.Disclosure render={<Button $size='sm' $forceRounded />}`, and `ak.DisclosureContent` with an ordered `List $marker='counter'` (one item for each sentence of the action) and a details line with `Code`.
- Capacity: `Progress` with `aria-label='Database'`, `value={742.4 / 900}`, and `fill={{ $layer: 'warning' }}` under the impact.
  **Copy**
- Impact sentences from the data: `The pull request does not show its Visonaut result.`; `New capture runs pause when the database reaches 900 MiB.`; `The newest recovery point is older than one day.`
- Second line: `GitHub check · seen 6 times`; links `Open run`, `Recovery guide`; button `Steps`.
- Capacity line: `Database capacity · 742.4 of 900 MiB`.
- Notes: `Showing the latest 50`; `These alerts may be out of date.` with `Retry`.
  **Scenarios**
- `critical`: as in the sketch, with a danger tint.
- `warning`: the capacity sentence, the meter, and the capacity line.
- `expanded`: the backup row with `Steps` open: three numbered sentences and `Kind backup · Code copy-failed · First seen 14 h ago · Last seen 1 h ago`.
- `unknown`: the first line is `Service operation`; the second is `staged-retention · delete-failed · Recovery guide`; a neutral tint.
- `popover`: three rows with `$p={2}` in `w-90`; the links go under the title.
- `overflow`: the 50 rows in a `Frame` with `max-h-96 overflow-auto`; then the note.
- `stale`: the note above the rows in `Text $text='warning'`; the rows keep their tint.
  **At 390 px**: the age goes to the second line.
  **Budget**: one sentence and 8 words in a row.

## Variant `runbook`: Runbook card

A card with a tinted head band, the impact, the action as numbered steps, and the identifiers with a copy button, all visible.

Ideas:

- For the operator: each part that the review guide asks for is on the face: action, subject, first seen, last seen.
- The action text becomes steps, one sentence each.
- The identifiers line up and the subject can be copied.

Tradeoffs:

- Tall: three alerts take about 600 px, and 50 take a very long page.
- Most words of all the variants: about 50 for an alert.
- A reviewer who is not the operator reads text that is not for them.

### Spec

**Sketch**

```text
┌ (Critical)  GitHub check ──────────────────────── since 47 min · seen 6 times ┐
│ The pull request does not show its Visonaut result.                            │
│ 1. Check GitHub App access and service availability.                           │
│ 2. Follow the recovery guide to resume the check.                              │
│ Kind check-delivery   Code exhausted   Subject dc0dd58c-4159-…  ⧉              │
│ First seen 47 min ago   Last seen 2 min ago        Open run   Recovery guide ↗ │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Build**

- Card: `Frame $lighten $border $rounded='2xl' $p='1rem'` with `grid gap-3`; cards stack with `gap-3`.
- Head band: `Frame $cover $layer={role} $mix={12} $p={3}` with `flex flex-wrap items-center gap-2 border-b`: `Badge $layer={role}` with the severity word, `Heading` with `mt-0 mb-0 text-base`, and the times in `Text` with `ms-auto text-sm ak-ink-70`.
- Impact: `Text render={<p />}`.
- Steps: `List ordered $marker='counter' $gap={1}` with one `ListItem` for each sentence of `alert.action` (split at a period and at `, then`).
- Identifiers: a `dl` with `grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm`; labels in `ak-ink-60`, values in `Code`; the subject has a copy `Button $size='xs'` with `aria-label='Copy subject'`.
- Links: `Link` for `Open run` and `Recovery guide` (with `ArrowUpRight`).
  **Copy**: badge `Critical` or `Warning`; `since 47 min · seen 6 times`; labels `Kind`, `Code`, `Subject`, `First seen`, `Last seen`; links `Open run`, `Recovery guide`; notes `Showing the latest 50` and `These alerts may be out of date.` with `Retry`.
  **Scenarios**
- `critical`: as in the sketch.
- `warning`: under the impact, a line `Database 742.4 of 900 MiB` with `Progress` (`value={742.4 / 900}`) and a line `Active runs 3 of 8` with `Progress`.
- `expanded`: the backup card with its three steps; nothing more to open.
- `unknown`: a neutral head band with `Service operation`; no impact and no steps; the identifiers and `Recovery guide` only.
- `popover`: the head band and the impact stay; the steps and the identifiers go behind a `Disclosure` with the button `Steps`.
- `overflow`: the first three cards are complete; the others show the head band only, in a `DisclosureGroup`; then the note.
- `stale`: the note above the cards in `Text $text='warning'`.
  **At 390 px**: as in the popover.
  **Budget**: about 50 words for an alert.

## Variant `table`: Incident table

A dense table with the severity, the alert, the subject, since, last seen, and the count; a row opens to the impact and the action.

Ideas:

- Fifty alerts fit on one or two screens.
- The operator can sort and scan times and counts in columns.
- The subject is in the mono font with a copy button.

Tradeoffs:

- A table does not fit a 360 px popover: there it keeps two columns.
- The impact and the action are behind a click.
- `occurrences` is not in the API today, and two writers do not raise the count, so the column can be wrong for those alerts.

### Spec

**Sketch**

```text
     Alert               Subject               Since     Last seen     Seen
 ▲   GitHub check        dc0dd58c ⧉            47 min    2 min ago        6   ⌄
 △   Database capacity   742.4 of 900 MiB      2 d       4 min ago      213   ⌄
 △   Backup              backup-2026-10-04…    14 h      1 h ago         14   ⌃
     The newest recovery point is older than one day.
     Check backup access and storage, then inspect the backup row state. …   Recovery guide ↗
```

**Build**

- `Table` with parts, `aria-label='Alerts'`, `container={{ $border: true }}`, `$borderInline={false}`, `$p={2}`, and `className='text-sm'`.
- Head cells: an unnamed severity column (`$fit`), Alert (`$grow`), Subject, Since (`$fit`, `sort`), Last seen (`$fit`, `sort`), Seen (`numeric $fit`, `sort`), and an unnamed toggle column.
- Severity cell: the icon in `Text $text={role}` with `role='img'` and `aria-label` (`Critical` or `Warning`).
- Alert cell: `TableCell header='row'` with the title. Subject: `Code $layer={false}` and a copy `Button $size='xs' $forceRounded` with `aria-label='Copy subject'`.
- Toggle: an icon `Button $size='sm' $forceRounded` with `aria-expanded` and `aria-label='Details of GitHub check'`.
- Open row: one more `TableRow` with a `TableCell colSpan={7}`: the impact, the action in `ak-ink-70`, `Kind` and `Code` in `Code`, and the links.
  **Copy**: head `Alert`, `Subject`, `Since`, `Last seen`, `Seen`; links `Open run`, `Recovery guide`; footer `Showing the latest 50`; caption `These alerts may be out of date.` with `Retry`.
  **Behavior and keys**: the sort is local state; the default is Last seen, newest first.
  **Scenarios**
- `critical`: the table with one row, closed.
- `warning`: the Subject cell has `742.4 of 900 MiB`.
- `expanded`: the three alerts with the backup row open.
- `unknown`: Alert `Service operation`, Subject `staged-retention`; the open row has `Kind`, `Code`, and `Recovery guide` only.
- `popover`: in `w-90`, `@max-md:` hides Subject, Last seen, and Seen.
- `overflow`: 50 rows; the container has `max-h-96` and the head has `$sticky: 'top'`; a footer row has the note.
- `stale`: the caption above the table in `Text $text='warning'`.
  **At 390 px**: as in the popover.
  **Budget**: 5 head words; a row has only its title.

## Variant `pulse`: Recurrence strip

Each alert has a small time strip from first seen to now with a tick for each occurrence, so the reader sees if the fault is still active.

Ideas:

- The first question of an operator is whether it still happens: the strip and one word answer it.
- `Active` and `Quiet` replace two absolute dates.
- The capacity alert uses the same place for its meter with the warning level marked.
- Not in the audit: a new idea.

Tradeoffs:

- The API has only the count, the first time, and the last time, so the tick places are an estimate.
- `occurrences` is not in the API today.
- A strip for each alert is more ink than a relative time.
- The words `Active` and `Quiet` are new and not in the terminology table.

### Spec

**Sketch**

```text
▲ GitHub check                                                 Active · 2 min ago
  ╎   ╎  ╎    ╎   ╎  ╎|                                        6 times in 47 min
  47 min ago ─────────────────────── now
  The pull request does not show its Visonaut result.          Open run · Recovery guide ↗
```

**Build**

- Card: `Frame $lighten $border $rounded='xl' $p='1rem'` with `grid gap-2`; cards stack with `gap-2`.
- Head line: the severity icon in `Text $text={role}`, the title in `font-medium`, and at the end `Text` with `text-sm`: the word in `Text $text={role}` for `Active` or in `ak-ink-60` for `Quiet`, then the last-seen time.
- Strip: a `div` with `role='img'`, an `aria-label` such as `Seen 6 times in 47 minutes, last 2 minutes ago`, and `relative h-4`. Track: `Frame $lightnessOffset={2} $rounded='full' $forceRounded` with `absolute inset-x-0 top-1/2 h-px`. Tick: `Frame $layer={role} $rounded='full' $forceRounded` with `absolute h-3 w-0.5` and an inline `insetInlineStart` in percent. Spread the ticks evenly from the first to the last time; draw at most 24, and above that one band of `$layer={role} $mix={40}`.
- Scale line: `Text` with `text-xs ak-ink-60 flex justify-between`.
- Last line: the impact in `Text` with `text-sm`, then the links.
- Steps: `Disclosure` with the button `Steps`; inside, the action as an ordered `List` and `Kind` and `Code` in `Code`.
  **Copy**: `Active` when the last time is less than 10 minutes old, else `Quiet`; `6 times in 47 min`; scale `47 min ago` and `now`; links `Open run`, `Recovery guide`; `Steps`; notes `Showing the latest 50` and `These alerts may be out of date.` with `Retry`.
  **Scenarios**
- `critical`: as in the sketch.
- `warning`: in place of the strip, `Progress` with `value={742.4 / 900}` and a tick at 78 percent for the warning level; `Database 742.4 of 900 MiB`; the head reads `Active · 4 min ago`.
- `expanded`: the backup card: `Quiet · 1 h ago`, `14 times in 14 h`, and `Steps` open.
- `unknown`: `Service operation` and `staged-retention` in `Code`; the strip shows; no impact line.
- `popover`: in `w-90` the scale line hides and the links go under the impact.
- `overflow`: the first eight cards in a `Frame` with `max-h-96 overflow-auto`; then the note.
- `stale`: the note above the cards in `Text $text='warning'`; the scale end reads `last check` in place of `now`.
  **At 390 px**: as in the popover.
  **Budget**: one sentence and 10 words for an alert.
