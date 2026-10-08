# Skeleton placeholder (skeleton)

Group: system
Question: How should a placeholder look before the content arrives?
Description: The placeholder pieces (rows, image wells, meters) alone in a 360 px cell: at rest, after a long wait, and at the moment the content arrives.
Layout: row

## Scenarios

- `run-rows` (Run rows): Five Queue rows; the real row is one line with a status mark, a number, a title, a count, and a time.
- `screenshot-rows` (Screenshot rows): Eight list rows with a thumbnail and a name; real names are long and truncate.
- `image-pair` (Image pair): Baseline and current wells for a 1280 × 720 screenshot whose size is known.
- `tall-image` (Tall image): One 800 × 1600 screenshot: the well keeps the ratio and stays inside the cell.
- `status` (Status): Two capacity meters and three alert rows.
- `long-wait` (After 4 s): The run rows after 4 s: how the design says that the wait is long.
- `arrives` (Content arrives): A loop of 2 s of placeholder, then the real rows: the swap may not move anything.
- `reduced-motion` (Reduced motion): The run rows with reduced motion: nothing pulses, sweeps, or blinks.

## Variant `still-blocks`: Still blocks

Static blocks at one lightness step with the exact row geometry; no motion at all.

Ideas:

- Minimal: one `Frame` recipe and no animation.
- Text blocks sit in a `1lh` box, so the swap moves nothing.
- The image well prints its size, which is known before the pixels.

Tradeoffs:

- A still page can look stuck before the 3 s text arrives.
- On the light canvas the blocks need `$lightnessOffset`, not `$lighten` (pitfall 10).

### Spec

```text
(o) [====] [==================]        [==] [===]
(o) [====] [=============]             [==] [===]
(o) [====] [================]          [==] [===]

+------------------+ +------------------+
|    1280 × 720    | |    1280 × 720    |
+------------------+ +------------------+
```

**Build.** Cell `w-[22.5rem]`. Wrapper `aria-busy='true' aria-label='Loading runs'`; every block is `aria-hidden`.

- Block: `Frame $lightnessOffset={1} $rounded='sm'`. A text block is `h-[0.7em]` in a `flex h-[1lh] items-center` box. Widths by row index: `w-2/3`, `w-1/2`, `w-3/5`, `w-2/5`, `w-3/4`.
- Run row `h-10`: mark `size-4` (`$rounded='full' $forceRounded`), number `w-12`, title `flex-1`, count `w-8`, time `w-12`. Screenshot row `h-11`: thumbnail `w-7 h-5`, name `flex-1`, count `w-6`.
- Well: `Frame $darken $border` with `style={{ aspectRatio: width / height }}` and a centered `Text className='ak-ink-40 font-mono text-xs tabular-nums'` size label. The tall well has `max-h-80` and is centered.
- Meter: label block, `Frame` bar `h-1.5 w-full`, value block.

**Copy.** `Still loading…` after 3 s. Words: 0, then 2.

**Behavior.** Blocks go from opacity 0 to 1 in 150 ms, starting at 150 ms. No other motion.

**Scenarios.**

- `run-rows`, `screenshot-rows`, `image-pair`, `tall-image`, `status`: as sketched, with the geometry above.
- `long-wait`: one more row: `ProgressCircular` in a `size-[1lh]` span and `Still loading…` (`ak-ink-60 text-sm`).
- `arrives`: content replaces blocks in one frame.
- `reduced-motion`: the same picture.

## Variant `pulse-lines`: Pulse lines

Pulsing lines in two strengths with a short stagger, and a list that fades out downward to say that more follows.

Ideas:

- The lab recipe (`animate-pulse`) with an 80 ms stagger for each row (PRIM-R12, DASH-C6).
- Two strengths: the title line is stronger than the meta line.
- The list fades to nothing at the bottom, so the row count is never a promise.

Tradeoffs:

- A pulse on 12 rows for 6 s is tiring.
- The fade hides how long the real list is.

### Spec

```text
(o) [====] [##################]        [==] [===]    100 %
(o) [====] [#############]             [==] [===]     80 %
(o) [====] [################]          [==] [===]     55 %
(o) [====] [###########]               [==] [===]     30 %
                 (fades out)
```

**Build.** Cell `w-[22.5rem]`. Geometry as in `still-blocks`: run row `h-10`, screenshot row `h-11`, text blocks `h-[0.7em]` in a `1lh` box, wells from `width` and `height`.

