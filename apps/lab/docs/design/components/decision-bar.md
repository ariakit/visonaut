# Decision bar and save status (decision-bar)

Group: workspace
Question: Which decision bar, with its save feedback, should the workspace use?
Description: The controls that approve, reject, undo, and decide a whole screenshot, together with the place that shows sending, queued, saved, failed, and conflict.
Layout: stack

## Scenarios

- `ready` (Ready): Firefox · Light of Dialog with initial focus needs review, the screenshot has six changes, and nothing was decided in this session.
- `saving` (Sending and queued): Three fast approvals: one decision is still sending and two are queued on the server, and the bar already shows the next variant.
- `saved` (Saved, return visit): All decisions are saved, Undo is available, and the selected variant is one that the reviewer approved three minutes ago.
- `offline` (Not saved): The connection failed: two decisions were taken back, and new decisions are blocked until Retry or Reload.
- `conflict` (Conflict): The server refused the decision because @morikenji rejected this variant first; nothing changed.
- `waiting` (Images loading): The images of the selection still load, so decisions wait; the screenshot has one change, so no whole-screenshot command exists.
- `read-only` (Read-only): A newer run replaced this run: there is nothing to decide and a link opens the newer run.
- `narrow` (Narrow): The ready state in a container 390 px wide with a coarse pointer.

## Variant `dock`: Dock with a status slot

A bar of constant height: Undo, one status slot, the whole-screenshot menu, Reject, Approve.

Ideas:

- Nothing moves: the slot holds every message in one truncated line.
- Feedback part: words in the slot. `Sending 1`, `Queued 2`, and `Saved` are three different marks and words.
- In an error, Reject and Approve are replaced by Retry and Reload, so the only valid actions are the only visible ones.

Tradeoffs:

- The bar stays at the bottom, not in the main header that decision U02 selected.
- 52 px of permanent chrome.
- The whole-screenshot command has no confirmation on either path; Undo is the safety net (this settles WORK-17 in one of two possible ways).

### Spec

