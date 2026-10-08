# Console

Design direction `console` for the Visonaut design lab. This brief is complete for a builder who reads it alone.

Conventions in this brief:

- "Screenshot" is the UI word for an item. "Variant" is one rendering of a screenshot. "Change" is a variant that differs from the baseline.
- Sizes are given as Tailwind spacing steps, with the pixel value at the default look (root text 13 px, `--spacing` 0.25em = 3.25 px). Use the steps, not the pixels, so that the Look controls apply.
- "Not in the API today" marks a field or a function that the backend does not have. Section 7 has the full list.

## 1. Concept

**Name:** Console

**Tagline:** A matrix of marks, a stage, and one status line: the hands stay on the keys.

**The idea in five sentences**

1. Visonaut becomes a fixed-frame tool like an IDE: flat bands and panes with hairline seams, no cards, and no page scroll.
2. Each list is a table with a visible cursor row, and a run is a matrix: rows are screenshots, columns are variants, and each cell is one small mark.
3. The keyboard model of the contract is already a two-axis cursor (Up and Down change the screenshot, Left and Right change the variant), so the matrix shows that model on screen.
4. Each control shows its key, a command menu reaches each function by name, and `?` docks the full key map above the status line.
5. One status line at the bottom holds position, key hints, save state, refusals, errors, and service alerts, so the pages have no banners, no toasts, and 95 px of chrome in a 900 px window.

**Signature moment: the cascade.** The right hand is on the arrows. The left hand is on `A S D F G` and `X`. The reviewer presses `A A A X A`. In the matrix, amber dots become green checks from left to right and row after row. The cursor ring jumps to the next amber dot. The stage shows the next image with brackets around the changed region. The meter in the top bar counts down: 22 left, 21, 20. The status line echoes each decision. When the last dot flips, the status line becomes green and says "Review complete".

**Principles**

1. The cursor is always visible. Each page has one selected row or cell. The arrows move it, `Enter` opens it, and `Q` goes back one level.
2. Each control shows its key. The keycap is in the button, in the column head, and on the tool rail. `?` docks the full key map.
3. One status line and no banners. Position, key hints, save state, refusals, errors, loading time, and service alerts have one fixed place.
4. Marks before words. One mark vocabulary serves runs and variants. A word shows one time on a screen. Data (numbers, commits, keys, times) is monospaced.
5. The frame does not move. Bands and rows have fixed heights. Nothing shifts when data loads, when a decision saves, or when a save fails.

## 2. Visual system

### Layers and edges

| Surface                                                  | Layer                                                                                                                                                                             | Edge                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Top bar, context bar, matrix pane, tool rail, list pages | The canvas. Use `Layer` or a plain `div`, with no lighten or darken                                                                                                               | 1 px seams: `border-b` on the bars, `border-e` on the matrix and the rail. `$edgeWeight="light"` |
| Stage (the image well)                                   | `Layer $darken` (one step, sunken)                                                                                                                                                | No border. Each image has `ring-1` in the edge color, so the image boundary is visible           |
| Status line                                              | `Layer $darken={0.5}`. State tints: `$layer="success" $mix={18}` (review complete), `$layer="warning" $mix={15}` (read-only), `$layer="danger" $mix={22}` (not saved, load error) | `border-t`                                                                                       |
| Cursor row                                               | `$lightnessOffset` (one step) and a 2 px brand bar at the inline start                                                                                                            | None                                                                                             |
| Cursor cell                                              | A 1.5 px brand ring: `$border={1.5} $borderType="ring" $edge="brand" $edgeRaw`                                                                                                    | The ring                                                                                         |
| Hover row                                                | The default table tint                                                                                                                                                            | None                                                                                             |
| Command menu, popovers, menus, tooltips                  | The primitive defaults (raised surface, border, shadow). Pass `portal`                                                                                                            | The default                                                                                      |
| Key map panel                                            | `Layer $lighten`                                                                                                                                                                  | `border-t`                                                                                       |
| Brand                                                    | The Approve button, the cursor bar and ring, the progress fill, the focus ring, and the bar glider of the view tabs. Nothing else                                                 | None                                                                                             |

Rules:

- Borders are seams between panes only. No card has a border. Table rows have no lines. A section label row has `border-b`.
- Bands are `Layer` elements or plain `div` elements, not padded `Frame` elements. A padded frame with a small radius gives its controls the concentric radius (pitfall 2), and the buttons become square. With plain bands, each control keeps its `$rounded` step and the radius control of the lab applies.
- On the light canvas, `$lighten` paints almost nothing (pitfall 10). The design does not depend on it: seams and the sunken stage make the structure.
- Use `ak-dark:` and `ak-light:` when a style must follow the layer.

### Type

The root element of each Console page has `font-sans text-[0.8125rem] leading-5` (Inter, 13 px on 20 px).

| Step  | Class                            | Use                                                              |
| ----- | -------------------------------- | ---------------------------------------------------------------- |
| 12 px | `text-xs`                        | Secondary text, table heads, captions, the status line, tooltips |
| 13 px | root                             | Rows, buttons, labels                                            |
| 15 px | `text-[0.9375rem] font-semibold` | The pull request title, the completion heading                   |
| 18 px | `text-lg font-semibold`          | The sign-in heading only                                         |

- Weights: 400 for text, 500 for the cursor row and for labels, 600 for titles.
- Mono (`font-mono text-xs tabular-nums`, JetBrains Mono) is for data: screenshot keys, commit SHAs, `#4863`, counts, percentages, ages, clock times, keycaps, and the status line. Inter is for language.
- No text is smaller than 12 px. No uppercase labels. Sentence case. No trailing period in headings and labels.
- Secondary text uses `ak-ink-60`. The directory part of a screenshot key uses `ak-ink-50`. Do not use `opacity-*` on text.

### Spacing and density

| Part                                       | Step                                           | Pixels at the default look |
| ------------------------------------------ | ---------------------------------------------- | -------------------------- |
| Top bar, context bar                       | `h-11`                                         | 36                         |
| Status line, section label row, table head | `h-7`                                          | 23                         |
| Matrix row                                 | `h-8`                                          | 26                         |
| Table row (inbox, history, status, pull)   | `h-9`                                          | 29                         |
| Matrix cell                                | `size-5`, mark `size-3.5`                      | 16, 11                     |
| Tool rail                                  | `w-12`, button `h-11 w-10`                     | 39, 36 x 33                |
| Matrix pane                                | `w-[22rem]` (`w-[18rem]` from 1024 to 1279 px) | 352                        |
| Inspector pane                             | `w-[20rem]`                                    | 320                        |
| Pane padding, gaps                         | `px-3`, `gap-2`, stage `p-3`                   | 10, 6.5, 10                |

On a touch device or below 768 px, each row and each button is at least `min-h-[2.75rem]` (44 px).

### Radius

- Bands, panes, tables, the stage, and screenshots: no radius. A screenshot is evidence and is never rounded.
- Buttons, keycaps, cells, chips: `$rounded="sm"`. Inputs and the command field: `md`. Menus and popovers: `lg`. The command menu and the sign-in panel: `xl`.
- A `Badge` in a table cell needs `$forceRounded`.

### Icons

- lucide-react at `size-[1.1em]`, `strokeWidth={1.75}`. Marks at `size-3.5`, `strokeWidth={2.5}`.
- Framework and browser marks (React, Solid, Chrome, Firefox, Safari) at `size-3.5`, in the context bar, in the variant chips, and in the inspector only. The matrix has no brand marks.
- The view buttons on the tool rail show a lucide icon above the key letter.

### One status vocabulary

Color tells the state of the gate. Amber waits for a person. Green is accepted. Red blocks the check. Neutral needs nothing from the reviewer. The shape tells which state. Each mark has an accessible name and a tooltip with the word.

| Name                         | Used for                     | Color role           | lucide icon                                                           |
| ---------------------------- | ---------------------------- | -------------------- | --------------------------------------------------------------------- |
| Needs review                 | Run, variant                 | warning              | `Circle` with `fill="currentColor"`                                   |
| Approved (run word: Passed)  | Variant, run                 | success              | `Check`                                                               |
| Rejected                     | Variant, run                 | danger               | `X`                                                                   |
| Added (auto-approved)        | Variant                      | neutral, `ak-ink-70` | `Plus`                                                                |
| Removed (auto-approved)      | Variant                      | neutral, `ak-ink-70` | `Minus`                                                               |
| Unchanged                    | Variant                      | neutral, `ak-ink-30` | `Dot`                                                                 |
| Capturing, Comparing         | Run, variant                 | neutral              | `CircleDashed`. With known progress: `ProgressCircular` at `size-3.5` |
| Failed (variant word: Error) | Run, variant, critical alert | danger               | `TriangleAlert`                                                       |
| Rerun needed                 | Run                          | danger               | `RotateCw`                                                            |
| Replaced                     | Run                          | neutral, `ak-ink-50` | `Forward`                                                             |
| Read-only                    | Run                          | neutral              | `Lock`                                                                |
| Warning                      | Alert                        | warning              | `TriangleAlert`                                                       |

