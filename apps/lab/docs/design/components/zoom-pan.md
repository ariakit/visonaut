# Zoom, pan, and map (zoom-pan)

Group: viewer
Question: How does a reviewer zoom and move in a screenshot?
Description: The zoom control, the pan gestures and keys, and the mark that shows where the view is.
Layout: row

## Scenarios

- `clip-fit` (Small clip, Fit): A 160 x 60 image that Fit must enlarge (lab only: scene button with half of its width and height).
- `wide-fit` (Wide image, Fit): A 1280 x 720 image that Fit must reduce to 28% (scene dialog, dark).
- `zoomed` (Zoomed): The same image at 200%, centered on its changed region (the Done button).
- `tall` (Tall image): An 800 x 1600 image: contain makes it a narrow strip (scene form, light).
- `pair` (Linked pair): Baseline and current in two panes at 100% with one view (scene checkbox, light).
- `size-changed` (Different sizes): 640 x 400 and 640 x 422 in two panes: one scale and a top-left anchor (scene disclosure).
- `limit` (At the limit): The largest zoom of the variant; zoom in is not available.

## Variant `three-steps`: Three steps (minimal)

Fit, 100%, and 200% as today, with linked scroll panes, a zoom that keeps the center point, visible thin scrollbars, drag, and Shift+Arrows.

Ideas:

- The three levels of the contract stay, so no rule changes.
- Real scroll containers: scrollbars show the position and the native scroll keys work when shortcuts are off.
- The panes mirror their scroll offsets, and a zoom scales the offsets so that the center point stays.
- Fit enlarges a small clip by whole steps and fits the width of a tall image.

Tradeoffs:

- 200% is still small for a 7 px region, and no level is under 100% but Fit.
- The pan buttons go away. U04 named them ('page-wide review arrows with pan buttons'), so this changes a part of that decision. Shift+Arrows needs a Shift branch.
- A scroll container cannot zoom at the pointer as well as a transform; the center point is the anchor.

### Spec

**Words at rest: 1** (`Fit`).

```text
┌──────────────────────────────┐
│ ┌──────────────────────────┐ │
│ │          image           │ │
│ └──────────────────────────┘ │
│              [Fit│100%│200%] │
└──────────────────────────────┘
 zoomed: thin scrollbars show the place
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64`, `tabIndex={0}`, `role='group'`, `aria-label='Image'`.
- The pane is a real scroll container: `overflow-auto` with `[scrollbar-width:thin]`; the image box (`Frame $border $rounded='none'`) is inside.
- In a pair, mirror `scrollLeft` and `scrollTop` between the panes in `onScroll`. On a zoom change, multiply the offsets by the zoom ratio so that the center point stays.
- Control: `ak.RadioGroup` as `ButtonGroup $lighten $border $size='sm'` with `Fit`, `100%`, `200%` and a `ButtonGlider`, `absolute bottom-2 right-2`, `aria-label='Zoom'`. Each has a `Tooltip` with a `Kbd`.
- Cursor: `cursor-grab` when the image is larger than the pane.

**Copy**: `Fit`, `100%`, `200%`. Tooltips: `Fit` `0`, `Zoom in` `+`, `Zoom out` `-`.

**Behavior and keys**

- `0`, `+`, `-` step through the three levels (rule A19).
- Fit follows the shared rule: whole-step enlargement for a small image, fit width for a tall image.
- Pan: drag, wheel, `Shift+Arrows` (half a pane). No pan buttons.
- A zoom from Fit opens at region 1 when a region exists, else at the center.

**Scenarios**

- clip-fit: Fit shows the image at 2×, centered.
- wide-fit: Fit at 28%; no scrollbar.
- zoomed: 200% with the Done button in the center; both scrollbars show.
- tall: Fit is fit width; the vertical scrollbar shows; the top of the image.
- pair: two panes as rows at 100%; scroll one and the other follows.
- size-changed: one scale, top-left anchor; at the end of the scroll, Baseline shows 22 px of stage where Current has pixels.
- limit: 200% is selected; `+` does nothing.

## Variant `stepper`: Stepper with presets

A minus, percent, plus control with a preset menu from Fit to 800% and Actual pixels, and a zoom at the pointer with the wheel or a pinch.

Ideas:

- The control shows the real percent, also at Fit.
- Presets cover small clips (400%, 800%), tall images (Fit width), and a true 1:1 view (Actual pixels).
- Ctrl+wheel and pinch zoom at the pointer; drag and wheel pan.

Tradeoffs:

- More levels than rule A19 (fit, 100%, 200%).
- Ctrl+wheel over the stage takes the browser zoom away there (RULE-22).
- `Actual pixels` gives 50% on a display with a pixel ratio of 2, which can confuse.
- No mark shows the position when zoomed, apart from the image edge.

### Spec

**Words at rest: 0** (the percent).

```text
┌──────────────────────────────┐
│        image at 200%         │
│                              │
│            [ − │ 200% ▾ │ + ]│
└──────────────────────────────┘
 menu: Fit 0 · Fit width · 50% · 100% · 200% · 400% · 800% · Actual pixels
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`, `aria-label='Image'`.
- View: one CSS transform (`translate` and `scale`) on a wrapper around the image box; `cursor-grab`.
- Control: `ButtonGroup $lighten $border $size='sm'` with `absolute bottom-2 right-2`: `Button aria-label='Zoom out'` (`Minus`), an `ak.MenuButton render={<Button />}` with the percent (`tabular-nums`, `w-14`) and a `ChevronDown` slot, `Button aria-label='Zoom in'` (`Plus`).
- Menu: `ak.Menu portal` with the `popover` recipe (`$p: 1`, `$rounded: 'xl'`); the items are `ak.MenuItemRadio` with the `option` recipe; `Fit` has an `OptionSlot $kind='shortcut'` with `0`.

**Copy**: `Fit`, `Fit width`, `50%`, `100%`, `200%`, `400%`, `800%`, `Actual pixels`. Tooltips: `Zoom out` `-`, `Zoom in` `+`.

**Behavior and keys**

- `+` / `-` go to the next preset. `0`: Fit.
- Ctrl+wheel and pinch: 10% steps at the pointer. Wheel, drag, and `Shift+Arrows` pan.
- `Actual pixels`: one image pixel is one device pixel.
- From 800%, a 1 px grid shows between the image pixels (`repeating-linear-gradient` with `currentColor` at 10%).

**Scenarios**

- clip-fit: `200%`.
- wide-fit: `28%`.
- zoomed: `200%`.
- tall: `45%`; `Fit width` is checked in the menu.
- pair: one stepper for both panes.
- size-changed: one percent for both panes; top-left anchor.
- limit: `800%`; `Zoom in` is `disabled`; the pixel grid shows.

## Variant `navigator`: Corner navigator

When the image is larger than the stage, a small map in a corner shows the whole image, the view frame, and the regions, and a drag on it moves the view.

Ideas:

- The reviewer always sees where the view is and where the regions are.
- A drag of the view frame or a click on the map moves the view; the wheel over the map zooms.
- At Fit the map is one small button, so nothing covers the image.
- The map moves to the other corner when the focused region or the pointer is under it.

Tradeoffs:

- The map covers a corner of the image when zoomed.
- It draws a second copy of the image at the same URL (no thumbnail exists for current runs).
- The region dots need `regions` (not in the API today).
- More levels than rule A19 when the map zoom is used.

### Spec

**Words at rest: 1** (`Fit`, at Fit only).

```text
┌──────────────────────────────┐
│                              │
│      image at 200%           │
│                   ┌────────┐ │
│                   │ ┌──┐ · │ │  ← whole image, view frame, region dots
│                   │ └──┘   │ │
│                   └− 200% +┘ │
└──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`, `aria-label='Image'`. View: one CSS transform; `cursor-grab`.
- Map: `Frame $lighten $border $rounded='md' $p={0.5}` with `overflow-clip shadow-lg`, 6rem wide (4rem for a tall image), `absolute bottom-2 right-2`. It holds the current `img` at map size.
- View frame: `Frame $border={2} $edge='brand' $edgeRaw $rounded='none'` over the map, with pointer handlers and `aria-hidden` (a keyboard user pans with `Shift+Arrows`).
- Region dots: 0.25rem `Layer $layer='danger'` dots with `rounded-full`.
- Under the map image: `ButtonGroup $size='xs'` with `Minus`, a `TextFrame` percent, `Plus`.
- At Fit, the map is one `Button $lighten $border $size='sm'` `Fit` at the same corner.

**Copy**: `Fit`. Tooltips: `Zoom out` `-`, `Zoom in` `+`, `Fit` `0`.

