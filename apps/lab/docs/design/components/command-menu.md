# Command menu (command-menu)

Group: shell
Question: Should one typed control jump to runs and screenshots (and run actions), and in which form?
Description: A switcher for runs, screenshots, pages, and actions, with the key of each action beside it.
Layout: stack

## Scenarios

- `closed` (Closed): The trigger as it sits in the header; it opens the real overlay.
- `empty` (Open, no query): Open on a run page before any typing.
- `query` (Query): The query `dialog` on the 12 screenshot run.
- `large` (Large run): The query `menu` on the 120 screenshot run, with long path names.
- `no-match` (No match): The query `datepicker` matches nothing.
- `loading` (Loading): The run list is not here yet; rows that need no data show at once.
- `read-only` (Read-only run): Open on a replaced attempt: the decision actions are off.
- `narrow` (Phone, 390): The open state in a 390 px wide frame.

## Variant `slash-field`: Slash field

A visible field in the header that finds runs, screenshots, and pages; no actions and no modifier key.

Ideas:

- Navigation only: the smallest scope that removes the trips back to the Queue.
- `/` focuses the field, so no browser chord is taken.
- The list hangs from the field and is not modal: the page stays in view.

Tradeoffs:

- It takes `/`, which key map B gives to the list filter (and Firefox uses for quick find).
- A field costs 200 to 320 px of the header row.
- No actions, so it does not help a reviewer find the keys.
- A typed switcher is close to the hotkey registry that an earlier instruction excluded (feedback-ui.md:96), although it lists no keys.

### Spec

**Sketch**

```text
| (o)  ...          [ (s) Jump to...                       / ]          (DI) |
                    +-----------------------------------------+
                    | Screenshots                             |
                    |   Dialog                      2 of 6    |
                    |   Dialog with form            Done      |
                    | Runs                                    |
                    |   #4831 Update dependency @pl...   79   |
                    | Go to                                   |
                    |   Queue                                 |
                    |   History                               |
                    |   Status                                |
                    +-----------------------------------------+
```

**Build** `ComboboxProvider` + `InputGroup $size='sm' className='w-80'` (`InputSlot className='ak-ink-60'` with `Search`; `ComboboxInput` as the plain input with `className='min-w-0 flex-1'`; `InputSlot $kind='shortcut'` with `Kbd` `/`) + `ComboboxPopover sameWidth` + `ComboboxList` with `ComboboxGroup label` and `ComboboxItem` rows (`ComboboxItemContent` with `ComboboxItemLabel` and `ComboboxItemDescription`; a trailing `ComboboxItemSlot` for the count) + `ComboboxEmpty`. Lab cell: a header stand-in strip (`Frame $layer $border $rounded='lg' className='flex h-11 w-full items-center gap-2 px-3'`) with the field; an open state draws the list in flow under the strip (a `div` with the `popover` recipe and `data-open`); `narrow` wraps the cell in `max-w-[24.375rem]`. Data: `useReviewSession` (`changes`, `large`, or `read-only`) for screenshots, `useInbox('busy')` for runs.
**Copy** Placeholder `Jump to…`; groups `Screenshots`, `Runs`, `Go to`; rows `Queue`, `History`, `Status`; `No matches`. Words in the open list: about 8 plus data.
**Behavior** `/` focuses the field (in the lab: only while focus or the pointer is in the cell). Up and Down move; Enter opens; Esc clears, then blurs. The matched text is `font-medium`; the rest is `ak-ink-70`. A screenshot row shows its count (`2 of 6`) or `Done`. For a path name, the label is the last path segment and the description is the parent path in mono.
**States**

- `closed`: the field at rest.
- `empty`: `Screenshots` (the next five that need review), `Runs` (the runs to review), `Go to`.
- `query`: the groups with matches for `dialog`; an empty group hides.
- `large`: the group label shows the match count (for example `Screenshots · 14`); eight rows, then the row `Show all 14`.
- `no-match`: `No matches`, and one row `Search History for datepicker`.
- `loading`: the `Go to` rows at once; `Runs` is three skeleton rows.
- `read-only`: as `empty` (this variant has no actions).
- `narrow`: the field is a `Search` icon button; it opens a sheet as wide as the frame with the field and the list; no `Kbd`.

