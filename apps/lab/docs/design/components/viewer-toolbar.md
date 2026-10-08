# Viewer toolbar (viewer-toolbar)

Group: viewer
Question: Where do the view controls live, and how many words do they use?
Description: The controls for view mode, zoom, and region navigation, with their keys.
Layout: stack

## Scenarios

- `default` (Default): A changed variant: Side by side, Fit, three regions, none focused.
- `diff-zoomed` (Diff, zoomed): Diff at 200%, on region 2 of 5.
- `added` (Added): No baseline: Diff, Swipe, Blink, and Baseline are not available.
- `size-changed` (Size changed): The sizes differ, so no diff exists; the size change must show.
- `unchanged` (No change): No region; Diff has nothing to show.
- `loading` (Loading): The images load; the controls must not move.
- `keys-off` (Shortcuts off): The reviewer turned the keys off, so no key hint shows.
- `narrow` (Narrow): A width of 390 px; no control may be cut.

## Variant `quiet-row`: Quiet row (minimal)

One row above the stage with the four modes and the three zoom levels of today, plus the region counter, and with the keys in tooltips.

Ideas:

- The same place, modes, and zoom levels as today: no rule changes.
- Radio groups with a glider, real disabled states with a reason, and key hints out of the row.
- The row never wraps: labels hide before a control is cut.

Tradeoffs:

- Costs a 2.25rem row above the image.
- No Swipe and no Blink: the missing techniques stay missing.
- Keys are only in tooltips and in the ? list, so a reviewer who never hovers does not find them.

### Spec

**Words at rest: 7** (`Side by side`, `Diff`, `Current`, `Baseline`, `Fit`).

```text
 [▥ Side by side │ ◩ Diff │ ▣ Current │ ▢ Baseline]     ◂ 1 / 3 ▸     [Fit │ 100% │ 200%]
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                       stage                                         │
```

**Build**

- Cell: full width. Stub stage under the row: `Frame $darken $rounded='xl'` with `relative h-72`, and the current image of scene `button` at 2×. The stub does not change with the mode. State: `useViewer`.
- Row: a `div` with `flex h-9 items-center justify-between gap-2`. No surface and no border.
- Modes: `ak.RadioGroup` rendered as `ButtonGroup $border $size='sm'` (`aria-label='View mode'`). Each `ak.Radio render={<Button />}` has a `ButtonSlot` icon (`Columns2`, `Diff`, `Image`, `History`) and a `ButtonLabel`. Then `ButtonGlider` and `ButtonGlider $state='focus'`.
- Counter in the center (its space is always reserved): `ButtonGroup $size='sm'` with two chevron icon buttons and a `TextFrame` with `tabular-nums`.
- Zoom at the end: `ak.RadioGroup` as `ButtonGroup $border $size='sm'` (`aria-label='Zoom'`) with `Fit`, `100%`, `200%` and a `ButtonGlider`.
- Each control has a `Tooltip` with its name and a `Kbd`. The key is in `aria-keyshortcuts`. No key cap in the row.

**Copy**: `Side by side`, `Diff`, `Current`, `Baseline`, `Fit`, `100%`, `200%`, `1 / 3`. Tooltip keys: `S`, `D`, `F`, `G`, `0`, `+`, `-`, `C`, `⇧C`. Reasons: `No diff for an added screenshot`, `No baseline for an added screenshot`, `No diff when the size changed`, `No change`.

**Behavior and keys**

- An unavailable mode is `disabled`, and its tooltip gives the reason.
- Under 40rem of container width (`@container`), the mode labels hide (icons only) and Zoom is one `Button` that steps Fit, 100%, 200%.
- While focus is in a radio group, the arrow keys move in the group (Ariakit default). The other keys work as before.

**Scenarios**

- default: Side by side, `1 / 3`, Fit.
- diff-zoomed: Diff, `2 / 5`, 200%.
- added: Diff and Baseline are disabled; the counter place is empty.
- size-changed: Diff is disabled; in the counter place a `Badge $layer='warning' $forceRounded` `+22 px`.
- unchanged: Diff is disabled (`No change`); no counter.
- loading: the counter place is empty; a `Progress` without value (`$thickness={0.5}`, `aria-label='Loading images'`) on the top edge of the stage. Nothing moves.
- keys-off: tooltips without a `Kbd`.
- narrow: icons only; `1 / 3`; one zoom button `Fit`.

