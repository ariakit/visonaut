# Compare stage (compare-stage)

Group: viewer
Question: Which way to compare baseline and current should be the default stage?
Description: The stage that shows the two screenshots of one variant so that the reviewer sees what changed.
Layout: stack

## Scenarios

- `small-clip` (Small clip): A 320 x 120 clip with a color change, the common real case (scene button, light).
- `tiny-regions` (Tiny regions): A 640 x 400 image with four 7 px regions (scene select, dark).
- `zoomed` (Zoomed at a region): A 1280 x 720 page at 200%, on region 3 of 5 (scene page, light).
- `tall-shift` (Tall layout shift): An 800 x 1600 image where most of the page moved by 2 px (scene form, light).
- `size-changed` (Size changed): 640 x 400 became 640 x 422, so the mask marks every pixel (scene disclosure, light).
- `added` (Added): Only the current image exists (scene tooltip, light, baseline set to null).
- `unchanged` (No change): Both images exist and no pixel changed (scene popover with forcedColors active).
- `narrow` (Narrow): A 1280 x 720 image in a stage that is 390 px wide (scene dialog, dark).

## Variant `linked-pair`: Linked pair (minimal)

Side by side stays the default, with one shared zoom and pan, one scale, region marks, and a diff that keeps the screenshot under the mask.

Ideas:

- One view state for both panes: drag, wheel, and Shift+Arrows move both, and a zoom keeps the point under the pointer.
- Panes are columns or rows by the shape of the image and of the stage.
- Diff draws the mask as a tint over the dimmed current image, never alone.
- The first zoom opens at region 1, not at the top-left corner.

Tradeoffs:

- Each image gets half of the stage: a real 416 px clip stays at 1x, where one stage shows it at 2x.
- A 7 px region is about 3 screen px at Fit; only the 24 px mark makes it visible.
- Region marks need `regions` (not in the API today) or the mask before Diff is selected, which reopens P02.
- Shift+Arrows needs a new Shift branch in the key handler. No rule changes besides that.

### Spec

**Words at rest: 2** (`Baseline`, `Current`) plus the sizes.

```text
┌──────────────────────────────────────────────────────────────┐
│ Baseline 320 × 120            Current 320 × 120              │
│ ┌──────────────────────────┐  ┌──────────────────────────┐   │
│ │       image at 2×        │  │       image at 2×  ┌──┐  │   │
│ │                          │  │                    └──┘  │   │
│ └──────────────────────────┘  └──────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
 stage narrower than 40rem → rows: Baseline above, Current below
```

**Build**

- Stage: `Frame $darken $rounded='xl'` with `relative h-120 grid gap-px overflow-clip`, `role='group'`, `aria-label='Compare'`, `tabIndex={0}`. Keys on this root.
- Pane: a `div` with `relative overflow-clip`. One wrapper inside takes the shared transform.
- Image box: `Frame $border $rounded='none'` sized from the image; `img` with `block size-full`.
- Label: `Text` `text-xs` in the pane gutter at the top-left corner of the image: the name, then the size in `ak-ink-60 tabular-nums`.
- Region mark (Current pane only): `Frame $border={2} $edge='danger' $edgeRaw $rounded='sm'`.
- Diff mode: one pane. Current `img` with `opacity-40 grayscale`; over it a `Layer $layer='danger'` with the mask as `mask-image`.

**Copy**: `Baseline`, `Current`, `No baseline`, `No current image`, `No change`, `+22 px`.

**Behavior and keys**

- `S` (default), `D`, `F`, `G`: the four modes of today. No new mode.
- `H`: region marks on or off. `T` (hold) in `D` or `F`: the baseline in place.
- Zoom: Fit, 100%, 200% with `0`, `+`, `-`. The first zoom from Fit centers region 1.
- Pan: drag, wheel, `Shift+Arrows` (half a pane). Both panes move as one. Arrows alone never pan.

**Scenarios**

- small-clip: two columns at 1× in a wide stage (2× when each pane is 40rem or more); one mark around the Primary button.
- tiny-regions: two columns; four 24 px marks at the list corners.
- zoomed: two columns at 200%, both centered on region 3; drag one, both move.
- tall-shift: two columns at fit width, scrolled to the start of the region; corner brackets, no box.
- size-changed: one scale, top-left anchor; the 22 px that only Current has get a hatch on a `Layer $layer='warning' $mix={25}`; `Badge $layer='warning' $forceRounded` `+22 px` after the Current size; `D` is unavailable.
- added: Current takes the width; Baseline is a 5rem strip (`Frame $border $borderType='dashed' $rounded='md'`) with `No baseline`. This keeps the labeled empty pane of rule A21.
- unchanged: two columns; no marks; a neutral `Badge $forceRounded` `No change` at the top center.
- narrow: two rows, each at fit width; linked pan.