Save states in the status line: Sending (`ArrowUp`, neutral, with a count), Queued (`Cloud`, neutral), Saved (`Check`, success), Not saved (`TriangleAlert`, danger). The three states sending, queued, and saved stay different (invariant I4).

The eight run words are: Needs review, Rejected, Passed, Capturing, Comparing, Rerun needed, Replaced, Failed.

```tsx
<Text $text={role === "neutral" ? undefined : role} className="flex" aria-label={label}>
  <Icon className="size-3.5" strokeWidth={2.5} />
</Text>
```

### Motion

- A new mark scales from 0.6 to 1 in 120 ms. Nothing else moves in the matrix.
- The stage swaps images with no transition. Speed is the feature.
- A status line message fades in during 100 ms.
- A skeleton starts to pulse only after 300 ms (`animate-pulse` with a delay).
- The loading line is an indeterminate `Progress` with `$thickness={0.5}` under the top bar or at the top of the stage.
- Blink mode alternates each 600 ms.
- With `prefers-reduced-motion`: no scale, no fade, no pulse, no indeterminate animation (the status line text tells the state), and Blink does not play: each press of `B` flips the image one time.

## 3. Shell and navigation model

### What is always on screen

1. **Top bar** (`h-11`). Start: the Visonaut mark, then the view tabs on a list page, or the crumbs on a pull request or run page. Center: the command field. End: page facts (freshness, or the run meter) and the account button.
2. **Status line** (`h-7`). Start: the scope or the cursor position. Center: the key hints of the page, or the latest message. End: the save state (run page), the service alert mark (only when alerts are open), and the `?` button.

The account is the avatar button at the end of the top bar. Its menu (`ak.Menu` with the `popover` and `option` recipes) has: `@diegohaz`, Theme (System, Light, Dark), Keyboard shortcuts `?`, Sign out. The service alert is in the status line of each page: `▲ 3 alerts` links to Status. With no open alert it shows nothing. A `Preview` badge follows the mark when the data is fixture data.

```tsx
<div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto_auto] font-sans text-[0.8125rem] leading-5">
  <Layer render={<header />} className="flex h-11 items-center gap-2 border-b px-2">
    …
  </Layer>
  <main className="min-h-0">…</main>
  {keysOpen && <KeysPanel />}
  <Layer
    $darken={0.5}
    render={<footer />}
    className="flex h-7 items-center gap-3 border-t px-2 font-mono text-xs"
  >
    …
  </Layer>
</div>
```

### How a person moves

One spatial model serves all pages. Up and Down move in the rows. Left and Right move in the strip above the content. `Enter` goes one level down. `Q` goes one level up.

| Level                  | Rows (Up, Down, `J`, `K`) | Strip (Left, Right)              | `Enter`                                     | `Q`     |
| ---------------------- | ------------------------- | -------------------------------- | ------------------------------------------- | ------- |
| Inbox, History, Status | Runs or alerts            | The views Inbox, History, Status | Open the run, or the guide of the alert     | Nothing |
| Pull request           | Runs of the pull request  | Nothing                          | Open the run                                | Inbox   |
| Run                    | Screenshots               | Variants                         | Nothing (on the completion panel: Next run) | Inbox   |

- The crumbs on a run page are: mark, `‹ Inbox` with the keycap `Q`, `#4863` (a link to the pull request page), the title, then `a1b2c3d · attempt 2` in mono. Commit and attempt stay above the images (rule A06).
- The command menu reaches each place and each function by name. It opens from the field, from `/`, and from `Cmd/Ctrl+K`.
- A check link from GitHub that has a ready run goes to the run. The pull request page is the target of the crumb and of the states waiting, failed, and not required.

### Complete key map

| Key                  | Action                                                                                                           | In the app today    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- |
| `↑` `↓`              | Previous or next row. Stop at each end                                                                           | Yes (run page)      |
| `J` `K`              | Next or previous in reading order. In a run: the next or previous change of the visible list, across screenshots | No                  |
| `←` `→`              | Previous or next on the strip: view on a list page, variant in a run                                             | Yes (run page)      |
| `Enter`              | Open the cursor row                                                                                              | No                  |
| `Q`                  | Back one level                                                                                                   | No                  |
| `/`, `Cmd/Ctrl+K`    | Open the command menu                                                                                            | No                  |
| `?`                  | Dock or hide the key map                                                                                         | No                  |
| `Esc`                | Close a menu, a popover, or the command menu. It never decides                                                   | Yes                 |
| `1` to `9`           | Variant in that column                                                                                           | `1` to `6`          |
| `A` `X`              | Approve or reject the cursor variant, then go to the next that needs review                                      | Yes                 |
| `Shift+A` `Shift+X`  | Approve or reject all changed variants of the screenshot                                                         | Yes                 |
| `N` `Shift+N`        | Next or previous variant that needs review (skip)                                                                | No                  |
| `Cmd/Ctrl+Z`         | Undo the last saved decision                                                                                     | Yes                 |
| `S` `D` `F` `G`      | Side by side, Diff, Current, Baseline                                                                            | Yes                 |
| `W` `B`              | Swipe, Blink                                                                                                     | No                  |
| `H`                  | Change marks on or off                                                                                           | No                  |
| `R` `Shift+R`        | Next or previous changed region                                                                                  | No                  |
| `+` or `=`, `-`, `0` | Zoom in, zoom out, fit                                                                                           | No                  |
| `Shift` + arrows     | Pan both images when zoomed                                                                                      | No                  |
| `M` `I`              | Matrix pane, inspector pane                                                                                      | `[` for the sidebar |

Rules: a held key does not repeat. Keys do nothing in a text field, a menu, or a dialog. Keys with Alt do nothing. Match a Latin letter by `event.key` and fall back to `event.code` for other layouts (finding RULE-28). No bracket key and no Space key are used. The left hand has `A S D F G X W R Q`, the right hand has the arrows or `J K N`.

### URL model

| Page         | URL                                                                     |
| ------------ | ----------------------------------------------------------------------- |
| Inbox        | `/`                                                                     |
| History      | `/history?q=&state=&sort=`                                              |
| Status       | `/status?alert=<kind:code:subject>`                                     |
| Pull request | `/pulls/4863` (`?check=` is optional)                                   |
| Run          | `/runs/<runId>?item=<key>&variant=<key>&mode=diff&zoom=fit&show=review` |
| Sign-in      | No route. The gate renders in place at the requested URL                |

A change of selection, mode, zoom, or filter replaces the history entry. One run is one history entry, and a copied link shows the same view.

### Page titles

`(4) Inbox · Visonaut`, `History · Visonaut`, `Status · 3 alerts · Visonaut`, `#4863 Migrate component examples… · Visonaut`, `22 left · #4863 Migrate component… · Visonaut`, then `✓ #4863 Migrate component… · Visonaut` when the review is complete, and `Sign in · Visonaut`.

### Shell sketch, 1440 px

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎  Inbox 4   History   Status      [ ⌕ Search or run a command        ⌘K ]      12 s ⟳   DH │ 36
│    ───────                                                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│                         page body (a table or panes, with its own scroll)                    │
│                                                                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4 to review · 121 left       ↑↓ row  ↵ open  ←→ view  / search  ? keys          ▲ 3 alerts ? │ 23
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Shell sketch, 390 px

```
┌──────────────────────────────────────┐
│ ◎ Inbox 4  History  Status     ⌕  DH │ 44
├──────────────────────────────────────┤
│ page body                            │
├──────────────────────────────────────┤
│ 4 to review              ▲ 3 alerts  │ 28
└──────────────────────────────────────┘
```

On a phone the command field is an icon button, keycaps and key hints are hidden, and each target is 44 px.

### Shared parts and their primitives

| Part                      | Primitive                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top bar                   | `Layer render={<header />}` with `border-b`                                                                                                                                                                                                       |
| View tabs                 | `Nav $layout="horizontal" glider={{ $kind: "bar" }}` with `NavLink` and a `NavSlot $kind="badge"` for the count                                                                                                                                   |
| Crumbs                    | `ButtonGroup $size="sm"` with `ButtonSeparator $kind="chevron"`. The back button has a `ButtonSlot $kind="shortcut"` with `<Kbd>Q</Kbd>`                                                                                                          |
| Command field             | `Input render={<button type="button" />}` with `InputSlot` (Search icon), placeholder text, and `InputSlot $kind="shortcut"`                                                                                                                      |
| Command menu              | `Dialog` at the top center with `max-w-[40rem]`. Inside: `ak.ComboboxProvider`, `ak.Combobox` rendered as `Input`, `ak.ComboboxList`, and `ak.ComboboxItem {...option.jsx()}` in groups. Each row has its key in an `OptionSlot $kind="shortcut"` |
| Account                   | `ak.MenuButton render={<Button />}` with a `ButtonSlot $kind="avatar" $layer="brand"`                                                                                                                                                             |
| Status line               | `Layer render={<footer />}`. Segments are `Button $size="xs"` or `Text`. The message segment has `role="status"`                                                                                                                                  |
| Keycap                    | `Kbd` with `className="font-mono text-xs"`. It is `aria-hidden`. The control has `aria-keyshortcuts`                                                                                                                                              |
| Key map panel             | `Layer $lighten` with `border-t`, three columns of `Text` and `Kbd`, a switch (the Toggle recipe), and a `Link` to the guide                                                                                                                      |
| Tooltip on an icon button | `TooltipProvider`, `TooltipAnchor render={<Button aria-label="…" />}`, `Tooltip` with the label and a `Kbd`                                                                                                                                       |

