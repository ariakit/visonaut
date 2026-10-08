# Keyboard help (key-help)

Group: shell
Question: How does a reviewer find the keys?
Description: The entry to the shortcut list, the list, and the switch that turns single-key shortcuts off.
Layout: stack

## Scenarios

- `rest` (At rest): A run page with nothing open.
- `open` (Open): The full list, or the hints shown.
- `off` (Shortcuts off): Single-key shortcuts are off; the way to turn them on stays in reach.
- `read-only` (Read-only run): The decision keys do nothing; the move and view keys work.
- `queue` (On the Queue): A page with other keys than a run page.
- `touch` (Touch, 390): A coarse pointer: no key hint shows.

## Variant `question-button`: Question button

A button in the header and the `?` key open one short dialog; the on/off switch is inside it.

Ideas:

- The entry is in the first screen on every viewport (today it is in a footer below the fold, and `?` opens nothing).
- About 40 words in place of about 100: three groups, one to three words for each row, `Kbd` caps.
- The mode names equal the button names.
- The switch is stored and sits with the list.

Tradeoffs:

- Nothing teaches a key before the first `?`.
- The dialog is modal: it covers the page that it describes.
- With shortcuts off, `?` is off too (it is a single key): the button is the only way in.

### Spec

**Sketch**

```text
header end  [?]          +---------------------------------------------+
                         | Keys                                     x  |
                         | Move     ↑ ↓      Screenshot                |
                         |          ← →      Variant                   |
                         |          1–9      Variant by position       |
                         | Decide   A        Approve                   |
                         |          X        Reject                    |
                         |          ⇧A       Approve all variants      |
                         |          ⇧X       Reject all variants       |
                         |          ⌘Z       Undo                      |
                         | View     S D F G  Side by side · Diff · Current · Baseline |
                         | ------------------------------------------- |
                         | Single-key shortcuts                 [ on ] |
                         +---------------------------------------------+
```

**Build** `DialogProvider` + `TooltipAnchor render={<DialogDisclosure $p={2} aria-label='Keys' />}` (`Keyboard` icon; tooltip `Keys` and `Kbd` `?`). `Dialog className='flex max-w-md flex-col gap-4'`: `DialogHeading className='mt-0 mb-0 text-base'`, `DialogDismiss`, `DialogScroll` > `dl className='grid grid-cols-[auto_auto_1fr] gap-x-4 gap-y-2 text-sm'` (the group word in `ak-ink-60`, `Kbd` caps, the action text), `Separator $line='solid' $gap={0}`, and the Toggle recipe with a `label`. Keys come from `reviewShortcuts`; the words for entries with `origin: 'app'` are the words in the sketch; entries with `origin: 'lab'` use their own `label`. Lab cell: a boxed run page stand-in (a header strip, a tool row with the mode group and previous and next buttons, a decision row with `Undo`, `Reject`, `Approve`); an open state draws the dialog panel in flow (a `div` with the `popover` recipe and `data-open`, `max-w-md`); `rest` opens the real dialog; for `queue` the stand-in is three run rows and a `Jump to…` field; `touch` wraps the cell in `max-w-[24.375rem]`.
**Copy** As sketched. Queue rows: `↑ ↓` Run, `Enter` Open, `/` Jump, `?` Keys. Words: about 40.
**Behavior** `?` opens and closes (in the lab: only inside the cell). Esc closes. The switch calls `session.setShortcutsEnabled`; the product stores it in this browser.
**States**

- `rest`: the button.
- `open`: the list.
- `off`: open; the switch is off; rows with a single key are `ak-ink-40`; `⌘Z` keeps full ink.
- `read-only`: open; the `Decide` rows are `ak-ink-40`, and a `Badge` `Read-only` sits beside the group word.
- `queue`: open; the four Queue rows and the switch.
- `touch`: no button (`pointer-coarse:hidden`); the cell forces this state.

## Variant `legend-bar`: Legend line

A 28 px line at the bottom of the workspace that shows the keys that matter now.

Ideas:

- No discovery step: the main keys are on screen from the first second.
- It follows the context: no decision keys on a read-only run, list keys on the Queue.
- It is the visible home of the on/off state.

Tradeoffs:

- 28 px of height and about 10 words on every run page, also for people who know the keys.
- One more bar next to the decision bar.
- A hide control would need a second place to show the line again.

