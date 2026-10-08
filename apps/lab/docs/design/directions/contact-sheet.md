# Contact sheet: design brief

This brief is complete alone. It uses six builder words that never appear in the UI: **sheet** (the grid of one run), **strip** (the frames of one screenshot, joined), **frame** (one changed variant as a thumbnail), **cursor** (the frame with keyboard focus), **loupe** (the full-window viewer of one frame), and **dock** (the bottom bar). UI copy uses only the product words of the ui-copy terminology table: screenshot, variant, change, run, baseline, current, diff, side by side, added, removed, approve, reject, needs review, Queue, History, Status, alert, read-only.

Variant identifier for all six page surfaces: `contact-sheet` (the lab surface for the Queue is `inbox`).

## 1. Concept

**Name:** Contact sheet

**Tagline:** The whole run on one sheet: scan it, mark it, and zoom in only when in doubt.

**The idea in five sentences.** A run opens as one sheet of frames: each frame is one changed variant, cropped to the change, with the diff painted on it. The frames of one screenshot join into a strip, and strips pack into rows like words in a paragraph, so most runs fit on one or two screens and no list is necessary. The maintainer marks the sheet like a photo editor: select frames with the keyboard, a click, or a drag, then approve or reject the selection as one decision. A frame in doubt opens in the loupe, a full-window viewer with overlay, side by side, swipe, and blink, and Escape returns to the same place on the sheet. The same three steps (overview, mark, zoom) shape each page: the Queue is a board of runs with preview frames, History is a sheet of run tiles, and Status is a board of alerts.

**Signature moment.** Hold `B` on the sheet. Each frame shows its baseline while the key is down, and the current image returns on release. Twenty changes flicker at the same time, and the eye finds the one that is wrong.

**Five principles.**

1. **Overview before detail.** Each page first shows all of its things on one screen. `Enter` zooms in one level (runs, changes, pixels) and `Escape` zooms out.
2. **The frame shows the change, not the page.** Crop to the changed region at a readable scale and paint the diff on it. A shrunken full screenshot is not evidence.
3. **Marks, not words.** A verdict is a stamp on the frame. Each count lives one time, on a filter chip. Frames that need review are bright and decided frames fade.
4. **Nothing moves when you decide.** The sheet keeps its layout, so place is memory. Sorting runs at load and on request. After a decision only the cursor moves.
5. **Seen before decided.** A frame takes a decision only after its images decoded on screen. Each decision is one undoable command with a visible count and no confirmation dialog.

## 2. Visual system

All colors come from layer props and status roles. No literal colors, no pixel values in classes. Root of each page: `Shell className="text-sm"` (14 px base), so one spacing step is 3.5 px and `$height="sm"` bars are 49 px. All numbers below use this base.

### Layers and borders

| Surface                                           | Layer                                                                                                                                                                      | Edge                                                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page (dashboard pages)                            | canvas (`body`)                                                                                                                                                            | none                                                                                                                                                       |
| Bars: top bar, sheet bar, dock                    | `$layer` (paints the parent color to cover scrolling content)                                                                                                              | one seam each (`border-b` or `border-t`). These three seams are the only lines of the run page chrome                                                      |
| Sheet well (scroll area of a run) and loupe stage | `Frame $darken` (sunken, like a light table)                                                                                                                               | none                                                                                                                                                       |
| Strip                                             | `Frame $lightnessOffset $rounded="lg" $p={1}` on the well                                                                                                                  | none. The tone step shows which frames belong together                                                                                                     |
| Frame (thumbnail)                                 | image on `Frame $darken={2}`                                                                                                                                               | `$border` always (ring on light, border on dark), so a dark screenshot has a visible edge on a dark well. Selected: `$border={2} $edge="brand"` from state |
| Run card (Queue, Pull)                            | `Frame`/`Button` with `$lightnessOffset $rounded="2xl" $p={2}`; its preview strip is a `$darken` well inside                                                               | `$border` in light only (pitfall 10)                                                                                                                       |
| Tile (History, alerts, slugs)                     | `Button $lightnessOffset $rounded="lg"`; tinted `$layer={role} $mix={12}` when a person must act                                                                           | none                                                                                                                                                       |
| Popover, dialog                                   | primitives defaults (raised, border, shadow)                                                                                                                               | default                                                                                                                                                    |
| Dock with a selection                             | `$layer="brand" $mix={15}` from state                                                                                                                                      | seam                                                                                                                                                       |
| Brand fill                                        | exactly one control for each view: `Approve` (sheet, loupe), `Review 22` (pull), `Sign in with GitHub` (sign-in). The selection ring and the selected check also use brand |                                                                                                                                                            |

Borders are used on frames (evidence needs an edge) and nowhere else as decoration. Cards and tiles separate by tone.

### Type

Inter Variable for all UI text. JetBrains Mono Variable for values that a person compares or copies: frame numbers, change ratios, pixel sizes, commit hashes, pull request numbers, counts on chips, and `Kbd`.

| Step  | Class       | Use                                                                                                                                       |
| ----- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 12 px | `text-xs`   | frame captions (mono), strip labels (Inter, weight 500), chips, key legend, day labels. This is the smallest size. No 10 px or 11 px text |
| 14 px | `text-sm`   | body, buttons, titles in bars, card titles (weight 500)                                                                                   |
| 16 px | `text-base` | section labels on dashboard pages (weight 600), popover headings                                                                          |
| 20 px | `text-xl`   | one line for each empty or error state (weight 600)                                                                                       |
| 24 px | `text-2xl`  | sign-in title only                                                                                                                        |

Sentence case everywhere. No uppercase labels with letter spacing. `tabular-nums` on each number that can change. Secondary text is `ak-ink-60` or `ak-ink-70`.

### Spacing, density, radius

- Page gutter and sheet padding: step 4. Gap between strips in a row: step 3. Gap between rows: step 4. Gap between frames in a strip: step 1.
- Frame sizes are a CSS variable on the sheet: S `--frame: --spacing(42)` (147 px), M `--spacing(64)` (224 px, default), L `--spacing(98)` (343 px). Aspect ratio 3:2. At 1440 px this gives 9, 6, and 4 frames in a row. The density control of the lab scales them.
- Radius: frames `sm` (a screenshot stays a rectangle), strips `lg`, tiles `lg`, cards `2xl` with `$p={2}` (inner frames then get about 7 px), chips `full`, bars none.

### Icons

lucide-react at stroke 1.5, 16 px in controls and 14 px in captions. Framework and browser marks from `src/fixtures/icons` at 14 px in frame captions and loupe labels. Color scheme: `Sun`, `Moon`. More contrast: `Contrast`. Forced colors: `Blend`. Each icon-only control has an `aria-label` and a `Tooltip` that shows its key in a `Kbd`.

### Status vocabulary (one for run states and variant verdicts)

| Name                             | Applies to                  | Color role            | Shape (lucide)                                                                 | On a frame, card, or tile                                            |
| -------------------------------- | --------------------------- | --------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Needs review                     | run, variant                | warning               | `Circle` (ring)                                                                | no stamp, full brightness                                            |
| Rejected                         | run, variant                | danger                | `CircleX`                                                                      | cross stamp, danger edge, full brightness (it still fails the check) |
| Approved (variant), Passed (run) | both                        | success               | `CircleCheck`                                                                  | check stamp, image at 45% opacity                                    |
| Auto-approved                    | added and removed variants  | neutral (`ak-ink-60`) | `CircleCheck` plus a corner tag `Plus` (success text) or `Minus` (danger text) | image at 45% opacity, caption says `Added` or `Removed`              |
| Unchanged                        | variant                     | neutral               | `Equal`                                                                        | image at 45%, no diff paint. Hidden until its chip is on             |
| Comparing                        | run, variant                | neutral               | `LoaderCircle` (spins; static `CircleDashed` with reduced motion)              | pulsing empty well                                                   |
| Capturing                        | run                         | neutral               | `Aperture`                                                                     | empty frames with a determinate ring                                 |
| Failed                           | run, variant without images | danger                | `TriangleAlert`                                                                | danger-tinted empty well, caption `No images`                        |
| Rerun needed                     | run                         | warning               | `RotateCw`                                                                     | tile only                                                            |
| Replaced                         | run (read-only)             | neutral               | `ChevronsRight`                                                                | tile only, faded                                                     |

Each state has a different shape, so color is never the only signal. The eight run words are exactly: Needs review, Rejected, Passed, Capturing, Comparing, Rerun needed, Replaced, Failed. Each mark has a text alternative, and the accessible name of a frame is the full label, for example "Dialog with initial focus, React, Chromium, Dark, 0.05% changed, needs review".

Brightness is the second channel: a thing that needs a person is at full ink and may have a tint, and a thing that is done is at 45% (images) or `ak-ink-60` (text). This rule is the same on the sheet, the Queue, History, and Status.

### The frame

```text
┌──────────────────────────┐
│◯                       ⤢ │  check (top left) and open (top right). Both show on hover and focus; the check always shows while a selection exists and on touch
│        ┌╌╌╌╌╌╌╌╌┐        │
│        ┆▒▒▒▒▒▒▒▒┆   +2   │  region box (1.5 px, danger) around the painted diff; "+2" when two more regions are outside the crop
│        └╌╌╌╌╌╌╌╌┘        │
│ ✓ ✕                    ✓ │  quick approve and reject (hover only, bottom left); stamp (bottom right)
└──────────────────────────┘
 07  ⚛ ◎ ☾            0.05%   caption, mono 12 px: frame number, axis marks, change ratio
```

- **Picture.** Three stacked layers in one transformed box: the current image, the diff mask painted in the danger color (CSS `mask-image` with the mask URL over a danger-colored layer, so the paint follows the theme; fallback: the red mask image as it is), and region boxes drawn in frame coordinates so that their stroke does not scale.
- **Crop rule.** Picture mode `Change` (default): take the union of the changed regions, add 24 px on each side, and scale it to fit the frame, but never above 200% and never above the point where the union leaves the frame. If the union needs a scale under 50% and there are several regions, crop to the first region and show `+N` for the others. Picture mode `Whole`: fit the full screenshot and keep the region boxes. A frame without regions (added, removed, size changed, unchanged) shows the whole image.

  ```ts
  const box = picture === "whole" || !regions.length ? whole : pad(union(regions), 24, image);
  const scale = Math.min(frame.width / box.width, frame.height / box.height, 2);
  ```