**Command menu.** As the reviewer types, the table behind the menu filters (the hook function `setQuery`). The first option is always `Filter: “text”`: Enter keeps the filter, and a chip with `×` shows it. The next groups are Screenshots (in a run) or Runs (on a list page), Commands, and Go to. The empty menu lists the commands with their keys, so it also teaches the keys.

**Key map panel.** `?` docks a panel above the status line (about 150 px). It is not modal: the reviewer can keep it open during the review. Columns: Move, Decide, View. It holds the switch "Keys on", which is stored. When keys are off, all keycaps are hidden and the status line shows "Keys off". The `?` button in the status line always works.

## 4. Page specs

### 4.1 Sign-in

The gate renders inside the Console frame at the requested URL. The top bar has the mark only. The status line has the hint `↵ Sign in`.

```
1440                                                         390
┌───────────────────────────────────────────────────────┐   ┌──────────────────────────┐
│ ◎                                                     │   │ ◎                        │ 44
├───────────────────────────────────────────────────────┤   ├──────────────────────────┤
│                                                       │   │                          │
│            ┌────────────────────────────────┐         │   │ ◎                        │
│            │ ◎                              │         │   │ Sign in to Visonaut      │
│            │ Sign in to Visonaut            │         │   │ Reviews need write       │
│            │ Reviews need write access to   │         │   │ access to ariakit/ariakit│
│            │ ariakit/ariakit                │         │   │                          │
│            │ [ Sign in with GitHub      ↵ ] │         │   │ [ Sign in with GitHub ]  │
│            └────────────────────────────────┘         │   │                          │
│                                                       │   │                          │
├───────────────────────────────────────────────────────┤   ├──────────────────────────┤
│                    ↵ Sign in                          │   │                          │ 28
└───────────────────────────────────────────────────────┘   └──────────────────────────┘
```

Regions: the panel is `Frame $border $rounded="xl" $p="1.5rem"` with `w-[22rem]` (the 1.5rem padding keeps the radius of the button). The heading is `Heading className="mt-0 mb-0 text-lg"`. The repository is `Text className="font-mono text-xs"`. The button is `Button $layer="brand"` with `autoFocus` and a `ButtonSlot $kind="shortcut"`. On a phone the panel has no border and fills the width.

| Scenario     | Exact copy                                                                                                                                     | Words |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `guest`      | "Sign in to Visonaut" / "Reviews need write access to ariakit/ariakit" / button "Sign in with GitHub"                                          | 14    |
| `signing-in` | Same heading and line. The button is disabled, has a `ProgressCircular` slot, and says "Opening GitHub". The status line says "Opening GitHub" | 12    |
| `forbidden`  | "No write access" / "@okafor-amara cannot review ariakit/ariakit" / buttons "Use another account" (brand) and "Try again"                      | 12    |
| `error`      | "Visonaut did not answer" / "Error ID 7f3a9c" with a copy button / button "Retry" / status line "Retrying in 8 s"                              | 12    |

Word budget: 14. When the gate stands on a deep link, the heading names the target: "Sign in to review #4863".

Keys: `Enter` does the primary action. No other key.

Removed: the marketing text (34 words today), the navigation links for a guest, the account menu on the refused screen, and the three different sign-in designs.

### 4.2 Inbox

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎  Inbox 4   History   Status      [ ⌕ Search or run a command        ⌘K ]      12 s ⟳   DH │ 36
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│     Run     Title                                             Changes           Commit   Age │ 23
│ To review                                                                                    │ 23
│▌●   #4863   Migrate component examples to the new style re…   ▓▒░░░  22 left    a1b2c3d  12m ↵│ 29
│ ●   #4831   Add the combobox select                           ░░░░░  79 left    9f8e7d6   1h │
│ ●   #4819   Refactor the composite store so that items do n…  ▓░░░░  14 left    ba90300   3h │
│ ●   main    Update the tab glider                             ░░░░░   6 left    7e8ca38   4h │
│ In progress                                                                                  │
│ ◌   queue   #4850 #4851                                       Capturing 180/600 27b78d0   2m │
│ ◌   #4855   Fix the dialog focus                              Comparing 48/120  4f1c9e0   4m │
│ Needs attention                                                                              │
│ ▲   #4844   Tooltip: delay hide when the pointer moves        Failed            8d4ac30   1d │
│ ↻   main    Bump dependencies                                 Rerun needed      c3d4e5f   2d │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4 to review · 121 left       ↑↓ row  ↵ open  ←→ view  / search  ? keys          ▲ 3 alerts ? │ 23
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────────────┐
│ ◎ Inbox 4  History  Status     ⌕  DH │ 44
├──────────────────────────────────────┤
│ To review                            │ 28
│ ● #4863                 22 left · 2 ✕│ 56
│   Migrate component examples to th…  │
│ ● #4831                      79 left │ 56
│   Add the combobox select            │
│ In progress                          │
│ ◌ #4855             Comparing 48/120 │ 56
│   Fix the dialog focus               │
├──────────────────────────────────────┤
│ 4 to review              ▲ 3 alerts  │ 28
└──────────────────────────────────────┘
```

Regions and primitives:

- The table is `Table` with `$p={1.5}`, `container={{ $border: false, $rounded: "none" }}`, `head={{ $sticky: "top" }}`, the class `table-fixed`, and a width limit of `max-w-[96rem]`. Rows have no lines.
- A section label is a full-width row (`TableCell header colSpan`) with `border-b` and `ak-ink-60`.
- Columns: the mark (fit), Run (`#4863`, `main`, or `queue`, in mono), Title (grows, `truncate`), Changes, Commit (mono, 7 characters), Age (mono, end aligned).
- The title cell holds the link of the row. The link covers the row (`after:absolute after:inset-0` on the link, `relative` on the row).
- The cursor row is `TableRow selected` (the table needs `role="grid"` for the selected look) with a 2 px brand bar at the start and a `Kbd` with `↵` at the end.
- The Changes cell of a run to review is a meter and a number: three `Frame` segments (`$layer="success"`, `$layer="danger"`, and `$layer="warning" $mix={30}`), `w-16 h-1`, then `22 left` in mono, then `2 ✕` when the run has rejections. Without `counts` (not in the API today) the cell shows `22 left · 2 ✕` only.
- The Changes cell of a run in progress is the state word and the progress (`Capturing 180/600`, progress not in the API today). The cell of a run that needs attention is the state word (`Failed`, `Rerun needed`).
- The freshness in the top bar is `Text` in mono (`12 s`) and an icon `Button` with the label "Refresh". The list also refreshes each 60 s and when the window gets focus.
- On a phone each run is a two-line row and the columns Commit and Age are hidden.

Exact copy: tabs "Inbox", "History", "Status". Placeholder "Search or run a command". Heads "Run", "Title", "Changes", "Commit", "Age". Sections "To review", "In progress", "Needs attention", "Recent". Status line "4 to review · 121 left", hints "row", "open", "view", "search", "keys". Word budget: 35 (the sketch has 32).

| Scenario    | What it shows                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `busy`      | Three sections with 4, 2, and 2 rows. The cursor is on the first row of "To review"                                                                                                 |
| `single`    | One row under "To review" with the cursor. Then the section "Recent" with the five latest runs from `recentRuns`, in `ak-ink-60`                                                    |
| `empty`     | One line in place of the sections: `✓ Nothing to review`, then `Baseline r128` in mono. Then "Recent" with ten rows. The status line says "Nothing to review"                       |
| `first-run` | No table head. "No baseline yet" / "Run the visual tests on main to create one" / link "Setup guide ↗" (14 words)                                                                   |
| `loading`   | The frame, the tabs without a count, the table head, and eight skeleton rows of the real row height. See section 5                                                                  |
| `error`     | The table head, then one row: `▲ Could not load runs`, "Error ID 7f3a9c" with a copy button, and the button "Retry". The status line has the danger tint and says "Retrying in 8 s" |

Keys: Up, Down, `J`, `K` move the cursor. `Enter` opens the run. Right goes to History. `/` opens the command menu.

Removed: the eyebrow "ARIAKIT/ARIAKIT", the heading "Your review queue.", the sentence under it, the three counter tiles, the 240 px cards, the "Review changes" buttons, the state badge on each run, "Attempt 1", the absolute dates, the text button "Refresh runs", and the footer link "View history".

