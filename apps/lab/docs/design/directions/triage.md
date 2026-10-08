# Triage

A design brief for the Visonaut design lab. Builders can implement it without more questions. Sizes in px assume the 14 px base font that this direction sets on its root (`text-sm`), where one spacing step is 3.5 px. All classes use spacing steps, so the Look controls (brand, canvas, radius, density) apply.

Recommended files: one page variant with the id `triage` in each surface folder (`src/explorations/pages/<surface>/triage.tsx`) and one shared module for the parts named in this brief (`TriageFrame`, `Rail`, `ListPane`, `RunRow`, `ChangeRow`, `ItemHeader`, `Receipt`, `ReadingBar`, `RunPreview`, `Stage`, `BatchPane`, `ZeroState`, `KeysDialog`, `StatusMark`).

---

## 1. Concept

**Name:** Triage

**Tagline:** Review screenshots like mail: one list, one reading pane, and a run that ends at inbox zero.

**The idea in five sentences**

1. Every page uses one frame: a slim rail for the three mailboxes (Inbox, History, Status), a list pane, and a reading pane.
2. The list is the product: a row is one thing that waits for the maintainer (a run in the inbox, a changed variant in a run, an alert in status).
3. The reading pane always shows the row under the cursor, `J` and `K` move the cursor, `A` and `X` decide, and `M` marks rows for one batch decision.
4. A row leaves the list when the maintainer deals with it, so the count at the top of the list is the only progress display.
5. A run ends with an empty list, and `Enter` opens the next run in the same frame.

**Signature moment**

The maintainer presses `A`. The row slides out of the list, "To review 22" becomes "To review 21", and the next comparison is already in the reading pane. At zero the list is empty, the reading pane says "Run passed", and one line shows the GitHub check as it turns green.

**Principles**

1. One list and one reading pane on every page. The list is the product.
2. A row is one decision. A decided row leaves the list, and the count is the progress.
3. Home-row keys (`J K A X M Enter`), printed on the control that they operate.
4. The reading pane belongs to the pixels: one 42 px bar, then the screenshot.
5. A batch shows the diff of every target before it saves, as one command with one Undo.

---

## 2. Visual system

### Layers

| Surface                                     | Layer                                                                                  | Edge                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Page and rail                               | canvas (the `body` layer; the rail is a `Layer` with the parent color)                 | none                                                                                           |
| List pane                                   | `Frame $lightnessOffset={0.5}` (lighter on dark, darker on light)                      | one seam: `border-e`                                                                           |
| List header rows, sticky screenshot headers | `Frame $layer` (paints the pane color, so rows scroll under it)                        | none                                                                                           |
| List footer (the outbox)                    | `Frame $layer`                                                                         | one seam: `border-t`                                                                           |
| Cursor row                                  | flat glider of the `ButtonGroup`                                                       | none                                                                                           |
| Marked row                                  | `$layer="brand" $mix={10}` from state                                                  | none                                                                                           |
| Reading bar                                 | canvas (no paint)                                                                      | none                                                                                           |
| Stage                                       | sunken: `Frame $darken`                                                                | none; the image has a 1 px ring (`$border $borderType="ring"`) so that its boundary is visible |
| Popover, dialog, menu                       | the defaults of the primitives                                                         | their own border and shadow                                                                    |
| Brand surface                               | one for each view: `Approve` in a run, `Review 22` in the inbox, `Sign in with GitHub` | none                                                                                           |

Rules:

- The frame has two seams only (`border-e` on the list pane and `border-t` on the footer). No other borders. No cards in lists. No checkerboard behind images.
- Rows are inside a frame with less than 1rem of padding, so each row `Button`, each `Badge`, and each `Kbd` gets `$forceRounded` (pitfall 2).
- Status color is always a tinted icon plus a word. A colored fill is used only for callouts (`$mix={12}`) and the completion card.

### Type

Fonts: Inter Variable for text, JetBrains Mono Variable for identifiers.

| Use                                                     | Class                   | Size    |
| ------------------------------------------------------- | ----------------------- | ------- |
| Root, row labels, bar titles, buttons                   | `text-sm`               | 14 / 20 |
| Meta lines, captions, legend, group counts              | `text-xs`               | 12 / 16 |
| Preview heading, zero-state heading (one for each view) | `text-lg font-semibold` | 18      |
| Sign-in heading                                         | `text-xl font-semibold` | 20      |

- Weights: 400 for text, 500 for run titles in "To review", screenshot names, the cursor row, and rows that are not opened yet, 600 for the one heading of a view.
- Mono (`font-mono text-xs`): `#4863`, short SHAs, change ratios (`0.15%`), image sizes, error IDs, keys.
- Numbers that change use `tabular-nums`. No text is smaller than 12 px. Soft text uses `ak-ink-70` (meta) and `ak-ink-60` (captions and legend). No `opacity-*` on text.
- Sentence case everywhere. No trailing period in headings, labels, and buttons.

### Spacing, density, radius, icons

| Part                           | Class           | px at 14 px |
| ------------------------------ | --------------- | ----------- |
| Rail width                     | `w-12`          | 42          |
| List pane width (full / spine) | `w-96` / `w-12` | 336 / 42    |
| List header, reading bar       | `h-12`          | 42          |
| Tabs row, filter row           | `h-10`          | 35          |
| Change row, screenshot header  | `h-8`           | 28          |
| Run row, alert row (two lines) | `h-14`          | 49          |
| List footer                    | `h-9`           | 32          |
| Stage caption gutter           | `h-7`           | 25          |
| Stage padding                  | `p-3`           | 11          |

- On a coarse pointer (`pointer-coarse:`) change rows are `h-13` (46 px) and run rows are `h-17` (60 px).
- Radius: rows `md`, tiles and thumbnails `lg`, callouts and cards `xl`, the sign-in card `2xl`, badges `full`. The panes have no radius, because they are full-height columns.
- Icons: `lucide-react` at 16 px with `strokeWidth={1.5}` (18 px in the rail, 14 px for row marks). The framework and browser marks (React, Solid, Chrome, Firefox, Safari) appear in the reading bar title, in the filter menu, and on batch tiles. They do not appear in list rows, where color means status.

### One status vocabulary

One word, one color role, one shape, on every page. The mark is an icon inside `Text $text={role}` (pitfall 6). A screen-reader name always contains the word.

| Word               | Used for                          | Role             | Icon                                               | Shape                   |
| ------------------ | --------------------------------- | ---------------- | -------------------------------------------------- | ----------------------- |
| Needs review       | a change without a verdict; a run | warning          | `CircleDot`                                        | ring with a dot         |
| Rejected           | a change; a run                   | danger           | `CircleX`                                          | circle with a cross     |
| Approved           | a change that a person approved   | success          | `CircleCheck`                                      | circle with a check     |
| Auto-approved      | an added or removed variant       | neutral, ink 60  | `CheckCheck`                                       | double check, no circle |
| Passed             | a run                             | success          | `CircleCheck`                                      | the same as Approved    |
| Same               | a variant without a change        | neutral, ink 40  | `Minus`                                            | dash                    |
| Capturing          | a run that waits for screenshots  | neutral          | `CircleDashed`                                     | dashed ring             |
| Comparing          | a run or a variant                | neutral          | `ProgressCircular` (with a value when it is known) | open ring               |
| Failed             | a run or a variant                | danger           | `TriangleAlert`                                    | triangle                |
| Rerun needed       | a run on an old baseline          | danger           | `RotateCw`                                         | arrow ring              |
| Replaced           | a run with a newer attempt        | neutral, ink 60  | `CornerUpRight`                                    | bent arrow              |
| Critical / Warning | an alert                          | danger / warning | `OctagonAlert` / `TriangleAlert`                   | octagon / triangle      |

- Kinds are tags, not states: `Added` and `Removed` are words in the trailing column of a row, in place of the change ratio.
- "Not opened" is not a status. A change row that the reading pane has not shown yet has weight 500. An opened row has weight 400 and `ak-ink-70`. This state is local to the page session (not in the API today).
- Save states (the outbox): `Sending 2` (`ArrowUp`), `Queued 2 · safe to close` (`Cloud`), `Saved` (`Check`), `Not saved` (`TriangleAlert`, danger). The three first states stay different, as the contract requires.
- Terminology: screenshot (not item), variant, change, run, baseline, current, diff, side by side, approve, reject, decision, alert, read-only. This direction says **Inbox** where the copy lane proposes "Queue".

### Motion

| What moves                         | How                                                                                                                                | Reduced motion     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| A decided or archived row          | 120 ms fade and 8 px slide to the end side, then 100 ms height collapse (`grid-rows` 1fr to 0fr)                                   | removed at once    |
| A restored row (Undo, failed save) | the reverse, 160 ms                                                                                                                | appears at once    |
| Count in a tab                     | 120 ms cross-fade of the number                                                                                                    | no fade            |
| Cursor                             | the glider of the primitive                                                                                                        | the glider default |
| Drill-in and back                  | the list content slides 160 ms (in from the end side, back from the start side); the frame does not move                           | no slide           |
| Image change                       | never a cross-fade between two variants; the old pixels clear at once, and the sharp image fades in for 80 ms over its placeholder | no fade            |
| Zero-state check                   | the stroke draws one time in 300 ms                                                                                                | static             |
| Skeleton                           | `animate-pulse motion-reduce:animate-none`, and only after 1 s                                                                     | static             |
| Blink                              | manual with `T`; auto blink each 600 ms is an option                                                                               | auto blink is off  |

