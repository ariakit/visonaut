# Run row (run-row)

Group: inbox
Question: Which row should show one run in the Queue and in History?
Description: One run in a list: what it is, its state, how much work it holds, and one link that opens it.
Layout: stack

## Scenarios

- `to-review` (To review): Two runs that wait for a person: #4831 with 79 changes and #4863 with 22 changes and 2 rejected.
- `long-title` (Long title): #4819 with a 176-character title, a 76-character branch, attempt 3, and 5 changes.
- `no-title` (No title): The production shape today: #4863 without a title or other new fields, and a main run with only its commit.
- `running` (In progress): A merge queue run that captures 212 of 600 screenshots and #4855 that compares 6 of 16.
- `problem` (Failed and rerun): #4844 that failed with an error sentence and a main run that needs a rerun.
- `past` (Past runs): History rows of #4822: the merge queue run passed, attempt 2 passed, attempt 1 was replaced.
- `loading` (Loading): Three skeleton rows with the final row geometry.
- `narrow` (Narrow): The rows of #4831, the capturing run, and #4844 in a 390 px container.

## Variant `line`: One line (minimal)

A row of 2.75em with the mark, the number, the title, one state text, and the age; the whole row is the link.

Ideas:

- Sixteen runs fit in the first screen in place of two cards.
- Fixed column widths make numbers, counts, and ages align down the list.
- The state text is the status: `79 changes` needs no badge and no button.
- At 390 px the row becomes two lines, not a squeezed one.

Tradeoffs:

- Commit, branch, and author are not on the row.
- A long title is cut at one line on a wide container.
- Rows of different states differ only by the mark and the last text.

### Spec

**Sketch**

```text
●  #4831  Update dependency @playwright/test to v1.63.0                  79 changes   34 min
✕  #4863  Migrate component examples to the new style…   22 changes · 2 rejected   12 min
◌  Merge queue  #4852 #4849                                Capturing 212 of 600    1 min
▲  #4844  Add forced colors styles to Checkbox and Radio                  Failed    1 h
```

**Build**

- List: `Nav` with `render={<div />}`, `aria-label='Runs'`, `$slotSize={5}`, and `glider={[{ $state: 'hover' }, { $state: 'focus' }]}`.
- Row: `NavLink` with `render={<LabLink to='review' scenario='changes' />}` and `$p={3}`.
- Mark: `NavSlot` with the state icon inside `Text $text={role}`.
- Number: `Text` with `w-16 tabular-nums ak-ink-60`. Title: `NavLinkLabel` with `$truncate` and `flex-1 min-w-0`.
- State text: `Text` with `w-52 text-end tabular-nums ak-ink-70`. Age: `Text render={<time />}` with `w-16 text-end ak-ink-60`.
  **Copy**
- State text as in the group rules: `79 changes`, `22 changes · 2 rejected` (second part in `Text $text='danger'`), `Capturing 212 of 600`, `Comparing 6 of 16`, `Failed`, `Rerun needed`, `Passed`, `Replaced`.
- `attempt 3` in `ak-ink-60` after the title, only from attempt 2.
  **Behavior and keys**
- One link and one tab stop per row. J, K, and the arrow keys move the focus between rows. Enter opens.
- A row with keyboard focus shows `↵` in a last `NavSlot $kind='shortcut'`.
  **Scenarios**
- `to-review`: #4831 and #4863 as in the sketch.
- `long-title`: one line with an ellipsis, then `attempt 3`, `5 changes`, `1 h`. The link `title` attribute has the full text.
- `no-title`: `#4863` takes the title place in normal ink with `22 changes · 2 rejected`; the main run reads `main` and `8744255` in `Code $layer={false}` with `3 changes`.
- `running`: `Merge queue #4852 #4849` with `Capturing 212 of 600`; #4855 with `Comparing 6 of 16`.
- `problem`: #4844 `Failed`; the main run `Rerun needed`. The error sentence is in the `title` attribute only.
- `past`: `Passed`, `Passed`, `Replaced`; the replaced row uses `ak-ink-60`.
- `loading`: three rows: a 1.25em circle, a 3em bar, a bar of 40 to 60 percent width, two short bars at the end.
- `narrow`: two lines: mark, number, and title (`line-clamp-2`), then state text and age.
  **Budget**: at most 4 words in a row besides the number and the title.