**Sketch**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ↶ Undo │ ✓ Saved                                 All 6 ▾   ✕ Reject X   ✓ Approve A │ 52 px
└──────────────────────────────────────────────────────────────────────────────┘
slot:  (empty)  ·  ↑ Sending 1  ·  cloud Queued 2 · safe to close  ·  ✓ Saved
offline:   │ ⚠ Not saved · Check your connection.                    Reload   Retry │
read-only: │ lock Read-only · Replaced by a newer run                 Open newer run │
```

**Build**

- `ButtonGroup role='toolbar' aria-label='Decision' $border className='w-full h-13 items-center'`.
- Undo: `Button` with `Undo2` and `ButtonLabel`; a `TooltipAnchor` with `Undo` and `<Kbd>⌘Z</Kbd>`. `disabled={!can.undo}`.
- `ButtonSeparator`, then the slot: `TextFrame $p={2} role='status' className='flex-1 min-w-0 truncate text-sm'` with an icon in `Text $text` and the words.
- `All 6`: `ak.MenuProvider`, `ak.MenuButton render={<Button />}`, and a menu from the `popover` and `option` recipes: `Approve all 6` with `⇧A`, `Reject all 6` with `⇧X`. Hidden when the screenshot has one change.
- Reject: `Button $border` with `X`, `ButtonLabel`, and `ButtonSlot $kind='shortcut'` `X`. Approve: `Button $layer={can.approve ? 'brand' : undefined} $border={!can.approve}` with `Check`, `ButtonLabel`, and `A`.
- Return visit: the button of the current verdict shows the state: `Approved` with `$layer='success' $mix={20}` and `aria-pressed='true'`. The other button stays an action.
- Error mode: the whole group gets `$layer='danger' $mix={12}`. The slot has the message. The end has `Reload` (`Button $border`) and `Retry` (`Button $layer='brand'`).
- Waiting: a `Progress aria-label='Loading images' $thickness={0.5}` on the top edge (`absolute inset-x-0 top-0`); Reject and Approve are `disabled`.
- The `saving`, `offline`, and `conflict` scenarios are still pictures from constants. `ready` and `saved` use `useReviewSession('changes')`.

**Copy** (5 words at rest): `Undo`, `All 6`, `Reject`, `Approve`. Slot: `Sending 1`, `Queued 2 · safe to close`, `Saved`, `Undone`, `Loading images…`, `Not saved · Check your connection.`, `Not saved · Error ID req_01JZ8Q4W7M`, `Changed by @morikenji · Nothing was saved.`, `Read-only · Replaced by a newer run`. Buttons: `Retry`, `Reload`, `Open newer run`, `Approve all 6`, `Reject all 6`, `Approved`, `Rejected`.

**Behavior and keys**

- `A` and `X` decide and go to the next variant that needs review. `Shift+A` and `Shift+X` decide all changes of the screenshot as one command, with no dialog on either path. `Cmd/Ctrl+Z` undoes the last saved command.
- `Saved` fades after 1.6 s to an empty slot. Errors stay.
- A decision key during `waiting` writes `Loading images…` in the slot and the live region. It is not buffered.
- The slot text is also the live region (`role='status'`).

**Scenarios**

- ready: empty slot, Undo disabled.
- saving: `↑ Sending 1 · cloud Queued 2` (both at once: `ArrowUp` and `Cloud`).
- saved: `✓ Saved`; Approve reads `Approved` as a pressed state; Undo enabled.
- offline: error mode as in the sketch.
- conflict: error mode with `Changed by @morikenji · Nothing was saved.` and one button `Reload`.
- waiting: the top progress line, disabled buttons without a brand fill, no `All` menu.
- read-only: one line and `Open newer run`; no decision controls.
- narrow: two fixed rows. Row 1: Undo, slot, `All 6`. Row 2: Reject and Approve, each `flex-1 h-12`. No key hints.

## Variant `split`: Split buttons with a receipt

Approve and Reject are split buttons whose menus hold the whole-screenshot command; a floating receipt shows the last decision and its save state.

Ideas:

- The whole-screenshot command lives under the verb it belongs to, with its key and the marks of its targets.
- Feedback part: a receipt that floats above the bar end. It names what was decided, so a wrong key press is seen at once.
- Undo is inside the receipt, at the place of attention, and it is enabled only when the decision is saved.

Tradeoffs:

- The receipt covers a 16rem by 3rem corner of the image for a few seconds.
- Two more small buttons (the carets) in the bar.
- The bar stays at the bottom, not in the main header that decision U02 selected.

### Spec

**Sketch**

```
                                              ┌──────────────────────────────┐
                                              │ ✓ Approved · Firefox · Light │  receipt (floats, absolute)
                                              │ cloud Queued 2    Undo       │
                                              └──────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│ ↶ Undo                                        [✕ Reject X │▾]  [✓ Approve A │▾] │ 52 px
└──────────────────────────────────────────────────────────────────────────────┘
Approve ▾ menu:   This variant                A
                  All 6 in this screenshot   ⇧A     ○○○○○○
