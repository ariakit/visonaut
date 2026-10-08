# Changed-region marks and jump (region-markers)

Group: viewer
Question: How should the viewer point to the changed regions of an image?
Description: The marks that show where the pixels changed, and the control that moves between the regions.
Layout: row

## Scenarios

- `clip` (Small clip): A 320 x 120 clip with one region that is a quarter of the image (scene button, light).
- `one-small` (One small region): A 640 x 400 image with one 18 px region, about 10 screen px at Fit (scene checkbox, light).
- `four-tiny` (Four tiny regions): Four 7 px regions at the corners of a list (scene select, dark).
- `five-spread` (Five regions): A 1280 x 720 page with five regions across the image, at Fit (scene page, light).
- `focused` (At a region): The same page after a jump to region 3: zoomed and centered.
- `large-area` (Large region): A tall form where one region covers most of the image (scene form, light).
- `none` (Nothing to mark): No region: an unchanged pair (scene popover with forcedColors active). A size change gives the same result.
- `many` (Many regions): 23 small regions, as a noisy mask gives (lab only: a fixed synthetic list on scene table, with no mask).

## Variant `outline-boxes`: Outline boxes (minimal)

A thin box of at least 24 px around each region, and a small counter with previous and next.

Ideas:

- A 1 px change is still a 24 px box.
- No number and no word on the image; the counter is the only chrome.
- A jump centers the region and zooms to the first step at which it is large enough to judge.

Tradeoffs:

- A box line next to the changed pixels can hide a 1 px edge change; H removes the boxes.
- Needs `regions` (not in the API today), or the mask at first paint (reopens P02).
- The danger color can be close to the UI color in the screenshot.

### Spec

**Words at rest: 0.**

```text
┌──────────────────────────────┐
│ ┌──────────────────────────┐ │
│ │                 ┌──┐     │ │
│ │                 └──┘     │ │
│ │   ┌──┐                   │ │
│ │   └──┘                   │ │
│ └──────────────────────────┘ │
│                    ◂ 2 / 5 ▸ │
└──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`, `aria-label='Image with changed regions'`. The current image is at Fit in its image box (`Frame $border $rounded='none'`).
- Box: a `Button` with no surface, drawn as `Frame $border={2} $edge='danger' $edgeRaw $rounded='sm'`, `aria-label='Changed region 2 of 5'`. At least 24 by 24 screen px, centered on the region. The focused box has `$border={3}`.
- Counter in the bottom-right gutter (its space is always reserved): `ButtonGroup $lighten $border $size='sm'` with `Button aria-label='Previous region'` (`ChevronLeft`), `TextFrame` with `tabular-nums`, `Button aria-label='Next region'` (`ChevronRight`). Tooltips with `Kbd`.

**Copy**: `2 / 5`. Tooltips: `Next region` `C`, `Previous region` `⇧C`.

**Behavior and keys**

- `H`: boxes on or off.
- `C` / `Shift+C`: focus the next or previous region, center it, and zoom to the first step (100%, 200%, 400%) at which its longer side is 96 screen px or more. A click on a box does the same. `0`: fit.
- Regions that are closer than 12 image px join into one box.
- No counter for zero or one region.

**Scenarios**

- clip: one box around the Primary button.
- one-small: one 24 px box.
- four-tiny: four 24 px boxes; `1 / 4`.
- five-spread: five boxes; `1 / 5`.
- focused: region 3 centered at 200%; its box is 3 px; `3 / 5`.
- large-area: four corner brackets at the region corners, no full box.
- none: no mark and no counter.
- many: 23 boxes with `$border={1}`; `1 / 23`.

## Variant `numbered-pins`: Numbered pins

Each region has a box and a number, and a row of the same numbers under the stage goes to each region.

Ideas:

- The numbers give an order and a way to talk about a region ('look at 3').
- The legend row shows the count and the focused region with a glider.
- A direct jump to each region, not only next and previous.

Tradeoffs:

- The pins add ink on the image, next to the changed pixels.
- The legend costs a 2rem row under the stage.
- More than 9 regions need an overflow, and the digits cannot be keys (they select variants).
- Needs `regions` (not in the API today), or the mask at first paint (reopens P02).

### Spec

**Words at rest: 0** (numbers only).

```text
┌──────────────────────────────┐
│ ┌──────────────────────────┐ │
│ │                 ┌──┐②    │ │
│ │                 └──┘     │ │
│ │   ┌──┐①                  │ │
│ │   └──┘                   │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
 [ 1 │ 2 │ 3 │ 4 │ 5 ]
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`; the current image at Fit in its image box.
- Box: `Frame $border $edge='danger' $edgeRaw $rounded='sm'`, at least 24 screen px.
- Pin: `Badge $layer='danger' $mix={0} $forceRounded $px='md'` on the top-right corner of the box, outside the region.
- Legend under the stage: `ak.RadioGroup` rendered as `ButtonGroup $border $size='sm'` (`aria-label='Changed regions'`), one `ak.Radio render={<Button />}` for each region, then a `ButtonGlider`.