## Variant `floating-pill`: Floating pill

One icon-only pill inside the stage at the bottom center holds the modes, the zoom, and the region counter, and it fades when the reviewer is idle.

Ideas:

- No toolbar row above the image: the controls are next to the pixels.
- Six modes as icons with tooltips that carry the name and the key.
- The pill dims after 2 s without input and returns on a pointer move, a focus, or a key.

Tradeoffs:

- Icons without words must be learned; the tooltips carry all the words.
- The stage keeps a 3.5rem bottom gutter at Fit, and when zoomed the pill is over pixels.
- Six modes, a zoom stepper with more levels, and the keys W and B change rules K13 and A19.
- A fading control can surprise; it never goes below 40% opacity.

### Spec

**Words at rest: 0.**

```text
┌──────────────────────────────────────────────────────────────────────┐
│                               stage                                  │
│                                                                      │
│        ╭ ▥  ◩  ⬓  ⟳  ▣  ▢ │ − 200% + │ ◂ 1/3 ▸ │ ◎  ? ╮              │
└──────────────────────────────────────────────────────────────────────┘
```

**Build**

- Cell: full width. Stub stage: `Frame $darken $rounded='xl'` with `relative h-72`, and the current image of scene `button` at 2×. State: `useViewer`.
- Pill: `ButtonGroup $lighten $border $rounded='full' $size='sm'` with `shadow-lg`, `role='toolbar'`, `aria-label='View'`, `absolute bottom-3 left-1/2 -translate-x-1/2`.
- Modes: `ak.RadioGroup` with six `ak.Radio render={<Button />}` icon buttons (`Columns2`, `Diff`, `SquareSplitHorizontal`, `Repeat`, `Image`, `History`), each with an `aria-label`, and a `ButtonGlider`.
- `ButtonSeparator` between the clusters. Zoom: `Minus`, `TextFrame` with the percent (`tabular-nums`, `w-12`), `Plus`. Counter: two chevrons and a `TextFrame`. Then `Highlight` (`ScanEye`) with `aria-pressed`, and `Keys` (`Keyboard`).
- Each button: a `Tooltip` above it with the name and a `Kbd`.

**Copy** (tooltips): `Side by side` `S`, `Diff` `D`, `Swipe` `W`, `Blink` `B`, `Current` `F`, `Baseline` `G`, `Zoom out` `-`, `Fit` `0`, `Zoom in` `+`, `Previous region` `⇧C`, `Next region` `C`, `Highlight` `H`, `Keys` `?`. Reasons as in Quiet row.

**Behavior and keys**

- After 2 s without pointer or key input on the stage, the pill goes to 40% opacity. It returns on a pointer move, a focus, or a key.
- A click on the percent sets Fit. At Fit it shows the real percent.
- The pill is centered, so a cluster that hides does not move the image.

**Scenarios**

- default: glider on Side by side; `200%`; `1/3`.
- diff-zoomed: glider on Diff; `200%`; `2/5`; Highlight pressed.
- added: Diff, Swipe, Blink, and Baseline are `disabled`; the counter cluster is hidden.
- size-changed: Diff and Blink are `disabled`; a `Badge $layer='warning' $forceRounded` `+22 px` takes the place of the counter.
- unchanged: no counter cluster.
- loading: a `ProgressCircular` without value takes the place of the Highlight icon; the modes stay enabled.
- keys-off: tooltips without a `Kbd`; the Keys button stays.
- narrow: two pills: the modes at the bottom center; the zoom and the counter at the top right.

## Variant `tool-rail`: Tool rail

A narrow vertical rail of icons at the left edge of the stage, as in a design tool, so the controls cost no height.

Ideas:

- Screens are wide and the image needs height: the rail costs 2.5rem of width and no height.
- Three groups from top to bottom: modes, zoom, and regions with the Highlight and Keys buttons.
- On a narrow stage the rail turns into a row under the stage.

Tradeoffs:

- A vertical icon list is new for this app and has no words at rest.
- The rail is next to the screenshot sidebar of the page, so two rails can stand side by side.
- In a vertical radio group, Up and Down move in the group while it has focus, not between screenshots.
- Six modes and more zoom levels change rules K13 and A19.