## Variant `palette`: Palette

A centered modal palette for actions, screenshots, runs, and pages; each action row shows its key.

Ideas:

- Every action has a name that a person can type: this serves people who do not use single keys, and keyboard layouts where letters fail.
- The key column makes the palette the shortcut reference: `?` can open it with the actions only.
- On a run page the actions for the selected variant come first; an action that is off stays in the list with its reason.

Tradeoffs:

- It reopens two instructions on record: no hotkey registry (feedback-ui.md:96) and keep browser modifier shortcuts (feedback-ui.md:73).
- Ctrl+K is the address bar search in Chrome on Windows and Linux.
- A modal hides the screenshot while the reviewer looks for a command.
- It repeats the visible buttons.

### Spec

**Sketch**

```text
            +--------------------------------------------------+
            | (s) Type a command or search...             esc  |
            | Actions                                          |
            |   Approve                                    A   |
            |   Reject                                     X   |
            |   Diff                                       D   |
            | Screenshots                                      |
            |   Dialog                          2 of 6         |
            | Runs                                             |
            |   #4831 Update dependency @playwri...     79     |
            | Go to                                            |
            |   Queue                                          |
            +--------------------------------------------------+
```

**Build** Trigger: `DialogDisclosure $size='sm' $border aria-label='Command menu'` with `Search` and `ButtonSlot $kind='shortcut'` (`Kbd` `⌘K`). `Dialog $p='none' className='flex max-w-xl flex-col'` > `ComboboxProvider`: `InputGroup $border={false} $rounded='none' className='border-b'` with `ComboboxInput`; `DialogScroll` > `ComboboxList` > `ComboboxGroup label` > `ComboboxItem` with `ComboboxItemSlot` (icon), `ComboboxItemLabel`, and a trailing `ComboboxItemSlot $kind='shortcut'` (`Kbd`). Actions come from `reviewShortcuts` (entries with `origin: 'app'`) and `session.can`. Lab cell and data: as `slash-field`; the open panel is `max-w-xl`.
**Copy** Placeholder `Type a command or search…`; groups `Actions`, `Screenshots`, `Runs`, `Go to`; actions `Approve`, `Reject`, `Approve all variants`, `Reject all variants`, `Undo`, `Side by side`, `Diff`, `Current`, `Baseline`; `No matches`; `Read-only run`. Words in the open list: about 16 plus data.
**Behavior** `⌘K` (Ctrl+K on Windows and Linux) or the button opens; `?` opens it with the `Actions` group only. Up and Down move, Enter runs or opens, Esc closes. The palette closes after an action.
**States**

- `closed`: the trigger.
- `empty`: `Actions` (five for the selected variant), then `Screenshots`, `Runs`, `Go to`.
- `query`: the matches for `dialog` in each group.
- `large`: group labels with the match count; eight rows for each group, then `Show all`; path names as in `slash-field`.
- `no-match`: `No matches`.
- `loading`: `Actions` and `Go to` at once; `Runs` and `Screenshots` are skeleton rows.
- `read-only`: the decision actions are `aria-disabled`; one line `Read-only run` in `ak-ink-60` under the group label; the view actions stay.
- `narrow`: the dialog fills the frame; the key column hides.

## Variant `omnibar`: Omnibar

The header is one wide field: at rest it shows where you are, and on focus it is the search.

Ideas:

- Location and switcher are one control: it replaces the nav links, a breadcrumb, and a palette.
- At rest the value is the trail, with the full variant label as text (rule A07).
- Backspace in an empty field steps up one level: variant, screenshot, run, all.

Tradeoffs:

- A trail inside a field looks like text that can be edited: a new pattern to learn.
- It takes the whole header center: the commit and attempt need another home.
- It takes `/`, and it lists actions behind a `>` prefix: both are close to the registry that feedback-ui.md:96 excluded.
- It works only if it is the navigation: it does not combine with most `app-nav` variants.