**Behavior and keys**

- The map shows only when the image is larger than the stage.
- A drag of the view frame or a click on the map moves the view. The wheel over the map zooms.
- Levels: Fit, 50%, 100%, 200%, 400%. `+`, `-`, `0`, `Shift+Arrows` as in the shared map.
- The map moves to the bottom-left corner when the focused region or the pointer is under it.

**Scenarios**

- clip-fit: no map; the `Fit` button.
- wide-fit: no map; the `Fit` button.
- zoomed: the map with the frame on the Done button and one dot.
- tall: the map is 4rem wide and 8rem tall; the frame is at the top.
- pair: one map, in the lower pane, for both panes.
- size-changed: the map shows Current; its last 22 px are hatched.
- limit: 400%; the frame keeps a minimum size of 0.5rem; `Plus` is `disabled`.

## Variant `rail-map`: Rail map

A narrow rail beside the stage always shows the whole image with the view window and the region marks, made for tall and wide captures.

Ideas:

- A tall capture opens at fit width and is readable at once; the rail shows where the view is.
- The rail follows the image: a column for a tall image, a row for the others.
- The rail is always present, so the stage never changes size.
- Region marks on the rail show changes that are outside the view.

Tradeoffs:

- Costs 3rem of the stage all the time, also for the 78% of real clips that fit, where the rail has no job.
- It draws a second copy of the image at the same URL.
- The region marks need `regions` (not in the API today).
- More levels than rule A19.

### Spec

**Words at rest: 0.**

```text
┌─────────────────────────┬────┐
│                         │┌──┐│
│   image at fit width    ││▓▓││ ← view window
│                         ││  ││
│                 ▢       ││ •││ ← region mark
│                         ││  ││
│                         │└──┘│
└─────────────────────────┴────┘
 wide image: the rail is a row under the stage
```

**Build**

- Cell: `w-90`. Root: `Frame $darken $rounded='lg'` with `h-64 grid overflow-clip`, `tabIndex={0}`, `role='group'`, `aria-label='Image'`. Grid: `grid-cols-[minmax(0,1fr)_3rem]` for an image that is taller than wide, `grid-rows-[minmax(0,1fr)_2.5rem]` for the others.
- Stage cell: one CSS transform on the image box; `cursor-grab`.
- Rail cell: `Frame $darken` with the whole current `img` fitted to the rail length. Over it, the view window: `Frame $border={2} $edge='brand' $edgeRaw $rounded='none'`. The parts outside the window are dimmed by a `Layer $layer='canvas'` with `opacity-50`.
- Region marks: `Layer $layer='danger'` bars at the outer edge of the rail.
- Zoom at the rail end: `ButtonGroup $size='xs'` (`$layout='vertical'` in the column rail) with `Minus`, a `TextFrame` percent, `Plus`.

**Copy**: none. Tooltips: `Zoom out` `-`, `Zoom in` `+`.

**Behavior and keys**

- A click or a drag on the rail moves the view. `C` moves the window to the region.
- Levels: Fit, 50%, 100%, 200%, 400%. `+`, `-`, `0`, `Shift+Arrows` as in the shared map.

**Scenarios**

- clip-fit: a row rail with a small copy of the clip; the window covers all of it.
- wide-fit: a row rail; the window covers all of it.
- zoomed: a row rail; the window is a quarter of the rail; one mark.
- tall: a column rail; the window is the top fifth; one long mark.
- pair: one rail for both panes.
- size-changed: the rail shows Current; its last 22 px are hatched.
- limit: 400%; the window keeps a minimum size of 0.5rem.

## Variant `intent-zoom`: Intent zoom (new)

Three zoom levels with names of what the reviewer wants to see: Fit, Region, and Pixels, with the real percent as a quiet readout.

Ideas:

- A reviewer thinks 'show me the change', not '400%': Region picks the scale and the place.
- C moves to the next region at this level, so zoom and jump are one action.
- Pixels is the level for the question 'is this anti-aliasing or a real change'.
- Not in the audit lanes: they proposed percent levels only.

Tradeoffs:

- New words that the reviewer must learn; the readout gives the percent.
- `Region` needs `regions` (not in the API today), or the mask at first paint (reopens P02). It is disabled for an added or unchanged variant.
- More levels than rule A19, and the level names hide the 100% view (plus and minus still reach it).
- The scale of `Region` changes from region to region.