```

**Build**

- Bar: `Frame $layer className='relative flex h-13 items-center gap-2 border-t px-3'` with `role='toolbar' aria-label='Decision'`.
- Undo: `Button` with `Undo2` and `ButtonLabel`; tooltip `Undo` and `<Kbd>⌘Z</Kbd>`.
- Split button: `ButtonGroup $p='none' $gap='none'` with two joined buttons. Main: `Button $border $borderType='border'` (Reject) or `Button $layer='brand'` (Approve) with an icon, a `ButtonLabel`, and a `ButtonSlot $kind='shortcut'`. Caret: the same surface, `aria-label='More approve options'`, as `ak.MenuButton` with `ChevronDown`.
- Menu (`popover` and `option` recipes): `This variant` with the key, and `All 6 in this screenshot` with `⇧A` and the 12 px marks of the targets in an `OptionSlot`. The second item is disabled when the screenshot has one change.
- A disabled Approve drops the brand layer on both parts: `$layer={can.approve ? 'brand' : undefined}`.
- Receipt: `Frame $lighten $border $rounded='lg' $p={2} role='status' className='absolute bottom-full end-3 mb-2 grid w-64 gap-1 text-sm shadow-md'`. Line 1: the mark, the verdict word, and the short variant label (or `6 variants · Dialog with initial focus`). Line 2: the save state with an icon in ink 70, and the link button `Undo` (`Link render={<button />}`, `aria-disabled` until saved).
- Error: the receipt gets `$layer='danger' $mix={15} $edge='danger'`, stays, and holds `Retry` and `Reload` as `Button $size='sm' $border`.
- The `saving`, `offline`, and `conflict` scenarios are still pictures from constants.

**Copy** (3 words at rest): `Undo`, `Reject`, `Approve`. Menu: `This variant`, `All 6 in this screenshot`. Receipt: `Approved · Firefox · Light`, `Rejected · 6 variants`, `Sending 1`, `Queued 2`, `Saved`, `Undo`, `Not saved · Check your connection.`, `Changed by @morikenji · Nothing was saved.`, `Retry`, `Reload`. Read-only: `Read-only · Replaced by a newer run`, `Open newer run`.

**Behavior and keys**

- `A`, `X`, `Shift+A`, `Shift+X`, and `Cmd/Ctrl+Z` as in the app. The menu path and the key path do the same thing with no dialog.
- The receipt appears with the decision, shows `Sending`, then `Queued`, then `Saved`, and leaves 4 s after `Saved`. It never leaves while a decision is not saved.
- The bar itself never changes height.

**Scenarios**

- ready: no receipt; Undo disabled.
- saving: the receipt reads `Approved · Chromium · Dark`, `↑ Sending 1 · cloud Queued 2`, and `Undo` is disabled.
- saved: the receipt reads `Saved` with `Undo` enabled; the Approve main button reads `Approved` (`$layer='success' $mix={20}`, `aria-pressed`).
- offline: the danger receipt with `Retry` and `Reload`; both split buttons are disabled.
- conflict: the danger receipt with `Reload` only.
- waiting: both split buttons disabled without a brand fill; a `Progress $thickness={0.5}` line on the top edge of the bar.
- read-only: the bar is one line of text and `Open newer run`.
- narrow: the two split buttons fill a 48 px row; Undo moves into the receipt; the receipt is as wide as the bar.

## Variant `pill`: Floating pill

A rounded pill that floats over the bottom of the stage; the pressed button itself shows sending, queued, and saved.

Ideas:

- No reserved row: the image gets the full height.
- Feedback part: the icon of the pressed button turns into a ring, then a cloud, then a check. No sentence in a normal save.
- The pill fades while the reviewer only looks, and it turns into the error message when a save fails.

Tradeoffs:

- It covers the bottom center of the image unless the stage keeps 4rem free.
- Save states are icons; the words are in the tooltip and the live region only (rule A09 and invariant I4 need a decision on this).
- A faded control can hide state. It never fades while something is not saved.
- The bar is not in the main header that decision U02 selected.

### Spec

**Sketch**

```
┌ stage ───────────────────────────────────────────────────────────────┐
│                                                                      │
│            ╭───────────────────────────────────────────╮             │
│            │ ↶ │ ✕ Reject X │ ✓ Approve A │ ⋯ │         │  floats, bottom center
│            ╰───────────────────────────────────────────╯             │
└──────────────────────────────────────────────────────────────────────┘
saving:   │ ↶ │ ✕ Reject X │ ◔ Approve A │ ⋯ │   ring = sending, cloud with `2` = queued, check = saved
offline:  ╭ ⚠ Not saved · Check your connection.     Reload   Retry ╮   wider, danger tint
```

**Build**

- Lab cell: a mock stage `Frame $darken $rounded='xl' className='relative h-48'` so that the float is visible.
- Pill: `Frame $layer $lighten={2} $border $rounded='full' $p={1} role='toolbar' aria-label='Decision' className='absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 shadow-xl'`.
- Children: `Button $rounded='full' $forceRounded` for Undo (icon only, `aria-label='Undo'`, tooltip with `<Kbd>⌘Z</Kbd>`), `ButtonSeparator`, Reject (`X`, `ButtonLabel`, shortcut slot), Approve (`$layer={can.approve ? 'brand' : undefined}`, `Check`, `ButtonLabel`, shortcut slot), and a `⋯` `ak.MenuButton` (`aria-label='More'`) with `Approve all 6` `⇧A`, `Reject all 6` `⇧X`, and `Copy link`.
- Save feedback: the leading `ButtonSlot` of the button that was pressed. Sending: `ProgressCircular` without a value (in a `size-[1em]` box). Queued: `Cloud`, plus a `ButtonSlot $kind='badge' $p='md'` count when more than one decision is queued. Saved: `CircleCheck` for 1.6 s. Then the action icon returns. The tooltip and a visually hidden `role='status'` element carry the words.
- Return visit: the button of the current verdict has `$layer='success' $mix={25}` (or danger) and `aria-pressed='true'`.
- Error: the pill content is replaced by an icon, the message, `Reload`, and `Retry`; the frame gets `$layer='danger' $mix={20}`.
- Idle fade: `opacity-45` after 3 s without a pointer move, a key, or focus inside (`transition-opacity`). Never while sending, queued, waiting, or in an error. Off with reduced motion: the pill stays solid.

**Copy** (2 words at rest): `Reject`, `Approve`. Tooltips and live region: `Sending 1`, `Queued 2 · safe to close`, `Saved`. Error: `Not saved · Check your connection.`, `Changed by @morikenji · Nothing was saved.`, `Retry`, `Reload`. Menu: `Approve all 6`, `Reject all 6`, `Copy link`. Read-only: `Read-only`, `Open newer run`.

**Behavior and keys**

- `A`, `X`, `Shift+A`, `Shift+X`, and `Cmd/Ctrl+Z` as in the app, with no dialog.
- A key press makes the pill solid and gives the pressed button a 150 ms press look, so that keyboard decisions are visible.

**Scenarios**

- ready: a solid pill; Undo disabled.
- saving: the Approve slot shows the ring, and a `Cloud` count `2` sits on the `⋯` side of the Approve button.
- saved: Approve is in the success tint with `aria-pressed`; Undo enabled.
- offline: the wide danger pill.
- conflict: the wide danger pill with `Reload` only.
- waiting: both buttons disabled; an indeterminate `Progress $thickness={0.5}` line inside the bottom edge of the pill.
- read-only: a small pill: lock icon, `Read-only`, `Open newer run`.
- narrow: the pill is a bar at the bottom edge with two 48 px buttons at the full width; `⋯` and Undo sit above them at the end; no fade; no key hints.

## Variant `header-actions`: Header actions

The layout that the maintainer selected in decision U02: name, variant label, verdict, save state, Undo, Reject, and Approve in one header row.

Ideas:

- The decision is beside the name of the thing that is decided. No bottom bar exists.
- Feedback part: one chip in the row with an icon and a word for each save state.
- The whole-screenshot command is a two-step armed button, and it is the same for the pointer and for `Shift+A`.

Tradeoffs:

- The actions are at the top, far from a pointer that is on the image.
- A long name competes with the actions. The name truncates first; the actions never wrap.
- The armed step adds one key press to `Shift+A` (changes rule K11, where the key decides at once).

### Spec

**Sketch**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Dialog with initial focus  React · Firefox · Light  (○ Needs review)   cloud Queued 2  ↶  ✕ Reject X  [✓ Approve A │▾] │ 44 px
└──────────────────────────────────────────────────────────────────────────────────┘
armed (3 s):   … ✕ Reject X   [✓ Approve all 6?  ↵ ]        Esc cancels
```