- Primary line: `Frame $lightnessOffset={2} $rounded='sm'`. Other blocks: `$lightnessOffset={1}`.
- All blocks: `animate-pulse motion-reduce:animate-none` with `style={{ animationDelay: index * 80 + 'ms' }}` for each row.
- List wrapper: `[mask-image:linear-gradient(black_45%,transparent)]`.
- Well: the whole `Frame $darken` pulses; no label.
- Wrapper `aria-busy='true' aria-label='Loading runs'`; blocks `aria-hidden`.

**Copy.** `Still loading…` after 3 s.

**Scenarios.**

- `run-rows`, `screenshot-rows`: as sketched.
- `image-pair`, `tall-image`: pulsing wells; the tall well has `max-h-80`.
- `status`: meter bars pulse; alert rows as run rows.
- `long-wait`: the pulse goes on; a centered `Still loading…` sits over the faded part.
- `arrives`: content fades in over 120 ms and the mask goes away.
- `reduced-motion`: no pulse; blocks stay at 70 % opacity.

## Variant `sweep`: Sweep

One band of light crosses all blocks in step, from start to end, like a scanner.

Ideas:

- A single direction of motion reads as progress, not as a heartbeat.
- All blocks share one clock and one position, so the group moves as one surface.
- The sweep slows down after 3 s.

Tradeoffs:

- The most motion of all variants.
- Needs one local keyframe; the primitives have no sweep.
- A sweep suggests a known duration that does not exist.

### Spec

```text
(o) [==/ /=] [==========/ /=====]      [==] [===]
(o) [==/ /=] [==========/ /]           [==] [===]
(o) [==/ /=] [==========/ /===]        [==] [===]
            ----->  one band, 1.4 s
```

**Build.** Cell `w-[22.5rem]`. Geometry as in `still-blocks`.

- Block: `Frame $lightnessOffset={1} $rounded='sm' className='relative overflow-clip'`.
- Band inside each block: `Frame $lightnessOffset={3}` with `absolute inset-y-0 w-24 [mask-image:linear-gradient(90deg,transparent,black,transparent)]`. Each block sets `--x` to its offset in the cell, and the band position is the cell position minus `--x`, so all bands are at the same place in the cell.
- Keyframe `sweep` in the variant file: from `-6rem` to the cell width, `1.4s linear infinite`, `motion-reduce:animate-none`.
- Wells: the same band over `Frame $darken`.
- Wrapper `aria-busy='true'`; blocks `aria-hidden`.

**Copy.** `Still loading…` after 3 s.

**Scenarios.**

- `run-rows`, `screenshot-rows`, `status`: as sketched.
- `image-pair`: the band crosses both wells as one. `tall-image`: `max-h-80`.
- `long-wait`: the duration becomes 2.8 s; `Still loading…` under the rows.
- `arrives`: the band finishes its pass, then content appears.
- `reduced-motion`: no band; static blocks.

## Variant `known-parts`: Known parts, blank values

Everything that is known before the answer is real text; only the values are blank marks.

Ideas:

- Headings, column names, pane captions, and units are true at 0 ms, so they are not placeholders.
- No gray boxes: a run of dashes stands for each unknown value.
- One small ring beside the heading is the only activity sign.

Tradeoffs:

- It reads like an empty page, not like a loading page, if the ring is missed.
- It works only where the static parts are many (tables, the viewer).
- Row counts are not known, so the rows are few.

### Spec

```text
To review  (o)
Run                                Changes   When
#––––  –––––––––––––––––––             ––    –– min ago
#––––  ––––––––––––––                  ––    –– min ago

Baseline  –––– × ––––     Current  –––– × ––––
+ - - - - - - - - - +     + - - - - - - - - - +
```

**Build.** Cell `w-[22.5rem]`.

- Real text: group heading (`Heading className='mt-0 mb-0 text-sm'`), column heads, pane captions `Baseline` and `Current`, meter labels `Database` and `Active runs`, and the units `min ago` and `×`.
- Unknown value: `Text aria-hidden className='ak-ink-40 font-mono'` with a fixed run of en dashes.
- Activity: `ProgressCircular $thickness={0.75}` in a `size-[1lh]` span beside the heading, `aria-label='Loading runs'`.
- Wells: `Frame $border $borderType='dashed'` with the ratio of the image. No fill.
- Three rows only.

