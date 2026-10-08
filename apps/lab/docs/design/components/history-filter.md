# History filter bar (history-filter)

Group: inbox
Question: Which filter bar should the History list use?
Description: The search field, the status filter, and the result count above the History list.
Layout: stack

## Scenarios

- `default` (Default): Forty runs, no search text, and all statuses.
- `filtered` (Filtered): The search text fix and the status Passed give 13 of 40 runs.
- `no-match` (No match): The search text datepicker has no result.
- `empty` (No runs): History has no runs, so the bar must not offer controls that filter nothing.
- `loading` (Loading): The first load: the bar keeps its final geometry and the field is ready.

## Variant `select`: Field and select (minimal)

One search field, one status select with a fixed option list and counts, and one result count.

Ideas:

- Two controls with fixed widths: nothing moves when the data changes.
- The option list has a fixed order and shows each count, so the control is the same on each visit.
- One count replaces the three sentences that explain the limit of 100 runs.

Tradeoffs:

- The status options are behind a click.
- One status at a time.
- The counts are visible only in the open list.

### Spec

**Sketch**

```text
[ ⌕ Search runs                         / ]   [ All          ▾ ]                40 runs
```

**Build**

- Field: `InputGroup` with `w-80 max-w-full`; `InputSlot` with `Search` in `ak-ink-60`; a plain `input` with `type='search'`, `aria-label='Search runs'`, `placeholder='Search runs'`, and `min-w-0 flex-1`; `InputSlot $kind='shortcut'` with `Kbd` `/`.
- With text in the field, the last slot holds `Button $size='xs'` `Clear` in place of the key.
- Select: `ComboboxProvider`, `ComboboxSelect aria-label='Status'` with `w-48`, `ComboboxPopover unmountOnHide`, and nine `ComboboxItem` rows with `checkmark='before'`; each row has `ComboboxItemLabel` and a count in `ComboboxItemSlot` with `tabular-nums ak-ink-60`.
- Count: `Text` with `ms-auto text-sm tabular-nums ak-ink-60` and `aria-live='polite'`.
- Data: local state and `filterRuns(runs, { query, state })`.
  **Copy**
- Options in this order: `All`, `Needs review`, `Rejected`, `Failed`, `Rerun needed`, `Comparing`, `Capturing`, `Passed`, `Replaced`. An option with zero runs is `disabled`.
- Count: `40 runs`; with a filter `13 of 40`; when the list is at the API limit add `Latest 100` in soft text.
  **Behavior and keys**: `/` on the root moves the focus to the field. Escape in the field clears it. The search also matches the number with `#` and the state word.
  **Scenarios**
- `default`: as in the sketch.
- `filtered`: the field has `fix`, the select reads `Passed`, the count reads `13 of 40`.
- `no-match`: the field has `datepicker`, the count reads `0 of 40`, and `Button $size='sm' $border` `Clear` follows it.
- `empty`: the bar is not rendered. The lab cell shows `Not shown` in `ak-ink-50`.
- `loading`: the field is real and takes text; the select and the count are skeleton bars of the final size.
  **At 390 px**: the field takes the first line; the select and the count share the second.
  **Budget**: 5 words.

## Variant `chips`: Status chips

The search field and a line of status chips with counts; several chips can be on at one time.

Ideas:

- Each status and its count are visible without a click.
- Chips keep a fixed order, and a chip with zero stays in place, so the bar never moves.
- Two statuses together are possible, for example Failed and Rejected.

Tradeoffs:

- Eight chips take two lines at 768 px and four at 390 px.
- Chips show color and count for states that are rare in History.
- Multi-select is not in the app today: its filter takes one status.

### Spec

**Sketch**

```text
[ ⌕ Search runs                    / ]                                           13 of 40
( Needs review 2 ) ( Rejected 0 ) ( Failed 1 ) ( Rerun needed 0 ) ( Comparing 1 )
( Capturing 0 ) (✓ Passed 13 ) ( Replaced 3 )                                       Clear
```

**Build**