No smooth scroll in lists (a known complaint about review tools).

---

## 3. Shell and navigation model

### Always on screen

- **Rail** (42 px): the Visonaut mark (a link to the inbox), then Inbox with a count badge, History, and Status with a dot when alerts exist (danger for critical, warning for other alerts, hollow when all are acknowledged). At the bottom: `?` (keys) and the account button (initials). Each item is an icon button with a tooltip that names it.
- **List pane** (336 px): a header (title and context), the rows, and the footer (outbox, Undo, key legend).
- **Reading pane** (the rest): one bar and the content for the cursor row.

The page never scrolls. Only the row area of the list and a zoomed stage scroll.

```text
0    42                         378                                                          1440
┌────┬───────────────────────────┬───────────────────────────────────────────────────────────────┐
│ ◎  │ LIST HEADER            42 │ READING BAR                                                42 │
│    ├───────────────────────────┼───────────────────────────────────────────────────────────────┤
│ In │                           │                                                               │
│ Hi │  ROWS (scroll)            │  READING PANE (preview, stage, batch grid, or zero state)     │
│ St │                           │                                                               │
│    │                           │                                                               │
│ ?  ├───────────────────────────┤                                                               │
│ DH │ FOOTER: outbox         32 │                                                               │
└────┴───────────────────────────┴───────────────────────────────────────────────────────────────┘
 rail  list pane (w-96, or w-12 as a spine)      reading pane (flex-1)
```

Phone (390 px): one pane at a time, as in a phone mail app. A tab bar replaces the rail on list screens. A decision bar replaces it in the viewer.

```text
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ Inbox 4                    ⌕ │ 49     │ ‹ 22  Dialog with initial…  ◫│ 49
├──────────────────────────────┤        ├──────────────────────────────┤
│ rows (60)                    │        │                              │
│                              │  tap   │  reading pane, full screen   │
│                              │  ───▸  │                              │
├──────────────────────────────┤        ├──────────────────────────────┤
│ Inbox   History   Status  DH │ 56     │ ‹   ›     Reject    Approve  │ 63
└──────────────────────────────┘        └──────────────────────────────┘
```

### Three depths, one frame

| Depth                   | List pane                               | Reading pane      | Go down               | Go up    |
| ----------------------- | --------------------------------------- | ----------------- | --------------------- | -------- |
| Mailbox: Inbox, History | runs                                    | run preview       | `Enter` opens the run | the rail |
| Pull request            | runs by commit and attempt              | run preview       | `Enter` opens the run | `U`      |
| Run                     | changed variants under screenshot names | comparison viewer | none                  | `U`      |
| Status                  | alerts and capacity                     | alert detail      | none                  | the rail |

- `U` and the `‹` button in the list header go up one level. `Esc` never navigates: it closes an overlay, then clears marks.
- Item and variant are not pages. They are rows. The cursor is the navigation.
- The list pane has a second width, the **spine** (`B`): 42 px with only the status marks, the count, and the save icon. The list never disappears.

### URL model

| URL                                                                          | Page                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/`                                                                          | Inbox. `?run=<id>` sets the cursor                     |
| `/history?q=&state=&run=`                                                    | History                                                |
| `/status?alert=<id>`                                                         | Status                                                 |
| `/pulls/4863?run=<id>`                                                       | Pull request. The current `?check=` links keep working |
| `/runs/<runId>?item=<key>&variant=<key>&tab=review&mode=overlay&zoom=fit&q=` | Run. `tab` is `review`, `rejected`, `done`, or `all`   |

A cursor move replaces the history entry. A drill-in (`Enter`) and a move up (`U`) push one. Marks are not in the URL.

### Page titles

The pattern is `({count}) {subject} · Visonaut`. The count is the number of rows that wait, and it is absent at zero.

- `(4) Inbox · Visonaut`
- `(22) #4863 Fix the dialog focus ring · Visonaut`
- `#4863 Fix the dialog focus ring · Passed · Visonaut`
- `History · Visonaut`, `(3) Status · Visonaut`, `Sign in · Visonaut`

### Account and service alerts

- Account: the last button of the rail (initials on a brand avatar slot). It opens a menu (`ak.Menu` with the `popover` and `option` recipes): `@diegohaz`, `ariakit/ariakit`, `Theme` (System, Light, Dark), `Sign out`. On the phone it is the fourth tab.
- Alerts: the Status item of the rail carries the dot. When an alert is critical, every list pane pins one 28 px danger line above its rows: `Check delivery failed` with a link to `/status?alert=…`. There is no bell and no popover.

### Keys (one map for every page)

This is key map B of the contract lane ("List keys J and K") with marks and viewer keys. It binds no bracket key, no Space, and no Cmd/Ctrl+K.

| Keys                  | Action                                                       | Where                       |
| --------------------- | ------------------------------------------------------------ | --------------------------- |
| `J` / `K`             | Next / previous row                                          | every list                  |
| `↑` / `↓`             | Previous / next screenshot (stop at the ends)                | run                         |
| `←` / `→`             | Previous / next variant of the screenshot (stop at the ends) | run                         |
| `1` to `9`            | Variant by position                                          | run                         |
| `Enter`               | Open the run; open a batch tile                              | inbox, history, pull, batch |
| `U`                   | Up to the parent list                                        | pull, run                   |
| `/`                   | Filter                                                       | every list                  |
| `B`                   | Narrow or widen the list                                     | every page                  |
| `A` / `X`             | Approve / reject the change, or the marked changes           | run                         |
| `Shift+A` / `Shift+X` | Approve / reject the whole screenshot                        | run                         |
| `Cmd/Ctrl+Z`          | Undo                                                         | run                         |
| `E`                   | Archive (runs that need no decision); acknowledge (alerts)   | inbox, status               |
| `M`                   | Mark or unmark the row                                       | run, inbox                  |
| `Shift+J` / `Shift+K` | Mark the row and move                                        | run                         |
| `Shift+M`             | Mark every row of the screenshot                             | run                         |
| `Esc`                 | Close an overlay, then clear the marks                       | every page                  |
| `O` `S` `W` `T` `D`   | Overlay, side by side, swipe, blink (each press flips), diff | run                         |
| `G` / `F`             | Baseline only / current only                                 | run                         |
| `H`                   | Diff highlight on or off                                     | run                         |
| `N` / `P`             | Next / previous changed region                               | run                         |
| `+` `-` `0`           | Zoom in, zoom out, fit                                       | run                         |
| `Shift+arrows`        | Pan both images                                              | run                         |
| `I`                   | Details                                                      | run                         |
| `?`                   | Keys                                                         | every page                  |

Builders: `useReviewShortcuts` already binds the arrows, `1` to `9`, `A`, `X`, `Shift+A`, `Shift+X`, `S`, `D`, `F`, `G`, `O`, `W`, `H`, `+`, `-`, `0`, and Cmd/Ctrl+Z. Override the others through `keys` (they win over the built-in keys). `U`, `B`, and `N` have another meaning in the hook, so the override is required.

```tsx
useReviewShortcuts(session, {
  keys: {
    j: (event) => (event.shiftKey ? markAndMove(1) : moveCursor(1)),
    k: (event) => (event.shiftKey ? markAndMove(-1) : moveCursor(-1)),
    m: (event) => (event.shiftKey ? markScreenshot() : toggleMark()),
    a: (event) => decide("approve", event.shiftKey),
    x: (event) => decide("reject", event.shiftKey),
    u: () => goUp(),
    b: () => setSpine((value) => !value),
    t: () => {
      session.viewer.setMode("blink");
      session.viewer.setBlinkPaused(true);
      session.viewer.flipBlink();
    },
    n: () => session.viewer.nextRegion(),
    p: () => session.viewer.previousRegion(),
    escape: () => clearMarks(),
  },
});
```

`decide` calls `session.approve([...marks])` when marks exist, `session.approveItem()` with Shift, and `session.approve()` in the other case. `moveCursor` walks the rows that the list shows, in the order that it shows them, and calls `session.select(target)`.

How a person finds the keys:

1. The key is on the control: `Approve A`, `Reject X`, `Review 22 ↵`.
2. The footer legend is always visible: `J K move · M mark · ?`.
3. Each icon button has a tooltip with the name and a `Kbd`.
4. `?` (key or rail button) opens the Keys dialog: four groups (Move, Decide, Mark, View), about 50 words, and a `Shortcuts` switch that is stored. The rail button works when shortcuts are off.

### Focus model

- The list is one Tab stop (roving `tabIndex`: only the cursor row is 0). The row checkboxes are not Tab stops: `M` and a click operate them.
- Keys work from every focus position, except in text fields, menus, and dialogs.
- A decision does not move focus to the page. If the focused row leaves, focus goes to the new cursor row.
- One polite live region says each result: "Approved. 21 left." and "All reviewed."
- Landmarks: `nav` "Mailboxes" (rail), `section` with the list name ("Changes to review"), `main` (reading pane).

---

## 4. Page specs

### Shared parts

**Frame**

```tsx
<div className="flex h-dvh overflow-clip text-sm">
  <Layer
    render={<nav aria-label="Mailboxes" />}
    className="flex w-12 flex-none flex-col items-center gap-1 py-2"
  >
    {/* ButtonGroup $layout="vertical" of icon Buttons with tooltips and a ButtonGlider $kind="bar" $side="start" */}
  </Layer>
  <Frame
    $lightnessOffset={0.5}
    render={<section aria-label="Changes to review" />}
    className={cx("flex flex-none flex-col border-e", spine ? "w-12" : "w-96")}
  >
    {/* header, rows, footer */}
  </Frame>
  <main className="flex min-w-0 flex-1 flex-col">
    <div
      role="toolbar"
      aria-label="Review"
      className="flex h-12 flex-none items-center gap-2 px-3"
    />
    <Frame $darken className="relative min-h-0 flex-1 overflow-auto p-3" />
  </main>
</div>
```