## Variant `progress`: Two lines with review progress

A row of two lines with the title, an identity line, and a three-part bar for approved, rejected, and open changes.

Ideas:

- The bar shows how far the review is, so a half-done run stands out from a new one.
- Runs in progress use the same place for capture and comparison progress.
- The second line has room for the author and the attempt.

Tradeoffs:

- Needs `counts` and `progress`, which are not in the API today. With the data of today the bar has two parts only: rejected and open.
- Twelve runs fit in the first screen, not sixteen.
- A bar on each row is noise when most runs are untouched.

### Spec

**Sketch**

```text
┌────────────────────────────────────────────────────────────────────────────────────┐
│ (●)  Update dependency @playwright/test to v1.63.0           ▓▓▓▓░░░░░░░           │
│      #4831 · renovate[bot] · 34 min ago                      79 changes            │
│ (✕)  Migrate component examples to the new style recipes     ▓▓▓▒░░░░░░░           │
│      #4863 · nilsson-sofia · attempt 2 · 12 min ago          22 changes · 2 rejected│
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Build**

- List: `ButtonGroup $layout='vertical' $border $p={1}` with `ButtonGlider $state='hover'` and `ButtonGlider $state='focus'`.
- Row: `Button $p={3} render={<LabLink />}` with `w-full justify-start text-start`.
- Mark: `ButtonSlot $kind='avatar' $size='lg' $rowSpan={2} $layer={role} $mix={20}` with the state icon.
- Text: `ButtonContent` with `ButtonLabel` (title, `$truncate`) and `ButtonDescription` (identity line).
- End block: a `div` with `grid w-44 gap-1`: the bar, then `Text` with `text-sm tabular-nums`.
- Bar: `Frame $lightnessOffset={2} $rounded='full' $forceRounded` with `flex h-1.5 overflow-clip`. It holds `Frame $layer='success'` and `Frame $layer='danger'`, sized with `flexGrow` from the counts, and an empty rest. It has `role='img'` and a name such as `49 approved, 0 rejected, 79 open`.
  **Copy**
- Identity line: `#4831 · renovate[bot] · 34 min ago`. Leave out a part that the data does not have. Add `attempt 2` from attempt 2.
- Under the bar: the state text of the group rules.
  **Behavior and keys**: one link per row; J, K, arrows, and Enter as in the group rules.
  **Scenarios**
- `to-review`: #4831 with 49 of 128 approved; #4863 with 9 approved, 2 rejected, 22 open.
- `long-title`: one title line with an ellipsis; `#4819 · lucas-q-ferreira · attempt 3 · 1 h ago`; 2 of 7 approved.
- `no-title`: label `#4863`, description `attempt 2 · 12 min ago`, a two-part bar; main: label `main 8744255`, description `2 h ago`, an empty bar, `3 changes`.
- `running`: the bar is `Progress` with `value={212 / 600}` and `Capturing 212 of 600`; #4855 with `value={6 / 16}` and `Comparing 6 of 16`.
- `problem`: no bar. #4844 shows its error sentence in `Text $text='danger'` (one line, cut); the main run shows `Rerun needed`.
- `past`: no bar; `Passed · 10 changes`, `Replaced`.
- `loading`: three rows with a circle, two text bars, and one bar at the end.
- `narrow`: the end block moves under the identity line and takes the full width.
  **Budget**: 8 words in a row besides the title.

## Variant `thumbs`: Thumbnail card

A card that shows up to four changed screenshots of the run under its title, with a tile for the rest.

Ideas:

- The reviewer sees what kind of change waits before the click.
- The tile `+75` gives the size of the run without a sentence.
- Without previews the card falls back to a text row, so the production data of today still works.

