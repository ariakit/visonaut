# Screenshot list filter and search (item-filter)

Group: workspace
Question: How should the reviewer filter and search the screenshot list?
Description: The control above the screenshot list that narrows it by status, text, and axis, shown with a few result rows under it.
Layout: row

## Scenarios

- `default` (No filter): The `changes` run with no filter: 33 changes in 12 screenshots.
- `status` (Status filter): Filtered to Rejected: one screenshot (Actions menu) with two rejected variants.
- `query` (Typing): The `large` run with the text `combobox` in the focused field: six screenshots match and stay visible under the field.
- `axis` (Axis filter): Filtered to WebKit variants that need review: three variants in two screenshots (axis filters are not in the app today).
- `no-match` (No matches): The text `datepicker` matches nothing.
- `filter-done` (Filter complete): The text `combobox` after its last change was approved: nothing is left inside the filter and 21 changes wait outside it.
- `loading` (Loading): The run did not arrive yet: the control renders without counts and the rows are skeletons.
- `narrow` (Narrow): The default state at 16rem (256 px).

## Variant `one-field`: One field

A single field with a small status select inside it; typing never opens a menu.

Ideas:

- The smallest repair of the current control: the status menu opens only from its own button.
- One 36 px row holds status and search. The list gets the height back.
- `/` moves focus to the field, and Enter opens the first result.

Tradeoffs:

- Status counts are hidden until the menu opens.
- No axis filter. The text search matches browser and scheme words (`webkit dark`), but nothing says so.
- The select takes about 6rem of the field at 16rem.

### Spec

**Sketch**

```
┌──────────────────────────────────────┐ 20rem
│ All ▾ │ ⌕ Search screenshots       / │ 36 px
└──────────────────────────────────────┘
  ○ Dialog with initial focus        6   result rows (plain 32 px rows)
  ○ Combobox with auto…virtual focus 1
status menu (opens from `All ▾` only):
  ✓ All                33
    Needs review       22
    Rejected            2
    Approved            9
```

**Build**

- Column `w-80 grid gap-2`: the control, then result rows. Result rows are plain `NavLink` rows of 32 px (mark, truncated name, count), at most 5, then `Text` `+7 more` in ink 60.
- Control: `InputGroup $size='sm' className='w-full'`. First `InputSlot $size='2xl' $square={false}` with `border-e`, holding `ComboboxProvider` and `ComboboxSelect aria-label='Status' $layer='transparent' $size='xs'`. If the select does not fit the slot, use a `Button $size='xs'` as `ak.MenuButton` with the menu recipe and `ak.MenuItemRadio`.
- Then a `Search` icon `InputSlot` in ink 60, a plain `<input aria-label='Search screenshots' placeholder='Search screenshots' className='min-w-0 flex-1' />`, and an `InputSlot $kind='shortcut'` with `<Kbd>/</Kbd>`. While the field has text, the hint is replaced by a clear `Button $size='xs' aria-label='Clear search'` with `X`.
- `ComboboxPopover unmountOnHide` items: `ComboboxItem checkmark='before'` with the count in a trailing `ComboboxItemSlot` (`tabular-nums`, ink 60). Options with a count of 0 are disabled.
- Data: `useReviewSession`: `filters`, `facets`, `setFilters({ status })`, `setQuery`, `resetFilters`, `visibleItems`.

**Copy** (5 words at rest): `All`, `Needs review`, `Rejected`, `Approved`, placeholder `Search screenshots`. Empty: `No matches` and the link button `Clear`. Filter complete: `Nothing left here · 21 more` and the link button `Show all`.

**Behavior and keys**

- Typing filters at once. No popover opens from the text field.
- `/` moves focus to the field. Esc clears the text; a second Esc returns focus to the list. Enter selects the first result.
- When a status is active, the select label takes the role color through `ButtonLabel` and `$text`.

**Scenarios**

- default: `All ▾`, 5 rows, `+7 more`.
- status: the select reads `Rejected` in danger text; 1 row.
- query: `combobox` typed, caret visible, 5 of 6 rows shown right under the field.
- axis: this variant has no axis control. Show the text `webkit` with status `Needs review`: 2 rows.
- no-match: `No matches` centered in the list area, with `Clear`.
- filter-done: one approved row and the `Nothing left here · 21 more` line.
- loading: the control is enabled, the select has no counts, rows are skeletons.
- narrow: `w-64`; the select shows a mark icon in place of the word (with `aria-label`).

