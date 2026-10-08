# Shortcut help (shortcut-help)

Group: workspace
Question: How should a reviewer find and learn the keys?
Description: The entry point to the keys, the help itself, and what shows when shortcuts are off, when a run is read-only, and on a touch screen.
Layout: stack

## Scenarios

- `closed` (At rest): A mock workspace at rest: only the entry point and the hints that are always visible.
- `open` (Open): Help is open with the keys of the app today plus `?` and `/`.
- `extended` (Lab key map): Help is open with the lab key map (22 bindings), to test how the design scales.
- `off` (Shortcuts off): Shortcuts are turned off: hints are hidden and the way to turn them on is visible.
- `first-visit` (First visit): The first run page of a new reviewer: how the design teaches that keys exist.
- `read-only` (Read-only): A read-only run: the decision keys do nothing and the help shows that.
- `touch` (Touch): A container 390 px wide with a coarse pointer and no keyboard.

## Variant `cheat-sheet`: Cheat sheet

`?` or a header button opens a dialog with three short groups of keys and the on and off switch.

Ideas:

- About 25 words in place of about 100: one to three words for each row, and the mode names equal the buttons.
- The switch for shortcuts moves into the dialog, so the footer goes away.
- `?` works even when shortcuts are off, so the switch is always reachable.

Tradeoffs:

- A modal: the reviewer cannot look at the keys and use them at the same time.
- Nothing teaches the keys before the reviewer presses `?` or finds the button.
- The lab key map makes the dialog scroll.

### Spec

**Sketch**

```
entry:  [? ]  an icon button in the header, tooltip `Shortcuts ?`
┌ Keyboard shortcuts ───────────────── Shortcuts (on) ── ✕ ┐  max 34rem
│ Navigate                     Decide                      │
│ ↑ ↓   Screenshot             A       Approve             │
│ ← →   Variant                X       Reject              │
│ 1–6   Variant by number      ⇧A ⇧X   All variants        │
│ /     Search                 ⌘Z      Undo                │
│ View                                                     │
│ S  Side by side    D  Diff    F  Current    G  Baseline  │
└──────────────────────────────────────────────────────────┘
```

**Build**

- Lab cell: a mock header `Frame $layer className='flex h-11 items-center justify-between border-b px-3'` with a run title and the entry button. For the `open`, `extended`, `off`, and `read-only` scenarios, render the dialog content inline under it in a `Frame $lighten $border $rounded='2xl' $p={4} className='grid max-w-[34rem] gap-4 shadow-xl'` (a still picture of the open dialog). The entry button also opens the real dialog.
- Entry: icon `Button aria-label='Keyboard shortcuts'` with `Keyboard`, as a `TooltipAnchor` (`Shortcuts` and `<Kbd>?</Kbd>`).
- Dialog: `DialogProvider open setOpen` and `Dialog className='flex max-w-[34rem] flex-col gap-4'` with `DialogHeading`, the switch, and `DialogDismiss`; the groups are in `DialogScroll`.
- Switch: the `Toggle` recipe (`ak.Checkbox` with `role='switch'` on a `Button`), label `Shortcuts`, bound to `session.shortcutsEnabled`.
- Groups: `Text render={<h3 />} className='text-xs font-medium ak-ink-60'`, then rows in a two-column grid (`grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm`): the `Kbd` caps, then the label. Two groups side by side from 30rem, stacked under it.
- Render from `reviewShortcuts` (groups `navigate`, `decide`, `view`), filtered by `origin` for the scenario, with the labels below in place of the hook labels.

**Copy** (25 words): title `Keyboard shortcuts`. Switch `Shortcuts`. Groups `Navigate`, `Decide`, `View`. Rows: `Screenshot`, `Variant`, `Variant by number`, `Search`, `Approve`, `Reject`, `All variants`, `Undo`, `Side by side`, `Diff`, `Current`, `Baseline`. Lab rows: `Next change` (`J`), `Previous change` (`K`), `Next to review` (`N`), `Clear verdict` (`U`), `Overlay` (`O`), `Swipe` (`W`), `Blink` (`B`), `Highlight` (`H`), `Zoom` (`+` `−` `0`). Off: `Shortcuts are off`. Read-only: `Read-only` badge on the Decide group.