## Variant `diff-first`: Diff first

One stage shows the current image with the changed pixels tinted and marked, and a held key shows the baseline in the same place.

Ideas:

- The image gets the whole stage, so a real 416 px clip shows at 2x or 3x.
- Tint and marks are on from the first frame: the reviewer sees where and what in one image (the pattern of Chromatic, Percy, and Argos).
- Hold T, or press and hold the image, to see Baseline in place; release to return.
- The tint has three strengths, so a tint that is close to the UI color never hides the change.

Tradeoffs:

- Loads the mask before Diff is selected: reopens P02 ('eager' was rejected). The mask is shown evidence, so the approval gate must wait for it (I1).
- D is the default view and not a mode that the reviewer selects: the text of rule K13 changes.
- The two images are never on screen at the same time.
- Needs `regions` (not in the API today) for the marks and the counter.

### Spec

**Words at rest: 1** (`Current`) plus the counter.

```text
┌──────────────────────────────────────────────────────────────┐
│ Current 320 × 120                                  ◂ 1 / 5 ▸ │
│      ┌──────────────────────────────────────────────┐        │
│      │                                     ┌─────┐  │        │
│      │  image at 3×, changed pixels tinted │▓▓▓▓▓│  │        │
│      │                                     └─────┘  │        │
│      └──────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
 hold T: the same place in Baseline
```

**Build**

- Stage: `Frame $darken $rounded='xl'` with `relative h-120 overflow-clip`, `role='group'`, `aria-label='Compare'`, `tabIndex={0}`.
- One image box. Layers from the bottom: baseline `img` (hidden until `T`), current `img`, tint `Layer $layer='danger'` with the mask as `mask-image`, region marks (`Frame $border={2} $edge='danger' $edgeRaw $rounded='sm'`).
- Label: `Badge $forceRounded` in the top-left gutter: `Current`, then the size in `ak-ink-60`. While `T` is down: `Badge $layer='warning' $forceRounded` `Baseline`.
- Counter in the top-right gutter: `ButtonGroup $border $size='sm'` with `Button aria-label='Previous region'` (`ChevronLeft`), `TextFrame` with `tabular-nums`, `Button aria-label='Next region'` (`ChevronRight`). Each button has a `Tooltip` with a `Kbd`.

**Copy**: `Current`, `Baseline`, `1 / 5`, `Added`, `No change`, `Size changed`, `+22 px`. Tooltips: `Next region` `C`, `Previous region` `⇧C`.

**Behavior and keys**

- Default view: Current, tint Soft (50% over full-color pixels), marks on.
- `H` cycles the tint: Soft, Strong (the image goes to 40% without color and the tint is solid), Off (the marks stay).
- `T` hold: Baseline in place, no tint. Release: back.
- `C` / `Shift+C`: go to the next or previous region and zoom so that it fills about a third of the stage. `0`: fit.
- `S` opens the linked pair. `D` returns here. `F` and `G` show one clean image.

**Scenarios**

- small-clip: 3×; soft tint and one mark on the Primary button; no counter for one region.
- tiny-regions: four 24 px marks; `1 / 4`.
- zoomed: 200% at region 3; `3 / 5`.
- tall-shift: fit width; the tint covers the moved rows; corner brackets, no box.
- size-changed: no tint (the mask marks every pixel). The 22 px that only Current has get a hatch on a `Layer $layer='warning' $mix={25}`. `Badge $layer='warning' $forceRounded`: `Size changed` `+22 px`. `T` shows Baseline at the same scale and anchor.
- added: Current only; `Badge $layer='success' $forceRounded` `Added`; `T` does nothing.
- unchanged: Current only; neutral `Badge` `No change`.
- narrow: fit width; the counter moves to the bottom-right; a visible two-part switch `Baseline | Current` (`ak.RadioGroup` on a `ButtonGroup $border $size='sm'` with a `ButtonGlider`) replaces the hold for touch and for assistive technology.

## Variant `swipe`: Swipe

One stage with a divider: baseline pixels on one side and current pixels on the other, at the same place.

Ideas:

- Both images have the full stage size and the same place, so a layout shift shows as a break at the divider.
- A region track above the image shows where the changes are, so the reviewer knows where to drag.
- The divider starts on region 1, not at 50%.
- It works when the sizes differ, where no diff exists (Playwright users asked for the slider for this case).

