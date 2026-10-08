# Run header (run-header)

Group: shell
Question: How should a run say what it is, where it came from, and how much is left?
Description: The identity of the run under review: the way back, the pull request, the commit and attempt, the status or progress, and the links to GitHub.
Layout: stack

## Scenarios

- `pull` (Pull request): #4863 with a title, attempt 2, 22 changes left and 2 rejected.
- `long-title` (Long title): #4819 with a 170 character title and a 75 character branch, attempt 3.
- `no-title` (No title): A pull request run without a title, as most production runs are today.
- `main` (Main run): A run on main: no pull request and one attempt.
- `read-only` (Read-only): An attempt that a newer run replaced; no decision is possible.
- `comparing` (Comparing): The comparison still runs: 6 of 16 variants are done.
- `loading` (Loading): The run model is not here yet (up to 6 s); only the URL is known.
- `narrow` (Phone, 390): The pull request state in a 390 px wide frame.

## Variant `one-line`: One line

One 44 px row: back, number, title, commit, and one count in words.

Ideas:

- Each fact one time, in reading order: back, what, which code, how much is left.
- The number and the commit are links to GitHub; today the workspace has no link to either.
- `attempt` shows only above 1, and the status is one phrase: no bar, no badge.

Tradeoffs:

- `22 left` drops the total of the contract example `2 of 6 need review` (rule A08).
- A long title is cut, and touch has no tooltip to read it.
- At 390 px the commit and attempt hide, which breaks `commit/run identity above` (rule A06) on a phone.

### Spec

**Sketch**

```text
| <-  #4863  Migrate component examples to the new style recipes   a1b2c3d · attempt 2   22 left · 2 rejected |  44
390
| <-  #4863  Migrate component exam...                                         22 left |
```

**Build** One row in `ShellMainHeader $height='sm'` (or the start slot of the app header): `div className='flex min-w-0 items-center gap-3'`. Back: `TooltipAnchor render={<Button $p={2} aria-label='Queue' render={<a />} />}` with `ArrowLeft`. Number: `Link $text={false} className='flex-none font-medium tabular-nums no-underline'` to the pull request on GitHub. Title: `Text className='min-w-0 truncate'` with the full title in `title`. Commit: `Link $text={false} className='flex-none font-mono text-xs ak-ink-70'` to the commit on GitHub. Count: `Text className='flex-none tabular-nums'`, and `Text $text='danger'` for the rejected part. Lab cell: `Frame $border $rounded='xl' className='h-40 w-full overflow-clip [container-type:size]'` > `Shell $forceRounded className='h-full [--shell-top:0px]!'` with two image stand-in frames (`Frame $darken $rounded='md'`) under the row; `narrow` wraps the cell in `max-w-[24.375rem]`. Data: `pull`, `no-title`, and `narrow` use `useReviewSession('changes')`; `long-title` and `main` use run #4819 and the main run of `getInboxData('busy')`; `read-only`, `comparing`, and `loading` use the review scenario of the same name.
**Copy** Tooltip `Queue`; `attempt 2` (only above 1); `22 left`, `2 rejected`; other states `Passed`, `Replaced`, `Comparing 6 of 16`, `Failed`, `Rerun needed`; link `Open newer run`. Words at rest: 5 plus the title.
**Behavior** One link to the Queue. No text below 12 px; muted text is `ak-ink-70`. Numbers come from `session.progress`; the sha from `shortSha(run.testedSha)`. No key.
**States**

- `pull`: as sketched.
- `long-title`: the title truncates; the number, commit, and count never do (`flex-none`).
- `no-title`: `#4863`, then `Pull request` in `ak-ink-60`.
- `main`: `main` in mono in place of the number; the title is the commit message `Version Packages (#4828)`.
- `read-only`: the count slot shows `Replaced` and the link `Open newer run`.
- `comparing`: the count slot shows a 1lh `ProgressCircular` and `Comparing 6 of 16`.
- `loading`: the back link is real; number, title, commit, and count are skeleton bars (`w-12`, `w-64`, `w-16`, `w-14`) inside `aria-busy='true'`.
- `narrow`: commit, attempt, and `2 rejected` hide.

## Variant `crumb-popover`: Title popover

The title is a button; the run facts live in its popover, to read once for each run.

Ideas:

- Facts that do not change between variants (commit, attempt, baseline, status) leave the row.
- The popover shows the full title, so truncation loses nothing.
- A facts grid with aligned values and two GitHub links replaces the 10 px identity strip.
- A three-part progress bar shows rejected apart from approved.

Tradeoffs:

- Commit and attempt are one click away. This replaces rule A06 and the guide sentence `Check the run identity above the images`; the U02 selection already moves run IDs to Details.
- The popover covers part of the image while it is open.
- The baseline revision is hidden until the popover opens.

### Spec

**Sketch**

```text
| Queue / #4863 Migrate component examples to the new... v       [===:--......] 22 left |  44
          +--------------------------------------------+
          | Migrate component examples to the new      |
          | style recipes                              |
          | Pull request   #4863 ^                     |
          | Commit         a1b2c3d ^                   |
          | Attempt        2                           |
          | Baseline       128                         |
          | Status         Rejected                    |
          +--------------------------------------------+
```

**Build** `ButtonGroup render={<nav aria-label='Location' />} $size='sm' $p='none'` with `Button render={<a />}` (`Queue`), `ButtonSeparator $kind='slash'`, then `PopoverProvider` + `PopoverDisclosure` (`ButtonLabel $truncate`, a chevron `ButtonSlot $size='sm'`). `Popover portal $p={3} $rounded='xl' className='grid max-w-96 gap-3'`: `PopoverHeading className='text-sm font-medium'` (the full title), then `dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'` with `Text render={<dt />} className='ak-ink-60'` and `Link` values (`ArrowUpRight`). Progress: `Frame role='img' $rounded='full' className='flex h-1.5 w-24 overflow-clip'` with three child `Frame`s (`$layer='success'`, `$layer='danger'`, `$lightnessOffset={2}`) sized by `flex-grow`. Lab cell and data: as `one-line`.
**Copy** `Queue`; rows `Pull request`, `Commit`, `Attempt`, `Baseline`, `Status`; `22 left`. Name of the progress: `3 approved, 2 rejected, 22 left`. Words at rest: 3 plus the title.
**Behavior** The popover opens on click, Enter, or Space; Esc closes and returns focus. No key.
**States**

- `pull`: closed.
- `long-title`: the popover drawn open (static, `data-open`): the full title wraps.
- `no-title`: the crumb `#4863 Pull request`; the popover has no heading.
- `main`: the crumb `main · Version Packages (#4828)`; no `Pull request` row.
- `read-only`: a `Badge` `Replaced` takes the place of the progress; the popover adds the row `Newer run` with a link.
- `comparing`: a one-fill `Progress` and `Comparing 6 of 16`.
- `loading`: `Queue /`, then a skeleton crumb and a skeleton bar.
- `narrow`: a back icon, the truncated crumb, and `22`.

## Variant `source-chips`: Source chips

A dense row: a group of GitHub source chips and one segmented progress chip.

Ideas:

- Pull request, commit, and attempt are one `ButtonGroup` of links: each opens its page on GitHub.
- One progress chip with three segments replaces the count text, the gray bar, and the status sentence (today the bar is full and green on a rejected run).
- Identifiers are mono and never truncate; only the title gives way.

Tradeoffs:

- The densest row: five controls and a title compete below 1024 px.
- At 390 px it needs two rows (72 px).
- The attempt link needs the workflow run URL, which is not in the API today.

### Spec

**Sketch**

```text
| <- Queue   Migrate component examples to the n...   [ PR #4863 | a1b2c3d | attempt 2 ]   [##:=........] 5 of 27 |  44
390
| <- Queue   Migrate component exam...                                       |
| [ #4863 | a1b2c3d | 2 ]                                 [##:=......] 5/27 |
```

**Build** Back: `Button $size='sm' render={<a />}` (`ArrowLeft` slot + `ButtonLabel`). Title: `Text className='min-w-0 flex-1 truncate font-medium'`. Sources: `ButtonGroup aria-label='Source on GitHub' $size='sm' $border` with three `Button render={<a />}` (`ButtonSlot`: `GitPullRequest`, `GitCommitHorizontal`, `RotateCw`; `ButtonLabel className='font-mono'`) and `ButtonSeparator` between them. Progress chip: `TooltipAnchor render={<Frame role='img' $border $rounded='full' className='flex flex-none items-center gap-2 px-2 py-1 text-xs tabular-nums' />}` with the three-segment bar of `crumb-popover` and the count; `Tooltip`: `3 approved · 2 rejected · 22 left`. Lab cell and data: as `one-line`.
**Copy** `Queue`, `PR #4863`, `attempt 2`, `5 of 27`. Words at rest: 6 plus the title.
**Behavior** The chip count is decided of total (`progress.decided`, `progress.total`). The attempt chip hides when the attempt is 1. No key.
**States**