### Spec

**Sketch**

```text
| ↑↓ Screenshot    ←→ Variant    A Approve    X Reject    S D F G View             ? All keys |  28
off
| Shortcuts off                                                                   [ Turn on ] |
```

**Build** `Frame $layer className='flex h-7 items-center gap-4 border-t px-3 text-xs'` as the last row of a fixed app frame (or `sticky bottom-0`). Each hint: `span className='flex items-center gap-1.5'` with `Kbd` caps and `Text className='ak-ink-60'`. End: `PopoverProvider placement='top-end'` + `PopoverDisclosure $size='xs'` (`Kbd` `?`, `All keys`); the popover holds the list and the switch of `question-button`. Lab cell: as `question-button`, with the line as the last row.
**Copy** `Screenshot`, `Variant`, `Approve`, `Reject`, `View`, `All keys`, `Shortcuts off`, `Turn on`, `Read-only`; Queue: `Run`, `Open`, `Jump`. Words: 7.
**Behavior** `?` opens the popover. Hints are not buttons. The line does not change height between states.
**States**

- `rest`: as sketched.
- `open`: the popover drawn open above the line.
- `off`: `Shortcuts off` and `Button $size='xs'` `Turn on`.
- `read-only`: the move and view hints only, then `Read-only` in `ak-ink-60`.
- `queue`: `↑↓ Run`, `Enter Open`, `/ Jump`, `? All keys`.
- `touch`: no line.

## Variant `inline-hints`: Hints on the controls

No help surface: each control shows its key, on the button or in its tooltip.

Ideas:

- The key is where the eye already is.
- Text buttons carry a shortcut slot; icon buttons show the key in a tooltip on hover and on focus (today a `title` attribute).
- Hints leave when shortcuts are off and on touch, and they are not part of the accessible name (today the name is `Approve & next A`).

Tradeoffs:

- A key with no control (`1–9`, `⇧A`, `⌘Z` if Undo is an icon) cannot be found.
- Each letter adds about 20 px to its button, and noise for people who know the keys.
- There is no overview unless a list exists in another place.

### Spec

**Sketch**

```text
[ x Reject  X ]   [ v Approve  A ]           ( > )  tooltip: Next screenshot  ↓
[ Side by side S | Diff D | Current F | Baseline G ]
```

**Build** Text buttons: `Button` with `ButtonLabel` and `ButtonSlot $kind='shortcut' aria-hidden className='pointer-coarse:hidden'` (a `kbd`), plus `aria-keyshortcuts` on the button. Icon buttons: the tooltip recipe of the primitives guide (`TooltipAnchor render={<Button aria-label='Next screenshot' aria-keyshortcuts='ArrowDown' />}` + `Tooltip` with `Kbd`). One shared `shortcutsEnabled` value removes every slot and every `Kbd`. The full list is the `dl` of `question-button` in a popover from a `Keys` row of the account menu or the mark menu. Lab cell: as `question-button`.
**Copy** Button words as in the product (`Reject`, `Approve`, `Side by side`, `Diff`, `Current`, `Baseline`, `Undo`); tooltips `Previous screenshot`, `Next screenshot`. Words added: 0.
**Behavior** No new key. `?` is not bound in this variant.
**States**

- `rest`: as sketched.
- `open`: the tooltip of the next button drawn open.
- `off`: no slots; tooltips have no `Kbd`.
- `read-only`: `Reject` and `Approve` are disabled and have no slot; the mode hints stay.
- `queue`: the first run row has an `Enter` slot; the field has a `/` slot.
- `touch`: no slots.

## Variant `key-tips`: Key tips

Clean controls at rest; `?` puts a key cap on every control that has a key, in place.

Ideas:

- No letters on the chrome until the reviewer asks.
- It teaches by position: the cap sits on the thing that the key triggers.
- While the tips are on, a key still runs its action and the tips stay: learn by doing.

Tradeoffs:

- A key with no visible control has no place for a cap: a small list must name `1–9`, `⇧A`, `⇧X`, and `⌘Z`.
- Caps cover the corners of controls and can touch in a dense row.
- People do not expect `?` to decorate the page; no audit lane proposed it.

### Spec

**Sketch**