- **Special frames.** Size changed (the `disclosure` scene, 640 × 400 to 640 × 422): whole image, the extra area hatched, caption `+22 px` in place of the ratio. Added: whole current image, corner tag `+`, caption `Added`. Removed: whole baseline image, corner tag `−`, caption `Removed`. Image load failure: `ImageOff`, a `Retry` button, not selectable (a load failure is an error, not a result).
- **Frame number.** The position of the change in run order, two digits. It is stable under sorting, and it is the position text in the loupe (`07 / 33`).
- **Sizes.** At S the caption keeps the number and the ratio and shows the axis marks on hover and in the dock.

### Motion

| What moves                     | How                                                                                                               | Reduced motion                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Open and close the loupe       | The frame picture grows to the stage (View Transitions API with a shared `view-transition-name`), 220 ms ease-out | Instant swap                                  |
| Stamp after a decision         | The stamp scales from 1.3 to 1 in 120 ms and the image fades to 45% in 160 ms                                     | Opacity change only                           |
| Blink                          | Instant swap, no fade (a fade hides a 1 px shift)                                                                 | Same. Automatic alternation is off; hold only |
| Thumbnails arriving            | Fade in 150 ms when decoded                                                                                       | No fade                                       |
| Skeleton                       | `animate-pulse`                                                                                                   | Static                                        |
| Cursor move, scroll to a frame | `scrollIntoView({ block: "nearest" })`, instant. No smooth scrolling                                              | Same                                          |
| Dock state change              | Tint cross-fade 120 ms; numbers never change the width of the bar                                                 | Instant                                       |

## 3. Shell and navigation model

**Three zoom levels, two keys.** Queue (runs) → sheet (changes of one run) → loupe (pixels of one change). `Enter` opens the focused thing. `Escape` goes back from the loupe to the sheet, clears a selection, and closes popovers. `Escape` never rejects and never leaves a run.

**Always on screen:** one top bar, 49 px (`ShellHeader $height="sm"`).

- Dashboard pages (Queue, History, Status): brand mark and name, then `Nav $layout="horizontal" glider={{ $kind: "bar" }}` with `Queue` (count of runs to review in a badge slot), `History`, `Status` (danger badge with the alert count when it is above 0), then the keys button `?` and the account button.
- Run pages (pull, sheet, loupe): brand mark (link to the Queue), then a breadcrumb `ButtonGroup $size="sm"` with `ButtonSeparator $kind="chevron"`: `Queue › #4863 Migrate component… › Dialog with initial focus`. The last crumb exists only in the loupe. A click on a crumb zooms out to it. Then the commit and attempt in mono (`a1b2c3d · attempt 2`, attempt only when above 1), a link icon to GitHub, the keys button, an alert button (only when alerts exist; it opens a popover with the alert titles and a link to Status), and the account button.
- A 2 px progress line sits on the bottom edge of the top bar of a run: three `Frame` segments (success, danger, and a neutral track) with `role="img"` and a label such as "3 approved, 2 rejected, 22 need review". It stays visible in the loupe.

**Account.** A button with an avatar slot opens an `ak.Menu`: the login name as text, `Keys`, `Sign out`.

**URL model (product).** `/` Queue. `/history`. `/status`. `/pulls/$number`. `/runs/$runId` is the sheet, with `filter`, `q`, `group`, and `sort` as search parameters (replace, not push). `/runs/$runId?item=<key>&variant=<key>` is the loupe on that variant, so the existing deep links keep working; `mode` and `zoom` are optional. Opening the loupe pushes one history entry, so the browser Back button returns to the sheet. Moving inside the loupe replaces the entry. Frame size and key hints are personal settings in local storage. The lab has no router state for this: use React state.

**Page titles.** `Queue (4) · Visonaut`. `History · Visonaut`. `Status · 3 alerts · Visonaut`. `#4863 Migrate component examples… · Visonaut` (pull). `22 left · #4863 Migrate component… · Visonaut` (sheet). `Dialog with initial focus · React Chromium Dark · #4863 · Visonaut` (loupe). `Sign in · Visonaut`.

```text
Desktop, dashboard page                                   Desktop, run page
┌──────────────────────────────────────────────────┐      ┌──────────────────────────────────────────────────┐
│ ◉ Visonaut   Queue 4   History   Status ②   ? DH │ 49   │ ◉ Queue › #4863 Title… ↗   a1b2c3d·2   ? ⚠ DH    │ 49
├──────────────────────────────────────────────────┤      │▓▓▓▓▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│                                                  │      ├──────────────────────────────────────────────────┤
│        page content, max width 80rem,            │      │ filter chips                  filter group sort  │ 49
│        the page scrolls                          │      ├──────────────────────────────────────────────────┤
│                                                  │      │        sheet well (scrolls), or loupe stage      │
│                                                  │      ├──────────────────────────────────────────────────┤
└──────────────────────────────────────────────────┘      │ cursor label     key legend      Reject  Approve │ 49
                                                          └──────────────────────────────────────────────────┘
Phone, dashboard page            Phone, run page
┌──────────────────────────┐     ┌──────────────────────────┐
│ ◉  Queue 4 History Status│ 49  │ ‹  #4863 Migrate co…  ⋯  │ 49
├──────────────────────────┤     │▓▓▒░░░░░░░░░░░░░░░░░░░░░░░│
│ content, one column      │     ├──────────────────────────┤
│                          │     │ chips (scroll sideways)  │ 49
│                          │     ├──────────────────────────┤
│                          │     │ sheet, two frames wide   │
│                          │     ├──────────────────────────┤
└──────────────────────────┘     │ 22 left   Reject Approve │ 56
                                 └──────────────────────────┘
```

On a phone the nav shows the three words without icons, the account button moves into the `⋯` menu on run pages, and no key hints render (pointer: coarse).

## 4. Page specs

### 4.1 Review workspace (surface `review`)

One `Shell className="h-dvh text-sm"` (the fixed app frame recipe) with two states of the same page: the sheet and the loupe. The sheet stays mounted (`hidden` and `inert`) while the loupe is open, so its scroll position and decoded images stay.

#### Sheet at 1440 × 900

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ Queue › #4863 Migrate component examples to the new style recipes ↗       a1b2c3d · attempt 2   ?  ⚠  DH  │ 49
│▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (○ Needs review 22)(✕ Rejected 2)(✓ Approved 3)(± Auto-approved 6)(= Unchanged 7)  [⌕ Filter /][Screenshot ▾][Largest ▾][View ▾]│ 49
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Disclosure list 2                 Account form 2                    Actions menu 2                         │
│ ╭───────────────────────────────╮ ╭───────────────────────────────╮ ╭───────────────────────────────╮      │
│ │┏━━━━━━━━━━━━━┓┌─────────────┐ │ │┌─────────────┐┌─────────────┐ │ │┌─────────────┐┌─────────────┐ │      │
│ │┃○           ⤢┃│             │ │ ││  ┌╌╌╌╌╌╌┐   ││  ┌╌╌╌╌╌╌┐   │ │ ││ ┌╌╌╌╌┐      ││ ┌╌╌╌╌┐      │ │      │
│ │┃             ┃│             │ │ ││  ┆▒▒▒▒▒▒┆ +3││  ┆▒▒▒▒▒▒┆ +3│ │ ││ ┆▒▒▒▒┆      ││ ┆▒▒▒▒┆      │ │      │
│ │┃▨▨▨▨▨▨▨▨▨▨▨▨▨┃│▨▨▨▨▨▨▨▨▨▨▨▨▨│ │ ││  └╌╌╌╌╌╌┘   ││  └╌╌╌╌╌╌┘   │ │ ││ └╌╌╌╌┘     ✕││ └╌╌╌╌┘     ✕│ │      │
│ │┗━━━━━━━━━━━━━┛└─────────────┘ │ │└─────────────┘└─────────────┘ │ │└─────────────┘└─────────────┘ │      │
│ │ 30 ⚛◎☀ +22 px  31 ⚛◎☾ +22 px  │ │ 28 ⚛◎☀ 31.2%   29 ⚛◎☾ 31.0%   │ │ 11 ⚛◎☀ 0.61%   12 ⚛◎☾ 0.60%   │      │
│ ╰───────────────────────────────╯ ╰───────────────────────────────╯ ╰───────────────────────────────╯      │
│  Dialog with initial focus 6                                                                                │
│ ╭─────────────────────────────────────────────────────────────────────────────────────────────────╮        │
│ │┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐        │        │
│ ││    ┌╌╌╌┐    ││    ┌╌╌╌┐    ││    ┌╌╌╌┐    ││    ┌╌╌╌┐    ││    ┌╌╌╌┐    ││    ┌╌╌╌┐    │        │        │
│ ││    ┆▒▒▒┆    ││    ┆▒▒▒┆    ││    ┆▒▒▒┆    ││    ┆▒▒▒┆    ││    ┆▒▒▒┆    ││    ┆▒▒▒┆    │        │        │
│ ││    └╌╌╌┘    ││    └╌╌╌┘    ││    └╌╌╌┘    ││    └╌╌╌┘    ││    └╌╌╌┘    ││    └╌╌╌┘    │        │        │
│ │└─────────────┘└─────────────┘└─────────────┘└─────────────┘└─────────────┘└─────────────┘        │        │
│ │ 01 ⚛◎☀ 0.05%   02 ⚛◎☾ 0.05%   03 ⚛🦊☀ 0.05%  04 ⚛◈☀ 0.05%   05 ◆◎☀ 0.05%   06 ⚛◎▣ 0.05%          │        │
│ ╰─────────────────────────────────────────────────────────────────────────────────────────────────╯        │
│  Combobox with auto select, inline autocomple… 3      Tabs 2                                    (more rows) │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 30 · Disclosure list · React · Chromium · Light · +22 px    ↑↓←→ Move  Space Select  ↵ Open  B Blink    [✕ Reject X][✓ Approve A]│ 49
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Loupe at 1440 × 900

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ Queue › #4863 › Dialog with initial focus    ⚛ React · ◎ Chromium · ☾ Dark     07 / 33      ⓘ  ?  ⚠  DH  │ 49
│▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Current 1280 × 720                                                                         change 1 of 1    │
│          ┌────────────────────────────────────────────────────────────────────────────────┐                │
│          │                                                                                │                │
│          │                                                                                │                │
│          │                       one image, 100%, linked pan and zoom                     │                │
│          │                                          ┌╌╌╌╌╌╌╌┐                             │                │ 795
│          │                                          ┆▒▒▒▒▒▒▒┆                             │                │
│          │                                          └╌╌╌╌╌╌╌┘                             │                │
│          │                                                                                │                │
│          └────────────────────────────────────────────────────────────────────────────────┘                │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [▣1✓][▣2 ][▣3 ][▣4 ][▣5 ][▣6 ] │ (Overlay O)(Side by side S)(Swipe W) │ Diff D  Blink B │ Fit 100% 200% │ ✓ Saved ↶ │[✕ Reject X][✓ Approve A]│ 56
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Sheet and loupe at 390 × 844