**Copy**: the numbers; `+14`.

**Behavior and keys**

- The numbers go from top to bottom, then from left to right.
- A legend click, a pin click, or `C` / `Shift+C`: center the region and zoom to the first step at which its longer side is 96 screen px or more. The glider shows the focused region. `0`: fit.
- `H`: pins and boxes on or off. The legend stays.
- More than 9 regions: pins 1 to 9; the legend ends with a `PopoverDisclosure` `+14` that opens a `Popover portal` with the other numbers.

**Scenarios**

- clip: one box with pin 1; no legend for one region.
- one-small: one box, pin 1.
- four-tiny: four pins; legend `1 2 3 4`.
- five-spread: five pins; legend with five numbers.
- focused: region 3 centered at 200%; the glider is on 3.
- large-area: corner brackets and pin 1 at the top-right bracket.
- none: no mark and no legend.
- many: pins 1 to 9; the other regions are 0.375rem `Layer $layer='danger'` dots; the legend ends with `+14`.

## Variant `edge-ticks`: Edge ticks

The image stays clean: ticks on a rail along the top and the right edge show where the regions are, and a jump pings the place one time.

Ideas:

- No mark covers a pixel at rest.
- Two rails give the place of each region as on a ruler (the Percy diff highlighter bar, on two axes).
- When zoomed, the rails also show the visible part, so they work as a position bar.
- A jump shows two guide lines and one ping at the region.

Tradeoffs:

- The reviewer must join a tick on the top rail with a tick on the right rail to find a region; the guides show only on hover, focus, or a jump.
- For a small clip that fits the stage, the rails add little (benchmark pattern P15).
- The ping is motion; under reduced motion it is a still ring.
- Needs `regions` (not in the API today), or the mask at first paint (reopens P02).

### Spec

**Words at rest: 0.**

```text
     ▁▁▁█▁▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁       ← top rail: the x-range of each region
   ┌──────────────────────────┐▕
   │                 ◌        │█     ← right rail: the y-range
   │                          │▕
   │   ◌                      │█
   └──────────────────────────┘▕
                      ◂ 2 / 5 ▸
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`; the current image at Fit in its image box.
- Rails: two `Frame $lightnessOffset={2} $rounded='full'` bars, 0.25rem thick, in the gutter along the top and the right edge of the image box. They never cover image pixels.
- Tick: a `Layer $layer='danger'` span for the range of each region, at least 0.25rem long.
- Hit target: an invisible `Button` 1.5rem deep over each tick of the right rail, `aria-label='Changed region 2 of 5'`.
- Guides: two 1 px `Layer $layer='danger'` lines at 50% opacity that cross at the region.
- Ping: a `Frame $border={2} $edge='danger' $edgeRaw $rounded='full'` that shrinks onto the region one time (400 ms).
- Counter in the bottom-right gutter: `ButtonGroup $lighten $border $size='sm'` with two chevron buttons and a `TextFrame`.

**Copy**: `2 / 5`. Tooltips: `Next region` `C`, `Previous region` `⇧C`.

**Behavior and keys**

- Hover or focus on a tick: its guides show.
- `C` / `Shift+C` or a click: center and zoom to the region, then one ping. Under reduced motion: a still ring for 1.5 s.
- `H`: the guides of all regions on or off.
- When zoomed, each rail shows the visible part as a lighter span (`$lightnessOffset={5}`).

**Scenarios**

- clip: one tick on each rail; one ping on arrival.
- one-small: one short tick on each rail.
- four-tiny: two clusters of ticks on each rail.
- five-spread: five ticks on each rail.
- focused: zoomed to region 3; its guides cross; both rails show the visible span.
- large-area: one long span on the right rail and the full top rail.
- none: the rails are empty, which shows that the check ran and found nothing.
- many: 23 ticks that join into bands of density.

## Variant `spotlight`: Spotlight (new)

All pixels outside the changed regions are dimmed, so the regions are the only lit places; no box, no color.

Ideas:

- No mark touches the changed pixels and no tint changes their color.
- It works when the UI in the screenshot is red, where a red tint or a red box is not visible.
- Hold T to see the baseline in the lit places only.
- Not in the audit lanes.

Tradeoffs:

- It dims the context, so a reviewer must turn it off (H) to judge the full image.
- A large region or a size change leaves almost nothing to dim, so the effect is small.
- Many regions make a pattern of holes; holes must join above 12 regions.
- Needs `regions` (not in the API today), or the mask at first paint (reopens P02).

### Spec

**Words at rest: 0.**