The frame is a flex row, not a `Shell`: the shell has no rail width and its page scrolls. Every surface is a `Layer` or a `Frame`.

**Run row** (inbox, history, pull): a `Button $p={2} $rounded="md" $forceRounded` with `className="w-full justify-start text-start"` in one vertical `ButtonGroup $p="none" $gap="none"` with three gliders (selected, hover, focus). The cursor row has `aria-current="true"`.

```text
[mark]  Fix the dialog focus ring when the trigger…        12 min
        #4863 · 22 changes · 2 rejected
```

- Slot: `ButtonSlot $rowSpan={2}` with the status mark.
- Line 1: `ButtonLabel` with the title (`getRunTitle(run)`, weight 500 in "To review"), then the age (`text-xs tabular-nums ak-ink-60`, a `time` element with the full date in `title`).
- Line 2: `ButtonDescription`: the source in mono (`#4863`, `main`, `queue`), then one state phrase.
- Without a title (common in real data), line 1 is `#7746` in mono with weight 500 and line 2 is the state phrase. The words "Pull request" never appear.

| State           | Phrase                    |
| --------------- | ------------------------- |
| needs-review    | `79 changes`              |
| rejected        | `22 changes · 2 rejected` |
| comparing       | `Comparing 48 of 120`     |
| incomplete      | `Capturing 310 of 626`    |
| failed          | `Failed`                  |
| needs-recompare | `Rerun needed`            |
| superseded      | `Replaced`                |
| passed          | `Passed`                  |

`changes` is `run.pending - run.rejected`.

**Run preview** (the reading pane of inbox, history, pull):

- Bar: mark, `#4863` (mono), title (truncate). At the end: `Open on GitHub` (icon button with a tooltip), `Archive E` (only for failed, replaced, and rerun needed), and one main button.
- Body (`max-w-[44rem]`, `p-6`, aligned to the top):
  1. Meta line (`font-mono text-xs ak-ink-70`): `a1b2c3d · attempt 2 · fix/dialog-focus · @diegohaz · 12 min ago`. The attempt shows only above 1.
  2. One segmented bar (`h-1.5`, three `Frame`s: success, danger, neutral) and one legend line: `22 to review · 2 rejected · 9 done · 7 same`.
  3. Up to four diff thumbnails from `run.previews` (the Media frame recipe: a sunken `Frame` with `aspect-[4/3] overflow-clip` and one name line). A tile opens the run at that screenshot.
  4. A state block for a run that takes no decisions (the Callout recipe).

| Run state              | Body                                                                                   | Main button                              |
| ---------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| needs-review, rejected | meta, bar, thumbnails                                                                  | `Review 22 ↵` (brand)                    |
| comparing              | meta, `Progress`, "Comparing 48 of 120", "Review starts when it finishes"              | `Open ↵` (neutral)                       |
| incomplete             | meta, `Progress`, "Capturing 310 of 626"                                               | none                                     |
| failed                 | meta, danger callout with `run.error`                                                  | `Open the failing check` (a GitHub link) |
| needs-recompare        | meta, callout "Rerun needed", "This run is out of date. Rerun the visual tests in CI." | none                                     |
| superseded             | meta, callout "Replaced by a newer run"                                                | `Open current run ↵`                     |
| passed                 | meta, bar                                                                              | `Open run ↵` (neutral)                   |

**Outbox footer** (32 px, fixed height): the left side shows the first of these that applies; the right side always has the Undo icon button (tooltip `Undo ⌘Z`, disabled when nothing can be undone and while a save runs) and nothing else.

1. `Not saved` on a danger tint, with `Retry` and `Discard` (and `Error ID …` in a tooltip).
2. The receipt of the last save for 4 s: `Sending 2`, then `Queued 2 · safe to close`, then `Saved`. After Undo: `Undone`.
3. `12 marked` with `Clear` and a `Kbd` Esc.
4. The legend: `J K move · M mark · ?` in a run, `J K move · ↵ open · E archive` in the inbox.

In the lab, `save.status` has no queued state: show `Sending` for the first 200 ms of `saving`, then `Queued`.

---

### 4.1 Sign in

The frame without data. The rail shows the mark only. The list pane shows six static ghost rows (`aria-hidden`, no animation, `Frame $lightnessOffset={1}` bars). The reading pane has one card. The page reveals no run list: the ghost rows are fixed shapes.

```text
1440
┌────┬───────────────────────────┬───────────────────────────────────────────────────────────────┐
│ ◎  │ ▂▂▂▂▂                     │                                                               │
│    ├───────────────────────────┤                                                               │
│    │ ▂▂▂▂▂▂▂▂▂▂▂▂▂▂            │               ┌────────────────────────────────────┐          │
│    │ ▂▂▂▂▂▂▂                   │               │ Sign in to Visonaut                │          │
│    │ ▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂         │               │ You need write access to           │          │
│    │ ▂▂▂▂▂▂▂▂▂                 │               │ ariakit/ariakit.                   │          │
│    │ ▂▂▂▂▂▂▂▂▂▂▂▂              │               │                                    │          │
│    │ ▂▂▂▂▂▂                    │               │ [ ◐ Sign in with GitHub          ] │          │
│    │                           │               └────────────────────────────────────┘          │
└────┴───────────────────────────┴───────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────┐
│ ◎                            │
│                              │
│  Sign in to Visonaut         │
│  You need write access to    │
│  ariakit/ariakit.            │
│                              │
│  [ Sign in with GitHub     ] │
│                              │
└──────────────────────────────┘
```

On the phone there is no rail and no list: the mark and the card content only, without the card border.

Regions and primitives:

- Card: `Frame $lighten $border $rounded="2xl" $p="1.5rem"` with `className="grid w-full max-w-sm gap-4"`, rendered as a `section` with `aria-labelledby`.
- Heading: `Heading className="mt-0 mb-0 text-xl"`. Sentence: `Text render={<p />} className="ak-ink-70"`.
- Main action: `Button $layer="brand"` with a `ButtonSlot` (GitHub mark) and a `ButtonLabel`, full width.
- Account chip (forbidden): `Badge` with `BadgeSlot $kind="avatar"` and `BadgeLabel`.
- Error ID: `Code`, with a copy icon button.

Copy and scenarios (data: `useSignIn(scenario)`):

| Scenario   | Copy                                                                                                                                                                     | Words |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| guest      | "Sign in to Visonaut" / "You need write access to ariakit/ariakit." / button "Sign in with GitHub". When the link has a target, the heading is "Sign in to review #4863" | 14    |
| signing-in | the same heading and sentence; the button is disabled, shows a `ProgressCircular` in its slot, and says "Opening GitHub"                                                 | 12    |
| forbidden  | chip "@okafor-amara" / "No access" / "You need write access to ariakit/ariakit." / button "Use another account" (brand) / link "Back to GitHub"                          | 14    |
| error      | "Something went wrong" / "Try again in a moment." / `Error ID 4f7a2c9e` / button "Try again"                                                                             | 12    |

Interactions: `Enter` activates the main button, which has focus on load. No other keys.

Removed: the marketing headline and its two sentences, the three different sign-in designs (dashboard, run, pull), the app navigation that cannot work for a guest, and the text "Checking access".

---

### 4.2 Inbox

```text
1440 (busy)
┌────┬───────────────────────────────┬───────────────────────────────────────────────────────────┐
│ ◎  │ Inbox 4                  ⟳  ⌕ │ ⊗ #4863  Fix the dialog focus ring     ↗   [ Review 22 ↵ ]│ 42
│    ├───────────────────────────────┼───────────────────────────────────────────────────────────┤
│ In │ To review · 4                 │  a1b2c3d · attempt 2 · fix/dialog-focus · @diegohaz ·     │
│  4 │▌⊗ Fix the dialog focus r… 12m │  12 min ago                                               │
│ Hi │   #4863 · 22 changes · 2 rej… │                                                           │
│ St │ ◉ Add the combobox select  1h │  ▓▓▓▓▓▓▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                   │
│  • │   #4831 · 79 changes          │  22 to review · 2 rejected · 9 done · 7 same              │
│    │ ◉ Refactor the composite … 2h │                                                           │
│    │   #4819 · 18 changes          │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  │
│    │ ◉ Update the tab glider    4h │  │   diff    │ │   diff    │ │   diff    │ │   diff    │  │
│    │   main · 3 changes            │  └───────────┘ └───────────┘ └───────────┘ └───────────┘  │
│    │ In progress · 2               │  Dialog with…  Combobox w…   Tabs          Select         │
│    │ ◌ Merge queue              2m │                                                           │
│    │   queue · Capturing 310 of 626│                                                           │
│    │ ◌ Fix the select typeahead 4m │                                                           │
│    │   #4855 · Comparing 48 of 120 │                                                           │
│    │ Needs attention · 2           │                                                           │
│    │ △ Bump the dependencies    1d │                                                           │
│    │   #4844 · Failed              │                                                           │
│    │ ↻ Add the menu submenu     2d │                                                           │
│  ? │   main · Rerun needed         │                                                           │
│ DH ├───────────────────────────────┤                                                           │
│    │ J K move · ↵ open · E archive │                                                           │ 32
└────┴───────────────────────────────┴───────────────────────────────────────────────────────────┘

390 (busy)
┌──────────────────────────────┐
│ Inbox 4                    ⌕ │ 49
├──────────────────────────────┤
│ To review · 4                │
│ ⊗ Fix the dialog focus … 12m │ 60
│   #4863 · 22 changes · 2 rej │
│ ◉ Add the combobox select 1h │
│   #4831 · 79 changes         │
│ ◉ Refactor the composite… 2h │
│   #4819 · 18 changes         │
│ ◉ Update the tab glider   4h │
│   main · 3 changes           │
│ In progress · 2              │
│ ◌ Merge queue             2m │
│   queue · Capturing 310 of … │
├──────────────────────────────┤
│ Inbox   History   Status  DH │ 56
└──────────────────────────────┘
```