```text
Sheet                              Loupe
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ ‹  #4863 Migrate compo…   ⋯  │49 │ ‹  Dialog with ini…  07/33 ⓘ │ 49
│▓▓▓▒░░░░░░░░░░░░░░░░░░░░░░░░░░│   │▓▓▓▒░░░░░░░░░░░░░░░░░░░░░░░░░░│
├──────────────────────────────┤   ├──────────────────────────────┤
│ (○ 22)(✕ 2)(✓ 3)(± 6)   ⌕ ⚙ │49 │ Current 1280 × 720           │
├──────────────────────────────┤   │ ┌──────────────────────────┐ │
│ Dialog with initial focus 6  │   │ │   image, fit to width    │ │
│ ╭──────────────────────────╮ │   │ │   pinch to zoom,         │ │ 643
│ │┌───────────┐┌───────────┐│ │   │ │   drag to pan  ┌╌╌┐      │ │
│ ││◯          ││◯          ││ │   │ │                └╌╌┘      │ │
│ ││   ┌╌╌┐    ││   ┌╌╌┐    ││ │   │ └──────────────────────────┘ │
│ ││   └╌╌┘    ││   └╌╌┘    ││ │   │                              │
│ │└───────────┘└───────────┘│ │   ├──────────────────────────────┤
│ │ 01 0.05%     02 0.05%    │ │   │ [▣✓][▣ ][▣ ][▣ ][▣ ][▣ ]  →  │ 52
│ │┌───────────┐┌───────────┐│ │   │ (Baseline)(Current)(Diff)    │ 44
│ ││◯          ││◯          ││ │   │ [  ✕ Reject ][  ✓ Approve  ] │ 56
│ ...                          │   └──────────────────────────────┘
├──────────────────────────────┤
│ 22 left     [Reject][Approve]│56
└──────────────────────────────┘
```

Phone rules: two frames in a row (about 175 × 117 px). The check is always visible with a 44 px hit area. A tap on a frame opens the loupe, and a tap on a check selects. No long press and no swipe gestures on images, so nothing collides with the system image menu. Chips show the mark and the count; the words stay in the accessible names. The dock buttons are disabled until a frame is selected. In the loupe, the image is one pane with pinch and drag only. `Baseline`, `Current`, and `Diff` are one segmented control, and pressing and holding `Baseline` is the blink.

#### Regions and primitives

| Region                                | Primitive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top bar                               | `ShellHeader $height="sm"`: brand `Button` with `render={<LabLink to="inbox" scenario="busy" />}`; crumbs `ButtonGroup $size="sm"` with `ButtonSeparator $kind="chevron"`; mono `Text`; icon `Button`s in `TooltipAnchor`; account `Button` with `ButtonSlot $kind="avatar"` and an `ak.Menu` (popover and option recipes)                                                                                                                                                                     |
| Progress line                         | three `Frame`s (`$layer="success"`, `$layer="danger"`, `$lightnessOffset={2}`) in a 2 px flex row with `role="img"`                                                                                                                                                                                                                                                                                                                                                                            |
| Sheet bar                             | `ShellMainHeader $height="sm"`. Chips: `CheckboxCard $size="sm" $rounded="full" $p={1} $px="lg"` with `CheckboxCardSlot` (mark), `CheckboxCardLabel`, and a count slot (the Filter chips recipe). Filter field: `InputGroup $size="sm"` with `InputSlot $kind="shortcut"` and `Kbd`. Group and sort: `ComboboxProvider`, `ComboboxSelect $layer="transparent" $size="sm"`, `ComboboxPopover`, `ComboboxItem checkmark="after"`. View: `PopoverProvider`, `PopoverDisclosure`, `Popover portal` |
| Sheet                                 | `ShellMain $p={0} $maxWidth="100%"`, `ShellMainBody className="overflow-y-auto"`, one wrapper `Frame $darken role="listbox" aria-multiselectable` with `flex flex-wrap content-start gap-x-3 gap-y-4 p-4`                                                                                                                                                                                                                                                                                      |
| Strip                                 | `div role="group"` with a label row (`Text` 12 px weight 500, `truncate`; count in mono `ak-ink-60`) and `Frame $lightnessOffset $rounded="lg" $p={1} className="flex flex-wrap gap-1"`                                                                                                                                                                                                                                                                                                        |
| Frame                                 | `div role="option" aria-selected tabIndex` with the focus recipe (`focus.jsx({ $focus: true })` from `styles/focus.ts`), inside it a `Frame $border $rounded="sm"` with `relative aspect-[3/2] overflow-clip` and the caption row. Check: round `Button $size="xs"` (`$layer="brand"` when selected). Stamp: icon in `Text $text={role}` on a small round `Frame $layer`. Kind tag: `Badge $forceRounded`. Pointer-only controls inside the option have `tabIndex={-1}` and `aria-hidden`      |
| Dock                                  | `ShellFooter $height="sm"` (`$height="md"` in the loupe and on a phone) with `start`, `center`, `end`. Legend: the Keyboard hint recipe with `Kbd`. Buttons: `Button $border` (Reject) and `Button $layer="brand"` (Approve), each with icon slot, `ButtonLabel`, and `ButtonSlot $kind="shortcut"`                                                                                                                                                                                            |
| Loupe stage                           | `Frame $darken className="relative min-h-0 flex-1 overflow-hidden"` with one transformed canvas `div`. Pane tags: `Badge`. Swipe divider: a native `input type="range"` over the stage with a `Frame` handle                                                                                                                                                                                                                                                                                   |
| Variant switcher in the loupe         | `ButtonGroup` of `Button render={<a aria-current />}` with a small crop, the stamp, and the digit, plus `ButtonGlider`                                                                                                                                                                                                                                                                                                                                                                         |
| Modes, zoom                           | the Segmented control recipe: `ak.RadioGroup render={<ButtonGroup $border $size="sm" />}`, `ak.Radio render={<Button />}`, `ButtonGlider`                                                                                                                                                                                                                                                                                                                                                      |
| Diff and Blink toggles                | `Button aria-pressed` with `$lightnessOffset={pressed ? 2 : undefined}`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Details                               | `PopoverProvider placement="bottom-end"`, `Popover portal`, a `dl` grid, `Button $size="sm"` for `Copy debug info`                                                                                                                                                                                                                                                                                                                                                                             |
| Keys                                  | `DialogProvider`, `Dialog className="flex flex-col gap-4"`, `DialogHeading`, `DialogScroll`, `Kbd`, the Toggle recipe for `Keys on`                                                                                                                                                                                                                                                                                                                                                            |
| Callouts (failed run, expired images) | the Callout recipe: `Frame $layer={role} $mix={12} $border $edge={role} $rounded="xl" $p={3}`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Skeletons                             | `Frame $lightnessOffset={2}` with `animate-pulse` inside an `aria-busy` wrapper                                                                                                                                                                                                                                                                                                                                                                                                                |

```tsx
<Frame
  $darken
  role="listbox"
  aria-multiselectable
  aria-label="Changes"
  onKeyDown={onSheetKeyDown}
  className="flex min-h-full flex-wrap content-start gap-x-3 gap-y-4 p-4"
>
  {strips.map((strip) => (
    <div key={strip.id} role="group" aria-label={strip.name} className="grid max-w-full gap-1">
      <StripLabel strip={strip} />
      <Frame $lightnessOffset $rounded="lg" $p={1} className="flex flex-wrap gap-1">
        {strip.frames.map((frame) => (
          <SheetFrame key={frame.id} frame={frame} />
        ))}
      </Frame>
    </div>
  ))}
</Frame>
```

#### Arranging the sheet

- **Group** (select, default `Screenshot`): `Screenshot` (one strip for each screenshot), `Change size` (strips `Size changed`, `Over 5%`, `0.5% to 5%`, `Under 0.5%`, `Added`, `Removed`), `Browser`, `None` (a plain CSS grid, `grid-template-columns: repeat(auto-fill, var(--frame))`). When the group is not `Screenshot`, the caption gets a second line with the screenshot name.
- **Sort** (select, default `Largest change`): `Largest change`, `Smallest change`, `Run order`, `Name`. With groups, the sort orders the strips by their largest open change and the frames by the same key. Strips where nothing needs review come after the others. Strips that contain only auto-approved frames come last.
- **View** popover: `Size` S, M, L (segmented), `Picture` Change or Whole (segmented), `Diff paint` (switch), `Stack same diffs` (switch with the resulting frame count), `Hide decided` (switch), `Backdrop` dark, light, checker (three icon buttons).
- **Stack same diffs.** Off by default. When on, variants of one screenshot with an equal change (product: equal mask digest and equal size; lab: equal `regions`, equal size, and equal browser) collapse into one frame with a `×4` tag and the union of their axis marks. A decision on a stack decides all of its variants. A click on the tag fans the stack out.
- **Filter chips** are the legend, the counts, and the filter in one control. Default: `Needs review`, `Rejected`, `Approved`, and `Auto-approved` on, `Unchanged` off. `Failed` and `Comparing` chips appear only when such variants exist. The filter field takes words that match the screenshot name, the key, or an axis (`firefox dark dialog`).
- **Unchanged.** With the chip on, unchanged variants join their strips as faded frames without paint. Screenshots with no change at all are a `Disclosure` at the end of the sheet (`472 unchanged`), which holds a dense table of names and opens a frame on request. Do not render thousands of frames.
- **Long names.** A strip label truncates to the strip width. A path name truncates at the head and keeps the last segment (`…/applied-light-week-hover`). The full name and key are in the tooltip, in the dock for the cursor frame, and in the loupe.