## Variant `status-tabs`: Status tabs

A plain search field over a segmented control with a count on each status.

Ideas:

- One click changes the status. The counts replace the sidebar title, the `Accepted (N)` toggle, and the row sentences.
- Search and status are two separate controls, so nothing covers the results.
- A status with a count of 0 is disabled but stays in place: the layout never changes.

Tradeoffs:

- Two rows (68 px), where the current control has one.
- The default must stay `All`, because screenshots with a new variant must stay visible (contract:194).
- No axis filter.

### Spec

**Sketch**

```
┌──────────────────────────────────────┐
│ ⌕ Search screenshots               / │ 36 px
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│[All 33] Needs review 22  Rejected 2  Approved 9 │ 28 px, glider on the selected segment
└──────────────────────────────────────┘
  ○ Dialog with initial focus        6
```

**Build**

- Column `w-80 grid gap-2`. Result rows: plain `NavLink` rows of 32 px (mark, name, count), at most 5, then `+n more`.
- Search: `InputGroup $size='sm'` with a `Search` slot, a plain `input` (`aria-label` and placeholder `Search screenshots`), and an `InputSlot $kind='shortcut'` with `<Kbd>/</Kbd>` (a clear button while the field has text).
- Status: `ak.RadioProvider` and `ak.RadioGroup aria-label='Status' render={<ButtonGroup $border $size='sm' $layout='stretch' />}`. Each `ak.Radio render={<Button />}` has a `ButtonLabel` and a `ButtonSlot $kind='badge' $p='md'` count. Add `<ButtonGlider $kind='bevel' />` and `<ButtonGlider $state='focus' />`.
- Counts come from `session.facets` (variants, the same unit as the run progress). The `Rejected` count uses `$layer='danger'` when it is above 0.
- Use `text-xs` for the segments so that four fit in 20rem.

**Copy** (7 words): `All`, `Needs review`, `Rejected`, `Approved`, `Search screenshots`. Empty: `No matches` and `Clear`. Filter complete: `Nothing left here · 21 more` and `Show all`.

**Behavior and keys**

- A click on a segment filters at once. Left and Right move inside the group (one Tab stop); the group consumes these keys only while it has focus.
- `/` moves focus to the search field. Esc clears the text.
- After a decision, the counts change in place.

**Scenarios**

- default: `All` selected.
- status: `Rejected` selected; the glider sits on it; 1 row.
- query: `combobox`; the counts update to the matches (for example `All 30`, `Needs review 11`).
- axis: no axis control. Show `Needs review` with the text `webkit`.
- no-match: all counts read 0, the three status segments are disabled, `No matches` with `Clear`.
- filter-done: `Needs review 0` is disabled; the line `Nothing left here · 21 more`.
- loading: segments without counts, in ink 60; skeleton rows.
- narrow: `w-64`; the segment labels become marks (`Circle`, `X`, `Check`) with the count and an `aria-label`.

## Variant `meter-filter`: Meter filter

The segmented progress bar of the run is the status filter: click a segment to see only that status.

Ideas:

- One element is the progress, the counts, and the filter. It removes three other displays.
- The segment widths follow the counts, so the bar shows how much is left before the reviewer reads a number.
- Unchanged variants are outside the bar, so 3,800 unchanged variants cannot fill it.

Tradeoffs:

- A small count (2 rejected of 128) gets a minimum width, so the widths are not exactly proportional.
- If the page header also has a progress element, the same numbers show two times. Pick one place.
- A new idea that is not in the audit. A bar that is also a button group needs a clear hover and focus state.

### Spec

**Sketch**

```
┌──────────────────────────────────────┐
│ ⌕ Search screenshots               / │ 36 px
└──────────────────────────────────────┘
┌─────────┬──┬─────────────────────────┐ ┌────┐
│ ✓ 9     │✕2│ ○ 22                    │ │ = 7│ 24 px bar, each segment is a button
└─────────┴──┴─────────────────────────┘ └────┘
  ○ Dialog with initial focus        6
filtered to Needs review: the other segments drop to a 15% tint
```

