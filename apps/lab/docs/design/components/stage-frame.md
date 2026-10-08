# Stage, image edge, and labels (stage-frame)

Group: viewer
Question: What is behind and around a screenshot, and how is each image named?
Description: The stage surface, the edge of each image, the backdrop, and the Baseline and Current labels.
Layout: row

## Scenarios

- `light-clip` (Light clip): A pair of light 320 x 120 clips (scene tooltip, light). In the light theme they merge with the stage today.
- `dark-clip` (Dark clip): A pair of dark 320 x 120 clips (scene tooltip, dark). In the dark theme they merge with the stage today.
- `wide` (Wide image): A pair of 1280 x 720 images at Fit (scene dialog, light).
- `tall` (Tall image): A pair of 800 x 1600 images (scene form, light).
- `size-changed` (Size changed): 640 x 400 and 640 x 422: the label must carry the size change (scene disclosure).
- `single` (One image): Only the current image shows; the label must say which one it is (scene button, dark).
- `zoomed` (Zoomed): The image is larger than the stage: its edge is out of view and the label must stay (scene dialog at 200%).

## Variant `ring`: Ring (minimal)

A plain recessed stage, a 1 px edge on the exact picture box, and a small text label in the gutter above each image.

Ideas:

- The checkerboard leaves the stage; it is under the image only, where it means transparency.
- The edge is on the picture box, not on the img element, so it is right for tall images at Fit.
- The label is outside the pixels and costs no row.
- One pair of names in labels, alt text, and announcements: Baseline and Current.

Tradeoffs:

- A dark picture on the dark stage is separated by a 1 px line only.
- The label needs a top gutter of 1.5rem in each pane.
- No backdrop choice for a reviewer who wants more contrast.

### Spec

**Words at rest: 2.**

```text
┌──────────────────────────────┐
│ Baseline 320 × 120           │
│ ┌──────────────────────────┐ │
│ │          image           │ │
│ └──────────────────────────┘ │
│ Current 320 × 120            │
│ ┌──────────────────────────┐ │
│ │          image           │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, plain. A pair is two rows in this cell (two columns for the tall image).
- Image box: `Frame $border $edgeWeight='medium' $rounded='none'`, sized to the picture.
- Transparent pixels: a checkerboard on the image box only (`repeating-conic-gradient` with `currentColor` at 6%, 1rem squares).
- Label: `Text` `text-xs` in the gutter above the top-left corner of the box: the name, then the size in `ak-ink-60 tabular-nums`. The `img` has `alt='Baseline'` or `alt='Current'`.

**Copy**: `Baseline`, `Current`, the sizes.

**Scenarios**

- light-clip: both boxes at 1×; the edge and the darker stage separate the picture in both themes.
- dark-clip: the 1 px edge is the separation in the dark theme.
- wide: two rows at fit width.
- tall: two columns at fit width; the top of the image.
- size-changed: `Current 640 × 422` with `422` in `Text $text='warning'`.
- single: one box at 2×; `Current 320 × 120`.
- zoomed: the label stays at the top-left of the stage on a `Badge $forceRounded` (so that it is readable over pixels); each stage edge where the image continues has an inset shadow (`shadow-inner`).

## Variant `mat`: Mat and caption

Each image sits in a raised card with a caption row under it, as a print in a mat; the stage has no surface.

Ideas:

- A clear object for each image: the card edge is the boundary in both themes.
- The caption row has the name at the start and the size at the end, in a fixed place.
- The same card can be the item of a contact sheet or a gallery, so the app has one image object.

Tradeoffs:

- A caption row costs 1.75rem for each image, and the mat adds 0.25rem on each side.
- A raised card around evidence is decoration; the rule says to keep attention on screenshot pixels.
- Nested frames round their children: the image well must force square corners, or 2 px of evidence are cut.
- On the light canvas a raised card has almost the canvas color, so it depends on its border.

### Spec

**Words at rest: 2.**

```text
┌────────────────────────────┐
│┌──────────────────────────┐│
││          image           ││
│└──────────────────────────┘│
│ Baseline          320 × 120│
└────────────────────────────┘
┌────────────────────────────┐
│┌──────────────────────────┐│
││          image           ││
│└──────────────────────────┘│
│ Current           320 × 120│
└────────────────────────────┘
```

**Build**

- Cell: `w-90`, with `grid gap-2` and `h-64`. No stage surface: the cards are on the canvas.
- Card: `Frame $lighten $border $rounded='lg' $p={1}` with `grid gap-1 min-h-0` (the media frame recipe).
- Image well: `Frame $darken $rounded='none' $forceRounded` with `grid place-items-center overflow-clip min-h-0`; the image box inside is `Frame $border $rounded='none' $forceRounded`.
- Caption row: `flex items-center justify-between px-2 py-1 text-xs`: `Text` `font-medium` with the name; `Text` `ak-ink-60 tabular-nums` with the size.

**Copy**: `Baseline`, `Current`, the sizes, `+22 px`.

**Scenarios**

- light-clip: two cards; each clip at 1× in its well.
- dark-clip: the same; the well is darker than the card in both themes.
- wide: two cards as rows; the images at fit width.
- tall: two cards as columns; fit width; the caption stays under the well while the image pans in it.
- size-changed: the caption of Current has `640 × 422` and a `Badge $layer='warning' $forceRounded` `+22 px`.
- single: one card at the full height; `Current`.
- zoomed: the image pans inside the well; the card and the caption do not move.

## Variant `opposite-backdrop`: Opposite backdrop

The stage takes the tone that is opposite to the screenshot (a light screenshot on a dark stage, a dark one on a light stage), with a small backdrop control.

Ideas:

- The edge of the capture is always clear: padding, shadow, and border changes at the edge are easy to see.
- Auto reads the color scheme of the variant, so the reviewer does nothing.
- A control gives Auto, Light, Dark, and Grid (a checkerboard for transparent captures).
- Prior art: the canvas toggle of Percy; audit ideas A11Y-R5 and BENCH 19.

Tradeoffs:

- A light stage in a dark app is a large bright area; it changes at each move between a light and a dark variant.
- One more control and one more stored preference.
- The stage tone uses `$invert`, which is the high-contrast neutral, so the stage is very bright or very dark.
- No key: T, the key of Percy for this, shows the other image here.

### Spec

**Words at rest: 2.**

```text
 light screenshot → dark stage        dark screenshot → light stage
