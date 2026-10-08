# Details of the selected variant (details-panel)

Group: workspace
Question: How should the details of the selected variant be shown, and for whom: the reviewer or the operator?
Description: The secondary facts of one variant: changed pixels and ratio, size, tolerance, engine, digests, decision, and run identity.
Layout: row

## Scenarios

- `changed` (Changed): Firefox · Light of Dialog with initial focus: both images are 1280 × 720, a small ratio of pixels changed, and no decision exists.
- `size-changed` (Size changed): Chromium · Light of Disclosure list: 640 × 400 became 640 × 422, so the mask covers every pixel and the ratio is 100%.
- `added` (Added): Chromium · Light of Sortable data table: no baseline exists and the variant is auto-approved.
- `removed` (Removed): Chromium · Light of Legacy installation page: no current image exists and the variant is auto-approved.
- `decided` (Decided): Chromium · Light of Toolbar with a pressed toggle: approved by @morikenji a few minutes ago (reviewer login and time are not in the API today).
- `failed` (Failed): A variant of the `problems` run whose comparison has no images and no measurements.
- `not-uploaded` (Not uploaded): WebKit · Light of Actions menu: unchanged inside the tolerance, and CI did not upload the current image.
- `expired` (Images expired): A variant of the `expired` run: the images are deleted and only the decision and the identity remain.

## Variant `facts`: Facts popover

An info button opens a popover with six rows of facts and one button that copies the debug data.

Ideas:

- No layout change when it opens, and no copy of what the header already says.
- Six plain rows answer the reviewer; digests and identifiers go to the clipboard for a bug report.
- Every row has a human value: `Size changed`, not `100%`.

Tradeoffs:

- Digests and the run identifier are not readable on screen, only in the copied text.
- A popover closes when the reviewer continues, so it is not for constant reading.
- It still shows the five facts that the contract names (pixels, ratio, size, engine, tolerance).

### Spec

**Sketch**

```
(i) Details
┌──────────────────────────────────────┐ 20rem
│ Changed        1,420 px · 0.15%      │
│ Size           1280 × 720            │
│ Tolerance      0.2 · max 0 px        │
│ Compared with  rgba-visible-1        │
│ Decision       Needs review          │
│ Commit         9f8e7d6 ↗             │
│ [copy Copy debug info]               │
└──────────────────────────────────────┘
```

**Build**

- Trigger: `PopoverProvider` and `PopoverDisclosure $size='sm'` with an `Info` slot and the label `Details`.
- In the lab cell, render the trigger and, under it, the popover content inline and open (a `Frame $lighten $border $rounded='2xl' $p={3} className='grid w-80 gap-3 shadow-xl'`), so that all scenarios are visible at once. In a page, it is `Popover portal`.
- Rows: a `dl` with `grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm`. `dt`: `Text className='ak-ink-60'`. `dd`: `Text className='tabular-nums'`. Rows without a value are not rendered.
- Values: `Changed` = `formatCount(changedPixels)` + `px ·` + `formatRatio(ratio)`. `Size` = `width × height` of the current image (or `640 × 400 → 640 × 422 (+22)`). `Tolerance` = the numbers of `variant.threshold` as `0.2 · max 0 px` (print the sentence if it does not parse). `Compared with` = `variant.engine`. `Decision` = the status word, plus `by @login · 3 min ago` for a person. `Commit` = `Link` with `shortSha` and an `ArrowUpRight` icon.
- Copy: `Button $size='sm' $lightnessOffset` with a `Copy` slot. After a click its label is `Copied` for 1.6 s.
- Clipboard text (plain lines): `run {id} attempt {n} commit {sha}` / `screenshot {item.key}` / `variant {variant.key}` / `baseline {digest} {w}x{h}` / `current {digest} {w}x{h}` / `engine {engine} codec {codec}` / `policy {policy}` / `threshold {threshold}` / `changed {changedPixels} px ratio {ratio}`.

**Copy** (labels, 8 words): `Details`, `Changed`, `Size`, `Tolerance`, `Compared with`, `Decision`, `Commit`, `Copy debug info`, `Copied`.

**Behavior and keys**

- No key is bound (map A has none). The popover closes with Esc and returns focus to the trigger.
- The values follow the selection while the popover is open.

**Scenarios**