- Field: `InputGroup` as in the input recipe, with `w-80 max-w-full`, `aria-label='Search runs'`, and `Kbd` `/`.
- Chips: the filter chips recipe. A `div` with `role='group'`, `aria-label='Status'`, and `flex flex-wrap gap-2`; each chip is `CheckboxCard` with `$size='sm'`, `$rounded='full'`, `$p={1}`, `$px='lg'`, `CheckboxCardLabel`, and `CheckboxCardSlot $ink={60}` with `tabular-nums` for the count. A chip with zero is `disabled`.
- Count: `Text` with `ms-auto text-sm tabular-nums ak-ink-60` and `aria-live='polite'`. `Clear`: `Button $size='sm'`.
- Data: local state. No chip on means all statuses. A chip count is the number of runs of that state under the search text.
  **Copy**: chips in this order: `Needs review`, `Rejected`, `Failed`, `Rerun needed`, `Comparing`, `Capturing`, `Passed`, `Replaced`. Count: `40 runs` or `13 of 40`. Button: `Clear`.
  **Behavior and keys**: `/` moves the focus to the field. Tab reaches each chip; Space toggles it.
  **Scenarios**
- `default`: no chip on; counts 4, 2, 2, 1, 1, 1, 25, 4; `40 runs`; no `Clear`.
- `filtered`: the field has `fix`; `Passed` is on; counts 2, 0, 1, 0, 1, 0, 13, 3; `13 of 40`.
- `no-match`: the field has `datepicker`; each chip is disabled with 0; `0 of 40` and `Clear`.
- `empty`: the bar is not rendered. The lab cell shows `Not shown` in `ak-ink-50`.
- `loading`: the field is real; eight skeleton pills of the final size.
  **At 390 px**: the field takes the full width; the chips wrap.
  **Budget**: 14 words.

## Variant `tabs`: Outcome tabs

A tab strip groups the eight states into five outcomes with the words of the Queue, next to the search field and a sort.

Ideas:

- History and the Queue use the same group words: To review, In progress.
- Five tabs in place of eight states: Failed holds Rerun needed, To review holds Rejected.
- The strip is the page heading, and the count is on each tab.

Tradeoffs:

- A group hides the exact state; the row must show it.
- Six tabs do not fit at 390 px: the strip scrolls inside its own box.
- One group at a time.
- Tabs that filter one list are close to the merged table that U05 rejected; History stays its own page here.

### Spec

**Sketch**

```text
 All 40   To review 6   In progress 2   Passed 25   Failed 3   Replaced 4     [ ⌕ Search runs / ]  Newest ▾
 ━━━━━━
```

**Build**

- The page tabs recipe: `Tabs $border={false} $p='none' $panelRoundedTop={false}`; `TabList aria-label='Status' $layer='transparent' $darken={false}` with `border-b items-center`; `Tab $kind='flat' $selectedOffset={false}` with an `id`, `TabLabel`, and `TabSlot $kind='badge' $p='md'`; `TabGlider $kind='bar'`.
- End of the strip: `InputGroup $size='sm'` with `w-56` and `Kbd` `/`; then a sort select: `ComboboxProvider` and `ComboboxSelect aria-label='Sort' $layer='transparent'`.
- `TabPanel single` holds the count line: `Text` with `text-sm ak-ink-60` and `aria-live='polite'`.
- Groups: To review = needs-review and rejected. In progress = comparing and incomplete. Failed = failed and needs-recompare. Replaced = superseded.
  **Copy**: tabs `All`, `To review`, `In progress`, `Passed`, `Failed`, `Replaced`. Sort options `Newest`, `Oldest`, `Most changes`, `Longest`. Count line only with search text: `20 of 40`.
  **Behavior and keys**: arrow keys move between tabs. `/` moves the focus to the field. A tab with zero is `disabled`.
  **Scenarios**
- `default`: counts 40, 6, 2, 25, 3, 4; `All` is selected.
- `filtered`: the field has `fix`; counts 20, 2, 1, 13, 1, 3; `Passed` is selected; the count line reads `13 of 40`.
- `no-match`: the field has `datepicker`; `All 0` is selected and the other tabs are disabled; the count line reads `0 of 40` with `Button $size='sm' $border` `Clear`.
- `empty`: the bar is not rendered. The lab cell shows `Not shown` in `ak-ink-50`.
- `loading`: the tab words render at once; the counts are skeleton pills; the field is real.
  **At 390 px**: the field and the sort take the first line; the strip scrolls with `overflow-x-auto`.
  **Budget**: 13 words.