**Build**

- Column `w-80 grid gap-2`. Result rows: plain `NavLink` rows of 32 px, at most 5, then `+n more`.
- Search: `InputGroup $size='sm'` as in the other variants (`Search` slot, plain `input`, `Kbd` `/`).
- Bar: `ak.RadioProvider` and `ak.RadioGroup aria-label='Status' className='flex h-6 gap-px'`. Three `ak.Radio render={<Button $size='xs' $rounded='sm' $p='none' />}` segments with `style={{ flexGrow: count }}` and `min-w-7`: Approved `$layer='success'`, Rejected `$layer='danger'`, Needs review `$layer='warning'`. A segment with a count of 0 is not rendered.
- Segment content: mark and count (`ButtonSlot`, `ButtonLabel`, `tabular-nums`). Hide the count when the segment is narrower than 2.5rem.
- Selected look from state: the selected segment keeps the solid layer, and the others get `$mix={15}`. With no filter, all three are solid.
- Unchanged: a separate `Button $size='xs' $border` at the end with `Equal` and the count. It is also a radio of the group.
- Each segment is a `TooltipAnchor`: `22 need review`.
- Counts from `session.progress` and `session.facets`.

**Copy**: numbers only. Tooltips: `9 approved (6 auto)`, `2 rejected`, `22 need review`, `7 unchanged`. Empty: `No matches` and `Clear`. Filter complete: `Nothing left here · 21 more` and `Show all`.

**Behavior and keys**

- A click on a segment filters to that status. A click on the selected segment, or Esc, returns to all.
- Left and Right move inside the group (one Tab stop). `/` moves focus to the search field.
- After a decision, the widths animate (150 ms, off with reduced motion).

**Scenarios**

- default: three solid segments and `= 7`.
- status: the danger segment is solid; the others are tints; 1 row.
- query: the bar shows the counts inside the matches.
- axis: no axis control. Show the Needs review segment selected with the text `webkit`.
- no-match: an empty track (`Frame $lightnessOffset`), `No matches`.
- filter-done: one full success segment; `Nothing left here · 21 more`.
- loading: a pulsing track.
- narrow: `w-64`; counts hide in segments under 2.5rem.

## Variant `facets`: Facet chips

Toggle chips with counts for status and kind, and a `More` menu for browser, scheme, and framework.

Ideas:

- Multi-select: `Needs review` plus `WebKit` plus `Dark` is three clicks.
- Each number is the size of the list after a click, so a chip never leads to an empty list.
- Active axis filters come out of the menu as removable chips.

Tradeoffs:

- Chips wrap to two lines at 20rem.
- Kind, browser, scheme, and framework filters and the facet counts are not in the app today.
- The optional sort `Largest change` changes the declared order (rule A12, decision D29).

### Spec

**Sketch**

```
┌──────────────────────────────────────┐
│ ⌕ Search screenshots               / │
└──────────────────────────────────────┘
 (○ Needs review 22) (✕ Rejected 2)
 (+ Added 4) (− Removed 2) (More ▾)
  ○ Dialog with initial focus        6
More ▾ popover:
  Browser   ☐ Chromium 14  ☐ Firefox 4  ☐ WebKit 4
  Scheme    ☐ Light 12     ☐ Dark 10
  Framework ☐ Solid 1
  Order     (•) Declared   ( ) Largest change
```

**Build**

- Column `w-80 grid gap-2`. Result rows: plain `NavLink` rows of 32 px, at most 5, then `+n more`.
- Search: `InputGroup $size='sm'` (`Search` slot, plain `input`, `Kbd` `/`).
- Chips: `<div role='group' aria-label='Filters' className='flex flex-wrap gap-1.5'>` of `CheckboxCard $size='sm' $rounded='full' $p={1} $px='lg'` with `CheckboxCardLabel` (mark and word) and `CheckboxCardSlot $ink={60} className='tabular-nums'` (count). See the recipe `Filter chips`.
- Chips at rest: `Needs review`, `Rejected`, `Added`, `Removed`, and `Failed` or `Comparing` only when their count is above 0.
- `More`: `PopoverProvider`, `PopoverDisclosure $size='sm'`, `Popover portal $p={3} $rounded='xl' className='grid gap-3 w-72'` with `CheckboxField` groups (`Browser`, `Scheme`, `Framework` only when it varies) and a `RadioGroup` `Order`.
- A checked option of the menu shows as an extra chip (`WebKit ✕`) after the fixed chips.
- Data: `session.facets`, `setFilters({ status, kind, browser, framework, colorScheme })`.