### Spec

**Sketch**

```text
rest   | (o) [ #4863 / Dialog / React · Chromium · Dark                   / ]  22 left  (DI) |
focus  | (o) [ #4863 / |                                                  / ]                |
             +---------------------------------------------------------------+
             | Screenshots in #4863                                          |
             |   Dialog                              2 of 6                  |
             |   Combobox                            4 of 4                  |
             | Runs                                                          |
             |   #4831 Update dependency @playwright/test to...     79       |
             +---------------------------------------------------------------+
```

**Build** `ShellHeader center={<ShellHeaderCenter $grow />}`. Rest: `Input render={<button type='button' />} $size='sm' className='w-full max-w-3xl text-start'` with the trail as `Text` parts (separators in `ak-ink-40`, the last part in `font-medium`) and `InputSlot $kind='shortcut'` (`Kbd` `/`). Focus: the same box becomes an `InputGroup` with a scope chip (`Badge $forceRounded`, for example `#4863`) and `ComboboxInput`; `ComboboxPopover sameWidth`; rows as `slash-field`. Lab cell and data: as `slash-field`, with the field at full width.
**Copy** Placeholder `Jump to…`; groups `Screenshots in #4863`, `Runs`, `Go to`, `Actions`; `No matches in #4863`; `Search all runs`. Words at rest: 0 plus data.
**Behavior** `/` or a click focuses. Typing searches inside the scope chip; Backspace on an empty input removes the chip. A query that starts with `>` lists `Actions` with their keys. Enter opens; Esc restores the trail.
**States**

- `closed`: the trail at rest.
- `empty`: focused with the scope `#4863`: the next five screenshots that need review, then `Runs` and `Go to`.
- `query`: `dialog` inside the scope.
- `large`: the scope chip, and the count in the group label (`120 screenshots`); eight rows, then `Show all`.
- `no-match`: `No matches in #4863`, and the row `Search all runs`.
- `loading`: the trail is skeleton bars with `/` between them.
- `read-only`: the trail ends with `· Replaced`; `>` lists the view actions only.
- `narrow`: at rest only the last trail part shows; focus opens a sheet as wide as the frame.

## Variant `visual-switcher`: Visual switcher

A two-pane switcher: the list at the start, a picture of the highlighted row at the end.

Ideas:

- Names are long paths that look alike (`ariakit-tailwind-7466/applied-light-week-hover`); a picture identifies a screenshot faster than its name.
- The preview of a screenshot is its diff over the faded current image; the preview of a run is up to four thumbnails of its changes.
- The picture follows the arrow keys with no wait, because it uses thumbnails.

Tradeoffs:

- One image request for each highlighted row; thumbnails have no writer in the service today (rule A11 is not delivered).
- A 56rem modal covers the page.
- `diffPreview` and `Run.previews` are not in the API today.
- It takes `/`.
- No audit lane proposed a switcher with pictures.

### Spec

**Sketch**

```text
+-----------------------------------------------------------------------+
| (s) Jump to...                                                   esc  |
+------------------------------+----------------------------------------+
| Screenshots · 12             |  +----------------------------------+  |
| > Dialog           2 of 6    |  |                                  |  |
|   Combobox         4 of 4    |  |       (diff preview image)       |  |
|   Menu             Done      |  |                                  |  |
| Runs · 4                     |  +----------------------------------+  |
|   #4831 Update dep...   79   |  Dialog · dialog/focus/open            |
|                              |  2 of 6 left                           |
+------------------------------+----------------------------------------+
```

