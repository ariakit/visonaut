# Image states (image-states)

Group: viewer
Question: How does the stage show an image that loads, is absent, failed, or changed size?
Description: Each state of the stage other than two loaded images of equal size.
Layout: row

## Scenarios

- `loading` (Loading): Both images load. Their sizes are known before the bytes, so nothing may move (scene tooltip).
- `switching` (Next variant): The selection changed: the old pixels must go at once and the new images load.
- `added` (Added): No baseline exists. The variant is approved automatically.
- `removed` (Removed): No current image exists.
- `load-failed` (Failed to load): The current image fails (brokenImageUrl) and the baseline loads. This is an error with Retry, not an added or removed image.
- `size-changed` (Size changed): 640 x 400 became 640 x 422, and no diff exists (scene disclosure).
- `not-uploaded` (Not uploaded): The current image has no visible change and CI did not upload it (candidateOmitted).
- `expired` (Images expired): A closed run whose images are deleted; the decisions remain.

## Variant `labeled-panes`: Labeled panes (minimal)

The two panes of today stay, but each state lives inside its pane at the exact image size, and an absent image is a thin labeled strip.

Ideas:

- No row above the panes: loading, error, and empty states are in the place of the image, so the image never jumps.
- A placeholder with the true image size, and one progress line in place of three loading texts.
- The labeled empty pane of rule A21 stays, as a strip and not as half of the stage.
- Retry is a bordered button, and a size change says the truth.

Tradeoffs:

- Two labels and a strip are still more chrome than one pane.
- The strip is a compromise: A21 says 'a labeled empty pane' and does not give a size.
- The words `No baseline` and `No current image` replace the contract strings `New image, no reference` and `Removed, no new image`.

### Spec

**Words at rest: 2** (`Baseline`, `Current`) plus one or two state words.

```text
 loading                       added
┌──────────────────────────┐  ┌──────────────────────────┐
│▔▔▔▔▔▔▔▔ progress ▔▔▔▔▔▔▔▔│  │ Baseline                 │
│ Baseline                 │  │ ┌╌╌╌╌ No baseline ╌╌╌╌╌┐ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░ │  │ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │
│ Current                  │  │ Current  (Added)         │
│ ░░░░░░░░░░░░░░░░░░░░░░░░ │  │ ┌──────────────────────┐ │
│                          │  │ │        image         │ │
└──────────────────────────┘  │ └──────────────────────┘ │
                              └──────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`. In this cell the panes are rows (Baseline above). On a wide stage they are columns.
- Labels: `Text` `text-xs` in the gutter above each image box. They show from the first frame.
- Placeholder: `Frame $lightnessOffset={2} $rounded='none'` with `animate-pulse`, at the exact size of the image box.
- Progress: `Progress` without value, `$thickness={0.5}`, on the top edge of the stage, `aria-label='Loading images'`. The stage has `aria-busy`.
- Empty pane: `Frame $border $borderType='dashed' $rounded='md'`, 2.5rem tall as a row (5rem wide as a column), with centered `Text` `text-xs ak-ink-60`.
- Error: `Frame $layer='danger' $mix={12} $border $edge='danger' $rounded='md' $p={2}` with `role='alert'` and `flex items-center gap-2`: icon `TriangleAlert`, `Text` `text-sm font-medium`, `Button $border $size='sm'`. It has the place and the size of the image box.
- State badge after the label: `Badge $forceRounded`.

**Copy**: `Baseline`, `Current`, `No baseline`, `No current image`, `Added`, `Removed`, `Could not load`, `Retry`, `+22 px`, `No visible change`, `Not uploaded`, `Images expired`, `The decisions remain.`

**Timing**: at 0 ms the old pixels go (the box is the placeholder). After 150 ms the placeholder pulses. After 400 ms the progress line shows. After 6 s a `Button $border $size='sm'` `Retry` shows in each box. No text says that images load.

**Behavior**: `Retry` loads only the failed image. A `pending` variant uses the loading state with a neutral `Badge` `Comparing`.

**Scenarios**

- loading: two placeholders at the true sizes.
- switching: the same picture at once; the labels and the boxes do not move. A `Button $size='xs'` `Replay` under the cell runs the change again with a 1.5 s wait (`useSimulatedLoad`).
- added: empty pane `No baseline`; the Current image; `Badge $layer='success'` `Added`.
- removed: the Baseline image; empty pane `No current image`; `Badge $layer='danger'` `Removed`.
- load-failed: the Baseline image; the error in the Current box.
- size-changed: both images at one scale, start-aligned; `Badge $layer='warning'` `+22 px` after `Current 640 × 422`; the 22 px have a hatch.
- not-uploaded: the Baseline image; empty pane `Not uploaded`; neutral `Badge` `No visible change`.
- expired: no panes; centered `Text` `font-medium` `Images expired` and `Text` `ak-ink-60 text-sm` `The decisions remain.`