## Variant `facets`: Filter popover

The search field and one Filter button that opens a popover with status, kind, and sort; active filters show as removable badges.

Ideas:

- The bar is one line in the normal case.
- It scales to more dimensions: status, kind, and later author or branch.
- Each active filter is visible and has its own remove button.

Tradeoffs:

- Filters are two clicks away.
- The counts are hidden until the popover opens.
- The kind filter and the sort are not in the app today.

### Spec

**Sketch**

```text
[ ⌕ Search runs               / ]  [ ⚲ Filter 1 ]   Passed ✕   Clear                 13 of 40
       ┌───────────────────────────────┐
       │ Status                        │
       │ ☐ Needs review   2            │
       │ ☑ Passed        13            │
       │ Kind                          │
       │ ☐ Pull request  ☐ Main  ☐ Merge queue │
       │ Sort   (•) Newest  ( ) Most changes  │
       └───────────────────────────────┘
```

**Build**

- Field: `InputGroup` with `w-80 max-w-full`, `aria-label='Search runs'`, and `Kbd` `/`.
- Button: `PopoverProvider` and `PopoverDisclosure $border` with `ButtonSlot` (`ListFilter`), `ButtonLabel`, and, with active filters, `ButtonSlot $kind='badge' $p='md'` for their number.
- Popover: `Popover portal $rounded='xl' $p={3}` with `grid w-72 gap-3`. Group labels: `Text` with `text-xs ak-ink-60`. Status and kind rows: `CheckboxField` with `CheckboxLabel` and a count at the end in `ms-auto tabular-nums ak-ink-60`. Sort: `RadioProvider`, `RadioGroup`, and `RadioField` with `RadioLabel`.
- Active filters: `Badge $forceRounded` with `BadgeLabel` and a small remove `Button` with `aria-label='Remove Passed'`. Then `Button $size='sm'` `Clear`.
- Count: `Text` with `ms-auto text-sm tabular-nums ak-ink-60`.
  **Copy**: `Filter`; groups `Status`, `Kind`, `Sort`; the eight state words; `Pull request`, `Main`, `Merge queue`; `Newest`, `Oldest`, `Most changes`; `Clear`; count `40 runs` or `13 of 40`.
  **Behavior and keys**: `/` moves the focus to the field. Escape closes the popover. A change applies at once; the popover stays open.
  **Scenarios**
- `default`: the field, the button `Filter`, and `40 runs`.
- `filtered`: the field has `fix`; one badge `Passed`; the button reads `Filter 1`; `13 of 40`. The lab renders the popover open in this scenario.
- `no-match`: the field has `datepicker`; `0 of 40` and `Clear`.
- `empty`: the bar is not rendered. The lab cell shows `Not shown` in `ak-ink-50`.
- `loading`: the field is real; the button is a skeleton bar.
  **At 390 px**: the field takes the first line; the button, the badges, and the count wrap on the second.
  **Budget**: 4 words closed; 16 in the open popover.

## Variant `tokens`: Token search

One field takes text and filter tokens such as is:passed and kind:main, with suggestions and counts.

Ideas:

- One control for search and for each filter: nothing else is on the bar.
- Fast for a maintainer who knows the words; a filter can live in the URL.
- Three examples under an empty field teach the syntax.

Tradeoffs:

- A syntax to learn.
- Tokens such as `kind:` and `author:` need data that the API does not have today.
- A pointer user needs more steps than with chips.

### Spec

**Sketch**

```text
[ ⌕ fix is:pa|                                                        / ]        20 of 40
    ┌────────────────────────────┐
    │ is:passed               13 │
    └────────────────────────────┘
 is:passed ✕      (tokens)             is:passed   kind:main   author:morikenji   (examples)
```

**Build**

- Field: `Combobox` with `aria-label='Search or filter runs'`, `placeholder='Search or filter runs'`, `inputValue`, `setInputValue`, and `w-full max-w-xl`.
- Suggestions: `ComboboxList` with one `ComboboxItem` for each token that starts with the last typed word, with `ComboboxItemLabel` and a count in `ComboboxItemSlot`. `ComboboxEmpty` when no token matches.
- Token line under the field: `Badge $forceRounded` with the token in the mono font and a remove `Button` with `aria-label='Remove is:passed'`.
- Example line (only when the field and the token line are empty): `Text` with `text-xs ak-ink-60` and three `Code` examples; each example is a `Link render={<button type='button' />}` that adds the token.
- Count: `Text` with `ms-auto text-sm tabular-nums ak-ink-60`.
  **Copy**