### Spec

**Words at rest: 0.**

```text
┌────┬───────────────────────────────────────────────────────────────┐
│ ▥  │                                                               │
│ ◩  │                                                               │
│ ⬓  │                                                               │
│ ⟳  │                            stage                              │
│ ▣  │                                                               │
│ ▢  │                                                               │
│ ── │                                                               │
│ ＋ │                                                               │
│200%│                                                               │
│ － │                                                               │
│ ── │                                                               │
│ ▴  │                                                               │
│2/5 │                                                               │
│ ▾  │                                                               │
│ ◎ ?│                                                               │
└────┴───────────────────────────────────────────────────────────────┘
```

**Build**

- Cell: full width. One `Frame $darken $rounded='xl'` with `h-96 grid grid-cols-[auto_minmax(0,1fr)] overflow-clip`; the stub stage (the current image of scene `button` at 2×) is the second column. State: `useViewer`.
- Rail: `ButtonGroup $layout='vertical' $size='sm' $rounded='none'` with `w-10 border-e`, `role='toolbar'`, `aria-orientation='vertical'`, `aria-label='View'`. It is on the stage surface with no layer of its own.
- Top: `ak.RadioGroup` with six mode icon radios (`Columns2`, `Diff`, `SquareSplitHorizontal`, `Repeat`, `Image`, `History`) and a `ButtonGlider`.
- Middle: `Plus`, `TextFrame` with the percent (`text-xs tabular-nums`), `Minus`.
- Bottom (`mt-auto`): `ChevronUp`, `TextFrame` `2/5`, `ChevronDown`, then `Highlight` (`ScanEye`) and `Keys` (`Keyboard`).
- Tooltips open to the right (`TooltipProvider placement='right'`) with the name and a `Kbd`.

**Copy** (tooltips): as in Floating pill.

**Behavior and keys**

- The rail is always present, so the stage never changes size.
- Under 40rem of container width, the grid is `grid-rows-[minmax(0,1fr)_auto]` and the rail is a row under the stage (`$layout='horizontal'`, `border-t`): the six modes, the percent as one button that steps the zoom, and the counter.

**Scenarios**

- default: glider on Side by side; `200%`; `1/3`.
- diff-zoomed: glider on Diff; `200%`; `2/5`.
- added: Diff, Swipe, Blink, and Baseline are `disabled`; the region group is empty (its space stays).
- size-changed: Diff and Blink are `disabled`; in the region group a `Badge $layer='warning' $forceRounded` `+22`.
- unchanged: the region group is empty.
- loading: a `ProgressCircular` without value in the place of the Highlight icon.
- keys-off: tooltips without a `Kbd`.
- narrow: the rail is a row under the stage.

## Variant `status-chip`: Status chip

No toolbar: one small chip in a stage corner tells the mode, the zoom, and the region, and it opens a popover with each setting and its key.

Ideas:

- The smallest amount of interface: one chip at rest.
- The popover is the place to learn the keys: each row has its Kbd.
- Expert reviewers use only the keyboard and never open it.

Tradeoffs:

- Each pointer action needs two clicks.
- The chip must look like a control; a reviewer who does not try it finds no view settings.
- The key V and six modes change rule K13.
- The chip is the only place that names the mode.

### Spec

**Words at rest: 1 to 3** (the mode name).

```text
┌──────────────────────────────────────────────────────────────────────┐
│                                       ( Diff · 200% · 2 / 5  ▾ )     │
│                               stage                                  │
└──────────────────────────────────────────────────────────────────────┘
 popover:
 ┌───────────────────────────────┐
 │ ◉ Side by side              S │
 │ ○ Diff                      D │
 │ ○ Swipe                     W │
 │ ○ Blink                     B │
 │ ○ Current                   F │
 │ ○ Baseline                  G │
 │ ───────────────────────────── │
 │ Zoom     [Fit│100%│200%│400%] │
 │ Region        ◂ 2 / 5 ▸       │
 │ Highlight            ( on ) H │
 │ All keys                    ? │
 └───────────────────────────────┘
```

**Build**