**Build**

- Row: `Frame $layer className='flex h-11 items-center gap-3 border-b px-3'` with `role='toolbar' aria-label='Decision'` on the end group. In a page it is the `ShellMainHeader`.
- Start (`min-w-0 flex-1 flex items-center gap-2`): `Heading className='mt-0 mb-0 truncate text-sm font-semibold'` with the screenshot name, `Text className='truncate text-sm ak-ink-70'` with the full variant label, and a status `Badge $layer={role} $forceRounded` with a `BadgeSlot` mark and a `BadgeLabel`.
- Save chip: `Badge $forceRounded role='status'` with a `BadgeSlot` icon and a `BadgeLabel`. It keeps a fixed `min-w-28` place, so the buttons never move. Empty at rest.
- Undo: an icon `Button aria-label='Undo'`; tooltip `Undo` and `<Kbd>⌘Z</Kbd>`.
- Reject: `Button $border` with `X`, `ButtonLabel`, and the shortcut slot. Approve: a split button (`ButtonGroup $p='none' $gap='none'`) with `Button $layer={can.approve ? 'brand' : undefined}` and a caret `ak.MenuButton` whose menu has `Approve all 6` and `Reject all 6`.
- Armed state from local state: the Approve (or Reject) main button reads `Approve all 6?` with `<Kbd>↵</Kbd>` and keeps its width class (`min-w-44`) so nothing shifts. A 3 s `Progress $thickness={0.5}` line runs inside its bottom edge.
- Error: the chip becomes `Badge $layer='danger'` `Not saved`, and Reject and Approve are replaced by `Reload` and `Retry`. The message is in a `Tooltip` of the chip and in the live region.