## Variant `single-pane`: Single pane

The layout follows the images that exist: one image gets the whole stage with one state badge and one reason, and no empty pane shows.

Ideas:

- The only image of an added or removed variant gets the full stage (2x for a real clip).
- The state reads as a fact (a badge and three words), not as a missing picture.
- Modes that have no image are hidden in the toolbar, not disabled.
- A removed image is dimmed, so it does not look like the present state.

Tradeoffs:

- Replaces rule A21 ('S shows the old image and a labeled empty pane').
- The stage layout changes between variants (two panes, then one), which can feel like a jump.
- Dimming a removed image changes how the evidence looks.
- Hidden modes move the other toolbar buttons.

### Spec

**Words at rest: 1 to 4.**

```text
 added                            removed
┌──────────────────────────────┐ ┌──────────────────────────────┐
│ (＋ Added)  No baseline       │ │ (− Removed)  No current image│
│   ┌────────────────────────┐ │ │   ┌────────────────────────┐ │
│   │   current, full stage  │ │ │   │  baseline, dimmed      │ │
│   └────────────────────────┘ │ │   └────────────────────────┘ │
└──────────────────────────────┘ └──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`.
- Layout from the images that exist: two exist, two panes (rows in this cell); one exists, one pane at the full stage; none, an empty state.
- Head line in a 2rem top gutter: `Badge $forceRounded` with a `BadgeSlot` icon (`Plus`, `Minus`, `Equal`, `MoveVertical`) and one word, then `Text` `text-xs ak-ink-60` with the reason.
- Removed image: `opacity-60`, and its box is `Frame $border $edge='danger' $rounded='none'`.
- Loading: one placeholder for each image that will come (`Frame $lightnessOffset={2}` with `animate-pulse`, at the true size), and a `Progress` without value (`$thickness={0.5}`) on the top edge.
- Error: a centered card in the pane, `Frame $lighten $border $rounded='lg' $p={3}` with `role='alert'` and `grid gap-1 justify-items-start`: `Text` `font-medium`, `Text` `ak-ink-60 text-sm`, `Button $border $size='sm'`.

**Copy**: `Added`, `No baseline`, `Removed`, `No current image`, `Current could not load`, `Check your connection, then try again.`, `Retry`, `Size changed`, `640 × 400 → 640 × 422`, `No visible change`, `CI did not upload this image.`, `Images expired`, `The decisions remain.`

**Timing**: as in Labeled panes (0 ms cover, 150 ms pulse, 400 ms progress line, 6 s `Retry`).

**Behavior**: a key of a hidden mode (`D`, `G` for an added variant) does nothing and writes the reason to a visible status line for 2 s, not only to a live region.

**Scenarios**

- loading: two placeholders (both images will come).
- switching: the placeholders of the new variant at once; with a `Replay` button under the cell.
- added: Current at 2× on the full stage; `Added` `No baseline`.
- removed: Baseline dimmed; `Removed` `No current image`.
- load-failed: Baseline in its pane; the Current pane has the error card. Two panes stay, because two images exist.
- size-changed: two panes at one scale; head line `Badge $layer='warning'` `Size changed` and `640 × 400 → 640 × 422`; the 22 px have a hatch.
- not-uploaded: Baseline on the full stage; `No visible change` and `CI did not upload this image.`
- expired: centered `Images expired` and `The decisions remain.`

## Variant `blueprint`: Blueprint

Each image box is always drawn at its true shape with its dimensions on the edges, and the fill of the box tells the state: pixels, pulse, hatch, or an icon.

Ideas:

- One visual language for all states, with almost no words.
- The dimensions sit on the edges as on a drawing, so a size change is a number and a hatched band in the place where it is.
- Loading keeps the exact layout, because the box exists before the pixels.
- The hatch is neutral ink, not the diff color, so it does not look like measured differences.

Tradeoffs:

- A hatched box for an absent baseline uses the size of the current image and so shows a shape that never existed (close to the rejected D30 option 'mask').
- Dimension labels on each box add numbers that most reviews do not need.
- The state is mostly a pattern; the one word in the box and the accessible name carry it (rule A09: text with color).
- An absent pane still takes half of the stage.

### Spec

**Words at rest: 2** (`Baseline`, `Current`) plus numbers and one state word.

