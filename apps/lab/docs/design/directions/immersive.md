# Immersive

Working title: **Lightbox**. Direction id: `immersive`. Use the variant id `immersive` on each of the six page surfaces, so that `LabLink` stays in this direction.

Words in this brief follow the terminology table of the ui-copy lane: screenshot (not item), variant, change, run, baseline, current, diff, side by side, added, removed, approve, reject, needs review, decision, Queue, History, Status, alert, read-only.

## 1. Concept

**Name.** Immersive (Lightbox).

**Tagline.** The screenshot is the screen. Everything else is glass, a filmstrip, and one key away.

**The idea in five sentences.**

1. Every page is one full-viewport stage with one subject on it: a screenshot, a run cover, an alert, or a gate.
2. The siblings of the subject are a filmstrip at the bottom edge ("the roll"): the changes of a run, the runs of the queue, the attempts of a pull request, the alerts of the service.
3. Controls are translucent pills that float in the corners. At Fit they never cover a screenshot pixel, they fade while you pan, and `L` removes them.
4. Baseline, current, and diff share one image plane with one zoom and one position, so comparing is a flip in place and not a second pane.
5. A move between levels is a dive: a run cover grows into the review stage, and the strip changes from runs to changes.

**Signature moment: the flip.** A change opens with the baseline for 320 ms and then cuts to the current image, at full size, in the same place. The eye sees the motion at the place of the change. Hold `T`, or press and hold the picture, and the baseline shows for as long as you hold. Nothing else on the screen moves.

**Five principles.**

1. **The picture is the page.** The stage is the full viewport. At Fit, no control covers a screenshot pixel.
2. **One plane, many looks.** Baseline, current, and diff share one position and one zoom. Comparing is a flip.
3. **The roll is the map.** One strip is navigation, progress, and the verdict record.
4. **Chrome is glass and can leave.** Controls float, are translucent, fade while you pan, and go away with one key. A focused control, an error, and a read-only notice are never hidden.
5. **One grammar on every page.** One subject on the stage, its siblings on the strip, one brand action, text only as captions.

**Word budgets.** Sign-in 20. Queue 40. History 8 for the chrome and 6 for each run. Status 15 when healthy, 60 with an alert on the stage. Pull request 30. Review 30 at rest, 0 in lights out.

## 2. Visual system

### Layers

| Surface         | Recipe                                                                                           | Use                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Canvas          | the `body`                                                                                       | Never visible: the stage covers it                                                                                         |
| Stage (sunken)  | `<Frame $darken={2} render={<main />}>`, full viewport                                           | The one background of every page. Near black in dark, a light-table gray in light                                          |
| Print           | `<Frame $border $borderType="ring" $edgeWeight="medium" $rounded="none" className="shadow-2xl">` | The box of a screenshot. Sized from `width` and `height`. A checkerboard is the background of this box only                |
| Glass (raised)  | any frame with `$lighten={3} $border` and the `glass` classes below                              | All floating chrome: pills, the dock, the expanded roll, plates                                                            |
| Brand           | `$layer="brand"`                                                                                 | One surface on each screen: Approve, Review, or Sign in. Also the 1 px accent of the current frame and of the change marks |
| Status tint     | `$layer={role} $mix={15}`                                                                        | Stamps, tags, the error plate, the read-only plate                                                                         |
| Popover, dialog | the default `Popover` and `Dialog` (opaque)                                                      | Details, run facts, menus, Keys, All screenshots. Always `portal`                                                          |

```tsx
// One class string for all floating chrome. It is the blur recipe of ShellHeader ($blur).
const glass =
  "backdrop-blur-md bg-[color-mix(in_oklab,var(--ak-layer)_80%,transparent)] " +
  "supports-[not(backdrop-filter:blur(1px))]:bg-(--ak-layer) " +
  "[@media(prefers-reduced-transparency:reduce)]:bg-(--ak-layer) shadow-lg";
```

Rules:

- Borders exist in two places only: the 1 px edge of glass (`$border`, which is necessary in light because `$lighten` cannot go above white) and the ring of the print. There are no dividers and no separators, except `ButtonSeparator` inside the dock.
- Do not put glass inside glass. Nested backdrop filters do not compose. A popover that opens from a pill is opaque and uses `portal`.
- No literal colors. The red of the diff comes from the stored mask image. The checkerboard uses `currentColor`.
- A screenshot on the stage is never rounded, cropped, or tinted. A thumbnail is a crop and can have `$rounded="sm"`.

### Type

Fonts: Inter Variable for text, JetBrains Mono Variable for identifiers and numbers. All sizes are `rem` classes. No text is below 12 px.

| Class       | Size  | Weight                             | Use                                                                      |
| ----------- | ----- | ---------------------------------- | ------------------------------------------------------------------------ |
| `text-xs`   | 12 px | 400, 500                           | Tags, meta lines, counts, tile captions, key caps                        |
| `text-sm`   | 14 px | 500 (controls), 600 (names)        | All controls, the caption name, the stamp                                |
| `text-base` | 16 px | 400                                | Sentences in a gate, an alert, a slate                                   |
| `text-xl`   | 20 px | 600                                | Slate title on the review page (end slate, state slates)                 |
| `text-3xl`  | 30 px | 600, `tracking-tight text-balance` | Slate title on the queue and the pull request, alert title, gate heading |

Mono (`font-mono tabular-nums`): pull request numbers, commit SHAs, branch names, image sizes, percentages, zoom level, counts on tiles, alert identifiers, the Error ID. The review page uses 12 px and 14 px only, plus 20 px on a slate.

### Spacing and density

- Floating chrome sits `inset-3` (12 px) from the viewport edges on desktop and `inset-2` (8 px) on a phone. The gap between pills is `gap-2`.
- Pills and the dock use `$size="sm"` (about 32 px high). The decision buttons use `$size="md"` with `text-sm` (40 px). On a phone every target is 44 px or more, and the decision buttons are 48 px.
- Use spacing steps and named radius steps only, so that the Look controls apply. Measure the chrome with a `ResizeObserver` for the fit calculation; do not hard-code pixel heights.

### Radius

Pills and the dock: `full`. Plates, popovers, dialogs: `2xl`. Tiles: `md`. Thumbnails inside tiles: `sm`. The print: `none`. Roll ticks: `xs`. Give a `Badge` inside a pill `$forceRounded`.

### Icons

lucide-react at `1.15em`, stroke 1.75. The framework and browser marks (React, Solid, Chrome, Firefox, Safari) show on roll tiles and in the caption. `Sun` and `Moon` show the color scheme. The view modes are words, not icons. Each icon-only button has an `aria-label` and a `Tooltip` with a `Kbd`.

### Status vocabulary

One shape language for run states and variant verdicts. Shape and word carry the meaning. Color is the third signal.

| Name (exact copy) | Applies to                  | Color role           | Icon                                     | Roll tick                            |
| ----------------- | --------------------------- | -------------------- | ---------------------------------------- | ------------------------------------ |
| Needs review      | run, variant                | warning              | `Circle` (hollow)                        | hollow outline                       |
| Approved          | variant                     | success              | `Check`                                  | solid                                |
| Auto-approved     | variant (added, removed)    | success, `ak-ink-60` | `CheckCheck`                             | solid at half strength (`$mix={50}`) |
| Rejected          | run, variant                | danger               | `X`                                      | solid and 2 px taller                |
| Passed            | run                         | success              | `CircleCheck`                            | none                                 |
| Capturing         | run                         | neutral              | `CircleDashed` with a `ProgressCircular` | none                                 |
| Comparing         | run, variant                | neutral              | `ProgressCircular`                       | dashed outline                       |
| Failed            | run, variant (kind `error`) | danger               | `TriangleAlert`                          | dashed outline, danger               |
| Rerun needed      | run (`needs-recompare`)     | danger               | `RotateCw`                               | none                                 |
| Replaced          | run (`superseded`)          | neutral              | `Replace`                                | none                                 |
| Unchanged         | variant                     | neutral              | `Equal`                                  | not on the roll                      |

Kind tags on the stage (a `Badge` beside the image tag): `Added` (success, `Plus`), `Removed` (danger, `Minus`), `Size changed` (warning, `Scaling`). A changed variant has no kind tag.

Map the lab roles with `runStateRoles`, `reviewStatusRoles`, and `variantKindRoles`. Use the words of this table, not the `short` labels of the lab.

### Motion

| What moves              | How                                                                                                                                                                                                                                                            | Reduced motion                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A new frame             | The old print is removed in the same frame (no fade out). The new print fades in over 120 ms with a 12 px offset: from the right for the next variant, from the left for the previous one, from below for the next screenshot, from above for the previous one | No offset. Opacity change in 80 ms             |
| Arrival flip            | Baseline for 320 ms, then a hard cut to current. One time for each arrival at a changed variant that needs review                                                                                                                                              | Off. The current image shows with static marks |
| Change marks            | One pulse (scale 1.15 to 1, 600 ms), then 60% strength                                                                                                                                                                                                         | No pulse                                       |
| Chrome fade             | 150 ms opacity. To 30% while a pan or a zoom gesture runs and for 800 ms after it. To 0 after 3 s without pointer movement while the image is under the chrome. Back in 150 ms on pointer movement, a key, or focus inside the chrome                          | Opacity steps without a transition             |
| Roll                    | Rises from ticks to tiles in 160 ms after a 120 ms hover delay. Falls 300 ms after the pointer leaves or 1200 ms after the last navigation key                                                                                                                 | No height transition                           |
| Camera (`C`, zoom keys) | 200 ms transform to the new scale and position                                                                                                                                                                                                                 | Instant                                        |
| Stamp                   | Scale 1.15 to 1 with opacity, 120 ms, on the leaving frame                                                                                                                                                                                                     | Opacity only                                   |
| Dive (queue to run)     | View transition: the cover tile grows into the print, 220 ms. Fallback: a fade                                                                                                                                                                                 | A fade                                         |
| HUD                     | Fades in 80 ms, stays 900 ms, fades out 150 ms                                                                                                                                                                                                                 | Same, without a fade                           |