**Copy** (2 action words at rest): `Reject`, `Approve`. Chip: `Sending 1`, `Queued 2`, `Saved`, `Not saved`, `Conflict`, `Loading…`, `Read-only`. Armed: `Approve all 6?`, `Reject all 6?`. Error tooltip: `Check your connection.`, `Changed by @morikenji. Nothing was saved.` Buttons: `Retry`, `Reload`, `Open newer run`.

**Behavior and keys**

- `A` and `X` decide. `Shift+A` or the menu item arms the button for 3 s. Enter, the same key again, or a click confirms. Esc or the timeout cancels.
- `Cmd/Ctrl+Z` undoes. The chip is the live region.

**Scenarios**

- ready: empty chip place; Undo disabled.
- saving: the chip reads `↑ 1 · cloud Queued 2` (the two counts with their icons).
- saved: the chip reads `✓ Saved`; the status badge reads `Approved`; Approve reads `Approved` with `$layer='success' $mix={20}`.
- offline: the danger chip, `Reload`, and `Retry`.
- conflict: the chip `Conflict`, and `Reload` only.
- waiting: the chip `Loading…` with a spinner; buttons disabled without a brand fill; no caret.
- read-only: the status badge reads `Read-only` with a lock; the end has only `Open newer run`.
- narrow: under a container width of 30rem the row keeps the name and the status mark, and the actions move to a bottom dock with two 48 px buttons.

## Variant `verdict-switch`: Verdict switch

A three-position switch shows the verdict of the variant on screen and changes it: Rejected, Needs review, Approved.

Ideas:

- The state and the action are one control. On a return visit, the glider is already on the saved verdict.
- The middle position clears a verdict, which the app cannot do today.
- Feedback part: the glider edge is dashed until the server confirms, and a small counter shows what is still in flight.

Tradeoffs:

- The labels are states (`Approved`), not actions (`Approve`).
- After a decision the page moves to the next variant and the glider returns to the middle. This can look like the choice did not stay; a 200 ms hold reduces the effect.
- `Clear verdict` (key `U`) is not in the app today.
- A new idea that is not in the audit. The bar is not in the main header that decision U02 selected.