#### Selection, decisions, and saving

- **Cursor and selection are different.** The cursor is the frame with focus (roving `tabIndex`, brand focus ring). The selection is a set (brand ring 2 px and a filled check).
- **Pointer.** With no selection, a click on a frame opens the loupe and a click on its check selects it. With a selection, a click on a frame toggles it, a Shift click selects the range, and a double click opens the loupe. A drag that starts on the well draws a rectangle and selects the frames that it touches. A hover on a strip label shows a check that selects the strip.
- **What `A` and `X` decide.** The selection when one exists. If not, the cursor frame. The dock buttons always show the count (`Approve 6`), so the scope is visible before the key press.
- **After a decision.** Stamps appear at once. The selection clears. The cursor moves to the next frame that needs review in sheet order, inside the filter, and wraps one time. If none is left, the completion state shows. No frame changes its place.
- **Whole screenshot.** `Shift+A` and `Shift+X` decide every changed variant of the cursor's screenshot as one command (the whole-item command of the contract). There is no confirmation dialog on any path. The count on the button, the stamps, and Undo are the protection, and they are the same for keys and pointer.
- **Seen before decided.** A frame is selectable when its images decoded and it was on screen. `Cmd/Ctrl+A` selects every open frame in the filter. If some are below the fold and not seen, the dock reads `22 selected · 9 not seen`, `Approve` and `Reject` are disabled, and a `Show` button scrolls to the first of them. Never skip a target silently.
- **The four rules of a multi-target command** (required by the contract audit): (1) each target needs its decoded frame images, on screen; (2) the variant identifiers and expected revisions are frozen at the key press or click; (3) one Undo restores every verdict of the command, the selection, the cursor, and the scroll position; (4) if the server refuses one target, it refuses the command: the stamps go back, the selection stays, the refused frames get a warning edge, and the dock offers `Deselect` and `Refresh`.
- **Save status** has three different marks, in a fixed slot of the dock before the buttons: `Sending 6` with a spinner, `Queued 6` with a cloud mark (tooltip: "Saved on the server soon. You can close this window."), and `Saved` with a check. `Undo` (`Cmd/Ctrl+Z`) appears beside `Saved` and stays until the next decision. It is disabled until the server confirms. The lab hook has only `saving`: show it as `Sending`, and build the `Queued` mark as a static state for the product.
- **Failed save.** The dock takes a danger tint: `Not saved`, `Retry`, `Discard`, and the Error ID in mono. The stamps of that command go back. New decisions are blocked until one of the two buttons is used (`failNextSave`, `retrySave`, `discardFailedSave` in the hook).

Dock states:

| State                                                   | Start                                                                            | Center                                                                                                    | End                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Idle                                                    | cursor label: `07 · Dialog with initial focus · React · Chromium · Dark · 0.05%` | key legend                                                                                                | `Reject X`, `Approve A`                                          |
| Selection (brand tint)                                  | `6 selected`, `Clear Esc`                                                        |                                                                                                           | `Reject 6 X`, `Approve 6 A`                                      |
| Not seen                                                | `22 selected · 9 not seen`, `Show`                                               |                                                                                                           | buttons disabled                                                 |
| Saving                                                  | as idle                                                                          |                                                                                                           | `Sending 6` or `Queued 6`, then `Saved` and `Undo`               |
| Not saved (danger tint)                                 | `Not saved`, Error ID                                                            |                                                                                                           | `Retry`, `Discard`                                               |
| Complete (success tint, or danger tint with rejections) | `All 27 decided`                                                                 | GitHub check state: `Updating the GitHub check`, then `GitHub check passed` or `2 rejected · check fails` | `Next run ↵` (with the number of the next run), `Pull request ↗` |
| Read-only                                               | `Read-only · Replaced by a newer run`                                            |                                                                                                           | `Open the newer run ↵`                                           |
| Comparing                                               | `Comparing 6 of 16` with a determinate `Progress`                                |                                                                                                           | no decision buttons                                              |
| Failed run                                              | `Failed · Rerun the visual tests in CI`                                          |                                                                                                           | `GitHub ↗`                                                       |

#### The loupe

- **Open.** `Enter`, a click, or the open button of a frame. The frame picture grows into the stage. The crop of the frame is the placeholder until the full image decodes. The decision buttons enable when the full images of the current mode are decoded. The next and the previous frame in sheet order preload.
- **Item navigation.** `↑` and `↓` go to the previous or next screenshot and stop at the ends. `J` and `K` go to the next or previous frame in sheet order. `N` and `Shift+N` go to the next or previous frame that needs review. The position text is the frame number (`07 / 33`).
- **Variant switching.** The left part of the dock is the strip of the current screenshot: one small crop for each variant with its stamp and its digit. `←` and `→` move in it and stop at the ends, and `1` to `9` select by position. The full variant label is in the top bar beside the screenshot name. With more than nine variants the strip scrolls and keeps the current one in view.
- **Compare modes.** `Overlay` (`O`, default): one image, the current one, with diff paint and region boxes. `Side by side` (`S`): baseline and current with one shared transform. `Swipe` (`W`): one image with a divider; drag it, or focus it and use the arrow keys. `Diff` (`D`) turns the paint and boxes on or off in each mode. `Blink` (`B`): hold to show the baseline in place of the current image; the dock button latches an automatic blink every 600 ms for pointer users. `F` and `G` stay as keys for current only and baseline only. The mask-only view is removed.
- **Default mode.** `Overlay`, at `Fit`. A size change opens in `Side by side`, aligned at the top left, with the extra area hatched and a badge `640 × 400 → 640 × 422`. An added or removed variant shows one pane with a badge `Added` or `Removed`, and the modes are disabled with a tooltip.
- **Zoom and pan.** One transform for all panes. `Fit`, `100%`, `200%` are buttons; `+` and `−` also reach 50% and 400%; `0` is fit. Drag pans, the wheel scrolls, pinch or `Ctrl`+wheel zooms at the pointer, and `Shift`+arrow pans by half a stage. At 200% and more the image renders with `image-rendering: pixelated`. Zoom, position, and mode stay when the variant changes, if the image size is equal.
- **Changed regions.** `R` and `Shift+R` step through the regions and zoom so that the region fills about 40% of the stage. The counter `change 1 of 3` is in the stage corner.
- **Decisions.** `A` and `X` decide the shown variant and move to the next frame that needs review in sheet order. `Shift+A` and `Shift+X` decide the screenshot. `Cmd/Ctrl+Z` undoes. The save slot and the buttons are the same components as on the sheet.
- **Details.** The `ⓘ` button (`I`) opens a popover: `Changed 1,152 px (0.05%)`, `Size 1280 × 720`, `Tolerance` (the threshold sentence), `Engine`, `Reviewed by` with the time, `Run #4863 · attempt 2 · a1b2c3d`, `Baseline 128`, and `Copy debug info` (identifiers and digests go to the clipboard, not to the screen).
- **Close.** `Escape` or the run crumb. The sheet shows the last frame of the loupe under the cursor, scrolled into view.

#### Scenarios

