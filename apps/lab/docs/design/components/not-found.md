# Not found (not-found)

Group: system
Question: What should a wrong or old link show?
Description: An unknown address, a run that does not exist, and an old check link in a 360 px cell: never a dead end.
Layout: row

## Scenarios

- `unknown-path` (Unknown address): The address /nope: today the bare text Not Found with no header and no link.
- `run-missing` (Run not found): A run address with an ID that does not exist; Retry cannot help.
- `old-check` (Old check link): A check link of #4863 for a replaced attempt; a newer run exists and needs review.
- `typo` (Near miss): The address /pull/4863 (singular): the app can offer /pulls/4863.
- `long-path` (Long address): A 180-character pasted address with a query; the echo must cut the middle.
- `signed-out` (Signed out): An unknown address without a session: no navigation that a guest cannot use.

## Variant `one-line`: One line

Three words, the address in mono, and one button to the Queue.

Ideas:

- The whole page is four words.
- The button has focus: Enter goes to the Queue.
- An old check link gets the newer run as its one action.

Tradeoffs:

- It offers one way out only.
- It says nothing about why a run is missing.

### Spec

```text
 Page not found
 /nope

 [ Queue  ↵ ]
```

**Build.** `grid w-[22.5rem] justify-items-start gap-2`.

- `Heading className='mt-0 mb-0 text-base'` (the `h1` of the page).
- Address: `Text className='font-mono text-xs ak-ink-60'`. Longer than 44 characters: the first 24, `…`, and the last 16.
- `Button $lightnessOffset autoFocus` rendered as a router link, with a `kbd` `↵` in `ButtonSlot $kind='shortcut'`.
- The page keeps the header with the mark. The document title is `Page not found · Visonaut`.

**Copy.** `Page not found` · `Queue`. Words: 4.

**Keys.** Enter on the focused button.

**Scenarios.**

- `unknown-path`: as sketched.
- `run-missing`: `Run not found`; no address (an ID says nothing); `Queue`.
- `old-check`: `This check is from an older run`; brand button `Open the newer run`; link `Open #4863 on GitHub`.
- `typo`: a line under the address: `Did you mean /pulls/4863?`; button `Open /pulls/4863`.
- `long-path`: `/runs/8f2c1d0a-4b7e-4c1…ct-Chromium-Dark`.
- `signed-out`: button `Home`; the header has the mark only.

## Variant `jump-field`: Jump field

A field under the message goes to a pull request or a run by number, with the newest runs as suggestions.

Ideas:

- A wrong link becomes a search: type `4863`, press Enter.
- The field is local to this page: no page-wide palette and no key registry (earlier instruction in feedback-ui).
- Suggestions come from the run list that the Queue already loads.

Tradeoffs:

- It needs the run list, so the suggestions wait for a request; the field works before they arrive.
- A guest gets no field.
- A `Combobox` for a rare page is extra build work.

### Spec

```text
 Page not found
 [ Q  Go to a pull request or run          ]
 +----------------------------------------+
 | * #4863 Migrate component ex...    24  |
 | * #4831 Update dependency @p...    79  |
 | * #4819 Fix a regression whe...    12  |
 +----------------------------------------+
```

**Build.** `grid w-[22.5rem] gap-2`.

- `Heading className='mt-0 mb-0 text-base'`.
- `Combobox aria-label='Go to a pull request or run' placeholder='Go to a pull request or run' autoFocus className='w-full'` with `inputValue` and `setInputValue`.
- `ComboboxList` with `ComboboxItem` rows: `ComboboxItemSlot` (state mark), `ComboboxItemLabel` (number and title, truncated), and the count in a trailing slot. `ComboboxEmpty` for no match.
- Lab: 5 rows from `useInbox('busy')`, filtered by number or title; the list is open in the cell. While the list loads: 3 skeleton rows.

**Copy.** `Page not found` · `Go to a pull request or run` · `No match`. Words: 9.

**Keys.** Type to filter. Down and Up move. Enter opens. `Esc` clears the field.

**Scenarios.**

- `unknown-path`: as sketched.
- `run-missing`: heading `Run not found`.
- `old-check`: heading `This check is from an older run`; the first item is `Newer run of #4863` with a `Badge $layer='warning' $forceRounded` `Needs review`, and it is the active item.
- `typo`: the field starts with `4863` and the match is the active item, so Enter opens it.
- `long-path`: no address echo.
- `signed-out`: no field: `Page not found` and the button `Home`.