Nothing loops, except the rings of Capturing and Comparing. They are static with reduced motion and show the value as text.

## 3. Shell and navigation model

There is no `Shell`, no header bar, no sidebar, and no footer. The root of every page is the stage. Five anchors hold the chrome, and they are the same on every page.

| Anchor                   | Queue                                   | Pull request                                             | Review                                 | History                            | Status                       | Sign-in                    |
| ------------------------ | --------------------------------------- | -------------------------------------------------------- | -------------------------------------- | ---------------------------------- | ---------------------------- | -------------------------- |
| Top left (context pill)  | mark, `Queue`, `History`, `Status`      | back, `#4863`                                            | back, `#4863 title`                    | mark and nav                       | mark and nav                 | mark                       |
| Top center (subject tag) | none                                    | none                                                     | image tag and verdict stamp            | none                               | none                         | none                       |
| Top right (meta pill)    | alert dot, account                      | alert dot, account                                       | progress, `?`, alert dot, account      | search, filter, alert dot, account | last check, refresh, account | none                       |
| Stage                    | cover of the selected run and its slate | cover of the selected attempt and the pull request slate | the screenshot                         | wall of run tiles                  | the selected alert           | the gate in an empty frame |
| Bottom band              | strip of runs                           | strip of attempts                                        | caption, dock, decisions, and the roll | none                               | meters and strip of alerts   | none                       |

**Always on screen.** The stage; the context pill (where am I, and the way back); the meta pill (alert dot and account); the strip when the subject has more than one sibling.

**Levels and movement.**

```
Queue  --Enter-->  Run  (first variant that needs review)
  |                 ^
  |  (a pull request with several attempts, or nothing to review)
  +--> Pull request --Enter--> Run
Queue <--> History (the strip expanded to a wall)      Status (from the nav or the alert dot)
Inside a run:  Up/Down = screenshot   Left/Right = variant   J/K = next/previous change on the roll
```

- Dive in: Enter, or a click on a tile or on the brand button. Come up: the back button in the context pill, or the browser Back key. Escape only closes a popover, a dialog, a zoom, or lights out. Escape never leaves a run and never rejects.
- A link from a GitHub check (`/pulls/4863?check=...`) opens the run directly when the head commit has a run that can be reviewed. The pull request level stays one step up.
- Inside a run, a selection change replaces the history entry. Entering a run pushes one entry. So Back always leaves the run in one step.

**URL model.**

| URL                                                              | Page                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/`                                                              | Queue. `?run=<id>` holds the selected run (replace)                          |
| `/history?q=datepicker&state=passed`                             | History                                                                      |
| `/status?alert=<id>`                                             | Status                                                                       |
| `/pulls/4863`                                                    | Pull request. `?run=<id>` holds the selected attempt                         |
| `/runs/<id>?item=dialog/focus/open&variant=react-chromium-light` | Review. Optional view state for shared links: `&view=diff&zoom=2&at=640,360` |

Sign-in is a state of each URL, not a route. The URL stays, so the return after GitHub is the page that the person asked for.

**Page titles.** `{state} · {subject} · Visonaut`.

- `(4) Queue · Visonaut`, `History · Visonaut`, `(3) Status · Visonaut`, `Sign in · Visonaut`
- `#4863 Migrate component examples… · Visonaut` (pull request)
- `22 left · #4863 Migrate component examples… · Visonaut`, then `Passed · #4863 …`, `Read-only · #4863 …`

**Account.** An avatar button at the end of the meta pill. It opens an `ak.Menu` (popover recipe): `@diegohaz` (label), `Theme` with `System`, `Light`, `Dark`, and `Sign out`.

**Service alert.** A dot with a count in the meta pill, on every page, only when `alertCount` is above 0. Critical is danger, else warning. It opens a `Popover` with at most three rows (mark, title, relative time) and the link `Open status`. On the review page the dot hides with the rest of the chrome in lights out.

**Desktop sketch (1440).**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (context pill)                    [subject tag]                              (meta pill) │
│                                                                                          │
│                                                                                          │
│                                  S T A G E                                               │
│                         one subject, centered in the                                     │
│                         space between the pills                                          │
│                                                                                          │
│                                                                                          │
│ ───── strip: the siblings of the subject (ticks, or tiles) ───────────────────────────── │
│ (caption)                        (dock)                               (one brand action) │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Phone sketch (390).**

```
┌──────────────────────────────┐
│ (context pill)   (meta pill) │
│ ┌──────────────────────────┐ │
│ │        subject           │ │
│ │   (fit width, top)       │ │
│ └──────────────────────────┘ │
│ [subject tag]                │
│ caption                      │
│ (dock)                       │
│ (one brand action, 48 px)    │
│ ── strip ─────────────────── │
└──────────────────────────────┘
```

On a phone the nav in the context pill becomes the mark and one button with the page name that opens a menu (`Queue`, `History`, `Status`).

## 4. Page specs

### 4.0 Shared parts

Build these one time (for example in `src/explorations/shared/immersive/`) and use them on all six pages.

| Part          | Primitive                                                                                                                         | Notes                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Stage`       | `Frame $darken={2} render={<main />}` with `relative h-dvh w-full overflow-clip`                                                  | History uses `min-h-dvh` and page scroll                                                              |
| `Pill`        | `ButtonGroup $lighten={3} $border $rounded="full" $size="sm"` with `glass`                                                        | Inner buttons take the concentric radius                                                              |
| `Plate`       | `Frame $lighten={3} $border $rounded="2xl" $p="1rem"` with `glass`                                                                | Error, read-only, and save-error notices                                                              |
| `ContextPill` | `Pill` with a back `Button` (icon `ChevronLeft`) and a `PopoverDisclosure`, or with a horizontal `Nav`                            | `Nav $layout="horizontal" glider` with three `NavLink`. `NavSlot $kind="badge"` holds the queue count |
| `MetaPill`    | `Pill` with icon buttons, `Tooltip`, `PopoverDisclosure`, `ak.MenuButton`                                                         |                                                                                                       |
| `Strip`       | `ak.CompositeProvider` and `ak.Composite render={<div role="listbox" />}`; each sibling is `ak.CompositeItem render={<Button />}` | One Tab stop. Arrow keys move inside it. Ticks or tiles                                               |
| `Tile`        | `Button $rounded="md" $p={1}` with a media `Frame $darken overflow-clip` and one caption line                                     | `aria-current="true"` plus `$border={2} $edge="brand" $edgeRaw` on the current tile                   |
| `EmptyFrame`  | `Frame $border $borderType="dashed" $rounded="none"` at 16:10, `max-w-[40rem]`, centered, content in a `grid place-items-center`  | Loading skeleton (`animate-pulse`), empty states, error states, the gate                              |
| `Slate`       | `HeadingLevel`, `Heading` (`mt-0 mb-0 text-3xl`), `Text` lines, one `Button $layer="brand"`                                       | The title card of a run, a pull request, or an alert. Text sits directly on the stage                 |
| `StatusMark`  | `Text $text={role} className="flex"` around the icon, or a `Badge $layer={role} $forceRounded` with `BadgeSlot` and `BadgeLabel`  | One component for the table in section 2                                                              |
| `HUD`         | `Frame` with `glass`, `$rounded="full"`, `aria-hidden`, bottom center                                                             | One line of feedback for 900 ms                                                                       |

The live region for assistive technology is one `sr-only` element with `role="status"` that prints `session.announcement`.

### 4.1 Sign-in

**1440 wide.**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (◎)                                                                                      │
│                                                                                          │
│                   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                 │
│                   ╎                                                  ╎                 │
│                   ╎              Sign in to review                   ╎                 │
│                   ╎   You need write access to ariakit/ariakit.      ╎                 │
│                   ╎                                                  ╎                 │
│                   ╎            [ Sign in with GitHub ]               ╎                 │
│                   ╎                                                  ╎                 │
│                   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                 │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide.** The same frame at `w-full` with a 16 px margin, vertically centered. The button is 48 px high and full width.

```
┌──────────────────────────────┐
│ (◎)                          │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐ │
│ ╎   Sign in to review      ╎ │
│ ╎   You need write access  ╎ │
│ ╎   to ariakit/ariakit.    ╎ │
│ ╎ [  Sign in with GitHub ] ╎ │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘ │
└──────────────────────────────┘
```

**Regions.** Stage. Context pill with the mark only (a `Button` that links to `/`). `EmptyFrame` with `Heading`, `Text render={<p />}` (`ak-ink-70`), `Button $layer="brand"` with a `ButtonSlot` (GitHub mark or `LogIn`) and a `ButtonLabel`. Use `useSignIn(scenario)`.

**Copy and scenarios.**

| Scenario     | Heading                   | Sentence                                                                   | Actions                                                                                                                 | Words |
| ------------ | ------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----- |
| `guest`      | `Sign in to review`       | `You need write access to ariakit/ariakit.`                                | `Sign in with GitHub` (brand)                                                                                           | 14    |
| `signing-in` | same                      | same                                                                       | The button is disabled, neutral, with a `ProgressCircular` in its slot and the label `Opening GitHub`. The frame pulses | 12    |
| `forbidden`  | `No write access`         | `@{login} cannot review ariakit/ariakit.` with the avatar before the login | `Use another account` (bordered), `Back to GitHub` (`Link` with `ArrowUpRight`)                                         | 13    |
| `error`      | `Visonaut did not answer` | `Try again in a moment.`                                                   | `Retry` (bordered, shows a ring while `retrying`), then `Error ID req_01JZ8Q2N5K` in mono, `ak-ink-60`                  | 13    |

When the URL names a target that the service can return to a guest, the heading is `Sign in to review #4863` (Not in the API today).