| Scenario             | What it shows                                                                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes`            | 33 frames in 12 strips at size M: 22 bright, 3 with a check stamp at 45%, 2 with a cross stamp and a danger edge, 6 auto-approved (4 added, 2 removed) faded with corner tags. `Unchanged 7` is off. The cursor starts on the first frame that needs review |
| `large`              | 128 frames in about 40 strips. Rows use `content-visibility: auto` with an intrinsic size. `Stack same diffs` reduces the sheet to about 55 frames. `472 unchanged` is a closed disclosure at the end                                                       |
| `one-change`         | The loupe opens directly, because a sheet with one frame only adds a step. `Escape` shows the sheet with one frame                                                                                                                                          |
| `passed`             | Every frame faded with a check stamp. The dock is in the complete state. A frame can still be opened and rejected                                                                                                                                           |
| `read-only`          | Frames with the stamps of the saved state, no checks, no quick buttons. Dock: `Read-only · Replaced by a newer run` and `Open the newer run`                                                                                                                |
| `comparing`          | Finished frames show. Variants that still compare are pulsing wells with a spinner, and they fill in as results arrive. No selection. Dock: `Comparing 6 of 16`                                                                                             |
| `problems`           | A danger callout above the first strip: `Failed · 5 variants have no images`. Failed variants are danger-tinted wells with the caption `No images`. The variant with a broken image shows `Retry`. Decisions are off                                        |
| `loading`            | See section 5                                                                                                                                                                                                                                               |
| `error` (extra)      | In the well: `The run did not load`, `Retry`, Error ID. The top bar stays                                                                                                                                                                                   |
| `expired` (extra)    | Frames are empty wells with their stamps. One callout: `Images expired`. Read-only dock                                                                                                                                                                     |
| Filter with no match | `No changes match` and `Clear filters`                                                                                                                                                                                                                      |

#### Keys

Sheet:

| Key                   | Action                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `←` `→` `↑` `↓`       | Move the cursor to the nearest frame in that direction. With the default grouping, left and right move between variants and up and down move between screenshots, as in the contract |
| `Home` / `End`        | First or last frame of the row                                                                                                                                                       |
| `Space`               | Select or deselect the cursor frame                                                                                                                                                  |
| `Shift`+arrow         | Move and extend the selection                                                                                                                                                        |
| `Cmd/Ctrl+A`          | Select every open frame in the filter (only while the focus is in the sheet)                                                                                                         |
| `Enter`               | Open the loupe                                                                                                                                                                       |
| `A` / `X`             | Approve or reject the selection, or the cursor frame                                                                                                                                 |
| `Shift+A` / `Shift+X` | Approve or reject the whole screenshot of the cursor                                                                                                                                 |
| `Cmd/Ctrl+Z`          | Undo the last saved decision                                                                                                                                                         |
| `B` (hold)            | Show the baseline in every frame                                                                                                                                                     |
| `D`                   | Diff paint on or off                                                                                                                                                                 |
| `V`                   | Picture: change crop or whole screenshot                                                                                                                                             |
| `+` / `−` / `0`       | Larger frames, smaller frames, fit the run on one screen                                                                                                                             |
| `H`                   | Hide or show decided frames                                                                                                                                                          |
| `N` / `Shift+N`       | Next or previous frame that needs review                                                                                                                                             |
| `/`                   | Filter field                                                                                                                                                                         |
| `?`                   | Keys dialog                                                                                                                                                                          |
| `Escape`              | Clear the selection                                                                                                                                                                  |

Loupe: `↑` `↓` screenshot, `←` `→` variant, `1` to `9` variant by position, `J` `K` next or previous frame, `N` `Shift+N` next or previous that needs review, `A` `X` `Shift+A` `Shift+X` `Cmd/Ctrl+Z` as on the sheet, `O` `S` `W` modes, `F` `G` current only and baseline only, `D` diff paint, `B` blink, `R` `Shift+R` regions, `+` `−` `0` zoom, `Shift`+arrow pan, `I` details, `Escape` back to the sheet.

How a person finds the keys: each button shows its key in a `Kbd` slot. The dock shows the four keys that are new to a first-time user. Each icon button has a tooltip with its key. `?` opens a dialog with four groups (`Move`, `Select`, `Decide`, `Look`) that is rendered from one list. The dialog has the switch `Keys on`, stored in local storage. With the switch off, all `Kbd` hints hide and only `?`, `Tab`, `Enter`, and `Escape` work. Held keys do not repeat a decision. Text fields, menus, and dialogs keep their own keys.

Focus: after a decision the focus stays on the cursor frame. It never jumps to the page root.

#### Exact copy

Sheet, 20 words of chrome (names and numbers are data): `Queue` · `attempt` · `Needs review` · `Rejected` · `Approved` · `Auto-approved` · `Unchanged` · `Filter` · `Screenshot` · `Largest change` · `View` · `Move` · `Select` · `Open` · `Blink` · `Reject` · `Approve`. Budget: 25.

Loupe, 15 words: `Queue` · `Current` · `change` · `of` · `Overlay` · `Side by side` · `Swipe` · `Diff` · `Blink` · `Fit` · `Saved` · `Reject` · `Approve`. Budget: 20.

On demand only: `Sending`, `Queued`, `Saved`, `Undo`, `Not saved`, `Retry`, `Discard`, `selected`, `Clear`, `not seen`, `Show`, `All 27 decided`, `Updating the GitHub check`, `GitHub check passed`, `Next run`, `Pull request`, `Read-only · Replaced by a newer run`, `Open the newer run`, `Comparing 6 of 16`, `Failed · Rerun the visual tests in CI`, `No images`, `Images expired`, `No changes match`, `Clear filters`, `The run did not load`, `Added`, `Removed`, `Baseline`.

#### Pixel budget at 1440 × 900

|                                         | Today      | Sheet                                                                           | Loupe                                                                                                                  |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Chrome above the first screenshot pixel | 408 px     | 137 px (top bar 49, sheet bar 49, padding 14, strip label and strip padding 25) | 63 px (top bar 49, stage padding 14)                                                                                   |
| Chrome in total                         | 469 px     | 147 px (three bars of 49)                                                       | 105 px (49 and 56)                                                                                                     |
| Screenshot share of the viewport        | 13% to 30% | about 50%: 18 complete frames of 224 × 149 px are 46%, plus half a row          | Stage 88%. A 1280 × 720 capture at 100% in Overlay or Swipe is 71%. Side by side shows two images of 702 × 395 px, 43% |

At 390 × 844: the sheet has 154 px of chrome and shows six complete frames (37% of the viewport). The loupe stage is 643 px high (76%); a 1280 × 720 capture at fit width is 362 × 204 px and starts at y = 63.

#### Removed, compared with the current UI

The item sidebar and its "N of M need review" rows. The run header band, the identity row, and the item heading band. The variant chip strip (265 to 413 px for each chip). The mode toolbar row and the captions above the panes. The mask-only view. The eight pan buttons. The sticky action bar in the middle of the page and the footer with keyboard help and the shortcut toggle. The `Accepted (N)` disclosure. The confirmation dialog for the whole item. The disabled `Recompare stored run` button and its sentence. Five of the six places that repeat the review state.

### 4.2 Queue (surface `inbox`)

`Shell className="text-sm"` (the page scrolls), `ShellMain $p="1.5rem" $maxWidth="80rem"`.

```text
1440
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ Visonaut             Queue 4 ▔▔    History    Status ②                                          ?    DH  │ 49
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│   To review 4                                                                        [⌕ Filter      /]  ⟳  │
│   ┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐ ┌───────────────┐ │
│   │╭────────────────────────╮│ │╭────────────────────────╮│ │╭────────────────────────╮│ │╭─────────────╮│ │
│   ││┌──────┐┌──────┐┌──────┐││ ││┌──────┐┌──────┐┌──────┐││ ││┌──────┐┌──────┐┌──────┐││ ││             ││ │
│   │││ crop ││ crop ││ crop │││ │││ crop ││ crop ││ crop │││ │││ crop ││ crop ││ crop │││ ││             ││ │
│   ││└──────┘└──────┘└──────┘││ ││└──────┘└──────┘└──────┘││ ││└──────┘└──────┘└──────┘││ ││             ││ │
│   │╰────────────────────────╯│ │╰────────────────────────╯│ │╰────────────────────────╯│ │╰─────────────╯│ │
│   │ #4863  ✕ 2 rejected  12m │ │ #4831                34m │ │ #4819                 1h │ │ main  9f8e7d6 │ │
│   │ Migrate component examp… │ │ Update dependency @play… │ │ Fix a regression where … │ │ Version Pack… │ │
│   │ ▓▓▓▒▒░░░░░░░░   24 left  │ │ ▓▓▓░░░░░░░░░░   79 left  │ │ ░░░░░░░░░░░░░   12 left  │ │ ░░░░   6 left │ │
│   └──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘ └───────────────┘ │
│                                                                                                            │
│   In progress 2                                       Needs attention 2                                    │
│   ◌ #4855 Fix Tabs selection indic…  Comparing 6/16   ⚠ #4844 Add forced colors styles…   Failed           │
│   ◍ Merge queue #4852 #4849         Capturing 212/600 ↻ main 3c4d5e6 Update the docs…     Rerun needed     │
│                                                                                                            │
│   Baseline 128 · 2 h ago                                                                                   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────┐
│ ◉   Queue 4  History Status ②│ 49
├──────────────────────────────┤
│ To review 4               ⟳  │
│ ┌──────────────────────────┐ │
│ │╭────────────────────────╮│ │
│ ││┌──────┐┌──────┐┌──────┐││ │
│ ││└──────┘└──────┘└──────┘││ │
│ │╰────────────────────────╯│ │
│ │ #4863  ✕ 2          12m  │ │
│ │ Migrate component exam…  │ │
│ │ ▓▓▒░░░░░░░░░░   24 left  │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ ...                          │
│ In progress 2                │
│ ◌ #4855 Fix Tabs…      6/16  │
│ Needs attention 2            │
│ ⚠ #4844 Add forced…  Failed  │
└──────────────────────────────┘
```

| Region        | Primitive                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nav           | `Nav $layout="horizontal" glider={{ $kind: "bar" }}`, `NavLink render={<LabLink … />}`, `NavSlot $kind="badge"`                                                                                                                                                                                                                                                                                                        |
| Section label | `Heading className="mt-0 mb-0 text-base font-semibold"` in a `HeadingLevel`, count in mono `Text className="ak-ink-60"`                                                                                                                                                                                                                                                                                                |
| Board         | `div` with `grid grid-cols-[repeat(auto-fill,minmax(--spacing(80),1fr))] gap-4`, `role="list"`                                                                                                                                                                                                                                                                                                                         |
| Run card      | `Button render={<LabLink to="review" scenario="changes" />} $lightnessOffset $rounded="2xl" $p={2} className="grid w-full justify-stretch gap-2 text-start"`. Preview strip: `Frame $darken className="flex gap-1 p-1"` with three small frames (the crop rule, non-interactive). Meta row: mono number, state mark, age. Title: `ButtonLabel` clamped to two lines. Bar: three `Frame` segments and `24 left` in mono |
| Slugs         | the List row recipe in two columns: `ButtonGroup $layout="vertical"` of `Button $p={3} render={<LabLink … />}` with a state icon slot, label, and a trailing state text; `ButtonGlider $state="hover"` and `$state="focus"`                                                                                                                                                                                            |
| Filter        | `InputGroup $size="sm"` with a `Kbd` `/`; the text filter is not in the app today                                                                                                                                                                                                                                                                                                                                      |
| Refresh       | icon `Button` with a tooltip; `refreshing` keeps the content and spins the icon                                                                                                                                                                                                                                                                                                                                        |

Copy and word count (titles, numbers, and times are data). Budget: 30.

| Scenario    | Copy                                                                                                                                                                                                                   | Words |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `busy`      | `Visonaut` `Queue` `History` `Status` · `To review` `In progress` `Needs attention` · `Filter` · `left` (4 cards) `rejected` · `Comparing` `Capturing` `Failed` `Rerun needed` · `Merge queue` `main` · `Baseline 128` | 27    |
| `single`    | bar · `To review` · `left`                                                                                                                                                                                             | 7     |
| `empty`     | bar · `Nothing to review` · `Baseline 128 · 2 h ago`                                                                                                                                                                   | 9     |
| `first-run` | bar · `No runs yet` · `The first run on main creates the baseline` · `Setup guide`                                                                                                                                     | 17    |
| `loading`   | bar only                                                                                                                                                                                                               | 4     |
| `error`     | bar · `Runs did not load` · `Retry` · `Error ID`                                                                                                                                                                       | 11    |

Scenarios:

- `busy`: four cards (the rejected run first, because it has decisions in progress, then by age), two slugs in progress, two slugs that need attention. A card of a run with a very long title clamps to two lines. A main run shows `main` and the short hash in place of a number, and its title is the commit message.
- `single`: one card at double width with six preview frames. It has the focus, so `Enter` opens it.
- `empty`: one faded empty frame with a check stamp, `Nothing to review`, and the baseline line. No button: History is in the nav.
- `first-run`: the same layout with an empty frame without a stamp, the sentence, and one link.
- `loading` and `error`: section 5. On an error the last known board stays, dimmed, under a one-line danger callout with `Retry`.

Keys: arrows move over cards and slugs in two dimensions, `Enter` opens the run, `/` focuses the filter, `?` opens the keys dialog. The focused card shows a `Kbd` `↵` in its corner.

Removed: the uppercase repository label, the heading "Your review queue." and its sentence, the three stat tiles, the 240 px cards with a "Review changes" button, the text "N views await approval", the full date and time, the footer link "View history", and the `Refresh runs` text button.

### 4.3 History (surface `history`)

```text
1440
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ Visonaut             Queue 4    History ▔▔    Status ②                                          ?    DH  │ 49
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  [⌕ Search runs   /]  (All 40)(Needs review 4)(Rejected 1)(Passed 14)(Failed 2)(Replaced 16)(…)  [Newest ▾] │
│  Today 12                                                                                                  │
│  ┌───────────────────┐┌───────────────────┐┌───────────────────┐┌───────────────────┐┌───────────────────┐ │
│  │✕ #4863        12m ││○ #4831        34m ││◌ #4855         3m ││⚠ #4844         1h ││✓ main 9f8e7d6  2h │ │
│  │Migrate component… ││Update dependency… ││Fix Tabs selectio… ││Add forced colors… ││Version Packages   │ │
│  └───────────────────┘└───────────────────┘└───────────────────┘└───────────────────┘└───────────────────┘ │
│  ┌───────────────────┐┌───────────────────┐ ...                                                            │
│  Yesterday 9                                                                                               │
│  ┌───────────────────┐┌───────────────────┐┌───────────────────┐┌───────────────────┐┌───────────────────┐ │
│  │» #4863 · 1     1d ││✓ #4852         1d ││…                                                              │
│  └───────────────────┘└───────────────────┘                                                                │
│  Latest 100 runs                                                                                           │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────┐
│ ◉   Queue 4  History Status ②│ 49
├──────────────────────────────┤
│ [⌕ Search runs             ] │
│ (All 40)(○ 4)(✕ 1)(✓ 14) →   │
│ Today 12                     │
│ ✕ #4863 Migrate comp…   12m  │ 44
│ ○ #4831 Update depen…   34m  │
│ ◌ #4855 Fix Tabs sel…    3m  │
│ Yesterday 9                  │
│ » #4863 · 1 Migrate…     1d  │
└──────────────────────────────┘
```

| Region        | Primitive                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search        | `InputGroup` with `InputSlot` (`Search`) and `Kbd` `/`                                                                                                                                                                                                                                                                                                                              |
| Status filter | single choice: `ak.RadioGroup render={<ButtonGroup $size="sm" $layout="wrap" />}`, `ak.Radio render={<Button $rounded="full" />}`, `ButtonGlider`. Only the states in `history.states` show, each with its count                                                                                                                                                                    |
| Sort          | `ComboboxSelect $layer="transparent" $size="sm"`: `Newest`, `Most changes`, `State` (not in the app today)                                                                                                                                                                                                                                                                          |
| Day label     | `TextFrame $ink={60} className="text-xs"` from `groupRunsByDay`                                                                                                                                                                                                                                                                                                                     |
| Tile grid     | `grid grid-cols-[repeat(auto-fill,minmax(--spacing(64),1fr))] gap-2`, `role="list"`                                                                                                                                                                                                                                                                                                 |
| Tile          | `Button render={<LabLink to="review" … />} $rounded="lg" $p={2}` with a state icon slot (`$rowSpan={2}`), `ButtonContent`, `ButtonLabel` (mono number, attempt when above 1, age at the end), `ButtonDescription` (title, truncated). Needs review, Rejected, Failed, Rerun needed: full ink and `$layer={role} $mix={12}`. Passed and Replaced: `$lightnessOffset` and `ak-ink-60` |

Tiles are 224 px or wider and 49 px high. 40 runs are 8 rows and fit on one screen at 1440 × 900. 100 runs are 20 rows.

Copy. Budget: 24. `full`: bar (4) · `Search runs` · chip words for the states that exist (up to 12: `All`, `Needs review`, `Rejected`, `Passed`, `Failed`, `Replaced`, `Comparing`, `Capturing`, `Rerun needed`) · `Newest` · `Today` `Yesterday` · `Latest 100 runs` = 24 at most. `no-match`: `No runs match “datepicker”` and `Clear search` (5). `empty`: `No runs yet` (3). `loading`: bar only.

Scenarios: `full` as drawn. `no-match` keeps the search field and the chips (all counts 0) and shows the line and the button in place of the grid. `empty` shows one faded empty tile outline and the line. `loading`: section 5. The extra `error` state: `History did not load` and `Retry`.

Keys: arrows move over tiles in two dimensions, `Enter` opens the run, `/` focuses the search, `Escape` in the field clears it.

Removed: the three-column table with the Created column in long date format, the sentences about the loaded history and the 100-run limit (now one caption), the "Pull request" kind label when a number is present, and the separate result select.

### 4.4 Status (surface `status`)

```text
1440, alerts
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ Visonaut             Queue 4    History    Status ② ▔▔                                          ?    DH  │ 49
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ⚠ 3 alerts · checked 18 s ago  ⟳                                                       Recovery guide ↗  │
│  ┌──────────────────────────────┐ ┌──────────────────────────────┐ ┌──────────────────────────────┐        │
│  │ ⛔ Critical              2 m  │ │ ⚠ Warning               4 m  │ │ ⚠ Warning               1 h  │        │
│  │ A GitHub check needs         │ │ Database capacity needs      │ │ A backup needs attention     │        │
│  │ attention                    │ │ attention                    │ │                              │        │
│  │ ×6 · 47 min                  │ │ ×213 · 2 d                   │ │ ×14 · 14 h                   │        │
│  └──────────────────────────────┘ └──────────────────────────────┘ └──────────────────────────────┘        │
│                                                                                                            │
│  Database     742.4 of 900 MiB   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░        Active runs   3 of 8   ▓▓▓▓▓▓░░░░░░░░░░       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
1440, healthy
│  ✓ No alerts · checked 18 s ago  ⟳                                                      Recovery guide ↗  │
│  Database     412.6 of 900 MiB   ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░        Active runs   1 of 8   ▓▓░░░░░░░░░░░░░░       │