Tradeoffs:

- `previews` is not in the API today. The fallback is the production look until the backend sends thumbnails.
- Six runs fit in the first screen.
- Small thumbnails of similar components look alike: they show the scale of the work, not the diff.
- Run previews are new data; the thumbnail rule A11 of the contract covers only the item list of a run.

### Spec

**Sketch**

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ●  #4831  Update dependency @playwright/test to v1.63.0                  34 min │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                                    │
│ │ Form │ │Table │ │ Page │ │Select│ │ +75  │   79 changes                       │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Build**

- Card: `Button render={<LabLink />}` with `$lighten`, `$border`, `$rounded='xl'`, `$p='1rem'`, `$active={false}`, and `grid w-full gap-3 text-start`. Cards stack with `gap-2`.
- Head line: the mark, the number in `ak-ink-60`, the title with `font-medium truncate flex-1`, the age.
- Thumbnail: `Frame $darken $border $rounded='md'` with `w-24 aspect-[8/5] overflow-clip`, and inside it `img` with `src={preview.image.url}`, `alt={preview.itemName}`, and `size-full object-cover object-top`.
- More tile: the same frame with `Text` `+75` (open changes minus the shown previews) in `tabular-nums ak-ink-70`.
- After the strip: the state text.
  **Copy**: no caption under a thumbnail; the screenshot name is the `alt` text. State text as in the group rules.
  **Behavior and keys**: the card is one link. J, K, arrows, and Enter as in the group rules.
  **Scenarios**
- `to-review`: #4831 with 4 thumbnails and `+75`; #4863 with 4 thumbnails, `+18`, and `22 changes · 2 rejected`.
- `long-title`: the title takes up to two lines (`line-clamp-2`); 3 thumbnails and `+2`.
- `no-title`: the data has no previews, so the card has the head line and the state text only: `#4863`, `22 changes · 2 rejected`.
- `running`: in place of the strip, `Progress` with `max-w-80` and `Capturing 212 of 600`; #4855 shows its 2 thumbnails and `Comparing 6 of 16`.
- `problem`: #4844 shows its error sentence in `Text $text='danger'` with `text-sm`; the main run shows `Rerun needed`.
- `past`: one line for each run and no strip: `Passed`, `Passed`, `Replaced`.
- `loading`: a card with one text bar and four thumbnail frames that pulse.
- `narrow`: three thumbnails and the more tile; the state text goes under the strip.
  **Budget**: 4 words in a card besides the title.

## Variant `columns`: Table columns

A table row with named and aligned columns for status, run, changes, commit, and age.

Ideas:

- Column headers remove the need for words in each row.
- The commit is visible in the mono font, which helps to match a run with a GitHub check.
- The same table serves History with a sort on Age and Changes.

Tradeoffs:

- A table for the Queue is close to the option `recent-clear` that the maintainer rejected in U05. Here it changes only the row shape, not the work-first order.
- At 390 px two columns must go.
- The link that covers the row needs a positioned table row; check it in Chrome.

### Spec

**Sketch**

```text
 Status          Run                                                 Changes  Commit    Age
 ● Needs review  #4831  Update dependency @playwright/test to v1.…        79  a7b1ef2   34 min
 ✕ Rejected      #4863  Migrate component examples…  attempt 2    22 · 2 rej.  76a809f   12 min
 ◌ Capturing     Merge queue  #4852 #4849                         212 of 600  57ca248    1 min
```

**Build**

- `Table` with parts, `aria-label='Runs'`, `container={{ $border: true }}`, `$borderInline={false}`, `$p={2}`, and `className='text-sm'`.
- Head cells: Status (`$fit`), Run (`$grow`), Changes (`numeric $fit`), Commit (`$fit`), Age (`$fit`).
- Status cell: `Badge $layer={role} $forceRounded` with `BadgeSlot` and `BadgeLabel`.
- Run cell: `TableCell header='row'` with the number in `tabular-nums ak-ink-60` and `Link render={<LabLink />}` with `no-underline after:absolute after:inset-0`. The `TableRow` has `relative`, so the link covers the row.
- Commit: `Code $layer={false}` with 7 characters. Age: `Text render={<time />}`.
  **Copy**