- `pull`: as sketched.
- `long-title`: only the title truncates; below a 64rem container the chips drop their icons.
- `no-title`: the title slot shows `Pull request` in `ak-ink-60`; the number stays in its chip.
- `main`: chips `main | a1b2c3d`; the title is the commit message.
- `read-only`: a `Badge` `Replaced` and `Button $size='sm' $border` `Open newer run` replace the progress chip.
- `comparing`: the chip holds a one-fill `Progress` and `6 of 16`.
- `loading`: back is real; the title, the chip group (`w-56`), and the progress chip are skeleton frames.
- `narrow`: two rows, as sketched.

## Variant `title-block`: Title block

The title comes first on its own line, with one meta line under it.

Ideas:

- The title is the `h1` of the page and can wrap to two lines: a long title is readable.
- The meta line has the same facts in the same order as a Queue row: one run line for the whole app.
- Author and branch say whose change this is.

Tradeoffs:

- 60 to 80 px high: 16 to 36 px more than a one-row header, above every screenshot.
- `branch`, `author`, and the run time are not in the review API today.
- If it sticks, it costs its height all the time; if it scrolls away, the identity leaves the screen.

### Spec

**Sketch**

```text
| <-  Migrate component examples to the new style recipes                  [ Rejected ]  22 left |
|     #4863 · refactor/style-recipes · a1b2c3d · attempt 2 · nilsson-sofia · 12 min ago          |  60
```

**Build** `HeadingLevel` + `div className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-2'`. Back: `Button $p={2} aria-label='Queue'`. Title: `Heading className='mt-0 mb-0 text-base font-semibold text-balance line-clamp-2'`. Meta: `Text className='ak-ink-60 text-xs'` with `Link $text={false}` for the number and the commit, and mono for the branch and the sha. Status: `Badge $layer='danger'` + `BadgeLabel`, then `Text className='text-sm tabular-nums'`. Lab cell and data: as `one-line`, at `h-48`.
**Copy** Status words `Needs review`, `Rejected`, `Passed`, `Comparing`, `Replaced`, `Failed`, `Rerun needed`; `22 left`; time from `formatRelativeTime`. Words at rest: 8 plus the title.
**Behavior** Not sticky: it scrolls away with the page, and the document title carries the identity. No key.
**States**

- `pull`: as sketched.
- `long-title`: the title wraps to two lines, then clamps; the branch truncates at `max-w-64`.
- `no-title`: the heading is `Pull request #4863`; the meta line drops the number.
- `main`: the heading is `Version Packages (#4828)`; meta `main · a1b2c3d · ariakit-bot · 3 h ago`.
- `read-only`: the badge is `Replaced`; the meta line ends with the link `Open newer run`.
- `comparing`: the badge is `Comparing`, then `6 of 16`.
- `loading`: two skeleton bars (`h-4 w-96`, `h-3 w-64`) and a skeleton badge.
- `narrow`: the title wraps; meta is `#4863 · a1b2c3d · attempt 2`; the badge moves to the end of the meta line.

## Variant `floating-chip`: Floating chip

No header row: a small chip floats on the top start corner of the stage and expands on hover, focus, or click.

Ideas:

- Zero rows of chrome for the run identity: the image can start at the top of the window.
- At rest the chip holds the two facts that matter during review: which run, and how much is left.
- It expands in place to the title, commit, attempt, and the GitHub link.

Tradeoffs:

- It covers about 200 by 32 px of the stage corner unless the stage keeps a top inset.
- The identity is over the images, not above them (rule A06), and the commit is hidden at rest.
- Hover does not exist on touch: a tap must expand it.

### Spec

**Sketch**

```text
+--------------------------------------------------------------------------+
| [ <- #4863 · 22 left ]                                                   |
|                          (stage, full height)                            |
expanded
| [ <- #4863  Migrate component examples to the new s...  a1b2c3d · attempt 2  GitHub ^ ] |
```