**Interactions and keys.** Enter activates the one button (it has focus on load). No shortcuts.

**Removed.** The marketing column ("Every change. A clear decision."), the eyebrow, the card with the icon tile, the navigation that cannot work for a guest, three different sign-in texts, the text "Checking access".

### 4.2 Inbox (visible name: Queue)

The queue is a lightbox of runs. Use `useInbox(scenario)`. The strip lists `groups` in the order review, progress, attention. The first run of the first group that has runs is selected.

**1440 wide (scenario `busy`).**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (◎ │ Queue 4 · History · Status)                                            (•3) (DH)    │
│                                                                                          │
│   #4863                                      ┌──────────────────────────────────────┐    │
│   Migrate component examples                 │                                      │    │
│   to the new style recipes                   │   cover: previews[0] at fit          │    │
│   nilsson-sofia · refactor/style-recipes     │                                      │    │
│   ✕ 2 rejected · 22 need review              │                                      │    │
│                                              └──────────────────────────────────────┘    │
│   [ Review 22 changes  ↵ ]                    Dialog with initial focus  ▫ ▫ ▫           │
│                                                                                          │
│  To review 4                                   In progress 2        Needs attention 2    │
│ ╔═══════╗ ┌───────┐ ┌───────┐ ┌───────┐       ┌╌╌╌╌╌╌╌┐ ┌╌╌╌╌╌╌╌┐   ┌╌╌╌╌╌╌╌┐ ┌╌╌╌╌╌╌╌┐  │
│ ║ cover ║ │ cover │ │ cover │ │ cover │       ╎  ◌    ╎ ╎  ◌    ╎   ╎   !   ╎ ╎   ↻   ╎  │
│ ╚═══════╝ └───────┘ └───────┘ └───────┘       └╌╌╌╌╌╌╌┘ └╌╌╌╌╌╌╌┘   └╌╌╌╌╌╌╌┘ └╌╌╌╌╌╌╌┘  │
│ #4863 22  #4831 79  #4819 12  main 6          queue 68%  #4855 40%  #4844      main      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide.**

```
┌──────────────────────────────┐
│ (◎ Queue 4 v)      (•3) (DH) │
│ ┌──────────────────────────┐ │
│ │  cover (fit width)       │ │
│ └──────────────────────────┘ │
│ #4863                        │
│ Migrate component examples   │
│ to the new style recipes     │
│ ✕ 2 rejected · 22 need review│
│ [ Review 22 changes        ] │
│ To review 4                  │
│ ╔════╗ ┌────┐ ┌────┐ ┌────┐ →│
│ ╚════╝ └────┘ └────┘ └────┘  │
│ #4863  #4831  #4819  main    │
└──────────────────────────────┘
```

**Regions.**

| Region                                                              | Primitive                                                                                                                                                                                                                   | Content                                                                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Context pill                                                        | `Pill` with the mark `Button` and a horizontal `Nav` with a flat glider                                                                                                                                                     | `Queue` with `NavSlot $kind="badge"` (count of the review group), `History`, `Status` with a status dot when alerts exist |
| Meta pill                                                           | `Pill`                                                                                                                                                                                                                      | Refresh icon button (`RotateCw`, shows a ring while `refreshing`; the content stays on screen), alert dot, account        |
| Slate (left, 40% of the width, vertically centered above the strip) | `HeadingLevel`, `Text` (mono number), `Heading` (`text-3xl`, `line-clamp-3`), `Text` meta (mono, `ak-ink-60`, `truncate`), `StatusMark` with the count line, `Button $layer="brand"` with `ButtonSlot $kind="shortcut"` `↵` | See the copy table                                                                                                        |
| Cover (right, 60%)                                                  | `Print` with `previews[0].image` at Fit in its column. Under it one `Text` line (`text-xs ak-ink-60`) with the screenshot name, and up to three mini prints (`previews[1..3]`, 72 px wide)                                  | Not in the API today: `previews`                                                                                          |
| Strip (pinned, tiles)                                               | `Strip` with group labels (`Text text-xs ak-ink-60`) and `Tile` 132 x 84                                                                                                                                                    | Caption under each tile: the mono identifier (`#4863`, `main`, `queue`) and one value (count, percent, or nothing)        |

Tile media by state: a cover thumbnail (`previews[0]`, `object-cover object-top`) for Needs review and Rejected, with the `StatusMark` on a glass dot at the top-left corner; a dashed `EmptyFrame` with a `ProgressCircular` (value from `progress`) for Capturing and Comparing; a dashed frame with `TriangleAlert` for Failed, `RotateCw` for Rerun needed, `Replace` for Replaced. A run without previews and with changes shows a dashed frame with its `StatusMark`.

**Copy.**

| Element            | Copy                                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nav                | `Queue`, `History`, `Status`                                                                                                                                                                                                                                                |
| Slate, line 1      | `#4863` (or `main`, `Merge queue`)                                                                                                                                                                                                                                          |
| Slate, title       | `getRunTitle(run)`. Without a title: `Pull request #7746`, or the short SHA for main                                                                                                                                                                                        |
| Slate, meta        | `{author.login} · {branch}`. For main: the short SHA                                                                                                                                                                                                                        |
| Slate, status line | Needs review: `79 need review`. Rejected: `2 rejected · 22 need review`. Capturing: `Capturing · 412 of 600`. Comparing: `Comparing · 240 of 600`. Failed: `Failed` and `run.error`. Rerun needed: `Rerun needed` and `The baseline changed. Rerun the visual tests in CI.` |
| Slate, action      | `Review 22 changes` (brand). Failed: `Open run` (bordered). Capturing, Comparing, Rerun needed: no button; a `Link`: `Open pull request`                                                                                                                                    |
| Strip labels       | `To review 4`, `In progress 2`, `Needs attention 2`                                                                                                                                                                                                                         |

Word count for `busy`: 32 words, plus 18 identifiers and numbers (today: 8 cards of 21 to 24 words each).

**Scenarios.**

- `busy`: as drawn. Eight tiles in three groups.
- `single`: one run. No strip. Slate and cover only. About 16 words.
- `empty`: a centered `EmptyFrame` with `CircleCheck` (success), the heading `Nothing to review`, the mono line `Baseline revision 128`, and the link `Open history`. The strip shows `recentRuns` at `ak-ink-60` under the label `Recent`. 8 words.
- `first-run`: `EmptyFrame` with the heading `No baseline yet`, the sentence `Run the visual tests on main to create the first baseline.`, and the link `Read the setup guide`. No strip. 18 words.
- `loading`: see section 5. No words except the nav.
- `error`: `EmptyFrame` with `TriangleAlert`, the heading `The runs did not load`, a bordered `Retry`, and `Error ID …` in mono when a reference exists. 9 words.

**Interactions and keys.** Left and Right (also `J` and `K`) select a run on the strip; the slate and the cover follow at once. Enter opens the selected run. A click on a tile selects it; a click on the selected tile or on the brand button opens it. `/` opens History with the search field focused. `?` opens Keys. The list refreshes every 30 s while the tab is visible; `refresh()` keeps the content on screen.

Lab links: #4863 to `review` `changes`; #4831 to `review` `large`; the single run to `review` `one-change`; #4855 to `review` `comparing`; #4844 to `review` `problems`; a tile with several attempts to `pull` `attempts`.

**Removed.** The page title "Your review queue." and its sentence, the repository eyebrow, the three counters, the uppercase section headings, the 240 px cards, the sentence "N views await approval.", the SHA, attempt, and absolute time on each card, one "Review changes" button for each card, the text button "Refresh runs", the bordered bell, the footer link "View history".

### 4.3 History

History is the queue strip expanded into a wall. The page scrolls; the pills are `fixed`. Use `useHistory(scenario)` and `groupRunsByDay(history.visibleRuns)`.

**1440 wide (scenario `full`).**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (◎ │ Queue 4 · History · Status)     (Search runs            /) (All 40 v)   (•3) (DH)   │
│                                                                                          │
│  Today                                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌╌╌╌╌╌╌╌╌╌╌┐ ┌╌╌╌╌╌╌╌╌╌╌┐            │
│  │  cover   │ │  cover   │ │  cover   │ │  cover   │ ╎    ◌     ╎ ╎    !     ╎            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └╌╌╌╌╌╌╌╌╌╌┘ └╌╌╌╌╌╌╌╌╌╌┘            │
│  #4863 Migrate comp…  #4831 Update depe…  #4819 Fix Combob…  …                           │
│  ✕ Rejected · 12 min  ○ Needs review · 1 h  ○ Needs review · 2 h                         │
│  No changes   (✓ main 4f1c9e0 · 2 h) (✓ queue 27b78d0 · 3 h) (✓ main 9a2b7c1 · 5 h)      │
│                                                                                          │
│  Yesterday                                                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                                                  │
│  …                                                                                       │
│                                                         Latest 100 runs                  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide.** The search field is a second pill under the top row. The wall has two columns.

```
┌──────────────────────────────┐
│ (◎ History v)      (•3) (DH) │
│ (Search runs)      (All 40 v)│
│ Today                        │
│ ┌────────────┐┌────────────┐ │
│ │   cover    ││   cover    │ │
│ └────────────┘└────────────┘ │
│ #4863 Migra…  #4831 Updat…   │
│ ✕ Rejected    ○ Needs review │
│ No changes                   │
│ (✓ main 4f1c9e0) (✓ queue …) │
└──────────────────────────────┘
```

**Regions.**