```text
rest      [ x Reject ]   [ v Approve ]      ( < )  ( > )     [ Side by side | Diff | Current | Baseline ]
after ?   [ x Reject ]X  [ v Approve ]A     ( < )↑ ( > )↓    [ Side by side S| Diff D| Current F| Baseline G]
          variants:  [React]1  [Solid]2  [Dark]3 ...
```

**Build** A `KeyTips` React context holds `on`. Each control with a key sits in a `span className='relative inline-flex'`; when `on`, it renders `Kbd $layer='brand' aria-hidden className='absolute -end-1.5 -top-1.5 z-10 text-xs'`. Header: `Button $p={2} aria-label='Key tips' aria-pressed={on} $lightnessOffset={on ? 2 : undefined}` (`Keyboard` icon). An `sr-only` text with `role='status'` says `Key tips on` or `Key tips off`. Controls keep `aria-keyshortcuts` at all times. Lab cell: as `question-button`, with three variant chips added to the tool row.
**Copy** `Key tips`; the list for keys with no control: `1–9` Variant by position, `⇧A` Approve all variants, `⇧X` Reject all variants, `⌘Z` Undo; `Shortcuts off`, `Turn on`. Words at rest: 0.
**Behavior** `?` or the button turns the tips on and off; Esc turns them off; they turn off after 10 s with no key. A second press of the button with the tips on opens the small list in a popover. With shortcuts off, `?` does nothing, and the button opens a small popover (`Shortcuts off`, `Turn on`).
**States**

- `rest`: no caps.
- `open`: caps on every control with a key.
- `off`: no caps; the small popover drawn open.
- `read-only`: caps only on the controls that work.
- `queue`: caps on the first run row (`Enter`) and on the field (`/`).
- `touch`: no button and no caps.

## Variant `learn-panel`: Learn panel

A side panel that is not modal: it stays open during review and lights the row of each key that you press.

Ideas:

- Learn while you work: the dialog of today blocks the page that it documents.
- Key echo: the row of a pressed key tints for 600 ms, so the reviewer sees that the key arrived.
- A key that is off says why in its row (`Read-only`, `No diff for an added screenshot`); today a refused key looks dead.

Tradeoffs:

- 192 px of width while it is open: two screenshots side by side shrink.
- It wants the end side, as the Details panel does.
- The echo is motion at the edge of the view; with reduced motion the tint has no transition.
- No audit lane proposed a key echo.

### Spec

**Sketch**

```text
+----------------------------------------------+---------------------+
|                                              | Keys             x  |
|               (workspace)                    | Move                |
|                                              |  ↑ ↓   Screenshot   |
|                                              |  ← →   Variant      |
|                                              | Decide              |
|                                              | [A]    Approve      |  <- tinted after a press
|                                              |  X     Reject       |
|                                              | View                |
|                                              |  S D F G            |
|                                              | ------------------- |
|                                              | Shortcuts    [ on ] |
+----------------------------------------------+---------------------+
```

**Build** `ShellSidebar $side='end' $width='sm' $show open={open} render={<aside />} aria-label='Keys'` with `ShellSidebarHeader $height='sm'` (`Text className='font-medium'`, a close `Button aria-label='Close keys'`), `ShellSidebarBody $p={2}` (group words as `TextFrame $p={1} $ink={60} className='text-xs'`; each row is `Frame $rounded='md' $p={1} className='flex items-center gap-2 text-sm'` with `Kbd` and `Text`; the pressed row sets `$layer='brand' $mix={20}`), and `ShellSidebarFooter` (the Toggle recipe). Header: `Button $p={2} aria-label='Keys' aria-expanded={open}`. Lab cell: as `question-button` at `h-80`; `onKeyDown` on the focusable cell root (`tabIndex={0}`, `role='group'`, `aria-label='Key echo'`) sets the pressed row.
**Copy** `Keys`, `Move`, `Decide`, `View`, the row words of `question-button`, `Shortcuts`, `Read-only`. Words: about 25.
**Behavior** `?` or the button opens and closes; the open state is stored. The review keys work while it is open (it holds no focus trap).
**States**

- `rest`: closed; the header button.
- `open`: open; press a key in the cell to see the echo.
- `off`: open; rows are `ak-ink-40`; the switch is off.
- `read-only`: `Read-only` in warning text under `Decide`; a press of `A` tints that line, not the row.
- `queue`: the rows for the Queue keys.
- `touch`: no button and no panel.