- Cell: full width. Stub stage: `Frame $darken $rounded='xl'` with `relative h-72`, and the current image of scene `button` at 2×. State: `useViewer`.
- Chip: `PopoverDisclosure $lighten $border $size='sm' $rounded='full'` with `absolute top-3 right-3`, and `aria-label='View: Diff, 200%, region 2 of 5'`. The parts have a middle dot in `ak-ink-50` between them; a `ChevronDown` slot is at the end.
- `PopoverProvider placement='bottom-end'`; `Popover portal $rounded='xl' $p={1}` with `grid min-w-64`.
- Mode rows: `ak.RadioGroup`; each `ak.Radio` uses the `option` recipe with an `OptionLabel` and an `OptionSlot $kind='shortcut'` that holds a `Kbd`.
- `Separator $line='solid' $gap={1}`. Then three rows (`flex items-center justify-between px-2 py-1`): a `Text` `text-sm ak-ink-70` label and the control: a zoom `ButtonGroup $size='sm'` radio with a `ButtonGlider`, the region counter, and a switch for Highlight (the Toggle recipe). Last row: `Button` `All keys` with a `Kbd` `?`.

**Copy**: `Side by side`, `Diff`, `Swipe`, `Blink`, `Current`, `Baseline`, `Zoom`, `Region`, `Highlight`, `All keys`, `Turn keys on`. Reasons: `No baseline`, `Size changed`, `No change`.

**Behavior and keys**

- `V` or a click opens the popover. Escape closes it.
- Each setting has a key (the shared key map), so the popover is for learning and for the pointer.
- A disabled mode row shows its reason as a second line in `ak-ink-50`.

**Scenarios**

- default: `Side by side · Fit · 1 / 3`.
- diff-zoomed: `Diff · 200% · 2 / 5`.
- added: `Current · Fit`; Diff, Swipe, Blink, and Baseline are disabled with `No baseline`.
- size-changed: `Side by side · Fit` and a `warning` badge slot `+22 px`; Diff is disabled with `Size changed`.
- unchanged: `Side by side · Fit`; Diff is disabled with `No change`.
- loading: `Side by side · Fit` with a `ProgressCircular` slot at the start.
- keys-off: no `Kbd` column; the last row is `Turn keys on`.
- narrow: the same chip; the popover is as wide as the stage.

## Variant `merged-bar`: Merged bar

The view controls move into the review action bar under the stage, between Undo and the two decisions.

Ideas:

- One bar in place of two: all frequent controls are in one row near the bottom.
- The view cluster is quiet (icons, less ink), so Approve stays the one brand surface.
- On a narrow stage the bar has two rows, with the decisions in the lower row.

Tradeoffs:

- It joins two components: the maintainer cannot pick the action bar and the toolbar apart.
- The bar is full at 1024 px: Undo, six modes, zoom, counter, Reject, and Approve.
- A view control next to Reject raises the cost of a wrong click.
- Six modes and more zoom levels change rules K13 and A19.

### Spec

**Words at rest: 0 added.** The bar already has `Undo`, `Reject`, and `Approve` from the action bar group.

```text
│                               stage                                  │
├──────────────────────────────────────────────────────────────────────┤
│ ↶ Undo │  ▥ ◩ ⬓ ⟳ ▣ ▢   − 200% +   ◂ 1/3 ▸  │  ✕ Reject X  ✓ Approve A │
└──────────────────────────────────────────────────────────────────────┘
```

**Build**

- Cell: full width. Stub stage: `Frame $darken $rounded='xl'` with `relative h-72`, and the current image of scene `button` at 2×. State: `useViewer`.
- Bar under the stage: `Frame $lighten $border $rounded='xl' $p={1}` with `grid grid-cols-[1fr_auto_1fr] items-center gap-2`, `role='region'`, `aria-label='View and review'`.
- Start: `Button $size='sm'` `Undo` with an `Undo2` slot. End (`justify-self-end flex gap-1`): `Button $border $size='sm'` `Reject` with a `ButtonSlot $kind='shortcut'` `X`, and `Button $layer='brand' $size='sm'` `Approve` with the shortcut `A`. These three are stubs here.
- Center: `ButtonGroup $size='sm' $ink={70}` with `role='toolbar'`, `aria-label='View'`: six icon mode radios (`ak.RadioGroup`) with a `ButtonGlider`, a `ButtonSeparator`, the zoom stepper (`Minus`, `TextFrame` percent, `Plus`), a `ButtonSeparator`, and the counter. Tooltips with a `Kbd`.