| Region         | Primitive                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search         | `InputGroup $rounded="full" $size="sm"` with `glass`, `InputSlot` (`Search`), a plain `input` (`min-w-0 flex-1`), `InputSlot $kind="shortcut"` with `Kbd` `/`                               |
| Result filter  | `ComboboxProvider`, `ComboboxSelect $layer="transparent"` inside a `Pill`, `ComboboxPopover` with one `ComboboxItem` for each state of `history.states` and its count from `history.counts` |
| Day heading    | `Heading` (`text-sm font-semibold mt-0 mb-0`) inside a `HeadingLevel`                                                                                                                       |
| Wall           | `ak.Composite` grid (`grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-4`). `Tile` 200 x 125 with two caption lines                                                                    |
| No-changes row | A `flex flex-wrap gap-2` row: `Text` label and one `Button $size="sm" $lightnessOffset $rounded="full"` for each run (`StatusMark`, mono identifier, relative time)                         |

A run goes to the wall as a tile when it has `previews`, or when its state is Capturing, Comparing, Failed, or Rerun needed (dashed frame). A Passed or Replaced run without previews goes to the `No changes` row of its day.

**Copy.**

| Element            | Copy                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Search placeholder | `Search runs`                                                                                                                        |
| Filter             | `All 40`, then `Needs review 3`, `Rejected 1`, `Passed 18`, `Replaced 9`, `Failed 2`, `Rerun needed 1`, `Comparing 1`, `Capturing 1` |
| Tile, line 1       | `#4863 Migrate component examples…` (one line, truncated). Without a title: `#7746`. Main: `main 4f1c9e0`                            |
| Tile, line 2       | mark, state word, `·`, relative time. Attempt shows only above 1: `· attempt 2`                                                      |
| Row label          | `No changes`                                                                                                                         |
| End of the wall    | `Latest 100 runs`                                                                                                                    |

**Scenarios.**

- `full`: 40 runs in about five day groups.
- `no-match`: the query `datepicker` is in the field. The wall is one `EmptyFrame` with the heading `No runs match “datepicker”` and a bordered `Clear search`. 6 words.
- `empty`: `EmptyFrame` with the heading `No runs yet`. 3 words.
- `loading`: see section 5.
- `error` (extra): `The runs did not load`, `Retry`.

**Interactions and keys.** `/` focuses the search. Arrow keys move in the grid when a tile has focus. Enter opens the run, or the pull request when the run is Replaced and its pull request has a newer run. Escape in the field clears the query. The query and the filter are in the URL.

**Removed.** The heading "Run history." and its sentence, the sentence about the latest 100 runs (it is three words at the end), the table header, the absolute timestamps, the attempt on each row, the SHA under each title.

### 4.4 Status

Use `useStatus(scenario)`. The alert list is read-only: do not use `acknowledge` or `dismiss`.

**1440 wide (scenario `alerts`).**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (◎ │ Queue 4 · History · Status •3)                     (Checked 12 s ago  ⟳)   (DH)     │
│                                                                                          │
│              ▲ Critical                                                                  │
│              A GitHub check needs attention                                              │
│              The pull request does not show its Visonaut result.                         │
│              {alert.action}                                                              │
│              check-delivery · exhausted · 5f0c…                                          │
│              Since 14:55 · last seen 4 min ago · 6 times                                 │
│              [ Open guide ↗ ]   [ Open run ]                                             │
│                                                                                          │
│  Database 612 MiB of 900 MiB ▓▓▓▓▓▓▓░░░        Captures 2 of 8 ▓▓░░░░░░                  │
│ ╔════════════════════════╗ ┌────────────────────────┐ ┌────────────────────────┐         │
│ ║ ▲ A GitHub check need… ║ │ △ Database capacity n… │ │ △ A backup needs atte… │         │
│ ║   4 min ago            ║ │   3 min ago            │ │   1 h ago              │         │
│ ╚════════════════════════╝ └────────────────────────┘ └────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide.**

```
┌──────────────────────────────┐
│ (◎ Status v)  (12 s ⟳) (DH)  │
│ ▲ Critical                   │
│ A GitHub check needs         │
│ attention                    │
│ The pull request does not    │
│ show its Visonaut result.    │
│ {alert.action}               │
│ [ Open guide ↗ ] [ Open run ]│
│ Database ▓▓▓▓▓▓▓░░  Captures │
│ ╔══════════╗ ┌──────────┐  → │
│ ║▲ A GitHub║ │△ Database│    │
│ ╚══════════╝ └──────────┘    │
└──────────────────────────────┘
```

**Regions.**

| Region                                         | Primitive                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta pill                                      | `TextFrame` (`Checked 12 s ago`, `ak-ink-60`) and a refresh icon `Button` with a `Tooltip` (`Check now`)                                                                                                                                                                                              |
| Alert slate (centered column, `max-w-[40rem]`) | `Badge $layer={role}` with `BadgeSlot` and `BadgeLabel` (severity), `Heading` (`text-3xl`), two `Text render={<p />}` (impact at ink 100, action at `ak-ink-70`), `Code` for the identifiers, one `Text` time line (`text-xs ak-ink-60`), `Button $layer="brand" render={<a />}` and `Button $border` |
| Meters                                         | Two `Progress` bars (`$thickness={1.5}`, 12rem wide) with a `Text` label before each. The fill is `warning` above the warning size and `danger` at the limit                                                                                                                                          |
| Strip                                          | `Strip` of `Tile` 280 x 56 without media: `StatusMark`, title (`truncate`), relative time. More than 9 alerts: the strip scrolls; `hasMore` adds the last tile `More than 50 alerts`                                                                                                                  |

**Copy.**

| Element               | Copy                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| Severity              | `Critical`, `Warning`                                                                  |
| Title, impact, action | `alert.title`, `alert.impact`, `alert.action` from the data. The page adds no sentence |
| Identifiers           | `{kind} · {code} · {subject}`                                                          |
| Times                 | `Since 14:55 · last seen 4 min ago · 6 times`                                          |
| Actions               | `Open guide` (brand, links to `guideUrl`), `Open run` (only with `runId`)              |
| Meters                | `Database 612 MiB of 900 MiB`, `Captures 2 of 8`                                       |
| Last check            | `Checked 12 s ago`                                                                     |

**Scenarios.**

- `alerts`: as drawn. The first critical alert is selected. About 55 words with the alert on the stage.
- `healthy`: a centered `EmptyFrame` with `CircleCheck` (success) and the heading `All clear`. The meters stay. No strip. 12 words.
- `loading`: see section 5.
- `error`: `EmptyFrame` with `TriangleAlert`, the heading `The alerts did not load`, and a bordered `Retry`. When alerts from an earlier check exist, they stay on screen and the meta pill shows a warning `Badge`: `May be out of date`.

**Interactions and keys.** Left and Right select an alert. Enter opens the guide. The page checks every minute and keeps the content on screen during a check (the refresh icon becomes a ring).

**Removed.** The eyebrow "Operations", the heading and its two sentences, the two gray capacity sentences with raw numbers, one card with a "Technical details" disclosure for each alert, the label "Open the operations and recovery guide", the sentence "No external notifications are sent.", the text button "Refresh alerts".

### 4.5 Pull request

Use `usePull(scenario)`. The strip groups the runs by commit (`commits`), newest commit first. The selected attempt is `reviewRun`, else `latestRun`.

**1440 wide (scenario `attempts`).**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (‹ Queue)                                                                   (•3) (DH)    │
│                                                                                          │
│   #4863 · Open                               ┌──────────────────────────────────────┐    │
│   Migrate component examples                 │                                      │    │
│   to the new style recipes                   │   cover of the selected attempt      │    │
│   nilsson-sofia · refactor/style-recipes → main                                     │    │
│   ✕ 2 rejected · 22 need review              │                                      │    │
│                                              └──────────────────────────────────────┘    │
│   [ Review 22 changes  ↵ ]  [ Open on GitHub ↗ ]                                         │
│                                                                                          │
│  4f1c9e0 · head                                   9a2b7c1                                │
│ ╔═════════╗ ┌╌╌╌╌╌╌╌╌╌┐                          ┌─────────┐                             │
│ ║  cover  ║ ╎    !    ╎                          │  cover  │                             │
│ ╚═════════╝ └╌╌╌╌╌╌╌╌╌┘                          └─────────┘                             │
│ Attempt 2 · 22  Attempt 1 · Failed                Replaced                               │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide.** The same stack as the queue on a phone: cover, slate, two buttons (the brand button first, full width), strip.

```
┌──────────────────────────────┐
│ (‹ Queue)          (•3) (DH) │
│ ┌──────────────────────────┐ │
│ │  cover (fit width)       │ │
│ └──────────────────────────┘ │
│ #4863 · Open                 │
│ Migrate component examples   │
│ to the new style recipes     │
│ ✕ 2 rejected · 22 need review│
│ [ Review 22 changes        ] │
│ [ Open on GitHub ↗         ] │
│ 4f1c9e0 · head     9a2b7c1   │
│ ╔════╗ ┌╌╌╌╌┐      ┌────┐    │
│ ╚════╝ └╌╌╌╌┘      └────┘    │
└──────────────────────────────┘
```

**Regions.** The same parts as the queue. The context pill has the back `Button` with the label `Queue`. The slate adds the pull request state after the number and a second, bordered button. The strip labels are mono commit SHAs; the head commit adds `· head`.

**Copy.**

| Element      | Copy                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Line 1       | `#4863 · Open` (`Open`, `Draft`, `Merged`, `Closed`)                                                                 |
| Meta         | `{author.login} · {branch} → {baseBranch}`                                                                           |
| Status line  | as on the queue slate, for the selected attempt                                                                      |
| Actions      | `Review 22 changes` (brand), `Open on GitHub` (bordered). A Passed attempt: `Browse run` (bordered, no brand button) |
| Tile caption | `Attempt 2 · 22`, `Attempt 1 · Failed`, `Replaced`                                                                   |