```text
┌──────────────────────────────┐
│ ┌──────────────────────────┐ │
│ │░░░░░░░░░░░░░░░░░░░░░░░░░░│ │
│ │░░░░░░░░░░░░░░░░░╭───╮░░░░│ │   lit: the regions
│ │░░░╭───╮░░░░░░░░░│   │░░░░│ │   dimmed: all other pixels
│ │░░░│   │░░░░░░░░░╰───╯░░░░│ │
│ │░░░╰───╯░░░░░░░░░░░░░░░░░░│ │
│ └──────────────────────────┘ │
│                    ◂ 2 / 5 ▸ │
└──────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`; the current image at Fit in its image box.
- Scrim: one `Layer $layer='canvas'` over the image box with `opacity-65`, with holes. Make the holes with an inline SVG mask (a white rect, and one black rounded rect for each region plus an 8 px margin) used as `mask-image`.
- A hole is at least 32 screen px. The focused hole has a `Frame $border $edge='brand' $edgeRaw $rounded='md'` ring; the other holes have none.
- Each hole has an invisible `Button` with `aria-label='Changed region 2 of 5'`.
- Counter in the bottom-right gutter: `ButtonGroup $lighten $border $size='sm'` with two chevron buttons and a `TextFrame`.

**Copy**: `2 / 5`. Tooltips: `Next region` `C`, `Previous region` `⇧C`.

**Behavior and keys**

- `H`: scrim on or off. The scrim fades in 150 ms.
- `C` / `Shift+C` or a click on a hole: center and zoom to the region; the ring moves.
- `T` hold: the lit places show the baseline; the dimmed part does not change.
- More than 12 regions: holes closer than 24 px join.

**Scenarios**

- clip: the Primary button is lit; the two other buttons are dimmed.
- one-small: one 32 px hole.
- four-tiny: four 32 px holes.
- five-spread: five holes.
- focused: zoomed to region 3; the ring is on its hole.
- large-area: the scrim covers only the top of the page.
- none: no scrim.
- many: 23 holes that join into about 8 lit areas.

## Variant `detail-callouts`: Detail callouts (new)

Each tiny region gets an enlarged bubble beside the image with a line to the true place, as a detail view on a technical drawing.

Ideas:

- The reviewer judges a 7 px change at 8x without a zoom and without the loss of the full image.
- A hover or a key flips the bubble to the baseline, so the comparison happens in the bubble.
- Regions that are large on screen get a plain outline; the bubbles go away after a zoom.
- Not in the audit lanes.

Tradeoffs:

- The bubbles and lines add much ink, and a bubble over the image covers pixels when the gutter has no room.
- The layout of several bubbles needs a placement rule; at most 5 show.
- In a wide stage with a small clip the region is large already, so no bubble shows (the common real case).
- Needs `regions` (not in the API today), or the mask at first paint (reopens P02).

### Spec

**Words at rest: 0** (scale tags only).

```text
┌────────────────────────────────────┐
│  ╭─────╮                           │
│  │ 8×  │╲  ┌────────────────────┐  │
│  │  ▪  │ ╲ │                    │  │
│  ╰─────╯  ╲│·                   │  │
│            │              ·─────┼──╭─────╮
│            └────────────────────┘  │ 8×  │
│  ◂ 1 / 4 ▸                         ╰─────╯
└────────────────────────────────────┘
```

**Build**

- Cell: `w-90`. Stage: `Frame $darken $rounded='lg'` with `relative h-64 overflow-clip`, `tabIndex={0}`, `role='group'`; the current image at Fit in its image box, with a 4rem gutter on the left and the right.
- Callout: a `Button` drawn as `Frame $border={2} $edge='danger' $edgeRaw $rounded='xl'` with `overflow-clip shadow-lg`, 4.5rem square. Inside, the current image moved and scaled by a CSS transform (4× to 8×, pixelated). `aria-label='Changed region 1 of 4, enlarged 8 times'`.
- Leader: an SVG `line` with `stroke='currentColor'` in a `Text $text='danger'` wrapper, from the region to the callout. A 0.375rem `Layer $layer='danger'` dot with `rounded-full` marks the region.
- Scale tag: `Text` `text-xs tabular-nums` in the callout corner.
- Counter in the bottom-left gutter: `ButtonGroup $lighten $border $size='sm'` with two chevron buttons and a `TextFrame`.

**Copy**: `8×`, `1 / 4`, `Baseline`.

**Behavior and keys**

- A region gets a callout when it is under 24 screen px at the present zoom. A larger region gets an outline box (`Frame $border={2} $edge='danger' $edgeRaw $rounded='sm'`).
- Put a callout in the stage gutter when there is room, else over the image on the side that is away from the other regions. At most 5 callouts; above that, only the focused region has one and the others are dots.
- Hover, focus, or `B`: the callout shows the baseline, with a `Badge $forceRounded` `Baseline` on it.
- A click or `C`: zoom the stage to the region. The callout then goes away, because the region is large.
- `H`: callouts on or off.

**Scenarios**

- clip: no callout (the region is large on screen); one outline box.
- one-small: one callout at 6× beside the checkbox.
- four-tiny: four callouts at 8×, one near each corner.
- five-spread: five callouts at 4× in the gutters.
- focused: zoomed to region 3; an outline box only.
- large-area: corner brackets only.
- none: nothing.
- many: 23 dots; one callout for the focused region.