### Spec

**Sketch**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ↶    (All 6)        [ ✕ Rejected X │ ○ Needs review │ ✓ Approved A ]       cloud 2 │ 52 px
└──────────────────────────────────────────────────────────────────────────────┘
                                         ▲ glider = the verdict of the variant on screen
scope on:   (All 6 ✓)   the switch then applies to all six changes as one command
```

**Build**

- Bar: `Frame $layer className='flex h-13 items-center gap-3 border-t px-3'`, `role='toolbar' aria-label='Decision'`.
- Undo: an icon `Button aria-label='Undo'` with a tooltip (`Undo`, `<Kbd>⌘Z</Kbd>`).
- Scope: `CheckboxCard $size='sm' $rounded='full' $p={1} $px='lg'` with the label `All 6`. Hidden when the screenshot has one change.
- Switch (centered, `mx-auto`): `ak.RadioProvider value={verdict ?? 'none'}` and `ak.RadioGroup aria-label='Verdict' render={<ButtonGroup $border $rounded='full' />}` with three `ak.Radio render={<Button $rounded='full' />}`: `X` and `Rejected` and the shortcut slot `X`; `Circle` and `Needs review`; `Check` and `Approved` and the shortcut slot `A`. Then `<ButtonGlider $kind='bevel' />` and `<ButtonGlider $state='focus' />`.
- Tone from state: with the glider on `Approved`, the group gets `$edge='success'`; on `Rejected`, `$edge='danger'`. While the verdict of this variant is sending or queued, the group gets `$borderType='dashed'`.
- Counter (end, fixed `w-16`, `role='status'`): `ArrowUp` and a number for sending, `Cloud` and a number for queued, `Check` for 1.6 s after a save. Tooltip: `Queued on the server. Safe to close.`
- Error: the counter place holds `Badge $layer='danger'` `Not saved` and a `Retry` button; the switch is `disabled`.
- An added or removed variant starts on `Approved` (auto-approved); the label line of the page says so.

**Copy** (4 words at rest): `Rejected`, `Needs review`, `Approved`, `All 6`. Error: `Not saved`, `Retry`, `Reload`. Read-only: `Read-only · Replaced by a newer run`, `Open newer run`.

**Behavior and keys**

- `A` or a click on `Approved`: the glider moves, holds 200 ms, then the page goes to the next variant that needs review and the glider shows the state of that variant. `X` is the same for `Rejected`.
- A click on `Needs review`, or `U`, clears the verdict of a person (`session.clear`).
- `Shift+A` and `Shift+X` decide all changes of the screenshot. The `All 6` chip does the same for the pointer: turn it on, then choose a side; it turns off after the command.
- `Cmd/Ctrl+Z` undoes the last saved command.

**Scenarios**

- ready: the glider is in the middle; Undo disabled.
- saving: the glider is in the middle (the next variant); the counter reads `↑ 1  cloud 2`.
- saved: the glider is on `Approved` with a solid success edge; Undo enabled.
- offline: `Not saved`, `Retry`, and a disabled switch. `Reload` is in the tooltip row of the badge as a second button.
- conflict: the glider is on `Rejected` (the verdict of @morikenji) and a line in the counter place reads `Changed by @morikenji` with `Reload`.
- waiting: the switch is `disabled` and its group shows a `Progress $thickness={0.5}` line on the top edge.
- read-only: the switch is replaced by the read-only line and `Open newer run`.
- narrow: two rows. Row 1: Undo, `All 6`, counter. Row 2: the switch at the full width, 48 px high, with icons and words, no key hints.

## Variant `ledger`: Ledger

The bar keeps the last decisions as small chips, and each chip shows its own save state.

Ideas:

- A fast reviewer sees that the last five key presses landed, and which ones are saved.
- Feedback part: the save state is on the decision itself, not in one shared message.
- A chip is a way back: click it to return to that variant. Undo removes the newest saved chip.

Tradeoffs:

- More small elements near the edge of vision.
- Chips name variants with icons; the words are in the tooltip.
- Needs the per-command save state (sending, queued, saved) in the client model, which exists, and a list of the last commands, which the session has.
- The bar is not in the main header that decision U02 selected. A new idea that is not in the audit.

### Spec

**Sketch**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ … [✓ C moon] [✓ F sun cloud] [✕ F moon ↑]   ↶ Undo   All 6 ▾   ✕ Reject X   ✓ Approve A │ 52 px
└──────────────────────────────────────────────────────────────────────────────┘
      saved       queued         sending     the newest chip is beside the buttons
whole screenshot:  [✓ x6 Dialog with ini…]
failed:            [⚠ ✓ F sun]  → popover: Not saved · Check your connection.  Retry  Reload
```