Word count for `attempts`: 28 words.

**Scenarios.**

- `attempts`: as drawn. Three tiles in two commit groups.
- `single`: #4852 with one Passed run. No strip. Status line `Passed · 12 approved`. Buttons: `Browse run`, `Open on GitHub`.
- `no-runs`: a centered `EmptyFrame` with `CircleCheck` (neutral), the heading `No visual review needed`, the sentence `This pull request does not change screenshots.`, and the link `Back to GitHub`. The slate lines (number, title) stay above the frame. 14 words.
- `loading`: see section 5.
- `waiting` (extra): a dashed frame with a `ProgressCircular`, the heading `Capturing`, the line `CI is still uploading. The review opens when it is ready.`
- `capture-failed` (extra): the heading `Capture failed` and the link `Open the workflow run`.

**Interactions and keys.** Left and Right select an attempt. Enter opens it. A Replaced or Failed attempt opens read-only.

**Removed.** The card with the icon tile, the eyebrow "Visual review · Pull request #7", the centered back link, the two waiting sentences, the "Check again" button (the page polls), the redirect page that shows before each review.

### 4.6 Review

Use `useReviewSession(scenario, { order: "declared" })` and `useReviewShortcuts(session, { keys })`.

**1440 x 900 (scenario `changes`, roll at rest).**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (‹ │ #4863 Migrate component exa… v)  [Current 1280 × 720][○ Needs review]  (◔ 22 left)(?)(•3)(DH) │  y 12-44
│                                                                                          │  y 56  safe rect top
│    ┌────────────────────────────────────────────────────────────────────────────────┐    │  y 81  first screenshot pixel
│    │                                                                                │    │
│    │                                                                                │    │
│ ‹  │                               ┌─          ─┐                                   │  › │
│    │                                   Done            (1280 × 720 at 100%)         │    │
│    │                               └─          ─┘                                   │    │
│    │                                                                                │    │
│    │                                                                                │    │
│    └────────────────────────────────────────────────────────────────────────────────┘    │  y 801
│                                                                                          │  y 826 safe rect bottom
│ ▭▭▭▬▭▭  ▭▭▭  ▭▭  ▭▭  ▭  ▭▭  ▭▭  ▮▮  ▭▭  ▬  ▬▬▬▬  ▬▬                                       │  y 834-840 the roll
│ Dialog with initial focus     (Current│Baseline│Diff│Swipe│Side by side)(− 100% +)(⌖ 1/1)(…)   (↶)(✕ Reject X)(✓ Approve A v) │  y 848-888
│ React · Chromium · Light · 0.15%                                                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**The roll raised (hover, a navigation key, or pinned with `P`).**

```
│ Dialog with initial focus                  Combobox with auto select…      Actions menu   │
│ ╔══════╗┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐  ┌──────┐┌──────┐┌──────┐  ┌──────┐┌────  │
│ ║ crop ║│ crop ││ crop ││ crop ││ crop ││ crop │  │ crop ││ crop ││ crop │  │ crop ││     │
│ ║Re Cr☼║│Re Cr☾││Re Fx☼││Re Wk☼││So Cr☼││Re Cr▣│  │   ✓  ││   ○  ││   ○  │  │   ○  ││     │
│ ╚═════○╝└─────○┘└─────○┘└─────○┘└─────○┘└─────○┘  └──────┘└──────┘└──────┘  └──────┘└────  │
```

**390 x 844.**

```
┌──────────────────────────────┐
│ (‹ #4863 Migrate co…) (◔ 22) │  8-52
│ ┌──────────────────────────┐ │  60   first screenshot pixel
│ │ whole screenshot         │ │       374 × 210 (fit width)
│ └──────────────────────────┘ │
│ [Current 1280 × 720][○ Needs]│
│ ┌──────────────────────────┐ │
│ │                          │ │
│ │  loupe: the changed      │ │       374 × ~250, region at 2× to 4×
│ │  region, enlarged        │ │
│ │                    1/1 2×│ │
│ └──────────────────────────┘ │
│ Dialog with initial focus    │
│ React · Chromium · Light     │
│ (Current│Baseline│Diff│Swipe)│  40
│ (↶) (✕ Reject) (✓ Approve v) │  48
│ ▭▭▭▬▭▭ ▭▭▭ ▭▭ ▭▭ ▭ ▭▭ ▮▮ ▬▬   │  the roll
└──────────────────────────────┘
```

#### Pixel budget at 1440 x 900

| Measure                                 | Today                                                      | Immersive                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Chrome above the first screenshot pixel | 408 px                                                     | 56 px of free stage with three pills. A 1280 x 720 image at 100% starts at y = 81. In lights out the image area starts at y = 12 |
| Space that the image can use            | 591 x 504 for each pane                                    | 1416 x 770 (84% of the viewport). 1416 x 876 in lights out                                                                       |
| 1280 x 720 screenshot, one image        | 832 x 468, 26% of the viewport, 36 px under the action bar | 1280 x 720 at 100%, 71% of the viewport, nothing under a control                                                                 |
| 1280 x 720, side by side                | 2 x 555 x 312 (27% for both)                               | 2 x 702 x 395 (43% for both)                                                                                                     |
| 800 x 1600 (tall)                       | a 94 px wide strip at Fit                                  | Fit width at 100%: 800 px wide, 770 px visible (48%), with wheel scroll                                                          |
| 640 x 400                               | 640 x 400                                                  | 150% on a 2x display (960 x 600, 44%); 100% on a 1x display                                                                      |
| 320 x 120 (small)                       | 320 x 120                                                  | 400% (1280 x 480, 47%), pixelated                                                                                                |

At 390 x 844 the first screenshot pixel is at y = 60 (today 518). The whole screenshot and the loupe use 52% of the viewport.

```ts
// Fit: shrink freely, enlarge only in whole device-pixel steps (crisp on 1x and on 2x displays).
function fitScale(
  image: { width: number; height: number },
  safe: { width: number; height: number },
) {
  const contain = Math.min(safe.width / image.width, safe.height / image.height);
  if (contain < 1) return contain;
  const ratio = window.devicePixelRatio || 1;
  return Math.min(4, Math.floor(contain * ratio) / ratio);
}
// Fit width (the default for an image whose contain scale is below 0.6): min(1, safe.width / image.width), with vertical scroll.
```

The safe rectangle is the viewport minus the measured top row and the measured bottom band (roll at rest: 74 px; roll pinned: 164 px). Use `[image-rendering:pixelated]` at a scale of 2 or more.

#### Regions and primitives

| Region                   | Primitive                                                                                                                                                                                                                                                                                                                                  | Content                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage                    | `Stage` with `role="group"` and `aria-label="Screenshot"`, `tabIndex={0}`                                                                                                                                                                                                                                                                  | Pointer and wheel handlers for pan and zoom                                                                                                                                                                                               |
| Print                    | `Print` with stacked `<img draggable={false}>` layers (baseline, current, mask) and the change marks                                                                                                                                                                                                                                       | One CSS transform for all layers                                                                                                                                                                                                          |
| Context pill             | `Pill`: back `Button` (`Tooltip`: `Back to queue`), `ButtonSeparator`, `PopoverDisclosure` with the run title                                                                                                                                                                                                                              | The popover (`Popover portal`) is the run facts: full title, `#4863` link, author, `branch → base`, commit link, `Attempt 2`, `Baseline revision 128`, `StatusMark`, links `Open pull request` and `All attempts`                         |
| Subject tag (top center) | Two `Badge $forceRounded` with `glass`: the image tag and the verdict stamp. Kind tags follow the image tag                                                                                                                                                                                                                                | `Current 1280 × 720` is quiet. Every other view is `Badge $invert`, so it is clear when the stage does not show the current image                                                                                                         |
| Meta pill                | `Pill`: progress `PopoverDisclosure` with a `ProgressCircular` (in a `size-[1lh]` box) and `22 left`; `?` button; alert dot; account                                                                                                                                                                                                       | Ring value: approved share of the variants that take a verdict, fill `success`. A danger `Badge` with the rejected count follows the text when it is above 0                                                                              |
| Edge zones               | Two `Button` (`aria-label="Previous change"`, `"Next change"`), 40 x 64 px hit area with a 32 px glass circle, at the left and right edges, vertically centered                                                                                                                                                                            | Visible when the pointer is within 96 px of the edge or when they have focus                                                                                                                                                              |
| Caption (bottom left)    | `PopoverDisclosure` rendered as a `Button` with `ButtonContent`, `ButtonLabel` (screenshot name, `$truncate`, `max-w-[20rem]`), `ButtonDescription` (variant label and change ratio)                                                                                                                                                       | It opens Details. The description shows framework and browser marks before the words                                                                                                                                                      |
| Dock (bottom center)     | `ButtonGroup role="toolbar"` with `glass`: an `ak.RadioGroup` of five `ak.Radio render={<Button />}` with a `ButtonGlider $kind="bevel"`; `ButtonSeparator`; zoom (`Minus` button, value `Button` that opens an `ak.Menu`, `Plus` button); `ButtonSeparator`; change stepper `Button` (`ScanSearch` and `1/3`); `Ellipsis` `ak.MenuButton` | The view menu holds: `Marks` (`H`), `Flip on arrival`, `Backdrop` (`Canvas`, `Light`, `Dark`, `Checker`), `Pin the roll` (`P`), `Lights out` (`L`)                                                                                        |
| Decisions (bottom right) | `ButtonGroup $gap="sm"` with `glass`: Undo icon `Button`; save slot `TextFrame` with a fixed width of 6rem; `Button $border` Reject with `ButtonSlot $kind="shortcut"` `X`; `Button $layer="brand" $size="md"` Approve with `A`; an `ak.MenuButton` caret joined to Approve                                                                | The buttons never move: the save slot has a fixed width and the pill has a fixed place                                                                                                                                                    |
| Roll                     | `Strip` between the stage and the bottom row                                                                                                                                                                                                                                                                                               | Ticks at rest, tiles when raised                                                                                                                                                                                                          |
| HUD                      | `HUD` above the dock                                                                                                                                                                                                                                                                                                                       | The name of the last action and its key                                                                                                                                                                                                   |
| Details                  | `Popover portal` from the caption, `w-80`, a `dl` in a two-column grid                                                                                                                                                                                                                                                                     | `Changed 1,842 px (0.15%)`, `Regions 1`, `Size 1280 × 720`, `Tolerance {threshold}`, `Reviewed by @login · 12 min ago`, `Commit 4f1c9e0`, `Attempt 2`, `Baseline revision 128`, button `Copy debug info`, button `Copy link to this view` |
| Keys                     | `Dialog` with `DialogHeading` `Keys`, `DialogScroll`, one row for each entry of `reviewShortcuts` and of the extra keys (`Text` and `Kbd`), and a switch `Shortcuts` (stored)                                                                                                                                                              | Opens with `?` and with the `?` button                                                                                                                                                                                                    |
| All screenshots          | `Dialog` at `max-w-[72rem]` and full height: `InputGroup` search (autofocus), filter chips (`CheckboxCard $rounded="full"` with counts from `facets`), a grid of `Tile` grouped by `session.groups`                                                                                                                                        | Opens with `/` and from the progress popover. It lists the unchanged screenshots too. No decisions here                                                                                                                                   |

#### Screenshot navigation: the roll

- A frame is one variant that takes a verdict or has a problem: `session.items.flatMap((item) => item.variants).filter((variant) => variant.reviewable || variant.status === "problem" || variant.status === "comparing")`, in declared order. Unchanged variants are not on the roll. They are in All screenshots.
- Frames of one screenshot touch (2 px gap). Screenshots have a 10 px gap between them.
- **At rest** the roll is one line of ticks, 6 px high, across the full width. Tick width: all frames share the width, minimum 4 px, maximum 28 px. When the ticks would be under 4 px, show one tick for each screenshot with the status of the screenshot. The tick encoding is in section 2. The current tick is 10 px high and brand. The hit height of the line is 22 px.
- **Raised**, each frame is a tile 72 x 48 with a crop of the changed region, the axis marks at the bottom left (framework mark, browser mark, `Sun` or `Moon`, and `Contrast` or `SquareDashed` when the variant has more contrast or forced colors), the `StatusMark` at the top right, and the position digit (1 to 9) for the frames of the current screenshot. The screenshot name is one caption above the first tile of each group (`text-xs`, `ak-ink-60`; the current group at ink 100, `truncate` to the group width).
- The roll rises on hover (120 ms delay), on a navigation key, on focus, and while Shift is held. It rises over the bottom of the stage and never moves the dock or the decision buttons. Unpinned is the default; `P` pins it, and the image fits the smaller space. The preference is stored.
- A click on a tick or a tile selects that frame. One Tab stop; Left and Right move inside it when it has focus.
- With one frame (`one-change`) the roll is not shown.

```tsx
// Crop for a roll tile: put the first changed region in the middle of a 72 × 48 window.
const region = variant.regions[0];
const scale = region ? Math.min(1, 43 / region.width, 29 / region.height) : 72 / image.width;
const x = region ? 36 - (region.x + region.width / 2) * scale : 0;
const y = region ? 24 - (region.y + region.height / 2) * scale : 0;
<Frame $darken $rounded="sm" className="relative h-12 w-18 overflow-clip">
  <img
    src={image.url}
    alt=""
    width={image.width}
    height={image.height}
    draggable={false}
    className="max-w-none origin-top-left"
    style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
  />
</Frame>;
```

#### Variant switching

- The variants of the current screenshot are its group of frames on the roll, with a verdict mark on each tick and tile. Left and Right move inside the group and stop at each end. `1` to `9` select by position.
- The full variant label is in the caption, one time: `React · Chromium · Light` (and `· More contrast`, `· Forced colors` when they apply).
- The stage shows the direction: a new variant comes in from the side, a new screenshot from below or above. So the arrow keys match what the eye sees.
- A screenshot remembers its last variant. The first visit opens the first variant that needs review, else the first variant.
- View mode, zoom, and position stay when the variant changes and the two images have the same size.

#### Compare modes and zoom

All modes use one plane. The names below are the exact labels.

| Label               | Key                                     | What the stage shows                                                                                                                                                                                                    |
| ------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Current` (default) | `F`                                     | The current image with change marks: one brand outline for each entry of `regions`, 6 px outside the region, minimum 16 x 16 screen px. `H` turns the marks off and on                                                  |
| `Baseline`          | `G`                                     | The baseline image                                                                                                                                                                                                      |
| `Diff`              | `D`                                     | The current image at `opacity-40 grayscale` with the mask image on top. A `drop-shadow` filter makes each change 3 screen px or more at Fit. This is the `overlay` mode of `useViewer`                                  |
| `Swipe`             | `W`                                     | Baseline left of a divider, current right of it (`clip-path`). The divider is a brand line with a round grip (`Button role="slider"`). It follows the pointer while the mouse button is down. `Q` and `E` move it by 5% |
| `Side by side`      | `S`                                     | Two synchronized views with one zoom, one position, and a linked crosshair on hover. Columns or rows: the layout that gives the larger scale                                                                            |
| Flip                | hold `T`, or press and hold the picture | The other image for as long as the key or the pointer is down. On arrival it runs one time by itself (baseline 320 ms, then current)                                                                                    |
| Blink               | `B`                                     | Baseline and current alternate each 600 ms. With reduced motion `B` flips one time for each press                                                                                                                       |

- A mode that the variant cannot show is disabled, with the reason in its `Tooltip`: `No baseline` (added), `No current image` (removed), `Sizes differ` (Diff, when the sizes differ).
- **One image only.** An added variant shows the current image with the tags `Current` and `Added`. A removed variant shows the baseline with `Baseline` and `Removed`. An unchanged variant without an uploaded current image shows the baseline with `Unchanged`. There is no empty pane.
- **Size change.** The image tag shows a warning `Badge`: `Size changed 640 × 400 → 640 × 422`. Flip, Swipe, and Side by side align the two images at the top left at one scale.
- **Zoom.** `Fit` (see `fitScale`), `Fit width`, `50%`, `100%`, `200%`, `400%`. `+` and `−` step, `0` is Fit. Ctrl or Cmd with the wheel, and pinch, zoom at the pointer. The wheel alone scrolls. Double-click switches between Fit and 100% at the pointer.
- **Pan.** Drag with the pointer. Shift with an arrow key moves by half a stage. The arrow keys alone never pan.
- **Camera to the change.** `C` moves and zooms the view to the next changed region (up to 400%, with a margin of one region size); Shift+`C` goes back; `0` returns to Fit. The dock shows `1/3`.
- **Loupe** (build if time allows). When the largest changed region is under 32 screen px at the current scale, a 200 x 140 glass inset above the decisions pill shows the region at the largest whole scale that fits, with the same mode and the same flip. A click on it runs `C`. On a phone the loupe is the second pane under the whole screenshot.
- **Navigator** (build if time allows). When the image is larger than the stage, a glass thumbnail at the right edge (at most 96 x 160) shows the whole image, the view rectangle, and a dot for each region. Drag in it to pan.

#### Decision flow

1. `A` or the Approve button approves the shown variant. `X` or Reject rejects it. The buttons are enabled when `can.approve` or `can.reject` is true and the images of the shown variant are decoded. A disabled Approve button is neutral, not brand (drop `$layer="brand"`), and its `Tooltip` gives the reason.
2. The stamp at the top center changes at once (`Approved`, `Rejected`), the tick on the roll changes, the HUD shows `Approved` or `Rejected`, and the progress count goes down.
3. Auto-advance: the next variant that needs review comes in (the session does this). Its images are preloaded, so the picture changes in the same frame in the normal case. Preload the next variant that needs review and the two neighbors on the roll.
4. When no variant needs review, the selection stays and the end slate shows (see below).
5. **Whole screenshot.** Shift+`A` and Shift+`X`, or the caret menu on Approve: `Approve all 6 variants` and `Reject all 6 variants`, each with its `Kbd`. There is no confirmation dialog on either path. While Shift is held, the roll rises, the target frames get a dashed brand outline, and the Approve label reads `Approve all 6`. After the command the HUD shows `6 approved`, and Undo takes it back as one command.
6. **Undo.** Cmd or Ctrl with `Z`, or the Undo button (`Undo2`, enabled by `can.undo`). It restores the verdicts and the selection. HUD: `Undone`.
7. **Clear.** `U` removes the verdict of the shown variant (Not in the app today).
8. **Save status.** A fixed slot in the decisions pill. Idle: empty. `Saving 2` with an `ArrowUp` icon. `Saved` with a `Check` for 1.6 s. In the product the slot has three states with three marks: `Sending 2` (`ArrowUp`), `Queued 2` (`Cloud`), `Saved` (`Check`); the lab hook has one saving state.
9. **Failed save.** The decisions pill becomes a danger `Plate`: `Not saved`, `Retry` (bordered), `Discard`. The stamps and ticks go back. Lights out ends. An unexpected failure adds `Error ID …`.
10. **Refused action.** When a button is disabled by `approveDisabledReason` or `rejectDisabledReason`, a press of its key shows the reason in the HUD for 3 s. Nothing advances.

#### Progress

- The roll is the progress display: each tick shows its state.
- The meta pill shows the ring and `22 left`. Its popover has five rows with marks: `22 need review`, `3 approved`, `2 rejected`, `6 auto-approved`, `7 unchanged`, and the button `All screenshots` with `Kbd` `/`.
- The tab title starts with `22 left`.

#### Completed state: the end slate

When `session.complete` is true, the print leaves and the stage shows a centered slate. The roll is raised under it, so all frames show with their marks.

| State           | Mark                   | Heading           | Line                            | Check line (Not in the API today)                                 | Actions                                                         |
| --------------- | ---------------------- | ----------------- | ------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| All approved    | `CircleCheck`, success | `Review complete` | `27 approved · 6 auto-approved` | `Updating the check on GitHub`, then `The check passed on GitHub` | `Next run: #4831` (brand, `↵`), `Open #4863` (bordered), `Undo` |
| With rejections | `CircleX`, danger      | `Review complete` | `25 approved · 2 rejected`      | `Rejected changes keep the check failed.`                         | same                                                            |
| No next run     |                        |                   |                                 |                                                                   | `Back to queue` in place of `Next run`                          |

About 20 words. A click on a frame of the roll returns to the picture; the slate is the last stop of `J`.

#### Other scenarios

- `changes`: as drawn. 33 frames on the roll (27 changed, 4 added, 2 removed), 22 left. The page opens on the first variant that needs review, with the arrival flip. The context pill shows `#4863 Migrate component examples… · 4f1c9e0 · attempt 2` for 4 s or until the first decision, then only the number and the title.
- `large`: 128 frames, 79 left. The ticks are about 10 px wide. The raised roll scrolls and keeps the current frame in the middle; render the tiles near the current frame only. All screenshots is the way to a named screenshot.
- `one-change`: no roll and no edge zones. `1 left`. After the decision the end slate shows.
- `passed`: the page opens on the end slate with the heading `Passed` and the action `Browse 33 changes`. The decisions stay available where `can` allows them.
- `read-only`: the pictures and the roll work. The decisions pill is a warning `Plate`: `Read-only · Replaced by a newer run` and the button `Open current run`. No Approve and no Reject button. The stamps show the stored verdicts. The title starts with `Read-only`.
- `comparing`: the page opens on a slate: `ProgressCircular`, the heading `Comparing`, the line `6 of 16 compared`, a `Progress` bar. The compared frames can be opened. The frames that wait are dashed ticks and show a dashed `EmptyFrame` with a ring. The decisions pill is a neutral `Plate`: `Comparing · 6 of 16`.
- `problems`: the page opens on a slate: `TriangleAlert`, the heading `Failed`, `run.error`, the line `5 screenshots have no comparison`, and the sentence `Rerun the visual tests in CI.` A frame of kind `error` shows a dashed `EmptyFrame` with `TriangleAlert` and `variant.error`. The variant whose current image does not load shows its print box at the right size with a centered `Plate`: `The current image did not load` and a bordered `Retry`; its decisions are disabled.
- `loading`: see section 5.
- `expired` (extra): a slate with the heading `Images expired` and the decision counts. No pictures.

#### Lights out and auto-hide

- At Fit with the roll at rest, nothing covers the image, and the chrome stays at full strength.
- During a pan or a zoom gesture the chrome goes to 30%. After 3 s without pointer movement, while a part of the image is under a control, the chrome goes to 0. Pointer movement, a key, or focus brings it back.
- `L` (lights out) hides all chrome at every zoom. The image fits the full viewport with a 12 px margin. All keys work, and the HUD confirms each one. `L`, Escape, the pointer at the top or bottom 48 px, or Tab brings the chrome back. The first use shows the HUD line `Lights out · L` for 2 s.
- Never hidden: a control with keyboard focus, the image tag when it is not `Current`, the save-error plate, the read-only plate, an image error.
- On a phone there is no hover and no lights out. The chrome does not cover the picture, so it stays.

#### Keys

| Group  | Keys                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move   | Up, Down: screenshot. Left, Right: variant. `1` to `9`: variant by position. `J`, `K`: next and previous change on the roll. `N`, Shift+`N`: next and previous change that needs review. `/`: all screenshots |
| Decide | `A` approve. `X` reject. Shift+`A`, Shift+`X`: all variants of the screenshot. `U` clear. Cmd or Ctrl with `Z`: undo                                                                                          |
| Look   | `F` current. `G` baseline. `D` diff. `W` swipe (`Q`, `E` move the divider). `S` side by side. `B` blink. Hold `T`: flip. `H` marks                                                                            |
| Camera | `+`, `−` zoom. `0` fit. `C`, Shift+`C`: next and previous changed region. Shift with an arrow key: pan                                                                                                        |
| Chrome | `L` lights out. `P` pin the roll. `I` details. `?` keys. Escape: close                                                                                                                                        |

Pass the keys that the hook does not have through `keys`: `d` (set the mode `overlay`), `j` and `k` (walk the roll frames with `session.select`), `arrowup` and `arrowdown` (move between the screenshots on the roll), `c`, `q`, `e`, `l`, `p`, `i`, `/`, `?`. Hold `T` needs its own `keydown` and `keyup` listener.

How a person finds the keys:

1. Approve and Reject show `A` and `X` at all times.
2. Each other control has a `Tooltip` with its name and a `Kbd`.
3. A click on a control shows the HUD with the name and the key (`Diff · D`), so the mouse teaches the keyboard.
4. `?` in the meta pill opens Keys.
5. The first changed variant of a session shows one chip under the print for 4 s: `Hold T to see the baseline`.
6. The `Shortcuts` switch in Keys turns all single-letter keys off and hides the key hints. It is stored.

Touch, with one meaning for each gesture: press and hold = flip; double-tap = zoom to the change and back; swipe left or right at Fit = next or previous change; pinch = zoom; drag = pan when zoomed. Each gesture has a button with the same result.

Focus: the keys work from every focus, except in a text field, a menu, or a dialog. A decision does not move the focus. Tab order: context pill, meta pill, stage, dock (the view modes are one stop), decisions, roll (one stop).

#### Copy at rest and word count (scenario `changes`)

`#4863 Migrate component exa…` · `Current` · `Needs review` · `22 left` · `Dialog with initial focus` · `React · Chromium · Light` · `Current` `Baseline` `Diff` `Swipe` `Side by side` · `Reject` · `Approve`. 25 words, plus the numbers `1280 × 720`, `0.15%`, `100%`, `1/1`. Lights out: 0 words.

#### Removed compared with the current page

The app header with three nav links (48 px); the main header row with the sidebar toggle, "Queue", the title, "9 of 11 need review", and the native progress bar (48 px); the commit strip (26 px); the heading block with the 28 px name, the badge, and the changed-pixel sentence (59 px); the variant chip row (38 px); the view and zoom toolbar row (55 px); the two pane captions (48 px); the left sidebar with its title row, its joined filter, its rows with "N of M need review", and the "Accepted (N)" disclosure; the Details sidebar; the footer with "Keyboard help", "Shortcuts on", and "Recompare stored run"; the four banner rows; the loading and error rows above the panes; the eight pan buttons; the second row of the decision bar; the confirmation dialog for the whole screenshot; the labels "Approve & next", "Reject view", and "All 7 changed views…".

## 5. Loading

One rule for all pages: the stage, the pills, and an `EmptyFrame` show at 0 ms with no data. Data fills the same layout, so nothing moves. The text "Checking access" does not exist. The skeleton has `aria-busy="true"` and one `sr-only` status: `Loading`.

| Page                                       | 0 ms                                                                                                                                                                                                                                           | 300 ms (list data)                                                                                                          | 1 s (first picture)                                                                                                                        | 5 s (still waiting)                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-in                                    | The complete page. It has no data                                                                                                                                                                                                              |                                                                                                                             |                                                                                                                                            |                                                                                                                                            |
| Queue                                      | Stage. Context pill with the real nav. An avatar skeleton. Left: three skeleton bars for the slate. Right: an `EmptyFrame` at 16:10 that pulses. Strip: four skeleton tiles                                                                    | The slate text, the brand button (enabled at once), the tile captions and marks, the nav count, the alert dot               | The cover fades into the frame (120 ms). The tile thumbnails fade in one by one                                                            | A thin indeterminate `Progress` line at the top edge of the frame since 2 s. Now also `Still loading` under the frame (12 px, `ak-ink-60`) |
| History                                    | Stage. The search field works and keeps typed text. Two day-heading bars and twelve skeleton tiles                                                                                                                                             | Day headings, tile captions, marks, the no-changes chips, the filter counts                                                 | Thumbnails fade in as they decode                                                                                                          | `Still loading` under the first heading                                                                                                    |
| Status                                     | Stage. `EmptyFrame`. Two meter skeletons. Three skeleton tiles                                                                                                                                                                                 | The alert on the stage, or `All clear`; the tiles; the meters; `Checked … ago`                                              | No picture on this page                                                                                                                    | `Still loading` under the frame                                                                                                            |
| Pull request                               | As the queue, with the back button                                                                                                                                                                                                             | Slate, buttons, attempt tiles                                                                                               | The cover                                                                                                                                  | As the queue                                                                                                                               |
| Review, from the queue or the pull request | The run title, the count, and the cover picture come with the navigation: the context pill is complete, and the cover stays on the stage as a placeholder under a pulsing ring, with the tag `Loading`. The decisions are disabled and neutral | The roll ticks, `22 left`, the caption, the image tag with the real size. The frame takes the exact size of the first image | The first image is decoded: the placeholder leaves, the arrival flip runs, the marks pulse, Approve becomes brand. The next frames preload | The progress line on the frame since 2 s. Now `Still loading` under the frame. All chrome works: the roll, All screenshots, Details        |
| Review, cold (link from GitHub)            | Stage. Context pill with the back button and a skeleton bar. A 16:9 `EmptyFrame` that pulses. A neutral line where the roll is. Disabled, neutral decision buttons                                                                             | As above                                                                                                                    | As above                                                                                                                                   | As above                                                                                                                                   |

When a wait ends in an error, the frame shows the error state of the page (heading, `Retry`, `Error ID`). When the image of one variant fails, only that print shows the error; the roll and the keys work.

When the list data itself needs 2 to 6 s (the case today), the 0 ms state stays, the progress line shows from 2 s, and `Still loading` shows from 5 s. The layout is the final layout, so the data arrives without a jump.

A refresh (`refreshing`) never blanks a page: the content stays and the refresh icon is a ring.

## 6. Risks, tradeoffs, and earlier decisions

### Risks and tradeoffs

1. **One pane hides the baseline.** A reviewer can approve without a comparison. The arrival flip, the change marks, and hold `T` reduce this risk. With reduced motion the arrival flip is off, and the marks and one key remain.
2. **Floating chrome over evidence.** Fit uses the safe rectangle, so no pixel is covered at Fit. A raised, unpinned roll can cover the bottom of the image for a short time; it never holds a decision control.
3. **Hidden chrome is harder to find.** Tab always shows the chrome, the pointer edge shows it, and errors force it back. Lights out is a choice, not the default.
4. **Roll ticks are small and have no text.** The tick shape (hollow, solid, tall) works without color, the count is in the progress pill, and the raised roll has icons. This is weaker than the rule "counts and text must accompany color".
5. **Data that the API does not have today.** `Run.previews`, `counts`, `progress`, `author`, `branch`, `commitMessage`, `error`; `PullRequest.title`, `author`, `branch`, `baseBranch`, `state`, `runs`; `ReviewVariant.regions`, `reviewerLogin`, `decidedAt`; `ReviewRun.pullRequest`, `counts`, `progress`, `supersededBy`; `ServiceAlert.severity`, `impact`, `occurrences`, `runId`; `User.avatarUrl`; the sign-in `repository` and `user`; the GitHub check state on the end slate; the viewer modes overlay, swipe, and blink; the zoom levels 50% and 400%; `clear`. Without `previews` the queue, the pull request, and History show dashed frames and text. Without `regions` the client can compute them from the mask.
6. **The queue shows one run in detail.** More than 9 runs scroll the strip. A dense list shows more runs at once.
7. **Arrow keys change meaning by level.** Left and Right select a run in the queue and a variant in a run.
8. **Translucent surfaces over any screenshot.** The 80% surface with a blur is the recipe of `ShellHeader`, which keeps text contrast above 7:1. Check it in light. Reduced transparency and missing backdrop filters give an opaque surface.
9. **Zoom with Ctrl or Cmd and the wheel** takes the browser zoom away while the pointer is over the stage.
10. **Phone.** Press and hold on a picture can open the system image menu. The images are `pointer-events-none` with `draggable={false}`, and the stage has `[-webkit-touch-callout:none]`.
11. **Status has no picture.** The lens adds little to that page; it keeps the grammar and the low word count.
12. **Build cost.** The stage needs its own pan, zoom, and fit code. There is no primitive for a slider, a split view, or a toast; the brief uses `Button role="slider"`, CSS, and one HUD element.

### Earlier maintainer decisions that this direction revisits

| Decision or rule                                                                                      | What this direction does                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U02 "Use one review shell" (header, sidebar, main header with Approve and Reject, Details disclosure) | Replaces the shell with a full-viewport stage and floating pills. It keeps "image evidence takes the remaining main area" and "move run IDs to Details"                                                                |
| A06 "Item list on the left … commit/run identity above"                                               | The list is the roll at the bottom. The commit and the attempt show in the context pill for the first 4 s and then in its popover                                                                                      |
| A11 thumbnail rule (first declared current variant)                                                   | Roll tiles are crops of the changed region of each variant                                                                                                                                                             |
| L4 and A13 ("Accepted" group, "Accepted automatically")                                               | No group. Approved frames stay on the roll with their mark. Auto-approved frames stay, have their own mark, and are skipped by auto-advance. Unchanged screenshots are in All screenshots. The word is `Auto-approved` |
| A21 and D30 (side by side shows a labeled empty pane)                                                 | One pane for an added or a removed variant. Diff stays unavailable, as D30 selected                                                                                                                                    |
| A27 (narrow: list above the viewer, stacked images) and D53 (phone not in the launch scope)           | One stage with a flip and a loupe on a phone                                                                                                                                                                           |
| L1 (variants are navigation links with a bar glider) and U03                                          | Variants are frames on the roll with a brand ring                                                                                                                                                                      |
| U04 "Page-wide review arrows with pan buttons"                                                        | The arrows stay page-wide and never pan. The eight pan buttons go away; drag, the wheel, and Shift with an arrow pan. The rejected options `focus-owned` and `pan-mode` stay rejected                                  |
| The instruction "do not add a hotkey registry"                                                        | Keys and the tooltips read one list (`reviewShortcuts` plus the extra keys). There is no Cmd or Ctrl with `K`                                                                                                          |
| P02 "Load diff when selected" (`eager` was rejected)                                                  | The change marks need `regions` from the service, or the mask at selection time. The second path reopens P02, and the mask then belongs to the images that a decision needs                                            |
| K6 (`1` to `6`) and K13 (`S`, `D`, `F`)                                                               | `1` to `9`. `D` shows the mask over the dimmed current image, not the mask alone. New keys: `W`, `B`, `T`, `C`, `H`, `L`, `P`, `I`, `Q`, `E`, `J`, `K`, `N`, `U`, `/`, `?`                                             |
| K11 and the dialog on the button path                                                                 | The same behavior on both paths: no dialog, a preview while Shift is held, one Undo                                                                                                                                    |
| X4 (shortcut toggle)                                                                                  | The switch is in Keys and is stored                                                                                                                                                                                    |
| `[` (sidebar)                                                                                         | Not bound. There is no sidebar                                                                                                                                                                                         |
| A08 "Show counts such as 2 of 6 need review"                                                          | One count for the run (`22 left`); the ticks of the group show each variant. No sentence for each screenshot                                                                                                           |
| Contract strings ("Side-by-side", "Pixel diff", "New-only", "Accepted automatically", "Reference")    | `Side by side`, `Diff`, `Current`, `Auto-approved`, `Baseline`. A rename needs a contract change                                                                                                                       |
| Three save states (sending, queued, saved)                                                            | Kept as three marks in one fixed slot. The lab hook has one saving state                                                                                                                                               |
| A24 "clear or cover stale pixels immediately"                                                         | Kept: the old print leaves in the same frame, with no fade out                                                                                                                                                         |
| U05 "List review work first with a history view"                                                      | Kept: the queue shows work first, and History is a separate view                                                                                                                                                       |
| "Recompare stored run" and export                                                                     | Not in the design (retired in the product)                                                                                                                                                                             |

## Appendix: build notes

```tsx
// Page skeleton of the review variant. Every other page uses the same stage and the same three rows.
export default function Variant({ scenario }: VariantProps) {
  const session = useReviewSession(scenario, { order: "declared" });
  useReviewShortcuts(session, { keys: extraKeys });
  return (
    <Frame
      $darken={2}
      render={<main />}
      className="relative h-dvh w-full select-none overflow-clip"
    >
      <Viewport session={session} /> {/* the print, centered in the safe rectangle */}
      <div className="pointer-events-none absolute inset-3 grid grid-rows-[auto_1fr_auto] gap-2">
        <div className="flex items-start justify-between gap-2 *:pointer-events-auto">
          <ContextPill /> <SubjectTag /> <MetaPill />
        </div>
        <div /> {/* the picture shows here */}
        <div className="grid gap-2 *:pointer-events-auto">
          <Roll />
          <div className="flex items-end justify-between gap-2">
            <Caption /> <Dock /> <Decisions />
          </div>
        </div>
      </div>
      <Hud />{" "}
      <p className="sr-only" role="status">
        {session.announcement}
      </p>
    </Frame>
  );
}
```

```tsx
// One roll tick. Hollow = needs review, solid = approved, tall = rejected, 10 px and brand = current.
<ak.CompositeItem
  render={<button type="button" aria-label={`${frame.itemName}, ${frame.name}, ${label}`} />}
  aria-current={current ? "true" : undefined}
  className="grid h-5.5 min-w-1 flex-1 items-end"
>
  <Frame
    $layer={current ? "brand" : solid ? role : undefined}
    $border={!solid && !current}
    $edge={role}
    $rounded="xs"
    className={cx("h-1.5 w-full", rejected && "h-2", current && "h-2.5")}
  />
</ak.CompositeItem>
```

Pitfalls for this direction:

- There is no `"primary"` layer. The one main action is `$layer="brand"`. Drop the layer while the button is disabled.
- A backdrop filter makes a containing block. Pass `portal` to every `Popover`, menu, and `Tooltip` that opens from glass.
- A `Badge` inside a pill needs `$forceRounded`. A plate uses `$p="1rem"`, so its children keep their own radius.
- `Heading` has margins and is an `h1` at 2.25em without a `HeadingLevel`. Use `className="mt-0 mb-0 text-3xl"` inside a `HeadingLevel`.
- A `Button` has no selected look. The view modes use a `ButtonGlider`; a pressed toggle (pin, marks) uses props from state (`$lightnessOffset={pressed ? 2 : undefined}`).
- Put text in `ButtonLabel` and each icon or `Kbd` in a `ButtonSlot`.
- Do not call `Date.now()` or `Math.random()`. Use `NOW`, `formatRelativeTime`, `formatCount`, `formatRatio`, `shortSha`.
- Check each page with `?theme=light` and at 390 px.