Tradeoffs:

- A change that covers the full image needs many drags (benchmark pattern P10).
- The divider is a pointer control first. Keys Q and E are new, and no held-Shift pointer mode is allowed (RULE-23: Shift+A approves the whole item).
- The region track needs `regions` (not in the API today) or the mask at first paint (reopens P02).
- Swipe was deferred in design r9, not rejected. It adds a mode and the key W to rule K13.

### Spec

**Words at rest: 2** (`Baseline`, `Current`).

```text
┌──────────────────────────────────────────────────────────────┐
│ Baseline      ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁███▁▁▁▁▁▁      Current │ ← region track
│      ┌─────────────────────────────┃────────────────┐        │
│      │  baseline pixels            ┃ current pixels │        │
│      │                            ⟨┃⟩               │        │
│      │                             ┃                │        │
│      └─────────────────────────────┃────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

**Build**

- Stage: `Frame $darken $rounded='xl'` with `relative h-120 overflow-clip`, `role='group'`, `aria-label='Compare'`, `tabIndex={0}`.
- One image box with two stacked `img`. The current `img` has `clip-path: inset(0 0 0 var(--split))`.
- Divider: a 2 px `Layer $layer='brand'` line with a round handle (`Frame $layer='brand' $rounded='full'`, icon `GripVertical`).
- Control: a native `input type='range'` (0 to 100) over the image box with `opacity-0 cursor-ew-resize` and `aria-label='Swipe position'`. No styled slider primitive exists.
- Region track: `Frame $lightnessOffset={2} $rounded='full'`, 0.25rem tall, above the image and as wide as it. One `Layer $layer='danger'` span for the x-range of each region.
- Labels: `Badge $forceRounded` `Baseline` in the left gutter and `Current` in the right gutter.

**Copy**: `Baseline`, `Current`, `Added`, `No change`, `+22 px`. Handle tooltip: `Drag, or` `Q` `E`.

**Behavior and keys**

- `W`: Swipe. `W` again: turn the divider (vertical or horizontal). The labels and the track follow.
- Pointer down on the image moves the divider to the pointer; a drag moves it. `Q` / `E`: 2% steps, and they repeat while held.
- `C` / `Shift+C`: the divider goes to the middle of the next or previous region.
- `H`: region marks. Zoom and pan as in the shared rules (wheel, `Shift+Arrows`).

**Scenarios**

- small-clip: 3×; divider through the Primary button; one span on the track.
- tiny-regions: divider on the left corners; two clusters on the track.
- zoomed: 200% at region 3; the track shows the visible part as a lighter span (`$lightnessOffset={5}`).
- tall-shift: fit width; the divider is horizontal, at the start of the region.
- size-changed: one scale, top-left anchor; the Baseline side ends 22 px early with a hatch; `Badge $layer='warning' $forceRounded` `+22 px` beside `Current`.
- added: no divider and no track; Current alone; `Badge $layer='success'` `Added`.
- unchanged: divider at 50%; empty track; neutral `Badge` `No change`.
- narrow: fit width; the handle is 2.75rem; the labels are above the image.

## Variant `blink-fade`: Blink and fade

One stage that flips between baseline and current in place, by key, by hold, or on a timer, with a fade slider for a slow comparison.

Ideas:

- Motion shows a 1 px shift at once (Chromatic strobe, reg-cli Toggle).
- The label is the control: a two-part switch `Baseline | Current` with a fade slider between the two words (onion skin).
- On arrival the stage flips twice by itself, then it rests on Current.
- Blink by itself is opt-in and stops under reduced motion.

Tradeoffs:

- A flip of the full image is tiring over many variants, and a small color change is easy to miss without a mark.
- It is weak when the sizes differ (benchmark pattern P12) and when the content changed (P11: the faded layers are not readable).
- Hold needs keydown and keyup. Space is not used, because it scrolls the page and presses the focused button.
- Blink and the overlay were deferred in design r9. It adds a mode and the keys B and T to rule K13.

### Spec

**Words at rest: 2** (`Baseline`, `Current`).

```text
┌──────────────────────────────────────────────────────────────┐
│              ( Baseline ○━━━━━━━━━━━━● Current )   ⟳         │
│      ┌──────────────────────────────────────────────┐        │
│      │                                              │        │
│      │   one image box, two layers, the same place  │        │
│      │                                              │        │
│      └──────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

**Build**