- changed: as in the sketch.
- size-changed: `Changed  Size changed`, `Size  640 × 400 → 640 × 422 (+22)`.
- added: `Changed  Added`, `Size  1280 × 720`, `Decision  Auto-approved`. No tolerance row.
- removed: `Changed  Removed`, `Size  1280 × 720 (baseline)`, `Decision  Auto-approved`.
- decided: `Decision  Approved by @morikenji · 3 min ago`.
- failed: one sentence in place of the rows: `The comparison has no images. Rerun the visual tests in CI.`, then `Commit` and the copy button.
- not-uploaded: `Changed  4 px · within tolerance`, and a row `Current  Not uploaded`.
- expired: `Images  Deleted`, `Decision  Approved by @diegohaz · 41 d ago`, `Commit`, and the copy button.

## Variant `inspector`: Inspector sections

A side panel with four sections, Result open and Images, Comparison, and Run closed.

Ideas:

- Progressive disclosure: the reviewer reads Result, and the operator opens the rest.
- Every digest and identifier is visible and has its own copy button.
- It can stay open while the reviewer moves through variants.

Tradeoffs:

- An open panel takes 20rem of image width.
- The most text of the options when all sections are open (about 40 words).
- It keeps a panel, which the audit calls the least useful 256 px of the page (WORK-25), unless it is closed by default.

### Spec

**Sketch**

```
┌ Details ─────────────────────────── ✕ ┐ 20rem
│ ▾ Result                              │
│   Changed     1,420 px · 0.15%        │
│   Tolerance   0.2 · max 0 px          │
│   Decision    Needs review            │
│ ▸ Images                              │   Baseline 1280 × 720  a1b2c3d4 copy
│ ▸ Comparison                          │   Engine, Codec, Policy copy
│ ▸ Run                                 │   Commit ↗, Attempt, Baseline revision, Run copy
└───────────────────────────────────────┘
```

**Build**

- Panel: `Frame $border $rounded='xl' $p={2} className='grid w-80 gap-1'`. In a page it is `ShellSidebar $side='end' $width='lg' render={<aside />} aria-label='Details'`.
- Header: `flex items-center justify-between px-2`: `Heading className='mt-0 mb-0 text-sm font-semibold'` `Details`, and an icon `Button $size='sm' aria-label='Close details'` with `X`.
- Sections: `DisclosureGroup`, with `Disclosure button={{ children: 'Result', indicator: 'chevron-right-start' }} defaultOpen`, then `Images`, `Comparison`, `Run`.
- Rows inside a section: a `dl` with `grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm`; `dt` in `ak-ink-60`.
- Result: `Changed`, `Tolerance`, `Decision`. Images: `Baseline` and `Current`, each with the size and `Code` of the first 8 characters of the digest, plus an icon `Button $size='xs' aria-label='Copy baseline digest'`; then `Environment` = `Same as baseline` or `Differs from baseline` (compare the two profiles). Comparison: `Engine`, `Codec`, `Policy` (8 characters and copy). Run: `Commit` (`Link`), `Attempt`, `Baseline revision`, `Run` (8 characters and copy).
- In the lab cell, open `Result` and `Images` so that the digests are visible.

**Copy**: `Details`, `Result`, `Images`, `Comparison`, `Run`, `Changed`, `Tolerance`, `Decision`, `Baseline`, `Current`, `Environment`, `Same as baseline`, `Differs from baseline`, `Engine`, `Codec`, `Policy`, `Commit`, `Attempt`, `Baseline revision`. Copy buttons announce `Copied`.

**Behavior and keys**

- The open sections are remembered in local storage. No key is bound.
- The values follow the selection.

**Scenarios**

- changed: as in the sketch, with `Images` open.
- size-changed: `Changed  Size changed`; the two sizes in `Images` differ and the current one has `+22` in warning text.
- added: `Images` has `Baseline  None`; `Decision  Auto-approved`.
- removed: `Images` has `Current  None`.
- decided: `Decision  Approved by @morikenji · 3 min ago`.
- failed: `Result` holds the sentence `The comparison has no images. Rerun the visual tests in CI.`; `Images` and `Comparison` are disabled.
- not-uploaded: `Changed  4 px · within tolerance`; `Current  Not uploaded`.
- expired: `Images` reads `Deleted` for both; `Run` is open.

## Variant `two-columns`: Baseline and current table

A table with one column for the baseline and one for the current image; the cells that differ are tinted.

Ideas:

- The same mental model as the viewer: baseline on the left, current on the right.
- A size change or an environment change is a tinted cell, so it shows without reading.
- An added or a removed variant is an empty column, which explains itself.

Tradeoffs:

- Three columns in 20rem leave short values: digests show 7 characters.
- Facts that have one value (changed pixels, tolerance, engine) need a second block under the table.
- A new idea that is not in the audit.

### Spec

**Sketch**