### 4.3 History

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎  Inbox 4   History   Status      [ ⌕ Search or run a command        ⌘K ]      12 s ⟳   DH │ 36
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ [All 40] Needs review 4  Rejected 2  Passed 25  Failed 2  Rerun needed 1  Replaced 4  …      │ 36
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│     Run     Title                                      State      Changes  Commit   Time  Created ▾│ 23
│ Today                                                                                        │ 23
│▌✓   #4852   Fix Select popover border radius in Saf…   Passed           3  5a6b7c8  4m 12s  14:02 ↵│ 29
│ ✕   #4863   Migrate component examples to the new s…   Rejected        27  a1b2c3d  4m 02s  13:10 │
│ →   #4863   Migrate component examples to the new s…   Replaced        27  0d1e2f3  3m 40s  11:16 │ dim
│ Yesterday                                                                                    │
│ ✓   main    Update the tab glider                      Passed           0  7e8ca38  3m 58s  19:36 │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 40 runs                      ↑↓ row  ↵ open  ←→ view  / search  ? keys          ▲ 3 alerts ? │ 23
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────────────┐
│ ◎ Inbox 4  History  Status     ⌕  DH │ 44
├──────────────────────────────────────┤
│ State: All 40 ▾                      │ 44
├──────────────────────────────────────┤
│ Today                                │ 28
│ ✓ #4852               Passed · 14:02 │ 56
│   Fix Select popover border radius…  │
│ ✕ #4863             Rejected · 13:10 │ 56
│   Migrate component examples to th…  │
├──────────────────────────────────────┤
│ 40 runs                  ▲ 3 alerts  │ 28
└──────────────────────────────────────┘
```

Regions and primitives:

- The toolbar is one row (`h-11`, `border-b`). The state chips are `ak.RadioGroup render={<ButtonGroup $size="sm" />}` with one `ak.Radio render={<Button />}` for each state that the loaded runs have, a count in a `ButtonSlot $kind="badge" $p="md"`, and a `ButtonGlider`. An active text filter shows at the end as a chip with `×`.
- The table is the inbox table with more columns: mark, Run, Title, State (the short word), Changes (the number of changed, added, and removed variants, or `—`), Commit, Time (duration), Created. The heads of Created, State, Changes, Time, and Title sort (`TableCell sort`). The default is Created, newest first.
- Day rows ("Today", "Yesterday", "Oct 3") show only when the list is sorted by Created (`groupRunsByDay`).
- A replaced run has `ak-ink-50` on the whole row.
- Created shows the clock time for today and yesterday and a date for older rows. The full date is in `title` and in `dateTime`.
- On a phone the chips become one `ComboboxSelect` ("State: All 40").

Exact copy: chips "All", "Needs review", "Rejected", "Passed", "Failed", "Rerun needed", "Replaced", "Capturing", "Comparing". Heads "Run", "Title", "State", "Changes", "Commit", "Time", "Created". Status line "40 runs", or "6 of 40 runs" with a filter. Word budget: 45.

| Scenario   | What it shows                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full`     | 40 rows in day groups. The cursor is on the first row                                                                                                                 |
| `no-match` | The chip `“datepicker” ×` in the toolbar. One line in the table body: `No runs match “datepicker”` and the button "Clear search". The status line says "0 of 40 runs" |
| `empty`    | No toolbar. "No runs yet" / "Runs appear here after the first capture" (10 words)                                                                                     |
| `loading`  | The toolbar with disabled chips and no counts, the table head, and 14 skeleton rows                                                                                   |

Keys: as the inbox. Left goes to Inbox and Right goes to Status. `/` opens the command menu, and the table filters while the reviewer types.

Removed: the eyebrow, the heading "Run history.", the sentence about the latest 100 runs, the placeholder "Search loaded history…", the select "Result · All results", "Attempt 1" (the attempt shows only when it is above 1, as `×2` after the commit), and the absolute dates.

### 4.4 Status

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎  Inbox 4   History   Status      [ ⌕ Search or run a command        ⌘K ]      12 s ⟳   DH │ 36
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▲ 1 critical · 2 warnings     Database ▓▓▓▓▓▓▓▓╎░ 742.4 / 900.0 MiB     Captures ▓▓▓░░░░░ 3 / 8 │ 36
├────────────────────────────────────────────────────────────────┬─────────────────────────────┤
│     Alert                         Subject        Since  Seen  Count │ Check delivery failed       │
│▌▲   Check delivery failed         71402233915    1h 31m   4m    14 │ Critical · since 13:59      │
│ ▲   Database above warning size   742.4 MiB      2d       3m   576 │                             │
│ ▲   Backup copy failed            backup-1005    6h      12m     3 │ Impact                      │
│                                                                    │ Decisions do not reach the  │
│                                                                    │ GitHub check.               │
│                                                                    │ What to do                  │
│                                                                    │ Check GitHub App access,    │
│                                                                    │ then follow the guide.      │
│                                                                    │ Kind     check-delivery   ⧉ │
│                                                                    │ Code     exhausted          │
│                                                                    │ Subject  71402233915      ⧉ │
│                                                                    │ [ Open guide ↗ ]  Open run  │
├────────────────────────────────────────────────────────────────┴─────────────────────────────┤
│ 3 open alerts                ↑↓ alert  ↵ guide  ←→ view  ? keys            Checked 15:30:12 ? │ 23
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────────────┐
│ ◎ Inbox 4  History  Status     ⌕  DH │ 44
├──────────────────────────────────────┤
│ ▲ 1 critical · 2 warnings            │ 44
│ Database ▓▓▓▓▓▓▓▓╎░ 742.4 / 900 MiB  │
│ Captures ▓▓▓░░░░░ 3 / 8              │
├──────────────────────────────────────┤
│ ▲ Check delivery failed         4m ⌄ │ 56
│   71402233915 · 14 times             │
│ ▲ Database above warning size   3m ⌄ │ 56
│   742.4 MiB · 576 times              │
├──────────────────────────────────────┤
│ 3 open alerts        Checked 15:30   │ 28
└──────────────────────────────────────┘
```

Regions and primitives:

- The summary strip (`h-11`, `border-b`) has the overall mark and counts, then two meters. Each meter is a `Text` label, a `Progress` (`$thickness={1}`, `w-32`, the fill is `{ $layer: "warning" }` above the warning size), and the numbers in mono. The database meter has a 1 px tick at the warning size.
- The alert table is the same `Table`. Columns: mark, Alert (the title), Subject (mono), Since (`firstSeenAt`), Seen (`lastSeenAt`), Count (occurrences, not in the API today).
- The inspector (`w-[22rem]`, `border-s`) follows the cursor row. It has the title, the severity and the start time, "Impact" (not in the API today), "What to do" (the `action` text of the API), a facts list (`Kind`, `Code`, `Subject`, `First seen`, `Last seen`, `Seen`) in mono with copy buttons, the `Button $border` "Open guide ↗", and the link "Open run" when the alert has a run (not in the API today).
- Below 1024 px there is no inspector. A row opens a `Disclosure` with the same content.
- The alert list is read-only, as the guide says. Console has no acknowledge and no dismiss.

Exact copy: "1 critical · 2 warnings", "Database", "Captures". Heads "Alert", "Subject", "Since", "Seen", "Count". Inspector labels "Impact", "What to do", "Kind", "Code", "Subject", "First seen", "Last seen", "Seen", "Open guide", "Open run". Status line "3 open alerts", "Checked 15:30:12". Word budget: 40, plus the two sentences of the selected alert.

| Scenario  | What it shows                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `healthy` | The summary: `✓ No open alerts` and the two meters. The table area has one line in `ak-ink-60`: "Alerts show only here". No inspector. 7 words                                                                                              |
| `alerts`  | Three rows. The cursor is on the critical alert. The inspector shows it                                                                                                                                                                     |
| `loading` | The summary strip as a skeleton, the table head, and three skeleton rows                                                                                                                                                                    |
| `error`   | The summary: `▲ Status unknown` / "The last check failed" / "Error ID 7f3a9c" / button "Retry". Alerts of an earlier good check stay in the table in `ak-ink-50`, with "from 15:02" in the status line. The status line has the danger tint |

Keys: Up and Down move in the alerts. `Enter` opens the guide of the alert. Left goes to History.

Removed: the eyebrow "OPERATIONS", the heading "Service status.", the two sentences under it, the capacity sentences, one card with a paragraph for each alert, the "Technical details" disclosures, the long guide button, the line "No external notifications are sent.", and the bell in the header.

### 4.5 Pull request

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎  ‹ Inbox Q  ›  #4863           [ ⌕ Search or run a command        ⌘K ]                  DH │ 36
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Migrate component examples to the new style recipes        [ GitHub ↗ ] [ Review 24 changes ↵ ]│ 56
│ #4863 · style-recipes → main · @nilsson-sofia · opened 2 d ago                               │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Capture ✓  ›  Compare ✓  ›  Review ● 22 left · 2 rejected  ›  Check ✕ failing               │ 29
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│     Commit          Attempt  State       Changes         Started   Time                      │ 23
│▌✕   a1b2c3d  head         2  Rejected    22 left · 2 ✕   12m       4m 02s                  ↵ │ 29
│ ▲   a1b2c3d               1  Failed      —               40m       1m 03s                    │
│ →   0d1e2f3               1  Replaced    27              3h        3m 40s                    │ dim
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 3 runs                       ↑↓ run  ↵ open  Q inbox  ? keys                    ▲ 3 alerts ? │ 23
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────────────┐
│ ‹  #4863                       ⌕  DH │ 44
├──────────────────────────────────────┤
│ Migrate component examples to the    │
│ new style recipes                    │
│ style-recipes → main · 2 d ago       │
│ [ Review 24 changes ]   [ GitHub ↗ ] │ 44
├──────────────────────────────────────┤
│ Capture ✓ › Compare ✓ › Review ● ›   │ 44
├──────────────────────────────────────┤
│ ✕ a1b2c3d  head · attempt 2          │ 56
│   Rejected · 22 left · 2 ✕ · 12m     │
│ ▲ a1b2c3d  attempt 1                 │ 56
│   Failed · 40m                       │
├──────────────────────────────────────┤
│ 3 runs                   ▲ 3 alerts  │ 28
└──────────────────────────────────────┘
```