- Stage: `Frame $darken $rounded='xl'` with `relative h-120 overflow-clip`, `role='group'`, `aria-label='Compare'`, `tabIndex={0}`.
- One image box: baseline `img`, and the current `img` over it with `opacity` from the fade value.
- Switch at the top center: `ButtonGroup $lighten $border $rounded='full' $size='sm'` with `Button` `Baseline`, a native `input type='range'` (`aria-label='Fade'`, 0 to 100, 8rem wide), `Button` `Current`. The side that shows has `$lightnessOffset={2}` from state.
- Auto: icon `Button` (`Repeat`) with `aria-label='Blink by itself'` and `aria-pressed`.

**Copy**: `Baseline`, `Current`, `Added`, `No change`, `+22 px`. Tooltips: `Flip` `B`, `Hold for the other image` `T`.

**Behavior and keys**

- `B`: flip (the fade snaps to 0 or 100). `T` hold: the other image while the key is down.
- The slider sets each fade between the two images.
- On arrival, the stage flips twice (350 ms each) and rests on Current. Not under reduced motion.
- Auto flips each 700 ms (`viewer.blinkInterval`). A key or a pointer action on the stage stops it. Off by default. Hidden under reduced motion.
- `H`: region marks. `C`: go to a region; the flip then happens at that place.

**Scenarios**

- small-clip: 3×; two flips show the color change of the Primary button.
- tiny-regions: the marks are on by default here, because each region is under 12 screen px and a flip alone is not visible.
- zoomed: 200% at region 3; the place stays through each flip.
- tall-shift: fit width; a flip shows the 2 px jump; a fade of 50% shows doubled text.
- size-changed: top-left anchor; the 22 px appear and go; `Badge $layer='warning' $forceRounded` `+22 px` beside `Current`.
- added: `Baseline` is `disabled` and the slider is hidden; `Badge $layer='success'` `Added`.
- unchanged: neutral `Badge` `No change`; no arrival flip; Auto hidden.
- narrow: the switch is at the bottom of the stage; a tap on the image flips.

## Variant `region-crops`: Region crops

For a large image, the stage opens as a list of enlarged crops, one card for each changed region, with a small map of the whole image.

Ideas:

- A 7 px region shows at 8x with no zoom and no pan.
- Each card has the baseline crop, the current crop, and the crop with the diff tint, at one scale.
- A map shows where each crop is; a card opens the full stage at that place.
- Many small regions in a tall image become a short list.

Tradeoffs:

- It helps only for large images. About 78% of real screenshots are small clips, where the whole image is the crop.
- Needs `regions` (not in the API today) and the mask at first paint (reopens P02).
- A crop cannot show that a full page moved, so a large region falls back to the full image.
- A noisy mask gives a long list (benchmark pattern P14); the list stops at 6 cards.

### Spec

**Words at rest: 5** (`Baseline`, `Current`, `Diff`, `Full image`).

```text
┌─────────────────────────────────────────────────┬────────────┐
│     Baseline       Current        Diff          │ ┌────────┐ │
│ 1  ┌─────────┐   ┌─────────┐   ┌─────────┐  8×  │ │ ·1     │ │
│    │         │   │    ▪    │   │    █    │      │ │    ·2  │ │
│    └─────────┘   └─────────┘   └─────────┘      │ │ ·3     │ │
│ 2  ┌─────────┐   ┌─────────┐   ┌─────────┐  4×  │ └────────┘ │
│    │ [Done]  │   │ [Done]  │   │  ▓▓▓▓   │      │ Full image │
│    └─────────┘   └─────────┘   └─────────┘      │            │
└─────────────────────────────────────────────────┴────────────┘
```

**Build**

- Stage: `Frame $darken $rounded='xl'` with `h-120 grid grid-cols-[minmax(0,1fr)_12rem] overflow-clip`, `role='group'`, `aria-label='Compare'`, `tabIndex={0}`. The list column has `overflow-auto`.
- Column heads: three `Text` with `text-xs ak-ink-60`.
- Card: `Button` as a row (`$rounded='lg' $p={2}`, `w-full justify-start`), with the index (`Text tabular-nums`), three crop boxes, and the scale (`Text ak-ink-60`).
- Crop box: `Frame $border $rounded='none'` with `overflow-clip` and a 3:2 shape. Inside, the full image moved and scaled by a CSS transform. The Diff crop is the current crop at 40% with the tint `Layer $layer='danger'`.
- Map: `Frame $border $rounded='none'` with the current image at fit and one `Badge $layer='danger' $forceRounded` number for each region.
- `Button $border $size='sm'`: `Full image`.

**Copy**: `Baseline`, `Current`, `Diff`, `Full image`, `Crops`, `8×`, `17 more`, `No change`.

**Behavior and keys**