```
┌──────────────────────────────────────┐ 20rem
│              Baseline     Current    │
│ Size         640 × 400    640 × 422  │  the current cell is tinted, `+22` under it
│ Digest       a1b2c3d c    9f8e7d6 c  │  c = copy button
│ Environment  4c5d6e7      4c5d6e7    │  equal values in ink 60
├──────────────────────────────────────┤
│ Changed      Size changed            │
│ Tolerance    0.2 · max 0 px          │
│ Engine       rgba-visible-1          │
│ Decision     Needs review            │
└──────────────────────────────────────┘
```

**Build**

- `Table aria-label='Details' container={{ $border: true }} $borderInline={false} $p={2} className='w-80 text-sm'` with children.
- Head: `TableRowGroup group='head'` with an empty cell, `Baseline`, and `Current`.
- Body rows with `TableCell header='row'` labels in ink 60: `Size`, `Digest`, `Environment`.
- A cell that differs from its neighbor: wrap the value in `Frame $layer='warning' $mix={15} $rounded='sm' $forceRounded className='inline-block px-1'`. The size cell adds `Text $text='warning' className='block text-xs'` with the difference (`+22`).
- Digest and environment values: `Code` with 7 characters. The digest cells have an icon `Button $size='xs' aria-label='Copy baseline digest'`.
- A missing image: `Text className='ak-ink-50'` `None`.
- Foot: `TableRowGroup group='foot'` with rows that span the two value columns (`colSpan={2}`): `Changed`, `Tolerance`, `Engine`, `Decision`.
- Under the table: `Button $size='sm'` `Copy debug info` (the same clipboard text as in the `facts` variant: run, screenshot, variant, both digests and sizes, engine, codec, policy, threshold, changed pixels, ratio).

**Copy**: `Baseline`, `Current`, `Size`, `Digest`, `Environment`, `Changed`, `Tolerance`, `Engine`, `Decision`, `None`, `Copy debug info`.

**Behavior and keys**

- No key is bound. The values follow the selection. A copy button shows `Copied` in its tooltip for 1.6 s.

**Scenarios**

- changed: equal sizes in ink 60; the two digests differ (both tinted); `Changed  1,420 px · 0.15%`.
- size-changed: as in the sketch.
- added: the baseline column reads `None` three times; `Changed  Added`; `Decision  Auto-approved`.
- removed: the current column reads `None`; `Changed  Removed`.
- decided: `Decision  Approved by @morikenji · 3 min ago`.
- failed: both columns read `None`; the foot has one row: `Changed  Failed`, and the sentence `Rerun the visual tests in CI.` under the table.
- not-uploaded: the current column reads `Not uploaded`; `Changed  4 px · within tolerance`.
- expired: both columns read `Deleted`; `Decision  Approved by @diegohaz · 41 d ago`.

## Variant `strip`: Inline strip

One line of facts in the mono font under the stage, always visible, with the rest behind one button.

Ideas:

- No click for the five facts that the contract names.
- One 28 px line, where today a 256 px side panel repeats the header.
- The line is data only: no labels where the value explains itself.

Tradeoffs:

- Nine words of permanent text on a screen that must lose words.
- In a 20rem cell the line wraps to two lines; it is one line from 45rem.
- Values without labels need a moment to learn (`0.2 · max 0` is the tolerance).

### Spec

**Sketch**

```
1280 × 720 · 1,420 px · 0.15% · tolerance 0.2, max 0 px · rgba-visible-1            ⋯
⋯ opens:
  Baseline   a1b2c3d4  copy
  Current    9f8e7d64  copy
  Commit     9f8e7d6 ↗   Attempt 2   Baseline revision 128
  [Copy debug info]
```

**Build**

- Line: `Frame $layer className='flex min-h-7 items-center gap-x-2 gap-y-0.5 flex-wrap border-t px-3 py-1 font-mono text-xs'` with the facts as `Text` separated by a middle dot in ink 40, and `tabular-nums`. In the lab cell it is `w-80`; in a page it is as wide as the stage.
- The decision is not in the line (the header or the bar has it), except for a person: `by @morikenji · 3 min ago` in ink 60 at the end.
- `⋯`: `PopoverProvider placement='top-end'` and `PopoverDisclosure $size='xs' aria-label='More details'` with `Ellipsis`, pushed to the end with `ms-auto`. The `Popover portal $p={3} $rounded='xl'` has a small `dl` (`Baseline`, `Current` with `Code` of 8 characters and copy buttons; `Commit` as a `Link`; `Attempt`; `Baseline revision`) and `Button $size='sm'` `Copy debug info`.
- In the lab cell, render the line and, under it, the popover content inline.
- A value that needs attention is `Text $text='warning'`: a size change, and a ratio of 100%.