**Behavior and keys**

- `?` opens the dialog from anywhere outside a text field, also when shortcuts are off. Esc closes it. The dialog keeps its own keys: `X` does not reject while it is open.
- The switch state is saved in local storage.
- Show `⌘Z` on Apple platforms and `Ctrl Z` elsewhere (decide after hydration; the lab can print `⌘Z`).

**Scenarios**

- closed: the header with the icon button only.
- open: as in the sketch.
- extended: the same groups with the lab rows; the list scrolls inside `DialogScroll` from 22 rows.
- off: the switch is off, the rows are in ink 50, and one line reads `Shortcuts are off`.
- first-visit: the entry button shows its label for the first session: `Shortcuts` and `<Kbd>?</Kbd>` (a labeled button), then it becomes the icon button.
- read-only: the Decide group is in ink 50 with a `Badge` `Read-only`.
- touch: no entry button and no dialog.

## Variant `legend`: Legend line

A one-line legend of the six most used keys stays at the bottom edge, follows the context, and folds away when the reviewer has learned it.

Ideas:

- The keys are visible before the reviewer asks: no discovery step.
- The legend follows the context: no decision keys in a read-only run, and field keys while the search has focus.
- After ten keyboard decisions it folds to one `Keys` button, so an expert pays no space.

Tradeoffs:

- 28 px and seven words of permanent chrome for a new reviewer, on a screen that must lose both.
- A line that changes with the context can distract.
- The full list still needs the dialog (`?`).

### Spec

**Sketch**

```
│ ↑↓ Screenshot   ←→ Variant   A Approve   X Reject   S D F G View        ? All keys │ 28 px
read-only:     │ ↑↓ Screenshot   ←→ Variant   S D F G View                 ? All keys │
search focus:  │ ↵ Open   Esc Clear                                                    │
learned:       │                                                             [kbd Keys] │
```

**Build**

- Lab cell: a mock stage `Frame $darken className='h-32'` and under it the legend line, to show its place at the bottom edge.
- Line: `Frame $layer className='flex h-7 items-center gap-x-4 border-t px-3 text-xs'` with `Text className='ak-ink-60 flex items-center gap-1.5'` items: `Kbd` caps and one word (see the recipe `Keyboard hint`).
- End (`ms-auto`): a `Button $size='xs'` with `<Kbd>?</Kbd>` and `All keys` that opens the cheat sheet dialog (build the dialog as in the `cheat-sheet` variant, or render a short version: the same three groups).
- Context from state: `session.readOnly` removes the Decide items. Focus inside an element with `data-shortcuts-ignore` or a text field swaps the items for the field keys.
- Learned: count the decisions that came from a key (local state, saved in local storage). At ten, the line folds to one `Button $size='xs'` with a `Keyboard` icon and `Keys` at the end; a click opens the line again.
- The line keeps its 28 px in all states, also when folded, so the stage never changes height.

**Copy** (7 words): `Screenshot`, `Variant`, `Approve`, `Reject`, `View`, `All keys`. Search context: `Open`, `Clear`. Folded: `Keys`. Off: `Shortcuts off` and `Turn on`.

**Behavior and keys**

- `?` opens the full list, also when shortcuts are off.
- The item of a key flashes (`$lightnessOffset` for 150 ms on its `Kbd`) when that key is pressed: a small key echo that confirms the press.
- No item is a button except `All keys` and `Keys`. The line is not in the Tab order except these.

**Scenarios**

- closed: the line with six items.
- open: the line, and the dialog picture under it.
- extended: the line adds `N Next to review` and keeps one line; the rest is in the dialog picture.
- off: the line reads `Shortcuts off` in ink 60 with a `Button $size='xs'` `Turn on`.
- first-visit: the line as in `closed`, and its `Kbd` caps pulse one time.
- read-only: the line without `A` and `X`.
- touch: no line.

## Variant `key-tips`: Key tips

Press `?` and every control shows its own key on top of itself; there is no list to read.