Regions and primitives:

- The header block (`h-[4.25rem]`, `border-b`, `px-4`) has the title as `Heading className="mt-0 mb-0 text-[0.9375rem]"`, one meta line in mono `text-xs ak-ink-60`, and two buttons: `Button $border render={<a />}` "GitHub ↗" and `Button $layer="brand"` "Review 24 changes" with a `Kbd` `↵`.
- The pipeline strip (`h-9`, `border-b`) is four steps with marks: Capture, Compare, Review, Check. A step in progress has a `ProgressCircular` mark and numbers (`Capture 180/600`). A failed step has the danger mark. The Check step tells the state of the GitHub check ("failing", "passing", "pending").
- The run table uses `usePull().commits`. Columns: mark, Commit (mono, with a `Badge $forceRounded` "head" on the head commit), Attempt, State, Changes, Started, Time. The cursor starts on `reviewRun`, else on the newest run.

Exact copy: buttons "GitHub", "Review 24 changes" (or "Open run" when no run takes decisions). Steps "Capture", "Compare", "Review", "Check". Heads "Commit", "Attempt", "State", "Changes", "Started", "Time". Badge "head". Status line "3 runs". Word budget: 30.

| Scenario                 | What it shows                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempts`               | As the sketch: three runs, the cursor on attempt 2 of the head commit, the brand button "Review 24 changes"                                                                                 |
| `single`                 | One row with `✓ Passed`. Pipeline: all four steps have a check. The primary button is neutral: "Open run ↵"                                                                                 |
| `no-runs`                | No pipeline and no table. One block: `✓ No visual check needed` / "This pull request changes no captured files" / "GitHub ↗" (12 words)                                                     |
| `loading`                | The crumb `#4863` (known from the URL), a skeleton title, the table head, and three skeleton rows                                                                                           |
| `waiting` (extra)        | The pipeline shows `Capture ◌ 180/600`, and the table has one row in progress. The page opens the run automatically when it is ready. The status line says "Opens the run when it is ready" |
| `capture-failed` (extra) | The pipeline shows `Capture ▲ failed` and a link "Open workflow run ↗"                                                                                                                      |

Keys: Up and Down move in the runs. `Enter` opens the run. `Q` goes to the inbox.

Removed: the card, the icon tile, the eyebrow "VISUAL REVIEW · PULL REQUEST #7", the back link above the card, the two sentences about waiting, and the button "Check again" (the page polls and shows the freshness).

### 4.6 Review workspace

```
1440 (scenario changes)
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ ‹ Inbox Q › #4863 Migrate component examples…  a1b2c3d · attempt 2   [ ⌕ Search or run…  ⌘K ]  ▓▓▒░░ 22 left  DH │ 36
├─────────────────────────────────────┬────┬───────────────────────────────────────────────────────────────┤
│ ◧ M   ⌕ Filter /                 ⇅  │ ▥  │ dialog/focus/open  ⚛◎☾ React · Chromium · Dark  ● Needs review  0.42% · 3 regions     ↶ ⌘Z  Reject X  Approve A ▾ │ 36
│ Screenshot            1 2 3 4 5   Δ │ S  ├───────────────────────────────────────────────────────────────┤
│ Needs review                        │ ±  │ ┌───────────────────────────┐   ┌───────────────────────────┐ │ ← y = 82
│▌dialog/focus/open     ✓[●]● ● · 0.4%│ D  │ │                           │   │              ⌜1⌝          │ │
│ combobox/…/virtual-focus ● ●    1.2%│ ▣  │ │         baseline          │   │         current           │ │
│ menu/actions/open     ● ✕ ●     0.1%│ F  │ │                           │   │     ⌜2⌝                   │ │
│ select/default/open   ● ●       0.2%│ ◨  │ └───────────────────────────┘   └───────────────────────────┘ │
│ Rejected                            │ G  │ Baseline 640 × 400              Current 640 × 400             │
│ toolbar/toggle/pressed ✕ ✓      0.3%│ ⇆  │                                                               │
│ Approved                            │ W  │                                                               │
│ tooltip/default       ✓ ✓       0.1%│ ◐  │                                                               │
│ site/legacy-installation + −        │ B  │                                                               │
│ ▸ Unchanged 7                       │ ── │                                                               │
│                                     │ H  │                                                               │
│                                     │ R  │                                                               │
│                                     │1/3 │                                                               │
│                                     │ +  │                                                               │
│                                     │100%│                                                               │
│                                     │ −  │                                                               │
│                                     │ I  │                                                               │
├─────────────────────────────────────┴────┴───────────────────────────────────────────────────────────────┤
│ Screenshot 1 of 12 · variant 2 of 5    ↑↓ screenshot  ←→ variant  A approve  X reject  ⇧A all  N skip    ✓ Saved  ▲ 3 alerts ? │ 23
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────────────┐
│ ‹  #4863 Migrate…       22 left  ⌕   │ 44
├──────────────────────────────────────┤
│ dialog/focus/open            1/12  ⌄ │ 40  screenshot picker (a Disclosure, in the page flow)
├──────────────────────────────────────┤
│ 1✓ [2● React · Chromium · Dark] 3● 4●│ 40  variant strip (scrolls sideways)
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │ ← y = 132
│ │            baseline              │ │
│ └──────────────────────────────────┘ │
│ Baseline 640 × 400                   │     stage: 624 px (74% of the height)
│ ┌──────────────────────────────────┐ │
│ │            current       ⌜1⌝     │ │
│ └──────────────────────────────────┘ │
│ Current 640 × 400                    │
├──────────────────────────────────────┤
│ [▥][±][▣][◨][⇆][◐]    ⌖   − 58% +   │ 40  view row
├──────────────────────────────────────┤
│ ↶ Saved        ✕ Reject   ✓ Approve  │ 56
└──────────────────────────────────────┘
```

#### Pixel budget

| Measure at 1440 x 900                   | Today     | Console                                                                                                                                            |
| --------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome above the first screenshot pixel | 408 px    | 82 px (top bar 36, context bar 36, stage padding 10)                                                                                               |
| Chrome below the stage                  | 61 px     | 23 px (status line)                                                                                                                                |
| Stage height                            | 431 px    | 805 px (89% of the height)                                                                                                                         |
| Stage area, matrix open                 | n/a       | 1049 x 805 px = 65% of the viewport                                                                                                                |
| Stage area, matrix closed (`M`)         | n/a       | 1401 x 805 px = 87% of the viewport                                                                                                                |
| Two 640 x 400 images side by side       | n/a       | 510 x 319 px each, 25% of the viewport                                                                                                             |
| Two 1280 x 720 images                   | 13 to 30% | Stacked at 654 x 368 px each, 37%. One image (Diff, Current, Swipe, Blink): 1029 x 579 px, 46%. With the matrix closed: 1280 x 720 px at 100%, 71% |

At 390 x 844: 124 px above the stage (today 518), 96 px below, the stage has 624 px (74%).

#### Top bar (run)

- Crumbs: `‹ Inbox` with `Q`, `#4863` (to the pull request page), the title (`truncate`), then `a1b2c3d · attempt 2` in mono `ak-ink-60` (the commit links to GitHub).
- Run meter at the end: a `PopoverDisclosure` with three `Frame` segments (approved, rejected, left; `w-24 h-1`) and `22 left` in mono. The popover lists each count with its mark: 3 approved, 2 rejected, 22 left, 6 auto-approved, 7 unchanged. "22 left" is the only run count on the screen.
- When the run takes no decisions, a mark and a word replace the meter: `✓ Passed`, `▲ Failed`, `Read-only` with a lock, or `Comparing 6/16` with a ring.

#### Matrix (screenshot navigation and variant switching)