### Spec

**Words at rest: 3** (`Fit`, `Region`, `Pixels`).

```text
┌──────────────────────────────┐
│   region fills half of the   │
│   stage                      │
│  400% [ Fit │ Region │ Pixels ]
└──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`, `aria-label='Image'`. View: one CSS transform; `cursor-grab`.
- Control: `ak.RadioGroup` as `ButtonGroup $lighten $border $size='sm'` with three radios and a `ButtonGlider`, `absolute bottom-2 right-2`, `aria-label='Zoom'`.
- Readout before it: `TextFrame $ink={60}` with `text-xs tabular-nums`: the real percent.

**Copy**: `Fit`, `Region`, `Pixels`. Tooltips: `Whole image` `0`, `The changed region` `C`, `Single pixels`, `No region`.

**Behavior and keys**

- Fit: the shared Fit rule.
- Region: the focused region with a 24 px margin fills about half of the stage, at a whole step (100%, 200%, 400%, 800%). `C` / `Shift+C` select this level and go to the next or previous region.
- Pixels: 800% with a 1 px grid between the image pixels, centered on the focused region (or on the stage center).
- `+` / `-` still step 50%, 100%, 200%, 400%, 800%. When the scale matches no level, no radio is selected and the readout tells the value.
- Drag, wheel, and `Shift+Arrows` pan.

**Scenarios**

- clip-fit: Fit; readout `200%`.
- wide-fit: Fit; `28%`.
- zoomed: Region; `400%`: the Done button fills half of the stage.
- tall: Fit (fit width); `45%`.
- pair: Region in both panes.
- size-changed: Region goes to the 22 px band at the bottom edge.
- limit: Pixels; `800%`; the grid shows; `+` does nothing.

## Variant `hud-only`: Gestures and HUD

No zoom control at rest: wheel, pinch, drag, double click, and keys do the work, and a small readout shows the percent for one second.

Ideas:

- The image-first option: nothing is on the stage at Fit.
- A double click zooms to 200% at the pointer and back.
- Two 2 px bars on the stage edges show the position when zoomed.
- One small Fit button shows only when the image is zoomed.

Tradeoffs:

- No visible zoom control at Fit: the reviewer must know the gestures or read the ? list.
- Ctrl+wheel over the stage takes the browser zoom away there (RULE-22).
- Free zoom values are more levels than rule A19.
- A keyboard user depends on plus, minus, 0, and Shift+Arrows only.

### Spec

**Words at rest: 0.**

```text
┌──────────────────────────────┐
│           ( 200% )           │  ← shows for 1 s after a zoom change
│                              │
│        image at 200%         │▕ ← 2 px position bars
│                              │
│▁▁▁▁▁▁▁▁▂▂▂▂▂▂▂▁▁▁▁▁▁▁▁▁▁  ⤢  │  ← Fit button, only when zoomed
└──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`, `aria-label='Image'`. View: one CSS transform.
- No control at Fit.
- HUD: `Badge $size='sm' $forceRounded` at the top center with `aria-live='polite'`, visible for 1 s after each zoom change; then it fades.
- Position bars: two `Frame $lightnessOffset={6} $rounded='full'` bars, 2 px thick, on the bottom and the right edge of the stage. Their length and offset give the visible part. Only when zoomed.
- `Button $lighten $border $size='sm'` with the icon `Minimize2` and `aria-label='Fit'`, `absolute bottom-2 right-2`, only when zoomed. Tooltip: `Fit` `0`.
- Cursor: `cursor-zoom-in` at Fit, `cursor-grab` when zoomed.

**Copy**: the percent. Tooltip: `Fit` `0`.

**Behavior and keys**

- Double click: Fit to 200% at the pointer, and back.
- Ctrl+wheel and pinch: zoom at the pointer, from Fit to 800%. Wheel and drag: pan.
- `+`, `-`, `0`, `Shift+Arrows` as in the shared map.

**Scenarios**

- clip-fit: the image at 2×; nothing more.
- wide-fit: the image at 28%; nothing more.
- zoomed: the two position bars and the Fit button; the HUD shows `200%` (keep it visible in this still state).
- tall: fit width; the right position bar shows.
- pair: one set of bars on the stage; both panes move.
- size-changed: one scale, top-left anchor.
- limit: HUD `800%`; a zoom in does nothing.