**Build** `Frame $layer $lighten $border $rounded='full' $p={1} className='absolute start-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1 text-sm shadow-md'` on a `relative` stage. Children: back `Button $size='sm' $rounded='full' aria-label='Queue'`; `ak.DisclosureProvider` + `ak.Disclosure render={<Button $size='sm' $rounded='full' />}` (the number and the count); `ak.DisclosureContent className='flex min-w-0 items-center gap-2'` (the title with `truncate`, the commit, and `Link` `GitHub`). Lab cell: a stage stand-in, `Frame $darken className='relative aspect-[16/5] w-full overflow-clip'`, with the baseline and current of `getScreenshotSet({ scene: 'dialog', scheme: 'dark' })`, so the overlap is visible. Data: as `one-line`.
**Copy** `Queue` (the name of the back button), `22 left`, `attempt 2`, `GitHub`. Words at rest: 2.
**Behavior** Pointer enter, focus inside, or a click on the number expands. Pointer leave with no focus inside, or Esc, collapses. `aria-expanded` follows. With reduced motion the width changes at once.
**States**

- `pull`: collapsed.
- `long-title`: drawn expanded; the title truncates at the chip limit.
- `no-title`: collapsed `#4863 · 22 left`; expanded shows `Pull request`.
- `main`: `main · 14 left`.
- `read-only`: `#4863 · Replaced` and the button `Open newer run`, both visible at rest.
- `comparing`: `#4863 · Comparing 6 of 16` with a small ring.
- `loading`: the back button and a skeleton bar `w-24`.
- `narrow`: collapsed; a tap expands it to the frame width in two lines.

## Variant `attempt-switcher`: Attempt switcher

The commit and attempt are a select that lists every run of the pull request, so an old attempt is never a dead end.

Ideas:

- A new workflow attempt is a separate run: the select shows the runs as siblings.
- The read-only state explains itself: the select says `Replaced`, and the newest run is one Enter away.
- A reviewer can open an earlier attempt to see what it showed.

Tradeoffs:

- It needs the list of runs of a pull request, which is not in the API today (`PullRequest.runs`).
- A switch loads another review model (5 to 7 s today).
- Most pull requests have one run: the control is then plain text and the feature is invisible.
- No audit lane proposed a run select in the header.

### Spec

**Sketch**

```text
| <-  #4863  Migrate component examples to the...   [ a1b2c3d · attempt 2 v ]   22 left · 2 rejected |  44
                                                    +-------------------------------------+
                                                    | a1b2c3d  attempt 2   Rejected   now |
                                                    | a1b2c3d  attempt 1   Failed    40 m |
                                                    | 9f8e7d6  attempt 1   Replaced   3 h |
                                                    | ----------------------------------- |
                                                    | Pull request on GitHub ^            |
                                                    +-------------------------------------+
```

**Build** The row is `one-line`. The commit and attempt are `ComboboxProvider` + `ComboboxSelect $layer='transparent' $size='sm' className='flex-none font-mono'` + `ComboboxPopover unmountOnHide`; each `ComboboxItem` has `checkmark='after'` and `ComboboxItemContent` (`ComboboxItemLabel`: sha and attempt; `ComboboxItemDescription`: state word and relative time); the footer is a `Link`. Data: `usePull('attempts').commits` for the list; the rest as `one-line`. Lab cell: as `one-line`.
**Copy** `attempt 2`; state words `Rejected`, `Failed`, `Replaced`, `Passed`, `Needs review`; `Pull request on GitHub`. Words at rest: 5 plus the title.
**Behavior** Up, Down, Enter, Esc, and typing a sha work inside the list. A pick opens that run. With one run the control is plain text with no chevron. No global key.
**States**

- `pull`: closed.
- `long-title`: the title truncates; the select keeps its width.
- `no-title`: `#4863`, `Pull request` in `ak-ink-60`, then the select.
- `main`: plain text `main · a1b2c3d`; no select.
- `read-only`: the list drawn open (static): the current row is the old attempt with `Replaced`; the first row is the newest run; the count slot shows `Replaced`.
- `comparing`: closed; the count slot shows `Comparing 6 of 16`.
- `loading`: skeleton bars for the title and the select.
- `narrow`: the select shows `attempt 2` only; the sha is in the list.