On the phone a tap on a run that takes decisions opens its change list at once. A tap on another run opens its preview as a full screen.

Regions and primitives:

| Region                      | Primitive                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List header                 | `Frame $layer` with `Heading className="mt-0 mb-0 text-sm"` "Inbox", a count in a `Badge $forceRounded`, and two icon `Button`s with tooltips (Refresh, Filter) |
| Filter row (on demand, `/`) | `InputGroup $size="sm"` with `InputSlot` (search icon) and a shortcut slot                                                                                      |
| Section label               | `TextFrame $p={1} $ink={60} className="text-xs"`: "To review · 4"                                                                                               |
| Rows                        | Run rows (see Shared parts) in one vertical `ButtonGroup` with gliders                                                                                          |
| Archive checkbox            | a `Checkbox` over the mark slot, only on rows under "Needs attention"                                                                                           |
| Footer                      | the outbox footer with the inbox legend                                                                                                                         |
| Reading pane                | Run preview                                                                                                                                                     |

Data: `useInbox(scenario)`. The sections are `inbox.groups` (`review`, `progress`, `attention`). The cursor starts on the first row of "To review".

Copy (busy): "Inbox", "To review", "In progress", "Needs attention", "move", "open", "archive", "Review", "to review", "rejected", "done", "same". That is 17 words of interface text. A row adds at most four words beside its title.

Scenarios:

| Scenario  | List pane                                                                                                         | Reading pane                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| busy      | three sections, eight rows (392 px of rows)                                                                       | preview of #4863                                                                                                |
| single    | "To review · 1" and one row                                                                                       | preview with `Review 1 ↵`                                                                                       |
| empty     | a small `CircleCheck` mark at ink 40 and "Nothing to review"                                                      | "Inbox zero" (`text-lg`), then `Baseline 128 · updated 2 h ago` (mono), then the button "Open history". 9 words |
| first-run | "No runs yet"                                                                                                     | "Create the baseline", "Run the visual tests in CI on main.", link "Setup guide". 16 words                      |
| loading   | the header and eight ghost rows (see Loading)                                                                     | a ghost bar and two ghost lines                                                                                 |
| error     | the header, then "Could not load runs", "Try again in a moment.", and a `Retry` button, in the row area. 10 words | empty                                                                                                           |

Interactions:

- `J` / `K` move the cursor and wrap at no end. The preview follows without a wait, because the inbox answer has the data.
- `Enter` or a click on the main button opens the run. The list content slides to the changes of the run. A click on a row moves the cursor; a second click or a double click opens.
- `E` archives the cursor row or the marked rows when they are under "Needs attention". The row leaves and the outbox says `Archived · Undo ⌘Z`.
- `/` opens the filter row and focuses it (`inbox.setQuery`). `Esc` in the field clears it and closes the row.
- The list refreshes when the window gets focus and each 60 s. A new row fades in. The Refresh button keeps the rows on screen (`inbox.refreshing` shows a spinner in the button only).
- Lab links: #4863 opens the review scenario `changes`, #4831 opens `large`, the run of `single` opens `one-change`, #4855 opens `comparing`, #4844 opens `problems`.

Removed: the page title "Your review queue.", the sentence below it, the repository eyebrow, the three counters, the 240 px cards, the badge plus the sentence that say the same state, "Review changes" on each card, the baseline footer and "View history" (the rail does this), and the blank page on refresh.

---

### 4.3 History

```text
1440 (full)
┌────┬───────────────────────────────┬───────────────────────────────────────────────────────────┐
│ ◎  │ History          Latest 100   │ ✓ #4852  Fix the menu arrow offset       ↗   [ Open run ↵ ]│ 42
│    │ [⌕ Search runs      /] [All ▾]│───────────────────────────────────────────────────────────│ 35
│ In ├───────────────────────────────┤  7c2d9e1 · fix/menu-arrow · @okafor-amara · 3 h ago       │
│ Hi │ Today                         │                                                           │
│ St │▌✓ Fix the menu arrow offs… 3h │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                   │
│    │   #4852 · Passed              │  12 approved · 2 auto-approved · 586 same                 │
│    │ ↱ Fix the dialog focus ri… 5h │                                                           │
│    │   #4863 · Replaced            │  ┌───────────┐ ┌───────────┐ ┌───────────┐                │
│    │ ✓ Update the tab glider    6h │  │   diff    │ │   diff    │ │   diff    │                │
│    │   main · Passed               │  └───────────┘ └───────────┘ └───────────┘                │
│    │ Yesterday                     │                                                           │
│    │ ⊗ Add the listbox example  1d │                                                           │
│    │   #4840 · 4 rejected          │                                                           │
│    │ △ Merge queue              1d │                                                           │
│    │   queue · Failed              │                                                           │
│  ? ├───────────────────────────────┤                                                           │
│ DH │ J K move · ↵ open             │                                                           │
└────┴───────────────────────────────┴───────────────────────────────────────────────────────────┘

390 (full)
┌──────────────────────────────┐
│ History                      │ 49
│ [⌕ Search runs     ] [All ▾] │ 46
├──────────────────────────────┤
│ Today                        │
│ ✓ Fix the menu arrow off… 3h │
│   #4852 · Passed             │
│ ↱ Fix the dialog focus r… 5h │
│   #4863 · Replaced           │
│ Yesterday                    │
│ ⊗ Add the listbox example 1d │
│   #4840 · 4 rejected         │
├──────────────────────────────┤
│ Inbox   History   Status  DH │
└──────────────────────────────┘
```

Regions and primitives:

| Region       | Primitive                                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List header  | `Frame $layer`: "History" and "Latest 100" (`ak-ink-60 text-xs`)                                                                                                                                                 |
| Search row   | `InputGroup $size="sm"` (search icon, plain `input` with `aria-label="Search runs"`, a `/` shortcut slot) and a `ComboboxSelect $layer="transparent" $size="sm"` for the status, with a count beside each option |
| Day label    | `TextFrame $p={1} $ink={60} className="text-xs"` from `groupRunsByDay(history.visibleRuns)`                                                                                                                      |
| Rows         | Run rows                                                                                                                                                                                                         |
| Reading pane | Run preview                                                                                                                                                                                                      |

Data: `useHistory(scenario)`.

Copy: "History", "Latest 100", "Search runs", "All", day names, "Open run", and the legend words. 13 words.

Scenarios:

| Scenario | List pane                                                                                               | Reading pane              |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------- |
| full     | 40 runs under day labels                                                                                | preview of the cursor run |
| no-match | the search row with "datepicker", then one line "No runs match" and the button "Clear filters". 5 words | empty                     |
| empty    | "No runs yet". 3 words                                                                                  | empty                     |
| loading  | the header, the search row, twelve ghost rows                                                           | a ghost bar               |

Interactions: `J` / `K`, `Enter` opens the run (a passed run opens the review scenario `passed`, a replaced run opens `read-only`), `/` focuses the search field, `Esc` in the field clears it. The status select filters at once. Search and status are in the URL.

Removed: the heading "Run history." with its sentence about the 100 runs, the Created column (day labels and ages replace it), the Result column (the mark and the phrase replace it), the two sentences that explain the search scope, and the separate filter label.

---

### 4.4 Status

```text
1440 (alerts)
┌────┬───────────────────────────────┬───────────────────────────────────────────────────────────┐
│ ◎  │ Status      checked 2 min  ⟳  │ ⬣ Check delivery failed       [ Acknowledge E ] [ Guide ↗ ]│ 42
│    ├───────────────────────────────┼───────────────────────────────────────────────────────────┤
│ In │ Critical · 1                  │  First seen   Oct 5, 14:55                                │
│ Hi │▌⬣ Check delivery failed   4m  │  Last seen    4 min ago                                   │
│ St │   run 4863 · 14 times         │  Seen         14 times                                    │
│  • │ Warning · 2                   │                                                           │
│    │ △ Database capacity       3m  │  Effect                                                   │
│    │   79% of 2 GiB · 576 times    │  Decisions on run #4863 do not reach the GitHub check.    │
│    │ △ Comparison retries     35m  │                                                           │
│    │   comparison 0b7d0e3c · 5 ti… │  What to do                                               │
│    │ Capacity                      │  Check the GitHub App permission "Checks: write".         │
│    │ ◔ Database       1.57 of 2 GiB│                                                           │
│    │   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░   │  check-delivery · exhausted · 71402233915   ⧉             │
│    │ ◔ Active runs          2 of 5 │                                                           │
│  ? │   ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░   │  [ Open run #4863 ]                                       │
│ DH ├───────────────────────────────┤                                                           │
│    │ J K move · E acknowledge      │                                                           │
└────┴───────────────────────────────┴───────────────────────────────────────────────────────────┘

390 (alerts)
┌──────────────────────────────┐
│ Status      checked 2 min  ⟳ │
├──────────────────────────────┤
│ Critical · 1                 │
│ ⬣ Check delivery failed   4m │
│   run 4863 · 14 times        │
│ Warning · 2                  │
│ △ Database capacity       3m │
│   79% of 2 GiB · 576 times   │
│ △ Comparison retries     35m │
│   comparison 0b7d0e3c        │
│ Capacity                     │
│ ◔ Database     1.57 of 2 GiB │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░      │
│ ◔ Active runs         2 of 5 │
├──────────────────────────────┤
│ Inbox   History   Status  DH │
└──────────────────────────────┘
```