**Build**

- Bar: `ButtonGroup role='toolbar' aria-label='Decision' $border className='w-full h-13 items-center'`.
- Ledger: `<div role='log' aria-label='Recent decisions' className='flex min-w-0 flex-1 justify-end gap-1 overflow-hidden'>` with a start fade (`mask-image` gradient). At most 5 chips.
- Chip: `Button $size='sm' $lightnessOffset $rounded='md'` with a verdict mark `ButtonSlot`, the browser icon and `Sun` or `Moon` (12 px), and a state `ButtonSlot`: `ArrowUp` with `animate-pulse` for sending, `Cloud` for queued, nothing for saved. Failed: `$layer='danger' $mix={20}` and a leading `TriangleAlert`; the chip is then a `PopoverDisclosure` whose `Popover portal` has the message, `Retry`, and `Reload`.
- A whole-screenshot command is one chip: the mark, `x6`, and the truncated screenshot name (`max-w-40`).
- Each chip is a `TooltipAnchor`: `Approved · Firefox · Light · Queued`.
- Then Undo (`Button` with `Undo2`, `ButtonLabel`, tooltip `<Kbd>⌘Z</Kbd>`), the `All 6` menu (`ak.MenuButton`, `Approve all 6` `⇧A`, `Reject all 6` `⇧X`), Reject (`Button $border`), Approve (`Button $layer={can.approve ? 'brand' : undefined}`), each with a shortcut slot.
- Data: `session.history` for the chips (newest last). The lab hook has no queued state: for `saving`, render constants.

**Copy** (5 words at rest): `Undo`, `All 6`, `Reject`, `Approve`. Popover: `Not saved · Check your connection.`, `Changed by @morikenji · Nothing was saved.`, `Retry`, `Reload`. Live region: `Approved Firefox, Light. Sending.` then `Saved.` Read-only: `Read-only · Replaced by a newer run`, `Open newer run`.

**Behavior and keys**

- `A`, `X`, `Shift+A`, `Shift+X`, and `Cmd/Ctrl+Z` as in the app, with no dialog.
- A new chip slides in at the end (120 ms; no motion with reduced motion). A click on a chip selects its variant. Undo removes the newest saved chip.
- When a save fails, the failed chips turn to the danger tint, Reject and Approve are `disabled`, and the popover of the first failed chip opens.
- The ledger is one Tab stop (`ak.Composite`).

**Scenarios**

- ready: an empty ledger; Undo disabled.
- saving: three chips: saved, queued, sending.
- saved: four solid chips; the newest is the selected variant; Approve reads `Approved` (`$layer='success' $mix={20}`, `aria-pressed`).
- offline: two danger chips and the open popover; decision buttons disabled.
- conflict: one danger chip; the popover reads `Changed by @morikenji · Nothing was saved.` with `Reload`.
- waiting: decision buttons disabled without a brand fill; a `Progress $thickness={0.5}` line on the top edge; no `All` menu.
- read-only: the ledger shows the last decisions of the run as final chips (no state icons); the end has only `Open newer run`.
- narrow: two rows. Row 1: the newest chip, Undo, `All 6`. Row 2: Reject and Approve at 48 px.