- Tokens: `is:needs-review`, `is:rejected`, `is:failed`, `is:rerun-needed`, `is:comparing`, `is:capturing`, `is:passed`, `is:replaced`; `kind:pr`, `kind:main`, `kind:queue`; `author:` and a login.
- Examples: `is:passed`, `kind:main`, `author:morikenji`. Count: `40 runs` or `13 of 40`.
  **Behavior and keys**: `/` moves the focus to the field. Enter on a suggestion removes the typed word and adds the token. Backspace in an empty field removes the last token.
  **Scenarios**
- `default`: an empty field, the example line, `40 runs`.
- `filtered`: the token `is:passed`, the text `fix`, `13 of 40`.
- `no-match`: the text `datepicker`, `0 of 40`, and `Button $size='sm' $border` `Clear`.
- `empty`: the bar is not rendered. The lab cell shows `Not shown` in `ak-ink-50`.
- `loading`: the field is real and has no suggestions; the example line shows.
  **At 390 px**: the count goes under the field.
  **Budget**: 4 words and three examples.

## Variant `squares`: Run squares

Each run is one small square, grouped by day and colored by state; a day or a state is a filter.

Ideas:

- History is about time: the reader sees when runs happened and where the failures are.
- One square per run doubles as the legend and the overview of the list.
- A click on a day or on a state count filters the list.
- Not in the audit: a new idea.

Tradeoffs:

- A square is color first; the legend with glyphs and counts and a tooltip on each square give the words.
- With 100 runs the squares take two lines.
- A square is not a target: only days and legend items take a click.
- The filter by day is not in the app today.

### Spec

**Sketch**

```text
[ ⌕ Search runs          / ]     ✓25  ●4  ✕2  ▲2  ↻1  ◔1  ◌1  →4                40 runs
 Sep 30   Oct 1       Oct 2   Oct 3        Yesterday  Today
 ■■■■■    ■■■■■■■■■   ■■■■    ■■■■■■■■■■   ■■■        ■■■■■■■■■
```

**Build**

- Field: `InputGroup` with `w-64 max-w-full`, `aria-label='Search runs'`, and `Kbd` `/`.
- Legend: a `div` with `role='group'`, `aria-label='Status'`, and `flex flex-wrap gap-1`. Each item is `Button $size='sm'` with `aria-pressed`, the state glyph in `Text $text={role}`, a count in `tabular-nums`, and an `aria-label` such as `Passed, 25`. A pressed item takes `$lightnessOffset={2}` from state.
- Days: `groupRunsByDay(runs)` in time order, oldest first, in a `div` with `flex flex-wrap gap-x-4 gap-y-2`. A day is `Button $size='sm'` with `aria-pressed` and `grid gap-1 justify-items-start`: the label in `Text` with `text-xs ak-ink-60`, then the squares in `flex gap-0.5`.
- Square: `Frame $layer={role} $rounded='xs' $forceRounded` with `size-3`. Passed uses `$mix={50}`. A neutral state uses `$lightnessOffset={4}`. A square that the filter excludes uses `$mix={12}`.
- Count: `Text` with `ms-auto text-sm tabular-nums ak-ink-60`.
  **Copy**: day labels `Today`, `Yesterday`, `Oct 3`; count `40 runs` or `13 of 40`; `Clear`.
  **Behavior and keys**: `/` moves the focus to the field. A day button toggles the day; a legend button toggles the state. A square has a `title` with the run identity and the state word.
  **Scenarios**
- `default`: six days with 5, 9, 4, 10, 3, and 9 squares.
- `filtered`: the field has `fix`; `Passed` is pressed; 13 squares keep their color; `13 of 40` and `Clear`.
- `no-match`: the field has `datepicker`; each square is faded; `0 of 40` and `Clear`.
- `empty`: the bar is not rendered. The lab cell shows `Not shown` in `ak-ink-50`.
- `loading`: the field is real; three skeleton bars stand for the days.
  **At 390 px**: the legend and the days wrap.
  **Budget**: 9 words.