Regions and primitives:

| Region       | Primitive                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List header  | `Frame $layer`: "Status", a `time` "checked 2 min" (`ak-ink-60 text-xs`), and a Refresh icon `Button`                                                                                                  |
| Group label  | `TextFrame`: "Critical · 1", "Warning · 2", "Acknowledged · 1", "Capacity"                                                                                                                             |
| Alert row    | the two-line row `Button`: severity mark, title, age; then subject and count                                                                                                                           |
| Capacity row | the same row with a `Progress` below its label (`fill={{ $layer: "warning" }}` above the warning size, `"danger"` at the limit)                                                                        |
| Reading bar  | mark, title, `Button $border $size="sm"` "Acknowledge" with a shortcut slot, `Button` "Guide" as a link                                                                                                |
| Detail       | a `dl` grid with `Text` labels at `ak-ink-60`, two short sections ("Effect", "What to do"), a `Code` line with a copy button, and `Button $lightnessOffset` "Open run #4863" when `alert.runId` exists |

Data: `useStatus(scenario)`.

Copy (alerts): "Status", "checked", "Critical", "Warning", "Capacity", "Database", "Active runs", "First seen", "Last seen", "Seen", "times", "Effect", "What to do", "Acknowledge", "Guide", "Open run", "move". 23 words. The alert body is one effect sentence (`alert.impact`) and one action sentence (`alert.action`).

Scenarios:

| Scenario         | List pane                                                                                                                   | Reading pane                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| healthy          | a `CircleCheck` mark and "No alerts", then the two capacity rows. 7 words                                                   | the capacity row under the cursor as two large meters with the three sizes (used, warning, limit) |
| alerts           | one critical, two warnings, capacity                                                                                        | detail of the first alert                                                                         |
| loading          | the header and four ghost rows                                                                                              | a ghost bar and four ghost lines                                                                  |
| error            | "Could not load alerts" and `Retry`. With cached alerts, the rows stay and one line says "These alerts may be out of date." | the cached detail, or empty                                                                       |
| overflow (extra) | 50 rows and a last line "Showing the latest 50"                                                                             | detail                                                                                            |

Interactions: `J` / `K`. `E` acknowledges the cursor alert: the row moves to "Acknowledged" (closed `Disclosure` at the end of the alerts), and the rail dot becomes hollow when no open alert is left. `E` on an acknowledged alert opens it again. The page checks each minute while it is open; the header time updates.

Removed: the heading and the two sentences about refresh and notifications, the card for each alert with 12 to 33 words of runbook text, the bell and its popover, the disclaimer about service dependencies, and the long guide button label.

---

### 4.5 Pull request

A pull request is a thread. Its runs are the messages.

```text
1440 (attempts)
┌────┬───────────────────────────────┬───────────────────────────────────────────────────────────┐
│ ◎  │‹ Fix the dialog focus ring  ⋯ │ ⊗ Attempt 2 · a1b2c3d                  ↗   [ Review 22 ↵ ]│ 42
│    │  #4863 · fix/dialog-focus     │                                                           │
│ In ├───────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Hi │ a1b2c3d · head                │  a1b2c3d · attempt 2 · @diegohaz · 12 min ago             │
│ St │▌⊗ Attempt 2               12m │                                                           │
│    │   22 changes · 2 rejected     │  ▓▓▓▓▓▓▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                   │
│    │ △ Attempt 1               40m │  22 to review · 2 rejected · 9 done · 7 same              │
│    │   Failed                      │                                                           │
│    │ 9f8e7d6                       │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  │
│    │ ↱ Attempt 1                3h │  │   diff    │ │   diff    │ │   diff    │ │   diff    │  │
│    │   Replaced                    │  └───────────┘ └───────────┘ └───────────┘ └───────────┘  │
│  ? ├───────────────────────────────┤                                                           │
│ DH │ J K move · ↵ open · U inbox   │                                                           │
└────┴───────────────────────────────┴───────────────────────────────────────────────────────────┘

390 (attempts)
┌──────────────────────────────┐
│ ‹ Fix the dialog focus ri… ⋯ │
│   #4863 · fix/dialog-focus   │
├──────────────────────────────┤
│ a1b2c3d · head               │
│ ⊗ Attempt 2              12m │
│   22 changes · 2 rejected    │
│ △ Attempt 1              40m │
│   Failed                     │
│ 9f8e7d6                      │
│ ↱ Attempt 1               3h │
│   Replaced                   │
├──────────────────────────────┤
│ [ Review 22                ] │ 63
└──────────────────────────────┘
```

Regions and primitives:

| Region                           | Primitive                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List header (two lines in 42 px) | `Frame $layer`: a back icon `Button` (tooltip "Inbox" with `Kbd` U), the title (`text-sm font-medium`, truncate), the meta line `#4863 · fix/dialog-focus` (`font-mono text-xs ak-ink-70`), and a `⋯` menu (`ak.Menu`: "Open pull request on GitHub", "Copy link") |
| Commit label                     | `TextFrame`: the short SHA in mono, and the word "head" for `commit.head`                                                                                                                                                                                          |
| Rows                             | the two-line row: mark, "Attempt 2", age; then the state phrase                                                                                                                                                                                                    |
| Reading pane                     | Run preview                                                                                                                                                                                                                                                        |
| Phone action                     | a `sticky bottom-0` `Frame $layer` with the main button at full width                                                                                                                                                                                              |

Data: `usePull(scenario)`. The groups are `pull.commits`. The cursor starts on `pull.reviewRun ?? pull.latestRun`.

Copy: "head", "Attempt", the state phrases, the legend words, "move", "open", "inbox". 12 words of interface text.

Scenarios:

| Scenario               | List pane                                                       | Reading pane                                                                                                  |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| attempts               | two commits, three rows                                         | preview of attempt 2 with `Review 22 ↵`                                                                       |
| single                 | one commit, one row "Attempt 1 · Passed"                        | preview with `Open run ↵`                                                                                     |
| no-runs                | "No runs"                                                       | "Nothing to review", "This pull request does not need visual tests.", button "Open #4870 on GitHub". 16 words |
| loading                | the header (the number comes from the URL) and three ghost rows | a ghost bar and a ghost body                                                                                  |
| waiting (extra)        | "No runs"                                                       | "Waiting for CI", "The review opens when the screenshots arrive.", a `Progress` without a value               |
| capture-failed (extra) | "No runs"                                                       | danger callout "Visual tests failed" with the button "Open the failing check"                                 |

Interactions: `J` / `K`, `Enter` opens the run, `U` goes to the inbox. In the waiting state the page opens the run when it arrives. For the product, a check link for one ready run goes straight to the run.

Removed: the card with the icon tile and the eyebrow "Visual review · Pull request #n", the "Check again" button (the page polls), the redirect hop before each review, and the separate sign-in design of this page.

---

### 4.6 Review workspace

```text
1440 (changes)
┌────┬───────────────────────────────┬───────────────────────────────────────────────────────────┐
│ ◎  │‹ Fix the dialog focus ring  ⋯ │◉ Dialog with initial focus · ⚛ React ◎ Chromium ☀ Light   │ 42
│    │  #4863 · a1b2c3d · attempt 2  │   0.15%    [▣ ▥ ◫ ⇄ ±] [− Fit +] ⓘ  [✕ Reject X][✓ Approve A]│
│ In ├───────────────────────────────┼───────────────────────────────────────────────────────────┤
│  4 │ To review 22  Rejected 2      │ Current + diff · 1280 × 720               Change 1 of 2 ‹ ›│ 25
│ Hi │ ▔▔▔▔▔▔▔▔▔▔▔▔  Done 9  All 40 ⌕│ ┌───────────────────────────────────────────────────────┐ │
│ St │ ▓▓▒░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │                                                       │ │
│  • │ Dialog with initial focus   6 │ │                                                       │ │
│    │▌◉ React   Chromium  Light  ☐  │ │                                                       │ │
│    │ ◉ React   Chromium  Dark  0.15│ │                                                       │ │
│    │ ◉ React   Firefox   Light 0.02│ │                     screenshot                        │ │
│    │ ◉ React   WebKit    Light 0.31│ │                  (1041 × 822 px)                      │ │
│    │ ◉ Solid   Chromium  Light 0.15│ │                                                       │ │
│    │ ◉ React   Chromium  Light     │ │                                                       │ │
│    │           Forced colors   0.15│ │                                                       │ │
│    │ Combobox with auto select   1 │ │                                                       │ │
│    │ ◉ React   Chromium  Light 1.20│ │                                                       │ │
│    │ Tabs                        2 │ │                                                       │ │
│    │ ◉ React   Chromium  Light 0.04│ │                                                       │ │
│    │ ◉ React   Chromium  Dark  0.04│ │                                                       │ │
│    │ …                             │ │                                                       │ │
│    │ › Auto-approved · 6           │ └───────────────────────────────────────────────────────┘ │
│  ? ├───────────────────────────────┤                                                           │
│ DH │ J K move · M mark · ?       ↶ │                                                           │ 32
└────┴───────────────────────────────┴───────────────────────────────────────────────────────────┘
```