## Variant `removed-screenshot`: Removed screenshot

The missing page is shown as the product shows a removed screenshot: a baseline pane, an empty current pane, and one action where the decision bar is.

Ideas:

- The 404 speaks the product's own language; a reviewer reads it in one look.
- No new words: the pane captions and the `Removed` badge already exist.
- Playful, with no extra chrome.
- Not proposed by the audit lanes.

Tradeoffs:

- A joke on an error page can wear thin.
- A reader outside the team may not get it; the heading still says `Page not found`.
- It uses a mock image, which must never look like data of a run.

### Spec

```text
 Page not found                      [- Removed]
+------------------+ +------------------+
| Baseline         | | Current          |
| [ small page   ] | |                  |
| [ sketch       ] | |   Nothing here   |
+------------------+ +------------------+
 /nope                            [ Queue  ↵ ]
```

**Build.** `grid w-[22.5rem] gap-2`.

- Head: `Heading className='mt-0 mb-0 text-base'` and `Badge $layer='danger' $forceRounded` with a `Minus` slot, `flex items-center justify-between`.
- Panes: two columns. Each has a caption `Text className='text-xs ak-ink-70'` and a well with `aspect-video`. Left: `Frame $darken $border $rounded='lg'` with `overflow-clip` and `getScreenshot({ scene: 'page', scheme, state: 'baseline' })` as `img` (`size-full object-cover object-top opacity-60`, `alt=''`). Right: `Frame $border $borderType='dashed' $rounded='lg'` with `grid place-items-center` and `Text className='ak-ink-60 text-sm'`.
- Bar: the address (`font-mono text-xs ak-ink-60 truncate`) and `Button $layer='brand' $size='sm' autoFocus` with a `kbd` `↵`.

**Copy.** `Page not found` · `Removed` · `Baseline` · `Current` · `Nothing here` · `Queue`. Words: 9.

**Keys.** Enter on the focused button. The panes are not Tab stops.

**Scenarios.**

- `unknown-path`: as sketched.
- `run-missing`: heading `Run not found`; no address.
- `old-check`: badge `Replaced` (`$layer='warning'`); captions `Attempt 1` and `Attempt 2`; the right pane reads `Needs review`; button `Open the newer run`.
- `typo`: the right pane reads `Did you mean /pulls/4863?`; button `Open /pulls/4863`.
- `long-path`: the address cuts in the middle (24 characters, `…`, 16 characters).
- `signed-out`: button `Home`; the header has the mark only.

## Variant `recent-work`: Back to work

The message is one line, and the runs that need review follow, so a wrong link still ends at work.

Ideas:

- A dead link becomes a short Queue (benchmark pattern P2).
- For an old check link the newer run is the first row, marked.
- The rows are the Queue rows, so no new component.

Tradeoffs:

- It needs the run list request and shows skeleton rows while it loads.
- A guest sees no rows.
- The message can be overlooked above a list.

### Spec

```text
 Page not found · /nope

 To review · 4
 * #4863 Migrate comp...        24   12 min
 * #4831 Update depend...       79    1 h
 * #4819 Fix a regress...       12    2 h
 All runs ->
```

**Build.** `grid w-[22.5rem] gap-2`.

- Message: `Heading className='mt-0 mb-0 text-sm'` with the address in `Text className='font-mono text-xs ak-ink-60'` after it; `role='status'`.
- Group heading: `Text className='ak-ink-70 text-sm'`.
- Rows: `Button className='w-full justify-start text-start'` rendered as router links, with a state mark slot, the number (`tabular-nums ak-ink-60`), `ButtonLabel $truncate`, the count, and the time. The first row has `autoFocus`. Data: the first three runs of the review group of `useInbox('busy')`.
- `Link` `All runs` with `ArrowRight`.
- While the list loads: three skeleton rows of the picked `skeleton` variant.

**Copy.** `Page not found` · `To review · 4` · `All runs`. Words: 7, plus the rows.

**Keys.** Enter opens the focused row. Tab moves through the rows.

**Scenarios.**

- `unknown-path`: as sketched.
- `run-missing`: `Run not found`, no address.
- `old-check`: `This check is from an older run`; the first row is the newer run of #4863 with `Badge $layer='warning' $forceRounded` `Newer run`; link `Open #4863 on GitHub`.
- `typo`: a first row `Open /pulls/4863` above the group, with focus.
- `long-path`: the address cuts in the middle.
- `signed-out`: no rows: `Page not found` and the button `Home`.