390, alerts
┌──────────────────────────────┐
│ ◉   Queue 4  History Status ②│ 49
├──────────────────────────────┤
│ ⚠ 3 alerts · 18 s ago     ⟳  │
│ ┌──────────────────────────┐ │
│ │ ⛔ Critical          2 m  │ │
│ │ A GitHub check needs     │ │
│ │ attention    ×6 · 47 min │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ⚠ Warning            4 m  │ │
│ ...                          │
│ Database  742.4 of 900 MiB   │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░     │
│ Active runs  3 of 8          │
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░     │
│ Recovery guide ↗             │
└──────────────────────────────┘
```

| Region       | Primitive                                                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health line  | `Text` with a state icon in `Text $text={role}`, the relative time in a `time` element with the absolute time as title, an icon `Button` for refresh, and a `Link` to the guide                                                                         |
| Alert tile   | `PopoverProvider` for each tile; the tile is `PopoverDisclosure $layer={alert.role} $mix={12} $rounded="xl" $p="1rem"` with `grid text-start`: severity row (icon, word, last seen), title (weight 500), occurrences and first seen in mono             |
| Alert detail | `Popover portal className="grid max-w-96 gap-3"`: `PopoverHeading` (title), the impact sentence, the recovery action sentence, a `dl` with `Subject` (mono), `First seen`, `Last seen`, then `Open run` (when the alert has a run) and `Recovery guide` |
| Stack        | alerts with an equal `kind` and `code` are one tile with `×N` alerts; its popover lists the subjects in a `DialogScroll`-like scroll area                                                                                                               |
| Meters       | `Progress value` with `fill={{ $layer: role }}` (success below the warning size, warning above it, danger at the limit), labelled by a `Text`                                                                                                           |

Copy. Budget: 20 plus the alert text of the service. `healthy`: bar (4) · `No alerts` · `checked … ago` · `Database` · `of` · `Active runs` · `of` · `Recovery guide` = 14. `alerts`: bar · `3 alerts` · `checked … ago` · `Critical` `Warning` `Warning` · meters (5) · `Recovery guide` = 17, plus three titles from the service. Popover labels: `Subject`, `First seen`, `Last seen`, `Open run`, `Recovery guide`. `error`: `Status did not load` · `Retry` (5). `loading`: bar only.

Scenarios: `healthy` is two lines of content, and it says `No alerts`, not "healthy" or "operational", because the list reports events and does not certify dependencies. `alerts` shows three tiles ordered by severity, then last seen. `overflow` (extra) shows stacks and the caption `50 alerts shown · more exist`. `error` with cached data keeps the board dimmed and changes the health line to `Not checked · last 14 min ago` with `Retry`.

Keys: arrows move over the tiles, `Enter` opens the detail popover, `Escape` closes it. The page refreshes each minute while open, as today.

Removed: the heading and its two sentences, the full-width cards with the action paragraph always open, "No external notifications are sent.", the capacity sentence (now two meters), and the long guide button text.

### 4.5 Pull request (surface `pull`)

```text
1440, attempts
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ Queue › #4863 Migrate component examples to the new style recipes ↗                             ?    DH  │ 49
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│     ┌────────────────────────────────────────────────────────────────────────────────────────────┐         │
│     │ ✕ Rejected    a1b2c3d · attempt 2 · 12 min                                                 │         │
│     │ ╭────────────────────────────────────────────────────────────────────────────────────────╮ │         │
│     │ │┌────────────┐┌────────────┐┌────────────┐┌────────────┐┌────────────┐┌────────────┐    │ │         │
│     │ ││    crop    ││    crop    ││    crop    ││    crop    ││    crop    ││    crop    │ +27│ │         │
│     │ │└────────────┘└────────────┘└────────────┘└────────────┘└────────────┘└────────────┘    │ │         │
│     │ ╰────────────────────────────────────────────────────────────────────────────────────────╯ │         │
│     │ ▓▓▓▒▒░░░░░░░░░░░░░░░░░░░░   22 left · 2 rejected · 3 approved            [ Review 22  ↵ ]  │         │
│     └────────────────────────────────────────────────────────────────────────────────────────────┘         │
│     Earlier                                                                                                │
│     ┌─────────────────────────┐ ┌─────────────────────────┐                                                │
│     │ ⚠ Failed                │ │ » Replaced              │                                                │
│     │ a1b2c3d · attempt 1 · 3h│ │ 7e6d5c4 · 5 h           │                                                │
│     └─────────────────────────┘ └─────────────────────────┘                                                │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