The sketch draws the reading bar on two lines for space. It is one 42 px row.

```text
390 (changes): the list screen, then the viewer screen
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ ‹ Fix the dialog focus ri… ⋯ │   │ ‹ 22  Dialog with initial f… │ 49
│   #4863 · a1b2c3d            │   │       React · Chromium · Li… ◫│
│ To review 22  Rejected 2  Do…│   ├──────────────────────────────┤
├──────────────────────────────┤   │ Current + diff               │
│ Dialog with initial focus  6 │   │ ┌──────────────────────────┐ │
│ ◉ React  Chromium  Light     │   │ │                          │ │
│ ◉ React  Chromium  Dark      │   │ │                          │ │
│ ◉ React  Firefox   Light     │   │ │       screenshot         │ │
│ ◉ React  WebKit    Light     │   │ │                          │ │
│ ◉ Solid  Chromium  Light     │   │ │                          │ │
│ Combobox with auto select  1 │   │ └──────────────────────────┘ │
│ ◉ React  Chromium  Light     │   │ [Baseline]                   │
├──────────────────────────────┤   ├──────────────────────────────┤
│ ✓ Saved                    ↶ │   │ ‹   ›    Reject     Approve  │ 63
└──────────────────────────────┘   └──────────────────────────────┘
```

#### Pixel budget

| Measure at 1440 x 900              | Today                            | Triage                                     |
| ---------------------------------- | -------------------------------- | ------------------------------------------ |
| First screenshot pixel (y)         | 408 px                           | 67 px (42 px bar and 25 px caption gutter) |
| Area for the screenshot            | 13 to 30 percent of the viewport | 1041 x 822 px, 66 percent                  |
| With the list as a spine (`B`)     | not applicable                   | 1335 x 822 px, 85 percent                  |
| Rows visible in the list           | 3 screenshots, 3 of 7 variants   | 28 rows, each with its verdict             |
| Count and status repeats on screen | 6 to 11                          | 1 (the tab count)                          |

Phone (390 x 844): the viewer has a 49 px bar and a 63 px action bar. The stage is 390 x 732 px (87 percent). The first screenshot pixel is at y = 57. Today it is at about 62 percent of the screen height.

#### List pane

| Region                                 | Primitive                                                                                                                                                                                                                                              | Content                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header (42 px, two lines)              | `Frame $layer`                                                                                                                                                                                                                                         | back `Button` (tooltip "Inbox" and `Kbd` U); the run title (`font-medium`, truncate); identity line in mono: `#4863 · a1b2c3d · attempt 2` (the attempt only above 1); `⋯` menu ("Open pull request on GitHub", "Open commit on GitHub", "Copy link to this change") |
| Tabs (35 px)                           | `ak.RadioGroup` rendered as `ButtonGroup $p="none" $size="sm"`, each tab an `ak.Radio` rendered as `Button` with a `ButtonLabel` and a count in `ButtonSlot $kind="badge" $p="md"`, then `ButtonGlider $kind="bar"`; a Filter icon `Button` at the end | "To review 22", "Rejected 2", "Done 9", "All 40". The Rejected count is in `$text="danger"` when it is above 0                                                                                                                                                       |
| Progress line (2 px, under the tabs)   | three `Frame`s in a flex row                                                                                                                                                                                                                           | approved (success), rejected (danger), left (neutral), from `session.progress`. Only variants that take a verdict count                                                                                                                                              |
| Filter row (35 px, on demand)          | a tri-state `Checkbox` ("Mark all 22"), an `InputGroup $size="sm"`, and a menu `Button` (`ak.Menu` with checkbox items)                                                                                                                                | text filter (`session.setQuery`); facets Browser, Framework, Scheme, Kind with the counts of `session.facets`; sort "Run order" or "Largest change"                                                                                                                  |
| Banner (28 px, only in special states) | the Callout recipe at one line                                                                                                                                                                                                                         | read-only, comparing, failed (see Scenarios)                                                                                                                                                                                                                         |
| Screenshot header (28 px, sticky)      | `Frame $layer` with `TextFrame $p={1}`                                                                                                                                                                                                                 | the screenshot name (`font-medium`, truncate), the row count, and on hover or when the cursor is inside: a `Checkbox` ("Mark all 6") and an icon `Button` with the tooltip "Approve all 6" and `Kbd` ⇧A                                                              |
| Change row (28 px)                     | `Button $p={1} $rounded="md" $forceRounded` in one vertical `ButtonGroup $p="none" $gap="none"` with selected, hover, and focus gliders                                                                                                                | see below                                                                                                                                                                                                                                                            |
| Collapsed group                        | `Disclosure` with a `DisclosureButton` at the row height                                                                                                                                                                                               | "Auto-approved · 6" at the end of "To review"                                                                                                                                                                                                                        |
| Footer                                 | the outbox footer                                                                                                                                                                                                                                      | receipt, marks, legend, Undo                                                                                                                                                                                                                                         |

The change row:

```tsx
<div className="group relative">
  <Button
    $p={1}
    $rounded="md"
    $forceRounded
    aria-current={current ? "true" : undefined}
    onClick={() => session.select(variant)}
    className="w-full justify-start text-start"
  >
    <ButtonSlot className={cx("group-hover:invisible", marked && "invisible")}>
      <Text $text="warning" className="flex">
        <CircleDot />
      </Text>
    </ButtonSlot>
    <ButtonLabel className={cx("flex flex-1 gap-2", opened ? "ak-ink-70" : "font-medium")}>
      <span className="w-14 flex-none">React</span>
      <span className="w-20 flex-none">Chromium</span>
      <span className="truncate">Light</span>
    </ButtonLabel>
    <Text className="ak-ink-60 font-mono text-xs tabular-nums">0.15%</Text>
  </Button>
  <Checkbox
    aria-label="Mark React, Chromium, Light"
    checked={marked}
    onChange={() => toggleMark(variant)}
    className={cx(
      "absolute start-1.5 top-1/2 -translate-y-1/2",
      !marked && "opacity-0 group-hover:opacity-100",
    )}
  />
</div>
```

- The checkbox is a sibling of the row button (a button cannot contain a checkbox). It replaces the mark on hover and while the row is marked. A marked row gets `$layer="brand" $mix={10}` from state.
- The three axis words stand in fixed columns, so a reader can scan one browser down the list. More axes ("Forced colors", "More contrast") follow the scheme in the last column. The variant key is not in the row: it is in the tooltip and in Details.
- The trailing column is the change ratio (`formatRatio`), or the word "Added" or "Removed", or `@login · 2 min` on rows of the Done and Rejected tabs.
- The cursor row is in the reading pane. Only that row (or the marked rows in the batch grid) can get a decision, so the rule "a decision uses the pixels on screen" holds. Rows have no hover actions.
- A real screenshot name is often a long path such as `ariakit-tailwind-7466/applied-light-week-hover`. Render the last segment in the normal ink with `flex-none` (at most 70 percent of the width) and the prefix in `ak-ink-60` with `min-w-0 truncate`, so the prefix is cut first.

Tabs:

| Tab       | Rows                                                                                                                                                                                | Count                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| To review | "Failed · 5" first when errors exist; then every variant without a verdict under its screenshot; then "Comparing · 10" when comparisons run; then the collapsed "Auto-approved · 6" | variants without a verdict |
| Rejected  | rejected variants under their screenshots                                                                                                                                           | rejected                   |
| Done      | approved and auto-approved variants                                                                                                                                                 | approved                   |
| All       | every screenshot. A screenshot whose variants are all the same is one row ("Popover · 6 same"); the others are open                                                                 | all variants               |

The default tab is "To review". When it has no rows on load (a passed run), the default is "Done".

#### Reading bar (42 px, one row)

| Part          | Primitive                                                                                                                               | Content                                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title         | `Text` (truncate, `min-w-0 flex-1`)                                                                                                     | status mark, screenshot name (`font-medium`), then the full variant label with the framework and browser marks, then the ratio in mono: `0.15%`                                                               |
| Compare modes | `ak.RadioGroup` rendered as `ButtonGroup $border $size="sm"` with five icon radios and a flat `ButtonGlider`; each in a `TooltipAnchor` | Overlay (`Layers`, O), Side by side (`Columns2`, S), Swipe (`SquareSplitHorizontal`, W), Blink (`ArrowLeftRight`, T), Diff (`Diff`, D). The Blink segment is also selected for the modes `new` and `original` |
| Zoom          | `ButtonGroup $border $size="sm"`                                                                                                        | `−`, a label button that shows `Fit` or the percent and switches between Fit and 100%, `+`                                                                                                                    |
| Details       | `PopoverDisclosure` icon button (`Info`, I) with a `Popover portal`                                                                     | a `dl`: Changed `1,843 px (0.15%)`, Size `1280 × 720`, Tolerance, Key `react-chromium-light`, Reviewed `@diegohaz · 2 min ago`, Commit `a1b2c3d`; one button "Copy debug info"                                |
| Reject        | `Button $border $size="sm"`                                                                                                             | `X` icon in danger, label "Reject", shortcut slot `X`                                                                                                                                                         |
| Approve       | `Button $layer="brand" $size="sm"`                                                                                                      | `Check` icon, label "Approve", shortcut slot `A`                                                                                                                                                              |