**Copy** (line, 9 words at most): `{width} × {height}`, `{n} px`, `{ratio}`, `tolerance 0.2, max 0 px`, `{engine}`. Popover: `Baseline`, `Current`, `Commit`, `Attempt`, `Baseline revision`, `Copy debug info`.

**Behavior and keys**

- The line never changes height at a given width: a missing fact leaves no gap, and the line keeps `min-h-7`.
- No key is bound. The values follow the selection.

**Scenarios**

- changed: as in the sketch.
- size-changed: `640 × 400 → 640 × 422 (+22) · Size changed · tolerance 0.2, max 0 px · rgba-visible-1`, with the size in warning text.
- added: `1280 × 720 · Added · Auto-approved`.
- removed: `1280 × 720 (baseline) · Removed · Auto-approved`.
- decided: the changed line plus `by @morikenji · 3 min ago`.
- failed: `Failed · The comparison has no images` in danger text.
- not-uploaded: `1280 × 720 · 4 px · within tolerance · current not uploaded`.
- expired: `Images deleted · Approved by @diegohaz · 41 d ago`.

## Variant `visual`: Visual facts

The facts are drawn: the two sizes as outlines to scale, the changed regions as a mini map, and the ratio as a meter.

Ideas:

- A size change is a picture: a dashed baseline outline inside a solid current outline, with the extra strip tinted.
- The mini map shows where the changes are in the image, and a click on a region goes to it in the viewer.
- Numbers stay, but as captions of a picture.

Tradeoffs:

- Needs `regions` (not in the API today).
- The ratio meter uses a square-root scale, because 0.15% is not visible on a linear bar. The number must stay beside it.
- More to build than a list. A new idea that is not in the audit.

### Spec

**Sketch**

```
┌──────────────────────────────────────┐ 20rem
│ ┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐                  │  outline to scale, 9rem wide
│ ┆   ▪  ▪           ┆  640 × 400      │  ▪ = changed regions
│ ┆                  ┆  → 640 × 422    │
│ └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘  +22 px         │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  (new strip, tinted) │
│ ▍░░░░░░░░░░░░░░░░░░░  0.15% · 1,420 px │  meter
│ tolerance 0.2 · max 0 px             │
│ rgba-visible-1        copy Copy debug info │
└──────────────────────────────────────┘
```

**Build**

- Card: `Frame $lighten $border $rounded='2xl' $p={3} className='grid w-80 gap-3 text-sm'` (a `Popover` or a panel in a page).
- Size picture: a `relative w-36` box with the aspect ratio of the larger image (`style={{ aspectRatio }}`). Baseline outline: `Frame $border $borderType='dashed' $rounded='xs'` positioned by percent. Current outline: `Frame $border $rounded='xs'`. The area that only the current image has: `Frame $layer='warning' $mix={30}`. Equal sizes give one solid outline.
- Regions: one `Button $p='none' $layer='danger' $rounded='xs'` for each of `variant.regions`, positioned by percent, at least `size-1.5`. `aria-label='Go to change 1 of 2'`.
- Beside the picture: `Text` lines with the size, an arrow and the new size, and the difference in `Text $text='warning'`.
- Meter: `Progress aria-label='Changed pixels' value={Math.sqrt(ratio)} $thickness={1} fill={{ $layer: 'warning' }}` and beside it `Text className='tabular-nums'` with the ratio and the pixel count.
- Then two ink 70 lines: the tolerance, and the engine with `Button $size='xs'` `Copy debug info` at the end.

**Copy** (about 10 words): sizes, `+22 px`, `0.15% · 1,420 px`, `tolerance 0.2 · max 0 px`, the engine name, `Copy debug info`. Empty map: `No baseline` or `No current image`.

**Behavior and keys**

- A click on a region calls `viewer.setRegion(index)` (lab only). No key is bound here; the lab viewer has its own keys.
- The values follow the selection.

**Scenarios**

- changed: one outline, two or more small regions, a short meter.
- size-changed: as in the sketch; the meter is replaced by the text `Size changed`.
- added: one solid outline filled with `$layer='success' $mix={20}` and a `Plus`; the text `Added · Auto-approved`.
- removed: one dashed outline with a `Minus`; the text `Removed · Auto-approved`.
- decided: the changed picture, and a last line `Approved by @morikenji · 3 min ago`.
- failed: an empty dashed box with `ImageOff` and the sentence `The comparison has no images.`
- not-uploaded: one outline with no regions; `4 px · within tolerance`; `Current not uploaded`.
- expired: an empty dashed box with `ImageOff`; `Images deleted`; the decision line.