```text
 added                     size-changed
 Baseline                  Baseline
 ┌╌╌╌╌╌╌╌ 320 ╌╌╌╌╌╌┐      ┌─────── 640 ──────┐
 ╎ ╱ ╱ ╱ None ╱ ╱ ╱ ╎ 120  │      pixels      │ 400
 └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘      └──────────────────┘
 Current                   Current
 ┌─────── 320 ──────┐      ┌─────── 640 ──────┐
 │      pixels      │ 120  │      pixels      │ 422
 └──────────────────┘      │╱╱╱╱╱╱ +22 ╱╱╱╱╱╱╱│
                           └──────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`; two rows.
- Box: `Frame $border $rounded='none'` at the true shape in each state; for an absent image `$borderType='dashed'`.
- Fill by state: the `img` (loaded); `Frame $lightnessOffset={2}` with `animate-pulse` (loading); a hatch (absent); the icon `ImageOff` with a `Button $border $size='sm'` `Retry` in the center (failed).
- Hatch: `repeating-linear-gradient` at 45 degrees with `currentColor` at 12%, in neutral ink.
- Dimensions: `Text` `font-mono text-xs ak-ink-50 tabular-nums`: the width in a gap of the top edge, the height beside the right edge.
- Size delta: the extra band has the hatch on a `Layer $layer='warning' $mix={25}` and `Text $text='warning'` `+22`. The dimension that changed is also in `$text='warning'`.
- State word in the center of a hatched box: `Text` `text-xs ak-ink-60`.
- Names: `Text` `text-xs` above each box.

**Copy**: `Baseline`, `Current`, `None`, `Removed`, `Not uploaded`, `Expired`, `Retry`, `+22`.

**Timing**: as in Labeled panes; no progress line, because the pulsing box is the signal.

**Behavior**: no badge and no sentence. Each box has an accessible name with the full state, for example `aria-label='Baseline: none. This screenshot is added.'`

**Scenarios**

- loading: two pulsing boxes with their dimensions.
- switching: the boxes take the new sizes and pulse at once; with a `Replay` button under the cell.
- added: the Baseline box is hatched, has the size of Current, and says `None`; Current has pixels.
- removed: Baseline has pixels; the Current box is hatched and says `Removed`.
- load-failed: Baseline has pixels; the Current box has `ImageOff` and `Retry`.
- size-changed: as in the sketch.
- not-uploaded: Baseline has pixels; the Current box is hatched and says `Not uploaded`.
- expired: the sizes are unknown: one hatched 3:2 box with `Expired`.

## Variant `state-chip`: State chip

One status slot at the top center of the stage holds each state as one chip with an icon and one to three words, and the images that exist take the rest.

Ideas:

- One place for each state: the reviewer learns where to look.
- The chip sits in a reserved gutter, so it never moves the image and never covers pixels at Fit.
- The loading chip shows only after 400 ms, so a fast load shows no signal.
- The same slot can carry a refused decision on the review page (contract-map idea F: one visible status slot).

Tradeoffs:

- A small chip can be too quiet for an error; rule A23 asks for 'an error with Retry', and the chip has both.
- The second fact (for example `No baseline`) is in a tooltip only.
- Uses one pane for one image, so it replaces rule A21.
- When zoomed, the chip is over pixels.

### Spec

**Words at rest: 0 with two loaded images; 1 to 4 in a state.**

```text
┌──────────────────────────────┐   the one slot, by state:
│          ( ＋ Added )         │   ( ◌ )                     loading, after 400 ms
│   ┌──────────────────────┐   │   ( ＋ Added )   ( − Removed )
│   │  the image that      │   │   ( ⚠ Current could not load │ Retry )
│   │  exists, full stage  │   │   ( ↕ +22 px )   ( = No visible change )
│   └──────────────────────┘   │   ( ⌛ Images expired )
└──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip` and a 2.5rem top gutter that is always reserved.
- Slot: the top center of the stage (`absolute top-2 left-1/2 -translate-x-1/2`).
- Chip: `Badge $size='sm' $forceRounded` with a `BadgeSlot` icon and a `BadgeLabel`. Colors: `success` for added, `danger` for removed, `warning` for the size, neutral for the others.
- Chip with an action: `ButtonGroup $layer='danger' $mix={15} $border $rounded='full' $size='sm'` with a `TextFrame` and a `Button` `Retry`; `role='alert'`.
- Loading chip: a `ProgressCircular` without value in a 1rem box, no word, `aria-label='Loading images'`.
- Images: the ones that exist, as large as the stage allows (one pane, or two rows). Placeholders: `Frame $lightnessOffset={2}` with `animate-pulse` at the true size.
- Each chip has a `Tooltip` with the second fact.