**Copy** (9 words at rest): `Needs review`, `Rejected`, `Added`, `Removed`, `More`, `Search screenshots`. Menu: `Browser`, `Scheme`, `Framework`, `Order`, `Declared`, `Largest change`. Empty: `No matches` and `Clear filters`. Filter complete: `Nothing left here · 21 more` and `Show all`.

**Behavior and keys**

- Chips in one group add up (Needs review or Rejected). Groups narrow each other (status and browser).
- `/` moves focus to the search field. Esc in the field clears the text. Each chip is a checkbox (Space toggles).
- A chip whose count becomes 0 stays while it is checked, with `0`.

**Scenarios**

- default: four chips and `More`.
- status: `Rejected` checked; 1 row.
- query: the chip counts follow the text.
- axis: `Needs review` checked and a `WebKit ✕` chip; 2 rows.
- no-match: `No matches` and `Clear filters`.
- filter-done: `Needs review 0` is hidden; the line `Nothing left here · 21 more`.
- loading: three pulsing pill frames.
- narrow: `w-64`; chips show marks and counts only (words in `aria-label` and tooltip).

## Variant `tokens`: Token search

One field takes text and tokens such as `is:rejected browser:webkit`, with suggestions only inside a token.

Ideas:

- One control for every axis. It is fast for a maintainer who knows the words.
- Suggestions open only after a token key and a colon, so plain text never opens a menu.
- The parsed tokens echo under the field as removable chips, which also teaches the syntax.

Tradeoffs:

- The reviewer must learn the token names. A wrong name gives a hint, not results.
- Nothing shows the counts until the reviewer types `is:`.
- Axis tokens need filters that the app does not have today.

### Spec

**Sketch**

```
┌──────────────────────────────────────┐
│ ⌕ is:rejected browser:webkit dia|  ? │ one field
└──────────────────────────────────────┘
 (Rejected ✕) (WebKit ✕)                 echo chips, only while tokens exist
  ✕ Actions menu                     2
suggestions (only while the caret is in a token):
  is:needs-review   22
  is:rejected        2
  is:approved        9
```

**Build**

- Column `w-80 grid gap-2`. Result rows: plain `NavLink` rows of 32 px, at most 5, then `+n more`.
- Field: the styled `Combobox` (`aria-label='Search screenshots'`, placeholder `Search or filter`) with controlled `inputValue`. Render `ComboboxList` only when the word at the caret contains `:` or is a token prefix (`is`, `browser`, `scheme`, `framework`). Each `ComboboxItem` has the token as `value` and the count in a `ComboboxItemSlot`.
- Tokens: `is:` needs-review, rejected, approved, added, removed, failed, unchanged. `browser:` chromium, firefox, webkit. `scheme:` light, dark. `framework:` react, solid. Other words match the name and the key.
- Echo chips: `Badge $size='sm' $forceRounded` with a small `X` button, in a `flex flex-wrap gap-1` row that renders only while tokens exist. It is the only element that can add a row, and only after user input.
- Help: a `PopoverDisclosure $size='xs' aria-label='Filter syntax'` with `CircleHelp` in the end slot. The popover has four lines of `Code`.
- An unknown token shows `Text $text='warning' className='text-xs'`: `Unknown filter browsr:`.

**Copy** (2 words at rest): placeholder `Search or filter`. Help lines: `is:rejected`, `browser:webkit`, `scheme:dark`, `framework:solid`. Empty: `No matches` and `Clear`. Filter complete: `Nothing left here · 21 more` and `Show all`.

**Behavior and keys**