390, attempts
┌──────────────────────────────┐
│ ‹  #4863 Migrate compo…   ↗  │ 49
├──────────────────────────────┤
│ ✕ Rejected                   │
│ a1b2c3d · attempt 2 · 12 min │
│ ╭──────────────────────────╮ │
│ │┌──────┐┌──────┐┌──────┐  │ │
│ │└──────┘└──────┘└──────┘  │ │
│ │┌──────┐┌──────┐  +28     │ │
│ │└──────┘└──────┘          │ │
│ ╰──────────────────────────╯ │
│ ▓▓▒░░░░░░░░░░░░░░░           │
│ 22 left · 2 rejected         │
│ [        Review 22         ] │
│ Earlier                      │
│ ⚠ Failed  a1b2c3d · 1 · 3h   │
│ » Replaced  7e6d5c4 · 5 h    │
└──────────────────────────────┘
```

| Region              | Primitive                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero card           | `Frame $lightnessOffset $rounded="2xl" $p="1rem" className="grid gap-3"`, max width 64rem, centered                                                                             |
| State row           | state mark in `Text $text={role}`, the state word (weight 500), then mono commit, attempt, age in `ak-ink-60`                                                                   |
| Preview strip       | `Frame $darken $rounded="lg" $p={1} className="flex gap-1"` with six frames of size S (the frame component without selection). A click on a crop opens the loupe of that change |
| Progress and counts | three `Frame` segments and one mono text                                                                                                                                        |
| Primary action      | `Button $layer="brand" render={<LabLink to="review" scenario="changes" />}` with `ButtonLabel` `Review 22` and a `Kbd` slot `↵`. It has the focus on load                       |
| Earlier runs        | the History tile component                                                                                                                                                      |

Copy. Budget: 20. `attempts`: `Queue` · `Rejected` · `attempt` · `left` `rejected` `approved` · `Review 22` · `Earlier` · `Failed` `Replaced` `attempt` = 11. `single`: `Queue` · `Passed` · `No changes` or `3 approved` · `Open run` = 6. `no-runs`: `Queue` · `No visual run` · `This pull request does not need screenshots` · `GitHub` = 12. `loading`: `Queue` and the number from the URL.

Scenarios: `attempts` as drawn; the run that takes decisions is the hero and the two others are tiles. `single` shows the hero faded with a check stamp, no preview strip when nothing changed, and a neutral `Open run` button. `no-runs` has no card: one line, one sentence, and a link to GitHub. Extra states: `waiting` uses the hero with six pulsing empty frames, `Capturing 212 of 600` with a determinate `Progress`, and it updates by itself with no "Check again" button; `capture-failed` shows `Capture failed · Rerun the visual tests in CI` and the GitHub link.

Keys: `Enter` opens the run to review. Arrows move between the hero and the tiles. `?` opens the keys dialog.

Removed: the card with a status sentence, the buttons `Check again` and `Open on GitHub` as the only content, and the page that shows no pull request title and no run.

### 4.6 Sign-in (surface `sign-in`)

```text
1440
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░ ░░░░░░░ ░░░░░░░ ░░░░░░░ ░░░░░░░ ░░░░░░░    dim empty frames in strips: the skeleton of the Queue  │
│  ░░░░░░░ ░░░░░░░ ░░░░░░░ ░░░░░░░ ░░░░░░░ ░░░░░░░                                                           │
│                        ┌──────────────────────────────────────┐                                            │
│  ░░░░░░░ ░░░░░░░ ░░░░  │ ◉ Visonaut                           │  ░░░░ ░░░░░░░                              │
│  ░░░░░░░ ░░░░░░░ ░░░░  │                                      │  ░░░░ ░░░░░░░                              │
│                        │ Review visual changes                │                                            │
│  ░░░░░░░ ░░░░░░░ ░░░░  │ ariakit/ariakit · Write access needed │  ░░░░ ░░░░░░░                              │
│  ░░░░░░░ ░░░░░░░ ░░░░  │                                      │  ░░░░ ░░░░░░░                              │
│                        │ [   Sign in with GitHub         ↵ ]  │                                            │
│                        └──────────────────────────────────────┘                                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────┐
│ ░░░░░░░░░░░░  ░░░░░░░░░░░░   │
│ ░░░░░░░░░░░░  ░░░░░░░░░░░░   │
│ ┌──────────────────────────┐ │
│ │ ◉ Visonaut               │ │
│ │ Review visual changes    │ │
│ │ ariakit/ariakit          │ │
│ │ Write access needed      │ │
│ │ [ Sign in with GitHub  ] │ │
│ └──────────────────────────┘ │
│ ░░░░░░░░░░░░  ░░░░░░░░░░░░   │
└──────────────────────────────┘
```

| Region     | Primitive                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Background | a `div aria-hidden` with the strip and frame layout of the Queue skeleton: `Frame $lightnessOffset` frames at 40% opacity, no pulse |
| Card       | `Frame $lighten $border $rounded="2xl" $p="2rem" className="grid w-full max-w-96 gap-4 shadow-xl"`, centered with a grid            |
| Title      | `Heading className="mt-0 mb-0 text-2xl"` in a `HeadingLevel`                                                                        |
| Line       | `Text className="ak-ink-70"`, repository in mono                                                                                    |
| Action     | `Button $layer="brand" $size="lg"` with a `Github` icon slot, `ButtonLabel`, and a `Kbd` slot `↵`                                   |

| Scenario     | Copy                                                                                                   | Words | What it shows                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------- |
| `guest`      | `Visonaut` · `Review visual changes` · `ariakit/ariakit · Write access needed` · `Sign in with GitHub` | 11    | The button has the focus. From a deep link the title is `Sign in to review #4863`  |
| `signing-in` | same, button text `Opening GitHub`                                                                     | 9     | The button is disabled with a spinning `LoaderCircle`. The background frames pulse |
| `forbidden`  | `No access` · `@okafor-amara has no write access to ariakit/ariakit` · `Use another account`           | 10    | Avatar and login of the account. One neutral button. No brand fill                 |
| `error`      | `Visonaut did not answer` · `Retry` · `Error ID req_01JZ8Q4W7M`                                        | 7     | A danger icon beside the title. `Retry` shows a spinner while `retrying`           |

Budget: 12 words. Keys: `Enter` activates the one button.

Removed: the marketing layout around one button, the three different sign-in texts, the three access-denied texts, and each loading sentence.

## 5. Loading

Rules: the top bar and the page frame render from the document, before any data. A wait shows the shape of the result (empty frames in the right layout), never a sentence. A slow wait adds a 2 px indeterminate line under the top bar, and after 5 s one `Retry` button. The words "Checking access" never show. A page that was visited before shows its last known content, dimmed to 80%, until fresh data arrives.

| Page    | 0 ms                                                                                                                                                                                                                                | 300 ms (list data)                                                                                                                                                                                                                                      | 1 s (first images)                                                                                                         | 5 s (slow case)                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in | Card and background from the document. No request                                                                                                                                                                                   | Same                                                                                                                                                                                                                                                    | Same                                                                                                                       | After a click: `Opening GitHub`. If the redirect did not start after 5 s, the button is enabled again                                                                      |
| Queue   | Top bar and nav without counts. Four card skeletons, each with three empty frames, and two slug skeletons                                                                                                                           | Real cards: numbers, titles, marks, counts, bars. Preview frames are empty wells. `Enter` already opens a run                                                                                                                                           | Preview crops fade in, visible cards first                                                                                 | Missing crops keep the empty well with a small spinner. If the list is missing: skeleton, indeterminate line, `Retry`                                                      |
| History | Top bar, search field (usable), fifteen tile skeletons under one day label skeleton                                                                                                                                                 | All tiles with data. This page has no images                                                                                                                                                                                                            | Complete                                                                                                                   | Skeleton, indeterminate line, `Retry`                                                                                                                                      |
| Status  | Top bar, a health line skeleton, two meter skeletons                                                                                                                                                                                | Health line, tiles, meters                                                                                                                                                                                                                              | Complete                                                                                                                   | With cached data: the board dimmed and `Not checked · last 14 min ago`. Without: skeleton, line, `Retry`                                                                   |
| Pull    | Top bar with `#4863` from the URL, a hero skeleton with six empty frames, the button disabled                                                                                                                                       | State, commit, counts, bar. `Review 22` enabled and focused                                                                                                                                                                                             | Crops fade in                                                                                                              | Empty wells with spinners; the button stays usable                                                                                                                         |
| Sheet   | Top bar: `Queue ›` and the run title from router state when the person came from the Queue (if not, a text skeleton). Sheet bar with chip outlines. Three strips of six empty frames at the stored size. Dock with disabled buttons | Real strips: names, frame count, captions (number, axis marks, ratio), stamps of saved verdicts, chips with counts. Each empty frame already shows its region box, because the region data arrives with the list. The cursor is on the first open frame | The frames of the first screen decoded and painted. They become selectable. Frames below the fold load when they come near | Frames without pixels keep the well and a small spinner, and they cannot be selected. The indeterminate line shows. Captions, stamps, sorting, and the filter already work |
| Loupe   | Opens at once: the stage shows the crop of the frame, scaled up and soft, as a placeholder. Dock complete; `Approve` and `Reject` disabled                                                                                          | (from the sheet, the list is present)                                                                                                                                                                                                                   | Full images decoded: sharp picture, buttons enabled. The next and the previous frame preload                               | The placeholder stays with a spinner in the stage corner. Navigation keys work. On a load failure: `The image did not load` and `Retry`                                    |