- With marks, the two buttons say "Reject 12" and "Approve 12". The label always states the number of changes that the key decides.
- On a decided variant both buttons stay, so a rejected change can be approved from the Rejected tab.
- In a read-only run the two buttons are absent. A `Badge` "Read-only" takes their place, with the reason in a tooltip and, for a replaced run, the button "Open current run".
- While the images of the cursor row load, both buttons are `disabled` (the disabled look of the primitive, not the brand fill).

#### Stage and compare modes

- The stage is `Frame $darken` with `p-3`. Its first 25 px are the caption gutter: one `Text className="text-xs ak-ink-60"` line. In side by side each pane has its caption ("Baseline", "Current") above it. In a one-image mode the caption names the view ("Current + diff", "Baseline", "Current"). The image size follows in mono. At the end of the gutter: "Change 1 of 2" with previous and next icon buttons (N, P).
- **Overlay** (default): the current image with the red mask at 70 percent opacity. `H` turns the mask off and on. This is the best first view in a 1041 px pane: a 1280 x 720 capture shows at 81 percent, where side by side shows two images at 40 percent.
- **Side by side**: baseline and current with one shared zoom and one shared pan position.
- **Swipe**: one stack with a divider. The divider is a native `input type="range"` (visually hidden, focusable, arrow keys move it) under a 2 px `Frame $layer="brand"` line that the pointer can drag.
- **Blink**: one image at a time in the same place. `T` flips. `G` shows the baseline and `F` shows the current image. The caption says which one is on screen. An "Auto" `CheckboxField` in the Details popover starts the 600 ms auto blink.
- **Diff**: the mask at full strength over the current image at 20 percent opacity, so the mask has context.
- The mode stays when the cursor moves, and it is stored. When a mode needs an image that the variant does not have, show `viewer.effectiveMode`.
- An added variant shows one pane ("Current") with the tag "Added". A removed variant shows one pane ("Baseline") with the tag "Removed". Modes that need two images are disabled with the tooltip "No diff for an added or removed screenshot".
- A size change shows `640 × 400 → 640 × 422` and the word "Size changed" in `$text="warning"` in the caption.
- Zoom: Fit fits the width and the height of the stage. A small image is enlarged up to 200 percent with `image-rendering: pixelated`. The steps are 50, 100, 200, and 400 percent. Pan with a drag, the trackpad, or Shift+arrows. There are no pan buttons.
- Changed regions (`variant.regions`): with `H` on in a mode without the mask, draw each region as a 1 px danger ring with a minimum size of 24 px. `N` and `P` scroll the region to the center at the current zoom.
- A load error: the stage shows "Could not load the images", "Check your connection, then try again.", and `Retry`. It is not a verdict state.

#### Decision flow

1. `A` or `X` decides the cursor row. The verdict shows at once, the row leaves the "To review" tab (see Motion), and the cursor moves to the row that follows in the list as it is shown, with one wrap. If the tab has a filter, the next row is inside the filter.
2. The outbox says `Sending 1`, then `Queued 1 · safe to close`, then `Saved`. Only then Undo is enabled.
3. `Shift+A` or `Shift+X` decides every row of the screenshot as one command, without a dialog. The rows leave together and the outbox says `Saved · 6 approved`. The screenshot header button does the same.
4. `Cmd/Ctrl+Z` or the Undo button takes back the last saved command. The rows slide back, and the cursor returns to the original row.
5. A failed save: the rows come back, the footer turns to the danger tint with `Not saved`, `Retry`, and `Discard`, and both decision buttons are disabled until one of the two is used. A conflict says `Changed by @login` with a `Reload` button.
6. In the tabs "Rejected", "Done", and "All" a decision changes the mark in place. A row leaves only when it no longer belongs to the tab.

The images of the next two rows preload, so the stage has pixels within one frame after a decision.

#### Marks and the batch grid

- `M` marks the cursor row. `Shift+J` and `Shift+K` mark and move. `Shift+M` and the screenshot header checkbox mark every row of the screenshot. The filter row checkbox marks every visible row. `Esc` clears.
- With two or more marks the reading pane becomes the **batch grid**. With one mark it stays the viewer.