- `/` moves focus to the field. Down opens the suggestions of the current token. Enter accepts a suggestion and adds a space. Esc closes the suggestions, then clears the field.
- Backspace at the start of a chip removes its token from the text.
- The filter text can go in the URL (`?q=`), so a filtered list can be shared.

**Scenarios**

- default: an empty field.
- status: the text `is:rejected`, the chip `Rejected ✕`, 1 row.
- query: the text `combobox`, no chips, no suggestions, 5 of 6 rows.
- axis: `is:needs-review browser:webkit`, two chips, 2 rows.
- no-match: `datepicker`; `No matches` and `Clear`.
- filter-done: `combobox`; the line `Nothing left here · 21 more`.
- loading: the field is enabled; skeleton rows.
- narrow: `w-64`; the help button hides while the field has text.

## Variant `jump`: Jump palette

No filter bar: `/` opens a palette that jumps to a screenshot or applies one filter command.

Ideas:

- The real job of search here is to jump to one screenshot among hundreds. The list itself stays whole.
- The list chrome is one 32 px trigger.
- The palette also lists filter commands, so one control covers both needs.

Tradeoffs:

- Text never narrows the list, so there is no flow to review only the combobox screenshots except through a filter command.
- A modal step for each search.
- A list of commands is close to the hotkey registry that an earlier instruction rejected (feedback-ui.md:96). It uses `/`, not `Cmd/Ctrl+K`.

### Spec

**Sketch**

```
┌──────────────────────────────────────┐
│ ⌕ Jump to screenshot               / │ a button that looks like a field, 32 px
└──────────────────────────────────────┘
 (Rejected ✕)                            the active filter, if one is set
  ○ Dialog with initial focus        6
palette:
┌ ⌕ comb|                              ┐
│ ○ Combobox with auto select, …     1 │
│ ○ Combobox, animated               5 │
│ Filters                              │
│   Needs review                    22 │
│   Rejected                         2 │
│   All                             33 │
└──────────────────────────────────────┘
```

**Build**

- Column `w-80 grid gap-2`. Result rows: plain `NavLink` rows of 32 px, at most 5, then `+n more`.
- Trigger: `Input render={<button type='button' />}` with a `Search` slot, `Text {...inputPlaceholder.jsx({ className: 'flex-1 truncate' })}`, and an `InputSlot $kind='shortcut'` with `<Kbd>/</Kbd>` (see the recipe `Search trigger`).
- Palette: `DialogProvider open setOpen`, `Dialog className='flex flex-col gap-2 max-w-md' $p={2}`, with a `Combobox` (`aria-label='Jump to screenshot'`) and a `ComboboxList` in `DialogScroll`. Screenshot rows are `ComboboxItem` with a mark slot, `ComboboxItemLabel` (name) and `ComboboxItemDescription` (key, mono, `text-xs`), and the count. A `Text` group label `Filters`, then three command items with counts.
- Active filter: one `Badge $forceRounded` chip with an `X` button under the trigger.
- In the lab cell, render the trigger. For `query` and `no-match`, also render the palette content inline in a `Frame $lighten $border $rounded='2xl' shadow-xl` (a static picture of the open dialog).

**Copy** (3 words at rest): `Jump to screenshot`. Palette: `Filters`, `Needs review`, `Rejected`, `All`. Empty palette: `No matches`. Filter complete: `Nothing left here · 21 more` and `Show all`.

**Behavior and keys**

- `/` or a click opens the palette. Typing filters the palette rows. Enter on a screenshot selects it in the list and closes. Enter on a filter command sets the status filter and closes. Esc closes.
- The palette lists at most 8 screenshots, with the ones that need review first.

**Scenarios**

- default: the trigger only; 5 rows.
- status: the chip `Rejected ✕`; 1 row.
- query: the palette picture with `combobox` typed and six rows; the list behind is whole.
- axis: not supported. Show the palette picture with `webkit` typed: the matches are screenshots that have a WebKit variant.
- no-match: the palette picture with `datepicker` and `No matches`.
- filter-done: the chip `Needs review ✕` with zero rows and the line `Nothing left here · 21 more`.
- loading: the trigger is disabled in ink 60; skeleton rows.
- narrow: `w-64`; the placeholder reads `Jump`.