- Primitive: `Table role="grid"` with `$p={1}`, `container={{ $border: false, $rounded: "none" }}`, and a sticky head. The pane scrolls alone.
- Pane header (`h-9`): the toggle `Button` (PanelLeft icon, `M`), a filter trigger (`Input render={<button />}` with the placeholder "Filter" and `/`) that opens the command menu, and a sort `Button` (icon only, tooltip "Order: declared" or "Order: largest change").
- Column head (`h-7`): "Screenshot", the column numbers `1 2 3 …` in mono `ak-ink-50` (these are the variant keys), and `Δ`.
- Sections are the six groups of `session.groups`, in this order, with these labels: "Problems", "Needs review", "Comparing", "Rejected", "Approved", "Unchanged". Skip an empty group. A section label has no count. "Unchanged" is closed by default and shows its count, because its rows are hidden: `▸ Unchanged 7`.
- A row is one screenshot: the key in mono (`dialog/focus/` in `ak-ink-50`, `open` in full ink; the directory part truncates first), one cell for each variant in declared order, and `Δ` (the largest change ratio of the row, or `size` when the dimensions changed).
- A cell is a `Button $size="xs" $rounded="sm"` with one mark. Its accessible name is the full variant label and the status ("React · Chromium · Dark, needs review"). A tooltip shows the same. The cursor cell has the brand ring. In the product each cell is a router link with `aria-current`.
- The cells show where the change is inside the variant set: `· · ● · ●` means that variants 3 and 5 changed.
- Mouse: a click on a cell selects that variant. A click on the key selects the first variant of the row that needs review.
- Keys: Up and Down change the row (the row opens its remembered variant; the first visit opens the first variant that needs review). Left and Right change the cell. `1` to `9` select a column. `J` and `K` go through the changes in reading order. `N` and `Shift+N` go to the next or previous variant that needs review.
- Width: 22rem. If a run has more than 8 variants in one screenshot, the pane uses 26rem. Cells after column 12 fold into a `+n` cell that opens a popover list.
- The matrix is closed by default when the run has one changed screenshot (`one-change`) and below 1024 px. When it is closed, the context bar shows the variant strip in its place, so the screen always has exactly one variant switcher.

```tsx
<TableRow selected={item.key === session.item?.key}>
  <TableCell header="row" className="min-w-0 truncate font-mono text-xs">
    <Text className="ak-ink-50">{directory}/</Text>
    {leaf}
  </TableCell>
  {columns.map((index) => {
    const variant = item.variants[index];
    const cursor = variant?.id === session.variant?.id;
    return (
      <TableCell key={index} $fit>
        {variant && (
          <Button
            $size="xs"
            $rounded="sm"
            $p={0.5}
            aria-current={cursor ? "true" : undefined}
            $border={cursor ? 1.5 : false}
            $borderType="ring"
            $edge="brand"
            $edgeRaw
            aria-label={`${variant.name}, ${reviewStatusLabels[variant.status].plain}`}
            onClick={() => session.select({ itemKey: item.key, variantKey: variant.key })}
          >
            <ButtonSlot>
              <Mark variant={variant} />
            </ButtonSlot>
          </Button>
        )}
      </TableCell>
    );
  })}
  <TableCell numeric $fit className="font-mono text-xs ak-ink-60">
    {delta}
  </TableCell>
</TableRow>
```

#### Variant strip (matrix closed, and on a phone)

`Nav aria-label="Variants" $layout="horizontal" glider={{ $kind: "bar" }}` with one `NavLink` for each variant. A chip that is not selected shows its number and its mark (`1 ✓`). The selected chip also shows the brand marks and the full label (`2 ● React · Chromium · Dark`). This is the contract form (links with a bar glider) with the verdict on each chip.

#### Context bar (identity and decision)

Start, in this order: the screenshot key (mono, 500), the framework, browser, and scheme marks, the full variant label ("React · Chromium · Dark"), the mark and the status word ("Needs review"), then the change in mono `ak-ink-60` (`0.42% · 3 regions`, or `640 × 400 → 640 × 422 · +22 px` with a warning mark when the size changed). The status of the selected variant shows here one time. The display name ("Dialog with initial focus") is in the inspector.

End: `Button` Undo (icon, tooltip "Undo", `Kbd` `⌘Z` or `Ctrl Z`), `Button $border` "Reject" with an `X` icon and `Kbd` `X`, and `Button $layer="brand"` "Approve" with a `Check` icon and `Kbd` `A`. A menu button (ChevronDown, `ak.MenuButton`) follows Approve. Its menu has "Approve all 5 variants" with `⇧A` and "Reject all 5 variants" with `⇧X`. The menu button is hidden when the screenshot has one changed variant.

This is the layout that decision U02 selected: the decisions are in the main header and the image takes the remaining area.

#### Tool rail (compare modes, marks, zoom)

`Layer` with `border-e`, `w-12`, one column.

1. View: `ak.RadioGroup render={<ButtonGroup $layout="vertical" $p="none" />}` with six `ak.Radio render={<Button />}` and a `ButtonGlider`. Each button shows an icon above its key letter. Each has a tooltip with the name and the key.