```text
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ 12 changes marked · in 4 screenshots                     [✕ Reject 12 X] [✓ Approve 12 A] │ 42
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │ diff     │ │ diff     │ │ diff     │ │ diff     │ │ diff     │ │ diff     │             │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
│ Dialog with… Dialog with… Dialog with… Dialog with… Dialog with… Dialog with…             │
│ ⚛ ◎ Light    ⚛ ◎ Dark •   ⚛ ◈ Light •  ⚛ ◇ Light •  ◆ ◎ Light •  ⚛ ◎ Forced •            │
│ ┌──────────┐ ┌──────────┐ …                                                               │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- Grid: `grid grid-cols-[repeat(auto-fill,minmax(--spacing(44),1fr))] gap-3`. A tile is a `Button $p={1} $rounded="lg" $forceRounded` with a sunken `Frame` (`aspect-[4/3] overflow-clip`) that holds the diff picture (`variant.diffPreview`, or the mask over the candidate; the candidate for an added variant; the reference for a removed one), one name line, and one line with the framework and browser marks, the scheme word, and the ratio. A dot marks a change that was not opened.
- `Enter` or a click on a tile moves the cursor to that row and shows it in the viewer while the marks stay. The bar then still says "Approve 12". `Enter` again returns to the grid.

The four rules for a decision that covers more than one screenshot (the contract lane asks for them):

1. **Pixels:** the diff picture of every target is in the grid, and both buttons stay disabled until every tile image is decoded. While they load the bar says "Loading 3 of 12".
2. **Frozen targets:** the command takes the identifiers and revisions of the marked rows at the moment of the key press. Marks cannot change while the save runs.
3. **Undo:** one Undo restores every verdict of the batch, the marks, and the cursor.
4. **Refusal:** the command saves every target or none. On a refusal nothing changes, the marks stay, the refused tiles get a warning ring, and one callout above the grid says "Nothing changed. 2 marked changes are protected." with the button "Unmark 2".

Limit one batch to 100 changes until the size of the database batch is measured.

#### Progress, details, and the completed state

- Progress is the count in the "To review" tab and the 2 px line under the tabs. No other element repeats it. The browser tab title carries the same number.
- Details is the popover in the reading bar (`I`). It holds the facts of the variant and the run identifiers. No panel takes space from the stage.
- The completed state is the empty "To review" tab:

```text
┌────┬───────────────────────────────┬───────────────────────────────────────────────────────────┐
│ ◎  │‹ Fix the dialog focus ring  ⋯ │                                                           │
│    │  #4863 · a1b2c3d · attempt 2  │                                                           │
│ In ├───────────────────────────────┤                         ◯✓                                │
│ Hi │ To review 0  Rejected 0       │                      Run passed                           │
│ St │ ▔▔▔▔▔▔▔▔▔▔▔  Done 31  All 40  │              31 approved · 6 auto-approved                │
│    │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │                                                           │
│    │ › Auto-approved · 6           │          ✓ The check is green on GitHub                   │
│    │                               │                                                           │
│    │         All reviewed          │          [ Open #4863 ↗ ]   [ Next run ↵ ]                │
│  ? ├───────────────────────────────┤                                                           │
│ DH │ ✓ Saved                     ↶ │                                                           │
└────┴───────────────────────────────┴───────────────────────────────────────────────────────────┘
```

- Reading pane: a `Frame $layer="success" $mix={10} $border $edge="success" $rounded="xl" $p="1rem"` card at the center, with the heading ("Run passed", or "Review complete" when rejections remain), one count line ("31 approved · 6 auto-approved", or "29 approved · 2 rejected · the check fails"), the check line, and two buttons.
- The check line has three states: `ProgressCircular` with "Updating the check on GitHub"; `Check` with "The check is green on GitHub"; `TriangleAlert` with "GitHub did not take the update" and a link "Status".
- "Next run ↵" (brand) opens the next run of the inbox section "To review". When none is left the button is "Back to inbox" with `Kbd` U, and the inbox shows "Inbox zero".
- List: the words "All reviewed" at ink 60 in the empty row area. The "Auto-approved · 6" row stays, so additions and removals remain one click from the main list.

Copy:

| State       | Interface text                                                                                                                       | Words    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Default     | "To review", "Rejected", "Done", "All", "Reject", "Approve", "Current + diff", "Change", "of", "Fit", "move", "mark"                 | 14       |
| Batch       | "changes marked", "in … screenshots", "Reject 12", "Approve 12", "marked", "Clear"                                                   | 8        |
| Completed   | "All reviewed", "Auto-approved", "Run passed", "approved", "auto-approved", "The check is green on GitHub", "Open #4863", "Next run" | 16       |
| Keys dialog | four group names, 26 short rows, the switch "Shortcuts"                                                                              | about 50 |

Scenarios (data: `useReviewSession(scenario)`):

| Scenario        | List pane                                                                                                                                                                                                     | Reading pane                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| changes         | To review 22 in 8 screenshots, Rejected 2, Done 9, All 40; the collapsed "Auto-approved · 6"                                                                                                                  | the viewer on the first row, in Overlay                                                                                         |
| large           | To review 79; the filter row is the main tool (`/`, then a browser facet, then "Mark all", then `A`); the "All" tab has 120 screenshots, most of them one "same" row (use `content-visibility: auto` on rows) | the viewer; the batch grid scrolls                                                                                              |
| one-change      | one screenshot header and one row                                                                                                                                                                             | the viewer; after `A` the completed state                                                                                       |
| passed          | the default tab is "Done 31"; "To review 0"                                                                                                                                                                   | the completed card until the cursor enters a row                                                                                |
| read-only       | banner: "Read-only · Replaced by a newer run" with the link "Open current run"; no checkboxes                                                                                                                 | the viewer with the "Read-only" badge and no decision buttons                                                                   |
| comparing       | banner: "Comparing 6 of 16 · review starts when it finishes" with a `Progress`; finished rows are listed; "Comparing · 10" rows have ring marks                                                               | the viewer for a finished row with disabled decisions; a ghost stage with "Comparing…" for a pending row                        |
| problems        | banner: "Run failed · Rerun the visual tests in CI" with a GitHub link; "Failed · 5" first                                                                                                                    | for a failed row: the error sentence of the variant in the stage; for the broken image: "Could not load the images" and `Retry` |
| loading         | the header with the title from the previous page, the tabs with ghost counts, twelve ghost rows                                                                                                               | a ghost bar and one ghost image frame                                                                                           |
| expired (extra) | the rows stay                                                                                                                                                                                                 | the stage says "Images expired" and "The images for this run are deleted. The decisions remain."                                |

Removed from the current page: the app header, the run header, the identity strip, the screenshot heading band, the variant strip, the separate toolbar row, the pane caption rows, the sticky action bar, and the footer (nine bands become one bar and one gutter); the "Accepted" disclosure (the Done tab replaces it); the 26 px thumbnails in rows; the whole-item dialog; the eight pan buttons; the disabled "Recompare stored run" button and its sentence; the native progress element; and the sentences "N of M need review" (six on screen today).

---

## 5. Loading

Assumption: the list data arrives in about 300 ms and the first screenshot in under 1 s. The frame needs no data, so it renders at 0 ms on every page: the rail, the list header with a title, the footer legend, and the reading bar. No page shows "Checking access" or any other sentence about the server.

Ghost rows are the Skeleton recipe (`Frame $lightnessOffset={2}` and `{1}` bars at the real row height) inside `aria-busy="true"`. They are static until 1 s. Then they pulse. A slow load never blocks the rail, the back button, or the keys.

| Page    | 0 ms                                                                                                                                                            | 300 ms                                                                                                                                                                                                | 1 s                                                                                   | 5 s                                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in | the full page (it needs no data)                                                                                                                                | the same                                                                                                                                                                                              | the same                                                                              | signing-in: the button still says "Opening GitHub", and a link "Try again" appears below it                                                                                                             |
| Inbox   | the frame, "Inbox", eight ghost rows, a ghost preview                                                                                                           | the rows and the text of the preview; the four thumbnails are blurred placeholders at the final size                                                                                                  | sharp thumbnails                                                                      | if the rows did not arrive: the ghost rows pulse and the footer says "Still loading"; after 10 s a `Retry` button joins it                                                                              |
| History | the frame, "History", the search row (it works at once on the cached runs), twelve ghost rows                                                                   | the rows under day labels and the preview text                                                                                                                                                        | sharp thumbnails                                                                      | as the inbox                                                                                                                                                                                            |
| Status  | the frame, "Status", four ghost rows, a ghost detail                                                                                                            | the rows, the capacity meters, the detail text                                                                                                                                                        | the same                                                                              | "Still loading" in the footer; cached alerts stay with "These alerts may be out of date."                                                                                                               |
| Pull    | the frame, the number from the URL in the header, three ghost rows                                                                                              | the title, the rows, the preview text                                                                                                                                                                 | sharp thumbnails                                                                      | as the inbox; in the waiting state the page stays and polls                                                                                                                                             |
| Review  | the frame; the run title and the "To review" count from the previous page (the inbox row has both); twelve ghost rows; a ghost image frame at 16:9 in the stage | the rows of "To review"; the reading bar text; the thumbnail of the first row, enlarged and blurred, in the stage; the counts of "Done" and "All" show a small ring until the rest of the run arrives | the sharp first image; the decision buttons become enabled; the next two rows preload | if the rows did not arrive: "Still loading" in the footer and the pulse; if only one image is late: the list works, the stage keeps the placeholder with a ring, and the decision buttons stay disabled |

In the lab, wrap the data hook in `useSimulatedLoad({ latency })` to show these steps, and treat `refreshing` as a spinner in the Refresh button only.

---

## 6. Risks, tradeoffs, and earlier decisions that this direction revisits

### Risks

1. **A split layout gives the image less width.** The benchmark catalogue says that a list with a detail pane fails when the detail needs the full width. Answers: Overlay is the default mode, the spine gives 85 percent of the viewport, and side by side stays one key away. The maintainer must judge side by side at 1041 px for 1280 px captures.
2. **Rows that leave can feel like a loss.** A reviewer cannot look back at the change that was just decided without a tab change. Answers: the outbox names the last decision, Undo restores the row and the cursor, and the Rejected and Done tabs hold every decided row.
3. **A key acts on the marks, not on the cursor row.** A reviewer who forgets the marks can decide more than intended. Answers: the button label always states the number, the reading pane changes to the grid at two marks, the footer says "12 marked", and one Undo restores the batch.
4. **Three key pairs move the cursor.** `J`/`K` move by row, the vertical arrows move by screenshot, and the horizontal arrows move by variant. This keeps contract rows K1 and K5, but `↓` skips rows in a flat list. A lab option can make the vertical arrows equal to `J`/`K`.
5. **The first response must be small.** The design assumes that the run page gets the changed rows first (about 300 ms). Today one request carries 5 MB and takes 5 to 7 s. Without that backend change the list shows ghost rows for the whole wait.
6. **The row with a checkbox overlay is a custom composition.** The gliders need CSS anchor positioning (Chrome is fine). If the selected glider does not follow rows inside a wrapper, set the cursor look from state (`$lightnessOffset={2}`).

### Earlier decisions and binding rules that this direction revisits

| Rule or decision                                                 | What Triage does                                                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D02 (the option "item" was rejected), D21, invariant I8, RULE-27 | A batch can cover several screenshots in one command. The four rules in 4.6 state the pixels, the frozen targets, Undo, and refusal. `Shift+A` and `Shift+X` keep their contract meaning. |
| U03 and contract line 192 (variant links with a bar glider), A07 | Variants are list rows with a flat glider. The full variant label is in the reading bar.                                                                                                  |
| K5                                                               | Left and Right keep their meaning but now move the cursor up and down inside one screenshot.                                                                                              |
| U02                                                              | Mostly delivered as selected: decisions are in the main bar, and the image takes the rest. Save state and Undo are in the list footer, not in the main bar.                               |
| A06 and the review guide ("identity above the images")           | The commit and the attempt are at the top of the list pane, beside the images. The attempt shows only above 1.                                                                            |
| L4, A13, A12, D29                                                | The Done tab replaces the "Accepted" group. Auto-approved additions and removals are one collapsed row in "To review". A sort by change size is an option in the filter menu.             |
| A21, D30                                                         | An added or removed variant uses one pane, without a labeled empty pane.                                                                                                                  |
| P02 (the option "eager" was rejected)                            | The default Overlay mode loads the diff mask at once. The mask is then shown evidence, so it must be in the set of images that a decision waits for.                                      |
| U04                                                              | The arrows stay page-wide. The pan buttons go away: pan is a drag or Shift+arrows.                                                                                                        |
| X4, "do not add a hotkey registry"                               | The shortcut switch moves into the Keys dialog and is stored. The dialog renders from one list of keys. New keys: `J K U B M E T N P I H O W / ?`.                                        |
| A11                                                              | List rows have no thumbnails. Diff thumbnails appear in the run preview and in the batch grid.                                                                                            |
| A27, D53                                                         | The phone layout shows one pane at a time and one image at a time. The list is not above the viewer.                                                                                      |
| A09                                                              | An opened row differs from a row that was not opened by weight and ink only. Every status mark has a shape and a word in its accessible name.                                             |
| The review guide: alerts are read-only                           | `E` acknowledges an alert locally. Nothing is hidden and nothing is resolved.                                                                                                             |
| The copy lane term "Queue"                                       | This direction says "Inbox".                                                                                                                                                              |

### Not in the API or the app today

- Runs: `counts`, `progress`, `previews`, `author`, `branch`, `commitMessage`, `error`, `updatedAt`. Pull request: `title`, `author`, `branch`, `runs`. Review run: `pullRequest`, `counts`, `progress`, `supersededBy`.
- Variants: `regions`, `diffPreview`, `reviewerLogin`, `decidedAt`.
- Alerts: `severity`, `impact`, `occurrences`, `runId`, and acknowledge.
- Session features: the filters by browser, framework, scheme, and kind with their counts, the next row inside a filter, the modes overlay, swipe, and blink, the zooms 50 and 400 percent, the highlight, and the text filter of the inbox.
- New client state: archived runs, "not opened" rows, marks, the stored compare mode, the stored shortcut switch, and the list width.
- Sign-in: the repository name for a guest and the login of a refused account.

### Tests that this direction breaks first

The helper that finds the selected variant as a link in a navigation named "Variants", the button name "Approve & next A", the text "N of M need review", the "Accepted (n)" group, the "Screenshots" dialog on narrow screens, the pan button names, and the whole-item dialog.

---

Process note for the orchestrator: this task changed no file in the repository. Skill invoked: `ariakit-general-workflow`. Scratch screenshots are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/design/scratch/` with the prefix `triage-`.