**Copy.** Only words that the loaded page also shows. After 3 s the heading reads `To review · still loading…`.

**Scenarios.**

- `run-rows`: as sketched.
- `screenshot-rows`: the filter field is real and `disabled`; rows are dashes.
- `image-pair`, `tall-image`: captions and dashed wells; the sizes are real when the model has them.
- `status`: `Database –– of –– MiB` with `Progress value={0}`.
- `long-wait`: the heading text above.
- `arrives`: values replace dashes in place.
- `reduced-motion`: the ring becomes a static `Loader` icon.

## Variant `ghost-glyphs`: Glyph ghost

Placeholders are text: runs of a block glyph in the real type, so size, density, and line height follow with no geometry.

Ideas:

- A placeholder that is typeset cannot drift from the real row.
- JetBrains Mono gives every value a countable width.
- A caret blinks at the first unknown value: one small sign of life.
- Not proposed by the audit lanes.

Tradeoffs:

- A terminal look that may not fit a quiet direction.
- Glyph runs need `aria-hidden` and must not be selectable.
- The glyph needs a font that has it; JetBrains Mono does.

### Spec

```text
o  #░░░░  ░░░░░░░░░░░░░░░░░░░░▍        ░░  ░░ min
o  #░░░░  ░░░░░░░░░░░░░░               ░░  ░░ min
o  #░░░░  ░░░░░░░░░░░░░░░░░            ░░  ░░ min

+-                -+
     1280 × 720
+-                -+
```

**Build.** Cell `w-[22.5rem]`.

- Value: `Text aria-hidden className='font-mono ak-ink-20 select-none'` with a run of `░`. Lengths by row index: 20, 14, 17, 11, 19.
- Caret: `▍` after the first run, `animate-pulse motion-reduce:animate-none`.
- Well: a box with the image ratio and four corner marks (`span` with `absolute size-2 border-s border-t` and its three rotations, on an element with a layer so that the edge color adapts); the size label in the center (`font-mono text-xs ak-ink-40`).
- Meter: `Database ░░░ of ░░░░ MiB` and a row of 20 `░` as the bar.
- Wrapper `aria-busy='true' aria-label='Loading runs'`.

**Copy.** `still loading…` after 3 s (lower case, as a typed line).

**Scenarios.**

- `run-rows`, `screenshot-rows`, `status`: glyph runs in the real row layout.
- `image-pair`, `tall-image`: corner marks and the size label.
- `long-wait`: a last line types in at one character each 40 ms: `still loading…`.
- `arrives`: each run is replaced by its value, row by row, 30 ms apart.
- `reduced-motion`: a static caret, no typing, one swap.

## Variant `develop`: Develop

The placeholder is a blurred copy of the real thing that sharpens: the thumbnail for an image, the last known text for a row.

Ideas:

- The model already has a 256 px thumbnail for each variant (VIEW-11 alternative b).
- The swap is a change of focus, not a replacement, so nothing moves.
- With no earlier data the piece falls back to still blocks.

Tradeoffs:

- Blurred text is unreadable on purpose and can annoy.
- Row text needs data from an earlier visit (see `cached-first`); a first visit has only blocks.
- CSS blur on many rows costs paint time.

### Spec

```text
o  #4863  (blurred: Migrate component ex...)   24  12 min
o  #4831  (blurred: Update dependency @pl...)  79   1 h

+------------------+ +------------------+
| thumbnail, blur  | | thumbnail, blur  |
+------------------+ +------------------+
```

**Build.** Cell `w-[22.5rem]`.

- Image: `Frame $darken overflow-clip` with the image ratio; the `thumbnail` as `img` with `size-full object-cover blur-md scale-105`; the full image above it, opacity 0 to 1 in 150 ms on decode.
- Row with earlier data: the real row with `blur-[3px] ak-ink-40 select-none`, `aria-hidden`, and `inert` until fresh.
- Row without earlier data: the blocks of `still-blocks`.
- Wrapper `aria-busy='true' aria-label='Loading runs'`.

**Copy.** `Still loading…` after 3 s.

**Scenarios.**

- `run-rows`, `screenshot-rows`: blurred earlier rows.
- `image-pair`, `tall-image`: blurred thumbnails of the `dialog` and `form` scenes.
- `status`: meters at their last values, blurred.
- `long-wait`: the blur stays; `Still loading…` under the rows.
- `arrives`: blur to 0 over 150 ms.
- `reduced-motion`: no transition; one swap.