**Copy** (tooltips): as in Floating pill. Bar words: `Undo`, `Reject`, `Approve`.

**Behavior and keys**

- Under 48rem of container width: two rows. The view row is above; the action row is below and never wraps.
- A disabled `Approve` drops `$layer='brand'`, so it does not look ready (audit finding VIEW-16).

**Scenarios**

- default: glider on Side by side; `200%`; `1/3`.
- diff-zoomed: glider on Diff; `2/5`.
- added: Diff, Swipe, Blink, and Baseline are `disabled`; no counter.
- size-changed: Diff and Blink are `disabled`; `Badge $layer='warning' $forceRounded` `+22 px` in the counter place.
- unchanged: no counter; `Reject` and `Approve` are `disabled` and neutral.
- loading: the view cluster is enabled; `Reject` and `Approve` are `disabled` and neutral; a `Progress` without value on the top edge of the stage.
- keys-off: no `X` and `A` slots; tooltips without a `Kbd`.
- narrow: two rows.

## Variant `key-strip`: Key strip (new)

The toolbar is the key legend: each control is a key cap with one word, under the stage, and a key press lights its cap.

Ideas:

- The keys are on screen all the time, on the controls that they move, so no help dialog is needed to learn them.
- A key press lights the cap of its control, which teaches the map by use.
- One switch drops the words and keeps the caps for an expert.
- Not in the audit lanes: they proposed help dialogs and tooltips.

Tradeoffs:

- The most words of this surface (about 10 at rest), against the complaint about text.
- A row of key caps is noise for a reviewer who uses the pointer.
- It repeats what the ? list says.
- Six modes and the keys W, B, C, H change rule K13.

### Spec

**Words at rest: 10.** On purpose the most words of this surface: the strip is the key legend.

```text
│                                      stage                                         │
├────────────────────────────────────────────────────────────────────────────────────┤
│ [S] Side by side [D] Diff [W] Swipe [B] Blink [F] Current [G] Baseline   [0] Fit [-] 200% [+]   [C] 1 / 3   [H] [?] │
```

**Build**

- Cell: full width. Stub stage: `Frame $darken $rounded='xl'` with `relative h-72`, and the current image of scene `button` at 2×. State: `useViewer`.
- Strip under the stage: a `div` with `flex h-8 items-center gap-1 text-xs`, `role='toolbar'`, `aria-label='View'`. No surface.
- Each control: `Button $size='xs'` with a leading `ButtonSlot` that holds a `Kbd` (`aria-hidden`), then a `ButtonLabel`. The key is also in `aria-keyshortcuts`.
- Modes: `ak.RadioGroup`; the selected mode has `Kbd $layer='brand'` and a `ButtonGlider $kind='bar'`.
- After `ms-auto`: `Fit` with the cap `0`; the caps `-` and `+` with the percent between them (`TextFrame`, `tabular-nums`); the cap `C` with `1 / 3`; the caps `H` (`aria-label='Highlight'`, `aria-pressed`) and `?` (`aria-label='Keys'`).

**Copy**: `Side by side`, `Diff`, `Swipe`, `Blink`, `Current`, `Baseline`, `Fit`. Reasons in tooltips as in Quiet row.

**Behavior and keys**

- A key press lights its cap for 120 ms (`$lightnessOffset={4}`).
- `?` (a click on its cap) switches between caps with words and caps only. Store the choice.
- When shortcuts are off, the caps hide and the words stay in the same places.

**Scenarios**

- default: the `S` cap is brand; `Fit`; `1 / 3`.
- diff-zoomed: the `D` cap is brand; `200%`; `2 / 5`; the `H` cap is pressed.
- added: the `D`, `W`, `B`, `G` controls are `disabled`; no counter.
- size-changed: `D` and `B` are `disabled`; `Badge $layer='warning' $forceRounded` `+22 px` in the counter place.
- unchanged: `D` is `disabled`; no counter.
- loading: a `ProgressCircular` without value in the counter place.
- keys-off: words only, no caps.
- narrow: caps only (11 caps fit in 390 px); the selected mode shows its word.