For this to hold in the product, the run endpoint must answer with the changed variants first (about 30 to 200 rows with regions, ratios, verdicts, and image references) and give only a count for the unchanged ones. Today one request carries 5.3 to 6.0 MB for 3,832 variants and waits 5 to 7 s.

A run that is `comparing` uses the same visual language without a time limit: frames arrive one by one.

## 6. Risks, tradeoffs, and revisited decisions

Earlier maintainer decisions and binding rules that this direction revisits:

| Decision or rule                                                                              | What this direction does                                                                                                                                                   | Fallback inside the direction                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| D02, D21, K11, invariant I8 (a decision covers one variant, or one whole item as one command) | One command can decide selected variants of several screenshots. The server already accepts such a target list; the rule does not                                          | Send the selection as one command for each screenshot, and undo them one by one |
| A26 (whole-item review need not open each variant)                                            | Stricter: a frame must have decoded on screen before any decision                                                                                                          | None needed                                                                     |
| P02 `on-demand` (load the diff when selected; `eager` was rejected)                           | The sheet loads the mask of each visible frame                                                                                                                             | Picture without paint until `D` is pressed, with region boxes from data only    |
| A11 (thumbnail = first declared candidate variant)                                            | One change crop for each variant. No thumbnails exist for current production runs                                                                                          | Client crops from full images, or a crop endpoint                               |
| A06, U02 (item list on the left, one shell with a sidebar)                                    | No item list. The sheet is the list                                                                                                                                        | None. This is the lens                                                          |
| A12, D29 (candidate order, then removed items)                                                | Default order is the largest change first                                                                                                                                  | `Run order` is one sort option                                                  |
| K1, K5, U04 (page-wide arrows: up and down item, left and right variant)                      | On the sheet the arrows are spatial. In the loupe they keep the contract meaning. Arrows never pan; `Shift`+arrow pans in the loupe and extends the selection on the sheet | Use `Shift`+arrow only for selection and pan with drag only                     |
| K13 (S, D, F: side by side, pixel diff, new only) and A16                                     | `D` becomes a toggle of the diff paint. The modes are Overlay, Side by side, Swipe. The mask-only view is removed. `F` and `G` stay                                        | Keep `D` as a fourth mode                                                       |
| K6 (`1` to `6`)                                                                               | `1` to `9` in the loupe                                                                                                                                                    | Limit to six                                                                    |
| X3 (keep native `Cmd/Ctrl+A`)                                                                 | `Cmd/Ctrl+A` selects all open frames while the focus is in the sheet                                                                                                       | A `Select all` button only                                                      |
| X5 (no grid semantics unless the interaction is a grid)                                       | The sheet is a multi-select list box with two-dimensional keys                                                                                                             | None. It is a grid interaction                                                  |
| L1 (variant links with a bar glider), U03                                                     | Variants are frames on the sheet and a small strip in the loupe                                                                                                            | None                                                                            |
| A21, D30 (labeled empty pane for an added or removed variant)                                 | One pane with a badge                                                                                                                                                      | Keep two panes in Side by side                                                  |
| A08 ("2 of 6 need review"), L4, A13 ("Accepted", "Accepted automatically")                    | Counts on chips; `Auto-approved` as the word; no Accepted group                                                                                                            | Wording can return on the chips                                                 |
| A27, D53 (narrow layout with the list above the viewer; Chrome desktop only at launch)        | A phone sheet two frames wide and a single-pane loupe                                                                                                                      | Build the phone layout as exploration only                                      |
| U04 notes ("do not add a hotkey registry"; keep browser modifier shortcuts)                   | The keys dialog renders from one list. `Ctrl`+wheel zooms over the stage                                                                                                   | Pinch and buttons only                                                          |
| RULE-06 (confirmation for the whole item: two paths differ today)                             | No confirmation on any path; count on the button, stamps, Undo                                                                                                             | A hold-to-confirm of 600 ms above 25 targets                                    |
| U05 note (pull request title) and P01, P03 (page reads)                                       | The Queue and the pull page need titles, counts, and previews; the sheet needs a "changes first" response                                                                  | Cards without previews still work                                               |

Risks and tradeoffs:

1. **A thumbnail is weaker evidence than a full image.** A crop can hide a second region or a change outside the crop. The `+N` mark, the `Whole` picture mode, the region boxes, the blink, and the loupe reduce the risk. Bulk approval from crops is still the largest product risk of this direction, and it is also its largest gain: 50 decisions become a few.
2. **Image cost.** A screen of 18 to 21 frames needs the current image and the mask for each (and the baseline after the first blink). With full-size PNG files this is several megabytes. The product needs crops from the service, or strict lazy loading with a concurrency limit. The lab uses data URIs and does not show this cost.
3. **Large commands.** Each target adds four statements to one D1 batch, and the limit is near 245 targets. A larger selection must go as several commands of at most 200, which breaks "every target or none" for the selection as a whole. The dock must then show `Saved 200 of 612`.
4. **Very large runs.** A token change can produce 1,800 frames. The sheet then needs real row virtualization (the app already has TanStack Virtual), `Stack same diffs`, and the `Change size` grouping. The lab `large` scenario (128 frames) does not prove this case.
5. **Same diff is not the same change.** A stack by equal mask groups variants whose changed pixels have the same positions, not the same colors. The stack is off by default for this reason.
6. **Stable layout costs space.** Approved frames keep their place until the reviewer hides them with `H`.
7. **Ragged rows.** Packed strips do not align in strict columns. Group `None` gives a strict grid.
8. **Two arrow models.** Spatial arrows on the sheet and contract arrows in the loupe. With the default grouping they agree in most rows.
9. **Unchanged screenshots are less visible** than in a list. They are one chip and one disclosure away.
10. **History as tiles** is denser than a table and worse for comparing one column.
11. **Chrome only.** The loupe transition uses the View Transitions API, and gliders need CSS anchor positioning. Both degrade to no animation.

Fields and hook members that are not in the API or the app today: `regions`, `Run.previews`, `Run.counts`, `Run.progress`, `Run.author`, `Run.error`, `Run.mergeGroupPullRequests`, `ReviewRun.pullRequest`, `ReviewRun.counts`, `ReviewRun.progress`, `ReviewRun.supersededBy`, `reviewerLogin`, `decidedAt`, the pull request `title` and `runs`, the alert `severity`, `impact`, `occurrences`, and `runId`, the guest `repository`, the forbidden `user`; in the hooks: `approve` and `reject` with a list of targets from several items, the filters by kind and axis, the History sort, the Queue text filter, the viewer modes `overlay`, `swipe`, and `blink`, the zoom levels 50% and 400%, and region stepping. Also new for the product: the `Queued` save mark as a separate state in the lab, the GitHub check confirmation in the completion state, and the "seen" rule.

## 7. Build notes

- **Session.** Call `useReviewSession(scenario, { autoAdvance: false })`. The sheet owns the order: build `frames` (changed, added, removed variants, plus unchanged when the chip is on) from `session.items`, then group and sort them. After a decision, move the cursor yourself to the next open frame in that order. Decide with `session.approve(targets)` and `session.reject(targets)`, where `targets` is the list of selected variants, and with `session.approveItem(itemKey)` for `Shift+A`. Keep the cursor in sync with `session.select(target)` so that `session.viewer` and the loupe follow it.
- **Keys.** `useReviewShortcuts` ignores events from inside `[role="listbox"]` and `[role="dialog"]`. So handle the sheet keys in one `onKeyDown` on the list box (and pass the same handler to a document listener for the case where the focus is on the body), and do not give the loupe a dialog role. In the loupe, call `useReviewShortcuts(session, { scope: loupeRef, keys })` and add `enter`, `escape`, `r`, `i`, and the hold behavior of `b` (a `keyup` listener) through `keys` or your own listener. The built-in `d` sets the mask-only mode: override it with the paint toggle (`viewer.toggleHighlight()`). The built-in arrows are correct for the loupe.
- **Up and down on the sheet.** Find the target with `getBoundingClientRect`: the frame in the next row whose center is nearest in x. Do not compute rows from the data, because strips wrap.
- **Seen.** One `IntersectionObserver` for all frames; a frame is seen when at least half of it was in the viewport after its images decoded (`img.decode()`).
- **Selection look.** A `Frame` has no selected style of its own. Derive props from state: `$border={selected ? 2 : true}` and `$edge={selected ? "brand" : undefined}`.
- **Radius.** Frames inside a strip take the concentric radius (pitfall 2). This is the intended look. Badges and round checks inside a frame need `$forceRounded`.
- **Images.** Size each image from its `width` and `height` and place it with a transform. Do not use `object-fit` for the crop, because the mask and the boxes must share the transform.
- **Light theme.** The well is `$darken` and the strips are `$lightnessOffset`; check that frames keep a visible ring and that faded frames stay above 3:1 against the well for their stamps.
- **Component surfaces that this direction can supply:** frame (states: needs review, approved, rejected, auto-approved added, auto-approved removed, size changed, failed, comparing, load error, selected, cursor), strip, filter chips, dock (all states of the table in 4.1), verdict stamp and status mark, progress line, run card, run tile, alert tile, loupe stage (three modes, single pane, size change), variant strip of the loupe, details popover, keys dialog, and the skeletons.