Ideas:

- The interface labels itself in place, so the reviewer learns the key where the control is.
- The rest of the page dims, so the key caps are the only bright things.
- It scales with the design: a new control with a key gets its tip with no change to a help text.

Tradeoffs:

- Keys with no visible control (arrows, numbers) need an anchor area, such as the list edge and the variant control.
- Every control must carry its key in the markup.
- No overview by group, and nothing to read for a screen reader user: an accessible list must exist beside it.
- A new idea that is not in the audit.

### Spec

**Sketch**

```
press ? →
┌───────────────────────────────────────────────────────────────────────┐
│ ‹ Queue   #4863 …                                         [?]   [/]⌕  │
│ ┌ list ─────┐   ┌ variants ───────────────┐                           │
│ │        [↑]│   │ [1] [2] [3] [4] [5] [6]  │[←][→]    [S] [D] [F] [G]   │
│ │        [↓]│   └─────────────────────────┘                           │
│ └───────────┘                         [⌘Z] ↶    [X] Reject   [A] Approve │
└───────────────────────────────────────────────────────────────────────┘
   the tips are inverted key caps; everything else is at 60%
```

**Build**

- Lab cell: a schematic workspace about 44rem by 16rem built from real primitives: a header `Frame` (a Queue link, a title, a `?` button, a search trigger), a list `Frame` with five plain rows, a variant control with six small buttons, a mode `ButtonGroup` (`Side by side`, `Diff`, `Current`, `Baseline`), and a bar with Undo, Reject, and Approve.
- Scope root: a wrapper with `data-keytips` set from state and the class `group/tips`.
- A tip: `<Kbd $invert className='absolute -top-2 -start-2 z-10 hidden group-data-[keytips]/tips:inline-flex'>A</Kbd>` inside a `relative` wrapper of its control. Arrow tips sit at the end edge of the list (Up, Down) and of the variant control (Left, Right). Number tips sit on the first six variant buttons.
- Dim: the non-tip content gets `group-data-[keytips]/tips:opacity-60` (apply to the main blocks, not to the tips).
- The key of each control comes from one small map in the variant file (`{ approve: 'A', reject: 'X', … }`), which also feeds the visually hidden list.
- Accessible list: a visually hidden `dl` with the same keys and the labels of the cheat sheet (`Screenshot`, `Variant`, `Approve`, …), and a `Button` `List` in the tips state that opens it in a `Popover`.

**Copy** (0 words in the tips state): the tips are keys only. One hint line at the bottom edge of the scope in the tips state: `Press a key, or Esc` in `text-xs`. Popover: the cheat sheet labels. Off: `Shortcuts are off` and `Turn on`.

**Behavior and keys**

- `?` turns the tips on. The next key runs its action and turns the tips off. Esc or `?` again turns them off with no action.
- The `?` button in the header does the same for the pointer.
- Tips of unavailable actions (read-only, no diff for an added variant) are `ak-ink-40` with a dashed edge.

**Scenarios**

- closed: the schematic workspace with no tips; the `?` button has a tooltip `Shortcuts ?`.
- open: the tips state as in the sketch.
- extended: more tips on the same picture: `N` on the list, `O` `W` `B` on three more mode buttons, `H`, and `+` `−` `0` on a zoom group; add those controls to the schematic.
- off: no tips; `?` shows a small `Popover` on the header button: `Shortcuts are off` and a `Button $size='sm'` `Turn on`.
- first-visit: the tips state shows by itself for 4 s on the first run page, with the hint line `Press ? to see the keys again`.
- read-only: the tips state with dashed, soft tips on Reject, Approve, and Undo.
- touch: no `?` button and no tips.

## Variant `keyboard-map`: Keyboard map

The help is a drawn keyboard: bound keys are tinted by group, and a key names its action on hover.

Ideas:

- The picture shows the design of the key map: decisions and views under the left hand, navigation under the right hand.
- Unbound keys are visible too, so the reviewer sees what is safe to press.
- A real key press lights its cap in the open help, which makes the help a place to practice.

Tradeoffs:

- The drawing is a US layout. Letters are matched by the printed letter, so on AZERTY or Dvorak the positions differ; the list view is the fallback.
- A larger dialog (about 38rem by 20rem).
- Playful, and more to build than a list. A new idea that is not in the audit.

### Spec

**Sketch**

```
┌ Keyboard shortcuts ────────────────────── Keyboard | List ── Shortcuts (on) ── ✕ ┐
│ [1][2][3][4][5][6] 7  8  9  0                                                    │  variant by number
│   Q  W  E  R  T  Y  U  I  O  P                                                   │
│   [A][S][D][F][G] H  J  K  L                                                     │  A approve · S D F G view
│ [⇧] [Z][X] C  V  B  N  M  ,  . [/]                              [↑]              │  X reject · ⌘Z undo
│ [⌘]                                                         [←][↓][→]            │
│ ■ Navigate   ■ Decide   ■ View                                                   │
│ X   Reject · with ⇧: all variants of the screenshot                              │  the hovered or pressed key
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Build**

- Lab cell: a mock header with the entry button (icon `Button aria-label='Keyboard shortcuts'` with `Keyboard`, tooltip `Shortcuts` and `<Kbd>?</Kbd>`). For the open scenarios, render the dialog content inline under it in a `Frame $lighten $border $rounded='2xl' $p={4} className='grid max-w-[38rem] gap-4 shadow-xl'`. The entry button also opens the real `Dialog` (`className='max-w-[38rem]'`).
- Header row: `DialogHeading`, a segmented control `Keyboard | List` (`ak.RadioGroup render={<ButtonGroup $border $size='sm' />}` with a `ButtonGlider`), the `Shortcuts` switch (the `Toggle` recipe), and `DialogDismiss`.
- Keyboard: `aria-hidden`, four rows of caps with row offsets (`ps-3`, `ps-5`, `ps-8`) and an arrow cluster at the end. Each cap is a `Kbd` with `className='inline-grid size-8 place-items-center'`.
- Tints: Decide keys `Kbd $layer='brand'`. View keys `Kbd $layer='secondary'`. Navigate keys the default raised `Kbd`. Unbound keys `Kbd $layer='transparent'` in `ak-ink-40`.
- Legend row: three small squares (`Frame` with the same layers) and the group names in `text-xs`.
- Action line: `Text role='status' className='min-h-6 text-sm'` with a `Kbd` and the action of the hovered, focused, or pressed key. Fixed height, so nothing shifts.
- List view: the three groups of the cheat sheet (`Kbd` caps and one to three words in a two-column grid). It is the accessible content.
- Data: `reviewShortcuts`, filtered by `origin` for the scenario; a local table maps each binding to its cap.

**Copy**: title `Keyboard shortcuts`. Views `Keyboard`, `List`. Switch `Shortcuts`. Groups `Navigate`, `Decide`, `View`. Action lines: `Approve · with ⇧: all variants of the screenshot`, `Reject · with ⇧: all variants of the screenshot`, `Undo (with ⌘)`, `Side by side`, `Diff`, `Current`, `Baseline`, `Screenshot`, `Variant`, `Variant by number`, `Search`. Note under the keyboard in ink 60: `US layout`.

**Behavior and keys**

- `?` opens the dialog, also when shortcuts are off. Esc closes.
- While the dialog is open, a real key press lights its cap (`$invert` for 300 ms) and shows its action line. The action does not run.
- Holding Shift shows the Shift meanings in the action line.
- The chosen view (`Keyboard` or `List`) is saved in local storage.

**Scenarios**

- closed: the header with the icon button.
- open: as in the sketch (13 tinted caps and the arrows).
- extended: `J`, `K`, `N`, `U` join Navigate and Decide; `O`, `W`, `B`, `H`, `0`, `−`, `=` join View.
- off: all caps in the unbound look; the switch is off; the action line reads `Shortcuts are off`.
- first-visit: the entry button shows the label `Shortcuts` and `<Kbd>?</Kbd>` for the first session.
- read-only: the Decide caps have a dashed edge and ink 50; the action line of `A` reads `Approve · not available in a read-only run`.
- touch: no entry button.

## Variant `command-list`: Command list

`?` opens a searchable list of every command with its key; Enter runs the selected command.

Ideas:

- One place lists every action, so it serves a reviewer who does not use single-key shortcuts.
- Typing two letters finds a command in the lab key map of 22 bindings.
- Unavailable commands are visible and say why.

Tradeoffs:

- It is close to the hotkey registry that an earlier instruction rejected (feedback-ui.md:96). It opens with `?`, not with `Cmd/Ctrl+K`.
- Typing to find a key is slower than reading a nine-row list.
- A modal with a text field: while it is open, the single keys type letters.

### Spec

**Sketch**

```
? →
┌ ⌕ Type a command                                  Shortcuts (on) ┐  max 30rem
│ Decide                                                           │
│ ▌Approve                                                      A  │
│  Reject                                                       X  │
│  Approve all 6                                               ⇧A  │
│  Undo                                                        ⌘Z  │
│ View                                                             │
│  Side by side                                                 S  │
│  Diff                                                         D  │
│ Navigate                                                         │
│  Next screenshot                                              ↓  │
└──────────────────────────────────────────────────────────────────┘
```

**Build**

- Lab cell: a mock header with the entry button (icon `Button aria-label='Commands and shortcuts'` with `Keyboard`, tooltip `Commands` and `<Kbd>?</Kbd>`). For the open scenarios, render the dialog content inline under it in a `Frame $lighten $border $rounded='2xl' $p={2} className='grid max-w-[30rem] gap-2 shadow-xl'`. The entry button also opens the real dialog.
- Dialog: `DialogProvider open setOpen` and `Dialog $p={2} className='flex max-w-[30rem] flex-col gap-2'` with the styled `Combobox` (`aria-label='Commands'`, placeholder `Type a command`) and, at the end of the field row, the `Shortcuts` switch (the `Toggle` recipe).
- List: `ComboboxList` inside `DialogScroll`. Group labels: `Text className='px-2 pt-2 text-xs font-medium ak-ink-60'`. Rows: `ComboboxItem` with `ComboboxItemLabel` and an end `ComboboxItemSlot` that holds `Kbd` caps.
- An unavailable command is `disabled` and has a `ComboboxItemDescription` with the reason.
- Data: `reviewShortcuts` for the rows (filtered by `origin`), in the group order Decide, View, Navigate, with the labels below. Each row maps to a session action (`session.approve`, `session.viewer.setMode('diff')`, `session.nextItem`, …).
- `ComboboxEmpty` for no match.

**Copy**: placeholder `Type a command`. Switch `Shortcuts`. Groups `Decide`, `View`, `Navigate`. Rows: `Approve`, `Reject`, `Approve all 6`, `Reject all 6`, `Undo`, `Side by side`, `Diff`, `Current`, `Baseline`, `Next screenshot`, `Previous screenshot`, `Next variant`, `Previous variant`, `Search screenshots`. Lab rows: `Next to review`, `Clear verdict`, `Overlay`, `Swipe`, `Blink`, `Highlight changes`, `Zoom in`, `Zoom out`, `Fit`. Reasons: `Read-only run`, `Images are loading`, `No diff for an added screenshot`. Empty: `No matches`.

**Behavior and keys**

- `?` opens the list, also when shortcuts are off. Up and Down move, Enter runs the command and closes, Esc closes.
- The first row is the most likely action: `Approve` when the selected variant needs review.
- When shortcuts are off, the rows still run with Enter; the key caps are in ink 40.

**Scenarios**

- closed: the header with the icon button.
- open: 14 rows in three groups.
- extended: 23 rows; the picture shows the text `ne` typed and three matches (`Next screenshot`, `Next variant`, `Next to review`).
- off: the switch is off and the key caps are soft; the rows are enabled.
- first-visit: the entry button shows the label `Commands` and `<Kbd>?</Kbd>` for the first session.
- read-only: the Decide rows are disabled with `Read-only run`.
- touch: the entry button stays (a command list is useful without a keyboard); the rows have no key caps and are 44 px high.