- Crop scale: the largest whole step from 1× to 8× at which the region plus a 16 px margin fits the box.
- `C` / `Shift+C`: next or previous card. The map number of the card is lit.
- Enter or a click: the full stage (the linked pair) at that region. `S` or `0`: the full image. `D`: back to the crops.
- More than 6 regions: 6 cards, then a `Button` `17 more`.

**Scenarios**

- small-clip: the whole image fits, so no crop is needed: one card with the three full images at 1×, and no map.
- tiny-regions: four cards at 8×; four numbers on the map.
- zoomed: the full stage that card 3 opens: the linked pair at 200%, with a `Button $border $size='sm'` `Crops` at the top left.
- tall-shift: the region is more than 40% of the image: no crops; the linked pair at fit width.
- size-changed: no crops; the linked pair with the hatched 22 px.
- added: Current alone; `Badge $layer='success'` `Added`.
- unchanged: the list column shows `No change`; the map and `Full image` stay.
- narrow: one crop for each card (Current; a tap flips it to Baseline); the map is a 4rem strip above the list.

## Variant `peek-lens`: Peek lens (new)

One stage shows the current image, and a lens that sits on the changed region shows the baseline inside it, so only the changed place flips.

Ideas:

- The comparison happens where the change is: the eye is led to the place and the rest of the image stays still.
- The lens parks on region 1 and flips twice; then it follows the pointer, or steps between regions with C.
- No divider to drag and no tint over the pixels.
- Not in the audit lanes and not in the benchmark tools.

Tradeoffs:

- A new pattern that the reviewer must learn; the lens label `Baseline` is the only explanation.
- A region that is larger than the lens is weak here: for a full-page shift, Swipe is better.
- The pointer lens is a hover interaction. Touch needs a drag, and the keyboard can only step between regions.
- Needs `regions` (not in the API today) to park the lens, and both images at first paint.

### Spec

**Words at rest: 2** (`Current`, and `Baseline` on the lens).

```text
┌──────────────────────────────────────────────────────────────┐
│ Current 320 × 120                                  ◂ 1 / 5 ▸ │
│      ┌──────────────────────────────────────────────┐        │
│      │                              ╭ Baseline ───╮ │        │
│      │   current pixels             │  baseline   │ │        │
│      │                              │  pixels     │ │        │
│      │                              ╰─────────────╯ │        │
│      └──────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

**Build**

- Stage: `Frame $darken $rounded='xl'` with `relative h-120 overflow-clip`, `role='group'`, `aria-label='Compare'`, `tabIndex={0}`.
- One image box with the current `img`.
- Lens: `Frame $border={2} $edge='brand' $edgeRaw $rounded='lg'` with `absolute overflow-clip shadow-lg`. Inside, the baseline `img` with the same size and transform as the current one, shifted by the lens offset, so that its pixels are at the same place.
- Lens label: `Badge $layer='brand' $forceRounded` on the top edge of the lens: `Baseline`.
- The lens has `role='img'` and `aria-label='Baseline at region 1'`.
- Label `Badge $forceRounded` `Current` and the counter (`ButtonGroup $border $size='sm'` with two chevron buttons and a `TextFrame`) in the top gutter.

**Copy**: `Current`, `Baseline`, `1 / 5`, `Added`, `No change`, `+22 px`.

**Behavior and keys**

- Lens size: the region plus a 24 px margin; at least 10rem by 7.5rem; at most 60% of the stage.
- On arrival, the lens sits on region 1 and its content flips twice (Baseline, Current, Baseline). Under reduced motion it does not flip.
- Pointer over the image: the lens follows the pointer. Pointer away: it returns to the region. A click pins it.
- `C` / `Shift+C`: the lens goes to the next or previous region. `B`: flip the content of the lens (the label follows). `T` hold: the whole image as Baseline. `H`: lens on or off.
- Zoom and pan as in the shared rules; the lens scales with the image.

**Scenarios**

- small-clip: 3×; the lens covers the Primary button and shows the old color.
- tiny-regions: lens on corner 1 at the minimum size; four stops.
- zoomed: 200%; lens on region 3.
- tall-shift: the lens is a band over the full image width, 60% of the stage height, at the start of the region; the text lines break at the lens edge.
- size-changed: the lens sits on the bottom edge; the part without baseline pixels is hatched; `Badge $layer='warning'` `+22 px`.
- added: no lens; `Badge $layer='success'` `Added`.
- unchanged: no parked lens; the pointer lens works; neutral `Badge` `No change`.
- narrow: the lens is parked; a drag moves it; the counter is at the bottom.