**Copy**: `Added`, `Removed`, `Current could not load`, `Retry`, `+22 px`, `No visible change`, `Images expired`, `Comparing`. Tooltips: `No baseline`, `No current image`, `640 × 400 → 640 × 422`, `CI did not upload this image`, `The decisions remain`.

**Timing**: at 0 ms the old pixels go. After 150 ms the placeholder pulses. After 400 ms the loading chip shows. After 6 s the chip becomes `ButtonGroup` with `Slow` hidden text and a `Button` `Retry`.

**Scenarios**

- loading: two placeholders; the loading chip.
- switching: placeholders at once; the chip after 400 ms; with a `Replay` button under the cell.
- added: Current on the full stage; `Added`.
- removed: Baseline on the full stage; `Removed`.
- load-failed: Baseline in its row; the Current row has a placeholder without pulse; the chip `Current could not load` with `Retry`.
- size-changed: two rows at one scale; the chip `+22 px`; the 22 px have a hatch.
- not-uploaded: Baseline on the full stage; `No visible change`.
- expired: an empty stage; the chip `Images expired`.

## Variant `pair-glyph`: Pair glyph (new)

A small two-node glyph, Baseline joined to Current, shows which images exist and their state, and it is also the switch between them.

Ideas:

- One glyph is the label, the state, and the mode switch: fewer parts on the stage.
- An absent side takes no stage space; the dashed node tells that it does not exist.
- Each node state has its own icon shape, so it does not depend on color.
- Not in the audit lanes.

Tradeoffs:

- A new symbol set that the reviewer must learn; the tooltips carry the words.
- It repeats the Current and Baseline buttons of a toolbar, so one of the two must go.
- Uses one pane for one image, so it replaces rule A21.
- A failed load as one small icon can be too quiet for rule A23; a Retry button stands beside it.

### Spec

**Words at rest: 2** (`Baseline`, `Current`).

```text
 Baseline ●━━━━● Current   both loaded        Baseline ◌╌╌╌╌● Current   added
 Baseline ●━━━━◍ Current   current loads      Baseline ●╌╌╌╌◌ Current   removed
 Baseline ●━━━━⊗ Current   current failed     Baseline ●━ +22 px ━● Current   size changed
 Baseline ●━━━━⊜ Current   not uploaded, no visible change
┌──────────────────────────────┐
│ Baseline ◌╌╌╌╌● Current      │
│   ┌──────────────────────┐   │
│   │ the image that exists│   │
│   └──────────────────────┘   │
└──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip` and a 2.5rem top gutter that is always reserved.
- Glyph row in the gutter: `ButtonGroup $size='sm'` with two node buttons and a connector between them.
- Node: `Button $rounded='full'` with a `ButtonSlot` icon and a `ButtonLabel`. Icons: `Circle` with `fill='currentColor'` (loaded), `CircleDashed` (does not exist), `ProgressCircular` without value (loading), `CircleX` in a `$text='danger'` slot (failed), `CircleEqual` (not uploaded).
- Connector: a 2 px `Layer` line, 2.5rem long, solid when both images exist; a `Separator` (dashed) with `$gap={0}` when one is absent. Size change: a `Badge $layer='warning' $forceRounded` `+22 px` in the middle of the line.
- Accessible names: `Baseline, loaded`, `Current, could not load`. Each node has a `Tooltip`.
- Stage: the images that exist, as large as possible. When one image shows, its node has `$lightnessOffset={2}`.

**Copy**: `Baseline`, `Current`, `+22 px`, `Retry`, `Images expired`. Tooltips: `No baseline: this screenshot is added`, `Removed: no current image`, `Could not load`, `Not uploaded: no visible change`, `640 × 400 → 640 × 422`.

**Timing**: at 0 ms the old pixels go and the nodes of the new variant show. After 150 ms the placeholder pulses and a loading node spins.

**Behavior and keys**

- A click on a node shows that image alone (`G`, `F`). A click on the connector shows both (`S`).
- A failed node has a `Button $border $size='xs'` `Retry` beside it; a click on the node also retries.

**Scenarios**

- loading: both nodes spin; two placeholders at the true sizes.
- switching: the nodes and the placeholders change at once; with a `Replay` button under the cell.
- added: Baseline node `CircleDashed`, dashed connector; Current on the full stage.
- removed: Current node `CircleDashed`, dashed connector; Baseline on the full stage.
- load-failed: Current node `CircleX` with `Retry`; Baseline shows.
- size-changed: `+22 px` on the connector; two rows at one scale; the 22 px have a hatch.
- not-uploaded: Current node `CircleEqual`; Baseline on the full stage.
- expired: both nodes `CircleDashed`; centered `Text` `text-sm ak-ink-60` `Images expired`.