**Build** Trigger: `DialogDisclosure $size='sm' $border aria-label='Jump to'` with `Search` and `Kbd` `/`. `Dialog $p='none' className='flex max-w-4xl flex-col'` > `ComboboxProvider`: the input row as `palette`; body `div className='@container grid min-h-0 grid-cols-[minmax(0,20rem)_minmax(0,1fr)] max-sm:grid-cols-1'`; start: `DialogScroll` > `ComboboxList`; end: `Frame $darken $rounded='lg' className='m-3 grid place-items-center overflow-clip'` with an `img` sized from `width` and `height` (`max-h-80 w-auto object-contain`), then two `Text` lines. The highlighted row comes from the combobox store (`activeValue`). Images: `variant.diffPreview` of the first variant that needs review; for a run, `run.previews`. Lab cell and data: as `slash-field`; the open panel is `max-w-4xl`.
**Copy** Placeholder `Jump to…`; groups `Screenshots`, `Runs`; caption: the name, the key in mono, `2 of 6 left`; `No matches`. Words: about 6 plus data.
**Behavior** `/` or the button opens. Up and Down move the highlight and the picture; Enter opens the row; Esc closes.
**States**

- `closed`: the trigger.
- `empty`: the first row is the next screenshot that needs review; its picture shows.
- `query`: `dialog`.
- `large`: `menu`; eight rows, then `Show all`; the caption shows the full path with `break-all`.
- `no-match`: `No matches` at the start; the end pane is an empty dashed frame.
- `loading`: skeleton rows and a pulsing frame.
- `read-only`: the caption adds `Read-only`.
- `narrow`: one column; the picture is a 16:9 band above the list.

## Variant `queue-menu`: Queue in a menu

No search field: the back button opens the Queue as a menu, with the next run first.

Ideas:

- The common jump is the next run that needs a decision: one key, then Enter.
- The list is the Queue (same order, same counts), so there is nothing new to learn.
- When a run is done, the same menu is the next step.

Tradeoffs:

- It finds runs only: no screenshots, no actions.
- Typeahead has no visible field.
- A split button (back, then a chevron) is two targets where people expect one.
- It takes `/` for a menu, which is not a search.

### Spec

**Sketch**

```text
| [ <- Queue | v ]   #4863 Migrate component examples to the new...        |
  +--------------------------------------------------+
  | Next                                             |
  |   #4831 Update dependency @playwright/t...    79 |
  | To review                                        |
  |   #4819 Fix a regression where the Com...     12 |
  |   main  Version Packages (#4828)              14 |
  | ------------------------------------------------ |
  |   Queue        History        Status             |
  +--------------------------------------------------+
```

**Build** `ButtonGroup $size='sm' $border`: `Button render={<a />}` (`ArrowLeft`, `Queue`), `ButtonSeparator`, and `ak.MenuProvider` + `ak.MenuButton render={<Button aria-label='Runs to review' />}` (`ChevronDown`). `ak.Menu portal {...popover.jsx({ $p: 1, $rounded: 'xl', className: 'grid w-96 max-w-full' })}` with `ak.MenuGroup`, `ak.MenuGroupLabel render={<TextFrame $p={2} $ink={60} className='text-xs' />}`, and `ak.MenuItem {...option.jsx()} render={<a />}` rows (`OptionLabel className='flex-1 truncate'` with the number in mono; `OptionSlot $kind='badge'`). The last row is three links in a `div className='flex gap-1'`. Lab cell and data: as `slash-field`.
**Copy** `Queue`, `Next`, `To review`, `History`, `Status`, `Newer run`, `No matches`. Words: 6 plus data.
**Behavior** `/` or the chevron opens, with the `Next` row highlighted; Enter opens it. Typing moves the highlight by number or title (menu typeahead); the typed text shows for one second in a small `TextFrame` at the end of the first label.
**States**

- `closed`: the split button.
- `empty`: open, as sketched; each count is the changes left in that run.
- `query`: typed `dialog`: the highlight is on the first run whose title matches.
- `large`: the menu lists runs, so the size of the run does not matter: at most eight rows, then the row `All in Queue`.
- `no-match`: the typed text and `No matches`; the highlight does not move.
- `loading`: skeleton rows; the last row of links shows at once.
- `read-only`: the first group is `Newer run`, with the run that replaced this one.
- `narrow`: the menu is a sheet as wide as the frame.