| Key | Name         | Stage                                                                                                                                                                             |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S` | Side by side | Baseline and current in two panes. The panes are side by side or stacked: use the layout that gives the larger scale                                                              |
| `D` | Diff         | The current image at 35% opacity with the red mask at 100% on top. A slider in the tooltip popover sets the opacity of the image from 0 (mask only, as today) to 100%             |
| `F` | Current      | The current image only                                                                                                                                                            |
| `G` | Baseline     | The baseline only                                                                                                                                                                 |
| `W` | Swipe        | One image area with a vertical divider: baseline at the start side, current at the end side. The divider is a native range input (`data-shortcuts-ignore`) that the pointer drags |
| `B` | Blink        | One image area that alternates baseline and current each 600 ms. The caption tells the image that shows. `B` again stops it                                                       |

2. `H`: change marks on or off (default on). `R`: next region, with the readout `1/3` under it.
3. `+`, the zoom readout (`100%`, or `Fit`), `−`, `0`. Zoom steps: fit, 50, 100, 200, 400%.
4. At the bottom: `I`, the inspector toggle.

A mode that needs both images (Diff, Swipe, Blink) is disabled for an added or removed variant, and its tooltip tells why ("Needs a baseline and a current image").

#### Stage

- `Layer $darken` with `p-3`. Images are aligned to the top and centered in the pane, so the first pixel does not move between variants. The caption is under each image: "Baseline" or "Current" and the size in mono (`640 × 400`).
- Fit scales down to the pane. A small image scales up by whole factors (2x, 3x, 4x) while it fits, with `[image-rendering:pixelated]`.
- All panes share one zoom and one pan. A drag pans. The wheel scrolls. `Shift` with an arrow pans by half a pane. The arrows alone never pan (decision U04 stays).
- Change marks: corner brackets in the brand color around each region, at least `size-6`, with the region number in mono outside the top corner. Brackets show on the current image in each mode. `R` centers the next region and zooms to it when the region is smaller than 48 px on screen. The mask stays red (rule A16).
- A checkerboard shows only under a transparent image, not on the whole stage.
- An added variant has one pane, "Current", with the caption `+ Added · no baseline`. A removed variant has one pane, "Baseline", with the caption `− Removed · no current image`. An unchanged variant whose current image was not uploaded has one pane, "Baseline", with the caption "Unchanged · current not stored".
- Loading: the pane has the exact size of the image (the model has width and height). A `Progress` line (`$thickness={0.5}`) is at the top of the stage. The old image is removed at once (rule A24).
- Load failure: a small block in the pane: `▲ Image did not load` and the `Button $border` "Retry images". The decision buttons are disabled.

#### Decision flow

1. `A` or `X` works only when the images of the cursor variant are decoded (invariant I1). Before that, the buttons are disabled with `aria-busy`, and a key press shows "Images still loading" in the status line for 1.5 s. The press is not stored.
2. The mark flips at once. The cursor goes to the next variant that needs review in the visible order (the filter applies) and wraps one time. The meter counts down.
3. The status line echoes the decision for 2.5 s: `✓ Approved · dialog/focus/open · Dark`. Then the key hints return.
4. Save state, at the end of the status line: `↑ Sending 2`, then `☁ 2 queued · safe to close`, then `✓ Saved`, which leaves after 1.6 s. A click on this segment opens a `Popover` "This session" with the decisions of `session.history` (newest first). The newest has the button "Undo".
5. `Shift+A` and `Shift+X` change all changed variants of the screenshot as one command. All its cells flip together. The status line says `✓ Approved 5 variants · 3 not viewed · Undo ⌘Z`. The key path and the menu path are equal, and neither has a dialog. "Not viewed" counts the variants whose images this session did not show.
6. Undo (`Cmd/Ctrl+Z` or the button) takes back the last saved decision and returns the cursor to it. The status line says `↶ Undone · dialog/focus/open · Dark`. The Undo button is disabled while a save runs (invariant I5).
7. A refusal stays in the status line, with the warning tint, until the next action: `▲ Not changed · “Solid · Chromium” is protected` and the button "Next eligible".
8. A failed save gives the status line the danger tint: `▲ Not saved · 2 decisions returned` with the buttons "Retry" (the same command) and "Reload run". The marks go back. New decisions are blocked until one of the two buttons is used.
9. At the first or last row, an arrow shows "First screenshot" or "Last screenshot" for 1 s.

#### Progress and completion

Progress is the meter in the top bar and the marks in the matrix. Nothing else counts.

When no variant needs review, the stage shows the completion panel (`Frame $border $rounded="xl" $p="1.5rem"`, `max-w-[30rem]`, centered):

```
✓ Review complete
25 approved · 2 rejected · 6 auto-approved
◌ Updating the GitHub check
[ Next run ↵ ]   [ #4863 on GitHub ↗ ]   Inbox Q
```

- The check line has three forms: `◌ Updating the GitHub check`, `✓ The check passed on GitHub`, `✕ The check fails: 2 rejected`. A fourth form covers a delivery problem: `▲ GitHub did not take the update` with a link to Status.
- "Next run" opens the next run of the inbox that needs review. With none, the button is "Inbox".
- The status line has the success tint and says "Review complete". Undo still works and returns to the last variant.
- A selected cell replaces the panel with its images.

#### Details (inspector)

`I` opens a pane at the end side (`w-[20rem]`, `border-s`; a `Popover` below 1280 px). It is closed by default. Content, as one facts list in mono: the screenshot name, the full variant label with marks, the status with the reviewer and the time (`Approved by @diegohaz · 12m`), Changed (`1,204 px · 0.42% · 3 regions`), Size, Threshold, Engine, Baseline (`r128`), Commit, Attempt, and the run identifier. A `Button` "Copy debug info" copies identifiers and digests. A region list (index, size, position) follows; a click selects the region.

#### Scenarios

| Scenario     | What it shows                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `changes`    | As the sketch. 12 rows in the sections "Needs review", "Rejected", "Approved", and the closed "Unchanged 7". The cursor is on the first variant that needs review. The meter says "22 left"                                                                                                            |
| `large`      | 120 screenshots. The sections are the same; "Unchanged" (472 variants) is closed, so the list shows only work. The meter says "79 left". The status line says "Screenshot 1 of 120 · variant 1 of 5". In the product the rows must be windowed                                                         |
| `one-change` | The matrix is closed. The context bar has the strip with one chip. The stage has the full width. After the one decision, the completion panel shows                                                                                                                                                    |
| `passed`     | All rows are in "Approved". The stage shows the completion panel with `✓ The check passed on GitHub` until a cell is selected. The top bar says `✓ Passed`. The decision buttons stay, because a decision can change                                                                                   |
| `read-only`  | The top bar says "Read-only" with a lock. The context bar has no decision buttons. In their place: "Replaced by attempt 3" and the `Button $border` "Open current run". The status line has the warning tint and says "Read-only · decisions are closed". `A` and `X` show "Read-only run"             |
| `comparing`  | The top bar shows `Comparing 6/16` with a ring. Pending cells have the dashed circle. A pending variant shows empty panes with the caption "Comparing". The decision buttons are disabled with the tooltip "Review opens when the comparison ends" (invariant I9). Finished variants can be viewed     |
| `problems`   | The section "Problems" is first and its cells have the error mark. The top bar says `▲ Failed`. For an error variant the stage shows `▲ Comparison failed` and the reason from `variant.error`. The variant with a broken current image shows the load failure block with "Retry images". No decisions |
| `loading`    | See section 5                                                                                                                                                                                                                                                                                          |

Exact copy on the default screen: "Inbox", "Search or run a command", "22 left", "Filter", "Screenshot", the section labels, "Needs review", "regions", "Reject", "Approve", "Baseline", "Current", "Screenshot 1 of 12 · variant 2 of 5", the hints "screenshot", "variant", "approve", "reject", "all", "skip", and "Saved". Word budget: 40 (the sketch has 36).

#### Removed from the current run page

The three header links, the "Queue" link, the metadata strip, the 28 px screenshot heading and its line "0.05% changed · 120 changed pixels", the row of variant chips while the matrix is open, the view and zoom toolbar row, the 48 px pane captions, the eight pan buttons, the bottom decision bar and its second row, the footer with keyboard help, the "Shortcuts on" button, and the dead "Recompare stored run" button, the "Accepted (N)" disclosure, the 26 px thumbnails, the "Screenshots · N items" header, the text "Changes need review", the native progress bar, the whole-item dialog, and all banners. Review state shows in two places (the mark in the matrix and the word in the context bar), not in 6 to 11.

## 5. Loading

Rules for each page:

- The frame (top bar, tabs or crumbs, table head, status line with the key hints) renders from the static shell at 0 ms. It needs no data. The key hints are readable during the wait.
- A skeleton row has the height of a real row. It is a `Frame $lightnessOffset={1} $rounded="sm"` bar for each column, with fixed widths from a short list. It is static before 300 ms and pulses after.
- The text "Checking access" does not exist. The status line tells the wait in seconds.
- Data of the last visit, when the app has it, shows at once in `ak-ink-50` with "from 15:02" in the status line.
- A late request never blanks the page. A refresh keeps the rows and runs the loading line under the top bar.

| Page         | 0 ms                                                                                                                                                                                                                                                                           | 300 ms                                                                                                                                                                                                                          | 1 s                                                                                                                                                                                                                                       | 5 s                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in      | The frame and the skeleton of the requested page (the app assumes a session)                                                                                                                                                                                                   | The answer 401 arrives: the panel shows over the canvas. No text names the check                                                                                                                                                | After a press: the button says "Opening GitHub"                                                                                                                                                                                           | Status line: "Opening GitHub · 5 s" and the link "Try again"                                                                             |
| Inbox        | Frame, tabs without a count, table head, 8 static skeleton rows                                                                                                                                                                                                                | Rows replace the skeleton in place. The cursor is on the first row. The status line has the counts                                                                                                                              | If no data: the skeleton pulses and the status line says "Loading runs · 1 s"                                                                                                                                                             | "Still loading · 5 s". After 8 s the button "Retry" is added                                                                             |
| History      | Frame, toolbar with disabled chips, table head, 14 skeleton rows                                                                                                                                                                                                               | Chips get counts, rows fill                                                                                                                                                                                                     | "Loading runs · 1 s"                                                                                                                                                                                                                      | "Still loading · 5 s"                                                                                                                    |
| Status       | Frame, summary skeleton, table head, 3 skeleton rows. The alert request starts at the same time as the run request                                                                                                                                                             | Summary, meters, rows, and the inspector of the first alert                                                                                                                                                                     | "Checking status · 1 s"                                                                                                                                                                                                                   | "Still checking · 5 s", then "Retry"                                                                                                     |
| Pull request | Frame, the crumb `#4863` from the URL, a skeleton title, table head, 3 skeleton rows                                                                                                                                                                                           | Title, pipeline, and rows. The cursor is on the run to review                                                                                                                                                                   | "Loading #4863 · 1 s"                                                                                                                                                                                                                     | "Still loading · 5 s"                                                                                                                    |
| Review       | Frame. The crumbs have the title and the commit when the reviewer came from the inbox, else a skeleton bar. Matrix: section label and skeleton rows (the row count comes from the inbox row when known, else 12). The rail is disabled. The stage has two dashed pane outlines | The list data arrives: real rows and marks, the cursor on the first variant that needs review, the real context bar, panes of the exact image size, the loading line at the top of the stage. The decision buttons are disabled | The first images are decoded and shown. The decisions are enabled. The app loads the images of the next two changes in the background. If the images are late: the caption says "Loading" and the status line says "Loading images · 1 s" | The matrix is usable (the reviewer can move in it). The status line says "Still loading · 5 s". After 8 s the stage shows "Retry images" |

In the lab, use `useSimulatedLoad` to show these steps. The `loading` scenario is the still picture of the 0 ms column with the pulse on.

## 6. Risks, tradeoffs, and earlier decisions that this direction revisits

### Kept as selected

- U02: one shell, decisions in the main header, the image takes the remaining area. Console completes it.
- U04: arrows work page-wide and never pan. Pan is on drag, on the wheel, and on `Shift` with an arrow.
- U05: a work list first, with a separate history view. Console does not merge them.
- D17 (compact, flat controls), D02 and D21 (variant scope, `Shift` for the whole screenshot), D03 and D28 (advance and wrap one time), D31 (Undo for the session), A06 (commit and attempt above the images), A07 (the full variant label in the context bar), A16 (red mask), A22 (Diff is unavailable without two images), A24 and A25 (no stale pixels, decisions wait for the images), K8 (the next variant follows the visible order), and the invariants I1 to I9.
- `G` stays the Baseline key, so the left hand keeps `A S D F G` on one row. For this reason Console has no `G` then letter sequences.

### Revisited (the lab must mark each one on the variant)

| Decision or rule                                                                                            | What Console does                                                                                                    | Why                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `feedback-ui.md:96` "do not add a hotkey registry" and `:73` "keep browser modifier shortcuts" (group G10)  | A command menu on `Cmd/Ctrl+K`, and one key table that renders the hints, the key map, and the menu                  | The lens needs a command menu. The menu also opens from the field and from `/`, so the chord can be removed          |
| X5, U03, and L1 (variants are navigation links with a bar glider; no grid unless the interaction is a grid) | A matrix with `role="grid"` in which each cell is a variant                                                          | The interaction is a two-axis cursor. The link strip with a bar glider returns when the matrix is closed             |
| K6 (keys `1` to `6`)                                                                                        | `1` to `9`                                                                                                           | The column numbers are on screen                                                                                     |
| K13 (modes S, D, F) and the guide (G)                                                                       | Adds `W` (Swipe) and `B` (Blink). Diff shows the mask on a faded image, with a slider to mask only                   | The audit found no overlay, swipe, or blink. The mask is transparent, so the backend does not change                 |
| P02 (load the diff when selected; `eager` and `idle` rejected)                                              | Change marks are on by default, so regions are needed before Diff is selected                                        | If the model has the regions as numbers, the mask still loads on demand. If not, the mask loads after the two images |
| A19 (fit, 100%, 200%)                                                                                       | Adds 50% and 400%, and whole-factor scale-up for small images                                                        | Small component images and tall pages                                                                                |
| A21 and D30 (a labeled empty pane for a removal)                                                            | One pane with a caption for added and removed variants                                                               | The one image gets the stage                                                                                         |
| A13 and L4 (the words "Accepted" and "Accepted automatically")                                              | Six sections by status. The marks `+` and `−` and the word "auto-approved"                                           | One vocabulary. Screenshots with a new variant stay visible in "Approved"                                            |
| A12 and D29 (declared order)                                                                                | The default stays. A sort by the largest change is one button                                                        | A few large changes can hide among many small ones                                                                   |
| A11 (thumbnail of the first declared variant)                                                               | No thumbnails                                                                                                        | A 26 px thumbnail shows nothing. The rule has no writer today                                                        |
| The pinned whole-item dialog (finding RULE-06)                                                              | No confirmation on the button path or the key path. The status line reports the count that was not viewed, with Undo | Both paths become equal. Speed. The risk is the one that D02 names: a variant is accepted without inspection         |
| X4 (visible buttons and a shortcut toggle)                                                                  | The toggle is in the key map panel and is stored. The `?` button is always in the status line                        | The footer is gone                                                                                                   |
| The key `[`                                                                                                 | `M` for the matrix. No bracket keys                                                                                  | Layouts that need AltGr for brackets                                                                                 |
| K3 (first visit opens the first variant)                                                                    | The first visit opens the first variant that needs review, as the tests pin                                          | The contract and the tests disagree. This is question 12 of the contract map                                         |
| D53 and A27 (Chrome Desktop; list above the viewer on narrow widths)                                        | A phone layout exists for exploration. It keeps the list above the viewer (one collapsed row) and stacked images     | Phone review is outside the selected scope                                                                           |

### Risks

1. Learning cost. The rail of icons with letters and the matrix of marks are cryptic on the first visit. Mitigations: tooltips with names, the docked key map, the command menu that lists each command with its key, and the key hints in the status line.
2. New single-letter keys (`J K N R W B H M I Q / ?`). They need the off switch (WCAG 2.1.4), and the off switch must hide the keycaps.
3. `Shift` has three jobs: whole screenshot (`A`, `X`), reverse (`N`, `R`), and pan (arrows). Each needs a second key, and no held `Shift` is a mode.
4. Density. Text is 12 and 13 px and matrix rows are 26 px. This meets the 24 px target size, not 44 px. Touch layouts use 44 px.
5. Real data has 626 screenshots and 3,832 variants. The closed "Unchanged" section solves the default view, but the open section needs windowed rows (decision P04).
6. A wide matrix. A screenshot with more than 12 variants needs the `+n` cell.
7. The status line is small. A refusal or a failed save uses a tint and stays until the next action, but a reviewer who looks only at the stage can miss a 1.5 s message.
8. The whole-item command without a dialog can accept a variant that the reviewer did not see. The "not viewed" count and Undo are the only guards.
9. Existing browser tests pin names such as "Approve & next A", the "Variants" navigation, the "Screenshots" dialog, and "Accepted (1)". This direction breaks most of the 20 pins in the contract map.

## 7. Notes for builders

### Files

- One page variant for each surface, with the id `console`: `src/explorations/pages/{sign-in,inbox,history,status,pull,review}/console.tsx`.
- Put shared parts in `src/explorations/shared/console/` (frame, top bar, status line, mark, keycap, run table, command menu, key map panel, list keys). The registry loads only `explorations/{pages,components}/*/*.tsx`, so this folder is not a variant.
- Link between surfaces with `LabLink` (`to="review" scenario="changes"`, `to="pull" scenario="attempts"`, `to="inbox" scenario="busy"`).

### Hooks

- Review: `useReviewSession(scenario)` with the default order `status`, and `useReviewShortcuts`. The lab keys `J K N W B H + - 0` already do what Console needs. Turn off the two lab keys that Console does not use and add the Console keys:

```tsx
useReviewShortcuts(session, {
  keys: {
    o: () => {},
    u: () => {},
    r: (event) => (event.shiftKey ? viewer.previousRegion() : viewer.nextRegion()),
    m: () => setMatrixOpen((open) => !open),
    i: () => setInspectorOpen((open) => !open),
    q: () => router.navigate({ href: inboxHref }),
    "/": () => setCommandOpen(true),
    "?": () => setKeysOpen((open) => !open),
    arrowleft: (event) => (event.shiftKey ? pan(-1, 0) : session.previousVariant()),
    arrowright: (event) => (event.shiftKey ? pan(1, 0) : session.nextVariant()),
    arrowup: (event) => (event.shiftKey ? pan(0, -1) : session.previousItem()),
    arrowdown: (event) => (event.shiftKey ? pan(0, 1) : session.nextItem()),
  },
});
```

- The hook ignores each key with Cmd or Ctrl except `Z`, and it is off while the session loads. So `Cmd/Ctrl+K`, `/`, and `?` also need one small document listener in the shared frame. Use the same guards: no action in a text field, a menu, or a dialog, and no repeat.
- List pages (`useInbox`, `useHistory`, `useStatus`, `usePull`) need one shared list hook for Up, Down, `J`, `K`, `Enter`, Left, Right, and `Q`. `Enter` must not fire when the focus is on a button, a link, or a field.
- The session has `save.status` `saving`, `saved`, and `error` only. Show "Sending n" for `saving`. Show the "Queued" form in a component surface, as a still state.
- Use `failNextSave()` in the lab to show the failed save state.
- Do not use `clear`, `approveRemaining`, `acknowledge`, or `dismiss`.

### Primitive rules for this direction

- Bands are `Layer` or `div` elements. Do not wrap a band in a padded `Frame` (pitfall 2).
- Do not use `Shell` for these pages. The frame is a CSS grid with `h-dvh`, and each pane scrolls alone. `Shell` has a 20 px radius and a page scroll, which this direction does not use.
- Put text in the `*Label` part and each icon or key in a `*Slot` part. A keycap in a button is `ButtonSlot $kind="shortcut"` with a `Kbd`.
- Each icon-only control has an `aria-label` and a tooltip. A control with a key has `aria-keyshortcuts`, and the keycap is `aria-hidden`, so the key is not part of the accessible name.
- Popovers, menus, and the command menu need `portal`.
- Gliders need CSS anchor positioning (Chrome).
- Check each page with `?theme=light`, with the radius control at "Sharp" and "Round", and with the density control at "Compact".

### Used, but not in the API today

- Runs: `counts`, `progress`, `error`, `commitMessage`, `durationMs`, `author`, `branch`, `mergeGroupPullRequests`.
- Pull request: `title`, `author`, `branch`, `baseBranch`, `createdAt`, `runs`, and the state of the GitHub check.
- Review: `pullRequest`, `counts`, `progress`, `supersededBy`, `regions`, `reviewerLogin`, `decidedAt`.
- Alerts: `severity`, `impact`, `occurrences`, `runId`.
- Sign-in: the repository name for a guest and the account name of a refused person.
- Functions: the viewer modes Swipe and Blink, zoom 50% and 400%, change marks and region steps, the six status groups, the next variant inside a filter, `N` and `J`/`K`, sort in the history and in the matrix, the text filter in the inbox, the delivery state of the check on the completion panel, the session log, the "not viewed" count, and the stored shortcut toggle.

### Component surfaces that this direction implies

Each can be a `console` variant in the component explorer: status mark (all states of the vocabulary), run row (inbox, history, and phone forms), matrix row and cell, variant chip strip, tool rail, context bar with the decision group, status line (hints, echo, sending, queued, saved, refusal, not saved, complete, read-only), run meter with its popover, command menu, key map panel, viewer pane (caption, brackets, loading, failure, one-image states), completion panel, alert inspector, pipeline strip, and skeleton rows.