- Head: `Status`, `Run`, `Changes`, `Commit`, `Age`.
- Changes cell: `79`; `22` and then `· 2 rejected` in `Text $text='danger'`; `212 of 600`; an em dash with `aria-label='None'` for Failed, Rerun needed, and Replaced.
  **Behavior and keys**: one link per row; rows tint on hover; J, K, arrows, and Enter on the table body.
  **Scenarios**
- `to-review`, `running`, `problem`: as in the sketch, with the state word in the badge.
- `long-title`: the title is cut at one line; `attempt 3` follows it in `ak-ink-60`.
- `no-title`: the Run cell has `#4863` only; the main run has `main`.
- `past`: `Passed`, `Passed`, `Replaced`; Changes shows `9`, `10`, and an em dash; the Age head cell has `sort='descending'`.
- `loading`: the head row is real; three body rows have bars.
- `narrow`: `@max-md:` hides Commit and the badge label; the badge keeps its icon and an `aria-label`.
  **Budget**: 5 head words; a row has only the state word and the title.

## Variant `diffstat`: Count first

A row that starts with the number of open changes and adds a git-style line of changed, added, and removed counts.

Ideas:

- The number column reads like an unread count, so the largest job is visible at once.
- `~108 +15 −5` uses the diffstat habit that maintainers know from GitHub.
- The number place holds a ring for a run in progress and an icon for a stopped run, so each state has one fixed place.
- Not in the audit: a new idea.

Tradeoffs:

- The line of kind counts needs `counts`, which is not in the API today. Without it only the number shows.
- A large number can look urgent when it is only a dependency update.
- The state word is not printed for a run that needs review: the number is the mark, with a hidden state word.

### Spec

**Sketch**

```text
┌──────┬───────────────────────────────────────────────────────────────────────┐
│  79  │ Update dependency @playwright/test to v1.63.0                  34 min  │
│      │ #4831   ~108  +15  −5                                                  │
├──────┼───────────────────────────────────────────────────────────────────────┤
│  22  │ Migrate component examples to the new style recipes            12 min  │
│ 2 rej│ #4863 · attempt 2   ~27  +4  −2                                        │
├──────┼───────────────────────────────────────────────────────────────────────┤
│ (35%)│ Merge queue  #4852 #4849                                        1 min  │
│      │ Capturing 212 of 600                                                   │
└──────┴───────────────────────────────────────────────────────────────────────┘
```

**Build**

- List: `ButtonGroup $layout='vertical' $border $p={1}` with hover and focus gliders.
- Row: `Button $p={3} render={<LabLink />}` with `w-full justify-start text-start`.
- Number block: a `div` with `grid w-14 justify-items-center`. The number is `Text` with `text-2xl font-semibold tabular-nums`. A rejected run adds `Text $text='danger'` with `text-xs` under it.
- In progress: a `div` with `size-10` and `ProgressCircular` with the value and `35%` inside. Stopped or past: the state icon at `size-6` in `Text $text={role}`.
- Text: `ButtonContent` with `ButtonLabel` (title) and `ButtonDescription` (number, attempt, diffstat). The age is at the row end.
- Diffstat: `Text` with `font-mono text-xs`: `~108` in `$text='warning'`, `+15` in `$text='success'`, `−5` in `$text='danger'`. Each part has an `aria-label` such as `108 changed`.
  **Copy**: the number is the count of open changes. A visually hidden text gives the state: `79 changes, needs review`. Rejected: `2 rejected`.
  **Behavior and keys**: one link per row; J, K, arrows, and Enter as in the group rules.
  **Scenarios**