┌──────────────────────────┐ ◐       ┌──────────────────────────┐ ◐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│         │░░░░░░░░░░░░░░░░░░░░░░░░░░│
│▓▓ ┌──────────────────┐ ▓▓│         │░░ ┌──────────────────┐ ░░│
│▓▓ │   light image    │ ▓▓│         │░░ │   dark image     │ ░░│
│▓▓ └──────────────────┘ ▓▓│         │░░ └──────────────────┘ ░░│
└──────────────────────────┘         └──────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $rounded='lg'` with `relative h-64 overflow-clip`. Its tone comes from the screenshot scheme (the `scheme` of the fixture set; in the app, `variant.axes.colorScheme`) and the page theme (`usePreview().theme`):
  - dark stage: `$darken={2}` in the dark theme, `$invert` in the light theme;
  - light stage: `$invert` in the dark theme, `$darken` in the light theme.
- The stage is a layer, so the labels and marks inside it take the right contrast with no more work.
- Image box: `Frame $border $rounded='none'`.
- Labels: `Badge $forceRounded` in the gutter above each box: the name, then the size.
- Backdrop control: an `ak.MenuButton render={<Button $size='sm' aria-label='Backdrop' />}` with the icon `Contrast`, at the top-right corner of the stage. Menu: `ak.Menu portal` with the `popover` recipe and four `ak.MenuItemRadio` items with the `option` recipe.

**Copy**: `Baseline`, `Current`; menu: `Auto`, `Light`, `Dark`, `Grid`.

**Behavior**: Auto is the default. `Grid` draws a checkerboard on the whole stage. The choice is stored. No key.

**Scenarios**

- light-clip: a dark stage in both themes.
- dark-clip: a light stage in both themes.
- wide: a dark stage; two rows at fit width.
- tall: a dark stage; two columns.
- size-changed: the Current label has `640 × 422` and a `Badge $layer='warning' $forceRounded` `+22 px`.
- single: a light stage (the clip is dark); one box at 2×.
- zoomed: the stage tone shows only at the gutters; the labels stay at the top-left of the stage.

## Variant `role-edges`: Role edges

Baseline and Current are told apart by the edge of the image and a one-letter tab, with no text row; the word and the size show on hover or focus.

Ideas:

- No label row and no words at rest: the two roles are two edges.
- The same two edge treatments mean the two roles in each viewer part (swipe sides, blink switch, pair glyph).
- The letter tab sits outside the pixels and grows into the word and the size on demand.

Tradeoffs:

- Color carries meaning, so the letter tab is required (rule A09: text with color).
- A brand edge on Current competes with the brand Approve button. Green was used for Current before and looked like a success state (audit finding VIEW-17).
- One letter must be learned, and the size is hidden at rest.
- A 2 px edge next to the pixels can hide a 1 px change at the image edge.

### Spec

**Words at rest: 0** (two letters).

```text
 ┌B┐                             ┌C┐
 ┢━┷━━━━━━━━━━━━━━━━━━━━┓        ┢━┷━━━━━━━━━━━━━━━━━━━━┓
 ┃   image, neutral edge┃        ┃   image, brand edge  ┃
 ┗━━━━━━━━━━━━━━━━━━━━━━┛        ┗━━━━━━━━━━━━━━━━━━━━━━┛
 hover or focus on the tab: Baseline 320 × 120
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`. A pair is two rows in this cell.
- Baseline box: `Frame $border={2} $edgeWeight='bold' $rounded='none'`. Current box: `Frame $border={2} $edge='brand' $edgeRaw $rounded='none'`. The border is outside the picture, so it covers no pixel.
- Tab: a `Button $size='xs'` rendered with a `Badge $forceRounded $rounded='sm'` look on the top-left corner outside the box: `B` (neutral) or `C` (`$layer='brand' $mix={0}`). It has `aria-label='Baseline, 320 by 120'`.
- On hover and on focus, the tab grows to the word and the size (`Baseline 320 × 120`).

**Copy**: `B`, `C`, `Baseline`, `Current`, the sizes, `+22 px`.

**Scenarios**

- light-clip: a neutral edge and a brand edge; tabs `B` and `C`.
- dark-clip: the same; the bold neutral edge separates the dark picture from the stage.
- wide: two rows at fit width.
- tall: two columns.
- size-changed: the `C` tab is open by default and shows `Current 640 × 422` with a `Badge $layer='warning' $forceRounded` `+22 px`.
- single: one box with the brand edge and the tab `C`.
- zoomed: the edges are out of view; the tab stays at the top-left of the stage, and a 2 px line in the role color runs along the top edge of the stage.

## Variant `rulers`: Rulers (new)

Pixel rulers along the top and the left of each image show its size, the pointer position, and the place of each region, as in a design tool.

Ideas:

- The size of the image is read from the rulers, so no size label is needed.
- The pointer position shows as `x 236  y 54`, which is useful in a bug report.
- The regions show as spans on the rulers, so the rulers are also the region marks.
- Not in the audit lanes.

Tradeoffs:

- Dense: 1.25rem at the top and 1.75rem at the left for each pane, and many small numbers.
- Coordinates are rarely needed in a review.
- In a small pane the tick labels get crowded; they must thin out.
- The region spans need `regions` (not in the API today), or the mask at first paint (reopens P02).

### Spec

**Words at rest: 0** (numbers and one letter).

```text
  B  0      100     200     300
    ┬───────┬───────┬───▓▓▓─┬───┐
  0 ┤┌──────────────────────────┐
    ││                          │
 50 ┤│         image      ▢     │
    ▓│                          │
 100┤└──────────────────────────┘
    x 236  y 54
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`. A pair is two rows; each pane has its own rulers and they move as one.
- Pane grid: `grid grid-cols-[1.75rem_minmax(0,1fr)] grid-rows-[1.25rem_minmax(0,1fr)]`.
- Ruler: a `Frame $lightnessOffset={1}` strip. Ticks: a `repeating-linear-gradient` with `currentColor` at 25%. Tick labels: `Text` `font-mono text-xs ak-ink-50 tabular-nums`. The rulers use image pixels: they start at the image corner, end at the image size, and scale with the zoom (a label each 100 px at Fit, each 10 px from 400%).
- Region spans: `Layer $layer='danger'` bars on both rulers for the range of each region.
- Pointer: a 1 px `Layer $layer='brand'` line on each ruler, and a readout at the bottom-left of the pane: `TextFrame $ink={60}` with `font-mono text-xs`.
- Origin corner: the letter `B` or `C` (`Text` `text-xs font-medium`) with a `Tooltip` that has the name and the size.
- Image box: `Frame $border $rounded='none'`; a checkerboard under the image only.

**Copy**: `B`, `C`, `x 236  y 54`. Tooltips: `Baseline 320 × 120`, `Current 320 × 120`.

**Scenarios**

- light-clip: rulers to 320 and to 120; labels at 0, 100, 200, 300.
- dark-clip: the same; the ruler strips separate the dark picture from the stage.
- wide: rulers to 1280 and to 720; a label each 200 px; one region span on each ruler.
- tall: two columns; the left ruler runs to 1600 and scrolls with the image.
- size-changed: the left ruler of Current runs to 422; its last 22 px are a `Layer $layer='warning'` span.
- single: one pane with rulers; the letter `C`.
- zoomed: a label each 50 px; the rulers show only the visible range; the readout follows the pointer.