- `to-review`: as in the sketch.
- `long-title`: `5`; the title wraps to two lines; `#4819 · attempt 3   ~7`.
- `no-title`: `22` and `2 rejected`; label `#4863`; description `attempt 2`; no diffstat, as `counts` is absent. Main: `3` and `main 8744255`.
- `running`: a ring with `35%` and `Capturing 212 of 600`; a ring with `38%` and `Comparing 6 of 16`.
- `problem`: a danger triangle, `Failed`, and the error sentence in the description; a warning refresh icon and `Rerun needed`.
- `past`: a success check, `Passed`, `~10`; a muted arrow and `Replaced`.
- `loading`: a square block and two text bars in each row.
- `narrow`: the same two lines; the age moves to the end of the description line.
  **Budget**: 3 words in a row besides the title.

## Variant `peek`: Row with a peek

A one-line row that opens in place to show thumbnails, counts by kind, identity, and the Review button.

Ideas:

- The list stays dense, and detail costs one key press, not a page load.
- The open panel holds the facts that the other rows leave out: commit, branch, author, and a GitHub link.
- Right opens and Left closes the focused row, so triage works without the pointer.
- Not in the audit: the audit has a split queue with a preview pane, not a peek in the list.

Tradeoffs:

- Two controls in one row: the link and the toggle. The toggle is a second tab stop.
- The panel needs `previews`, `counts`, `branch`, and `author`, which are not in the API today.
- An open panel moves the rows below it.

### Spec

**Sketch**

```text
●  #4831  Update dependency @playwright/test to v1.63.0          79 changes   34 min  ⌃
   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   108 changed · 15 added · 5 removed · 49 approved
   │ Form │ │Table │ │ Page │ │Select│   a7b1ef2 · renovate/playwright-monorepo · renovate[bot]
   └──────┘ └──────┘ └──────┘ └──────┘   [ Review  ↵ ]   Pull request ↗
✕  #4863  Migrate component examples to the…   22 changes · 2 rejected   12 min  ⌄
```

**Build**

- Row line: the parts of the variant `line` (a `NavLink` in a `Nav` with hover and focus gliders), then a toggle after the link.
- Toggle: `ak.DisclosureProvider` and `ak.Disclosure render={<Button $size='sm' aria-label='Details of #4831' />}` with `ChevronDown` in a `ButtonSlot`; the icon turns when open.
- Panel: `ak.DisclosureContent render={<Frame $darken={0.5} $rounded='lg' $p={3} />}` with `ms-10 mb-2 grid gap-3 @md:grid-cols-[auto_1fr]`.
- Thumbnails: `Frame $darken $border $rounded='md' $forceRounded` with `w-24 aspect-[8/5] overflow-clip` and an `img` with `object-cover object-top`.
- Facts: two `Text` lines with `text-sm ak-ink-70`; the commit in `Code`.
- Actions: `Button $layer='brand' $size='sm' $forceRounded render={<LabLink />}` with `ButtonLabel` and `ButtonSlot $kind='shortcut'`; then `Link` with an `ArrowUpRight` icon.
  **Copy**: `108 changed · 15 added · 5 removed · 49 approved`; button `Review` with `↵`; link `Pull request` (a main run: `Commit`).
  **Behavior and keys**
- On a focused row: Right opens the panel, Left closes it, Enter follows the link. J and K move between rows.
- One panel is open at a time.
  **Scenarios**
- `to-review`: #4831 open, #4863 closed.
- `long-title`: open; the first line of the panel has the full title.
- `no-title`: open; the panel has `76a809f · attempt 2` and the Review button only.
- `running`: open; `Progress` and `Capturing 212 of 600`; no Review button.
- `problem`: open; the error sentence in `Text $text='danger'`, then `Rerun the visual tests in CI` and a neutral button `Open run`.
- `past`: closed rows with `Passed`, `Passed`, `Replaced`.
- `loading`: skeleton rows without toggles.
- `narrow`: the row has two lines; the panel stacks and shows three thumbnails.
  **Budget**: 4 words in a closed row; 14 words in an open panel.
