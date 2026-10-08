# Focus: design brief

Variant id for all six page surfaces: `focus` (so `LabLink` keeps the direction). Hooks and fixtures: `apps/lab/docs/fixtures.md`. Primitives and pitfalls: `apps/lab/docs/primitives.md`.

## 1. Concept

**Name:** Focus. **Tagline:** One change on stage, one key to decide, and a rail that shows the way.

**The idea in five sentences**

1. Visonaut becomes a guided session and stops being a dashboard: each screen puts one object on a centered stage and offers one primary action.
2. A run is a stack of changes, and the reviewer sees one change at a time, at 100% when it fits, with the baseline one thumb press away.
3. A segmented rail at the top is the map and the main navigation: one segment for each change, grouped by screenshot, filled by verdict.
4. Enter always means "continue" (start the review, open the next run), and it never decides a change; `A` and `X` decide.
5. Lists, details, compare modes, and settings exist, but they are one step away in a sheet or a popover, and Escape closes them.

**Signature moment.** A change arrives and plays itself: the stage shows the baseline for 450 ms and then cuts to the current image with the changed regions ringed. The reviewer presses `A`. The card leaves, one rail segment fills, and the next change already plays. When the last segment fills, the stage says "Done" and Enter opens the next run.

**Principles**

1. **One thing on stage.** Each screen shows one object (a run, a change, an alert) and at most one primary action.
2. **Enter continues, A and X decide.** The primary action is always in the same place and on Enter. Enter never decides. The left hand alone can decide (`A`, `X`), peek (`Space`), and undo (`Cmd/Ctrl+Z`).
3. **Progress is the navigation.** The rail, the counter, and the tab title say where you are. You move by steps.
4. **One step away, never on screen.** The screenshot list, details, modes, shortcuts, history, and status open on demand.
5. **Nothing covers the pixels.** A screenshot shows at 100% when it fits. No label, control, or message overlaps it.

## 2. Visual system

### Layers

| Surface     | Layer                                               | Where                                                                                        |
| ----------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Canvas      | `body`, no prop                                     | The page, the header, the review dock. These paint nothing and have no border                |
| Stage well  | `Frame $darken $rounded="2xl"`                      | Only on the review page, behind the screenshot                                               |
| Raised card | `Frame $lighten $border $rounded="3xl" $p="1.5rem"` | Hero card, stage message, sheets, popovers                                                   |
| Brand       | `$layer="brand"`                                    | Exactly one control for each screen: the primary action. Also the current marker of the rail |
| Status tint | `$layer={role} $mix={12} $border $edge={role}`      | Only the Done card (success) and error messages (danger)                                     |

Borders: only on raised cards (`$border`, a ring on light), on inputs, and as a 1 px ring outside the screenshot (`Frame $border $borderType="ring" $rounded="none"`), so that the image edge is visible on a dark well. No separators between rows: spacing and the hover glider separate them. No shadows except the defaults of popovers and dialogs.

### Type

Inter Variable for all text. JetBrains Mono Variable (`font-mono`) for pull request numbers in rows, commit SHAs, pixel sizes, percentages, Error IDs, and key caps. All counters use `tabular-nums`.

| Role        | Classes                                 | Use                                                             |
| ----------- | --------------------------------------- | --------------------------------------------------------------- |
| Stage title | `text-3xl font-semibold tracking-tight` | "Done", "All done", "All clear"                                 |
| Title       | `text-2xl font-semibold tracking-tight` | Run title in a hero card, sign-in title                         |
| Body        | `text-base`                             | Sentences, large buttons                                        |
| Secondary   | `text-sm` + `ak-ink-70`                 | Meta lines, rows, the review header and dock                    |
| Label       | `text-xs font-medium` + `ak-ink-60`     | Eyebrows ("Next up · 1 of 4", "Then"), key caps, small counters |

No text is smaller than `text-xs`. Sentence case everywhere. No uppercase eyebrows. No trailing period in headings, labels, or one-sentence messages. Wrap each page in one `HeadingLevel`; each `Heading` takes `className="mt-0 mb-0 …"` (pitfalls 4 and 5).

### Spacing, density, radius

- Side pages use one centered column: `ShellMain $p="1.5rem" $maxWidth="45rem"`. Blocks `gap-6`, inside a card `gap-3`, rows `gap-1`.
- Large targets: a primary button is `Button $size="lg" $p={3} $rounded="xl"` (about 48 px at a 16 px base). A row is at least `min-h-11`. On a phone each target is 44 px or more.
- Radius: `3xl` cards, `2xl` stage well and sheets, `xl` buttons and rows, `full` marks, rail segments, avatar, and the flip switch. Cards use `$p="1rem"` or more, so their children keep their own radius (pitfall 2).
- Spacing steps and named radius steps only. The Look controls (brand, canvas, radius, density) must change every variant.

### Icons

`lucide-react`, `strokeWidth={1.75}`, size `1.25em`. Framework and browser marks (React, Solid, Chrome, Firefox, Safari from `src/fixtures/icons`) show only in front of the variant label of the current change and in the Details popover.

### Status vocabulary (one map for runs and variants)

| Label                             | Run states                  | Variant status                            | Color role                             | Icon                                                       | Rail segment       |
| --------------------------------- | --------------------------- | ----------------------------------------- | -------------------------------------- | ---------------------------------------------------------- | ------------------ |
| Needs review                      | `needs-review`              | needs review                              | warning                                | `Circle`                                                   | hollow (ring only) |
| Passed (run) / Approved (variant) | `passed`                    | approved                                  | success                                | `CircleCheck`                                              | solid              |
| Auto-approved                     |                             | added or removed, approved by the service | success, `$mix={40}`, text `ak-ink-60` | `CircleCheck` + `Plus` or `Minus`                          | solid, lighter     |
| Rejected                          | `rejected`                  | rejected                                  | danger                                 | `CircleX`                                                  | solid and tall     |
| Capturing, Comparing              | `incomplete`, `comparing`   | comparing                                 | neutral (`ak-ink-60`)                  | `LoaderCircle` (spins); `CircleDashed` with reduced motion | hollow, dashed     |
| Failed, Rerun needed              | `failed`, `needs-recompare` | failed (kind `error`)                     | danger                                 | `TriangleAlert`                                            | hollow and tall    |
| Replaced                          | `superseded`                |                                           | neutral (`ak-ink-50`)                  | `CircleSlash`                                              |                    |
| Unchanged                         |                             | unchanged                                 | neutral (`ak-ink-40`)                  | `Minus`                                                    | not in the rail    |

Kind of a change: Changed (no badge), Added (`Badge` "Added"), Removed (`Badge` "Removed"). A mark is always an icon with a shape of its own plus a text alternative; the word shows next to it in the hero card, in history rows, and in tooltips. Rail segments differ by shape (hollow, solid, tall, dashed), not only by color.

### Motion

| What                          | How                                                                                                                                                  | Reduced motion                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Arrival play                  | Baseline for 450 ms, then a hard cut to current (no cross-fade: a cut makes a 2 px shift visible). Region rings appear, then fade to 40% after 1.5 s | No play. Current shows at once, rings stay |
| Next change, same screenshot  | The image changes in place, no slide                                                                                                                 | Same                                       |
| Next change, other screenshot | Old card moves 24 px and fades out, new card comes in, 180 ms ease-out. Undo runs it in reverse                                                      | Plain swap                                 |
| Verdict stamp                 | The mark scales from 0.8 to 1 in the sibling row, 120 ms                                                                                             | None                                       |
| Rail                          | Segment fill 120 ms. Current marker slides 150 ms                                                                                                    | None                                       |
| Done                          | Rail segments light up left to right in 600 ms, the card scales from 0.96                                                                            | None                                       |
| Skeleton                      | `animate-pulse`                                                                                                                                      | Static                                     |

Only `transform` and `opacity` move. Use `motion-reduce:transition-none motion-reduce:animate-none`. Input is never blocked by an animation.

## 3. Shell and navigation model

**Always on screen:** a corner control at the top left (the mark on the queue, a close button on every other page), the account button at the top right, the stage, and at most one primary action. On the review page also the rail and the dock. There is no navigation bar and no sidebar.

**How a person moves**

| From         | To                  | How                                                                       |
| ------------ | ------------------- | ------------------------------------------------------------------------- |
| Queue        | Run                 | Enter (hero) or a "Then" row                                              |
| Run          | Screenshot          | Up and Down, a rail group, or the screenshot sheet (`/`)                  |
| Screenshot   | Variant             | Left and Right, `1` to `6`, the sibling marks                             |
| Run          | Next run            | Enter on the Done card                                                    |
| Any page     | Queue               | The close button (top left). It is a link to `/`, not history-back        |
| Queue        | History, Status     | Two footer links, and the account menu on every page                      |
| Run          | Pull request        | The run title popover ("All runs of #4863")                               |
| GitHub check | Run or pull request | The check link opens the run when it is ready, else the pull request page |

**URL model**

```
/                      Queue
/history?q=&result=    History
/status?alert=2        Status (the alert on stage)
/pulls/4863            Pull request (a ?check= link forwards to the run when it is ready)
/runs/<id>             Review. Opens at the first change that needs review, or at the Done card
/runs/<id>?item=<key>&variant=<key>&view=<mode>&zoom=<zoom>   One change. Steps replace the entry
```

Sign-in has no route: the card renders in place on the URL that needs a session, and the URL is the return target.

**Page titles:** `{state or count} · {object} · Visonaut`.

- Queue: `(4) Queue · Visonaut`, or `All done · Visonaut`.
- Review: `22 left · #4863 Migrate component examples… · Visonaut`, then `Done · #4863 … · Visonaut`.
- `History · Visonaut`, `(3) Status · Visonaut`, `#4863 Migrate… · Visonaut`, `Sign in · Visonaut`.

**Account and service alert.** The account button is `ak.MenuButton render={<Button $rounded="full" aria-label="Account" />}` with `ButtonSlot $kind="avatar"` (initials). The menu (`ak.Menu` with the `popover` recipe, `ak.MenuItem` with the `option` recipe) has: `@diegohaz` (static), Queue, History, Status (with a count slot), Keyboard shortcuts (`?`), Theme (System, Light, Dark as `ak.MenuItemRadio`), Sign out. A service alert is a danger dot on the avatar on every page, the count on the Status menu item, and the count beside the Status footer link of the queue. No bell, no popover with alert text.

**Sketch, 1440 wide (side pages)**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (o) or [x]                                                                         (DH.) │ 48, no fill, no border
│                                                                                          │
│                    ┌───────────────── column, 45rem ──────────────────┐                  │
│                    │ eyebrow · position                                │                  │
│                    │ ┌──────────────────────────────────────────────┐  │                  │
│                    │ │ the one object on stage (raised card)        │  │                  │
│                    │ │                           [ Primary   Enter ]│  │                  │
│                    │ └──────────────────────────────────────────────┘  │                  │
│                    │ "Then" rows, or nothing                           │                  │
│                    └───────────────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Sketch, 390 wide**

```
┌──────────────────────────────┐
│ (o) or [x]             (DH.) │ 44
│ eyebrow · position           │
│ ┌──────────────────────────┐ │
│ │ the one object           │ │
│ └──────────────────────────┘ │
│ "Then" rows                  │
│ ┌──────────────────────────┐ │
│ │      Primary action      │ │ 52 + safe area: sticky bottom dock
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

Rule for the primary action: on a desktop it is at the bottom right of the card; on a phone it is a full-width button in a sticky bottom dock (`Frame $layer className="sticky bottom-0 pb-[env(safe-area-inset-bottom)]"`). Key caps are hidden on touch (`pointer-coarse:hidden`).

**Primitives of the shell.** Side pages: `Shell` (page scroll), `ShellHeader $height="sm"` (`start`: mark or close `Button` in a `TooltipAnchor`; `end`: account menu), `ShellMain $p="1.5rem" $maxWidth="45rem"`, `ShellMainBody` with one wrapper `div className="grid gap-6"`. Review page: the fixed app frame recipe (`Shell className="h-dvh"`), see 4.6.

**Shared parts (build once, use on all six pages)**

| Part                                                                                | Primitives                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StageMessage` (icon, title, one sentence, primary on Enter, at most one secondary) | `Frame $lighten $border $rounded="3xl" $p="2rem"`, `Heading`, `Text`, `Button $layer="brand" $size="lg"`, `Link`                                                                      |
| `HeroCard`                                                                          | `Frame $lighten $border $rounded="3xl" $p="1.5rem"`, `Heading`, `Text`, `Code` (SHA), preview `Frame $darken $rounded="lg"` with `overflow-clip aspect-[16/10]`, `MiniRail`, `Button` |
| `ThenRows`                                                                          | `Nav` with `glider={[{ $state: "hover" }, { $state: "focus" }]}`, `NavLink`, `NavSlot`, `NavLinkLabel`                                                                                |
| `StatusMark`                                                                        | `Text $text={role} className="flex"` around the icon; with a word: `Badge $layer={role}` + `BadgeSlot` + `BadgeLabel` (hero only)                                                     |
| `Rail`, `MiniRail`                                                                  | `ak.Composite` + `ak.CompositeItem render={<Frame render={<button />} $rounded="full" />}`, `Tooltip`; the mini rail is three `Frame`s in a flex row with widths by ratio             |
| `KeyHint`                                                                           | `ButtonSlot $kind="shortcut"` with a `Kbd` inside                                                                                                                                     |
| `Skeleton`                                                                          | `Frame $lightnessOffset={2} $rounded="sm" className="animate-pulse"`                                                                                                                  |
| `AccountMenu`, `KeysDialog`                                                         | `ak.Menu` + recipes; `Dialog`, `DialogHeading`, `DialogScroll`, `Kbd`, the Toggle recipe                                                                                              |

## 4. Page specs

### 4.1 Sign-in (`useSignIn(scenario)`)

**1440 wide (guest)**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (o) visonaut                                                                             │ 48
│                                                                                          │
│                            ┌──────────────────────────────────────┐                      │
│                            │ Review ariakit/ariakit               │ card 26rem wide,     │
│                            │ You need write access                │ top at 30% of height │
│                            │ ┌──────────────────────────────────┐ │                      │
│                            │ │ Sign in with GitHub        Enter │ │ 48, brand            │
│                            │ └──────────────────────────────────┘ │                      │
│                            └──────────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide (no card frame, button in the bottom dock)**

```
┌──────────────────────────────┐
│ (o) visonaut                 │ 44
│                              │
│ Review ariakit/ariakit       │ text-2xl
│ You need write access        │
│                              │
│ ┌──────────────────────────┐ │
│ │   Sign in with GitHub    │ │ 52, bottom dock
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Regions:** header `ShellHeader` (mark and word mark only; no account button, no navigation). Card `StageMessage` with `$p="1.5rem"`. Button `Button $layer="brand" $size="lg" className="w-full"` with `ButtonSlot` (GitHub or `LogIn` icon), `ButtonLabel`, `KeyHint` Enter. Account chip (forbidden) `Badge` with `BadgeSlot $kind="avatar"`. Error ID `Code`.

**Copy (budget: 15 words for each scenario)**

| Scenario     | Title                  | Line                                                            | Primary (Enter)                                           | Secondary               | Words       |
| ------------ | ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------- | ----------------------- | ----------- |
| `guest`      | Review ariakit/ariakit | You need write access                                           | Sign in with GitHub                                       |                         | 10          |
| `signing-in` | Review ariakit/ariakit | You need write access                                           | Opening GitHub (disabled, `ProgressCircular` in the slot) |                         | 8           |
| `forbidden`  | No write access        | chip `@login`, then: This account cannot review ariakit/ariakit | Use another account                                       | Back to GitHub (`Link`) | 15          |
| `error`      | Could not sign in      | `{message}` and `Error ID {reference}`                          | Try again                                                 |                         | 9 + message |

With a deep link the title names the target ("Review #4863") and the line is "You need write access to ariakit/ariakit".

**Interactions and keys:** the primary button has focus on load. Enter activates it. `useSignIn` `onRedirect` goes to the queue (`useLabHref("inbox", "busy")`). After 5 s in `signing-in`, a `Link` "Try again" shows under the button.

**Removed:** the marketing headline and its paragraph, the "VISUAL REGRESSION REVIEW" eyebrow, the navigation links that a guest cannot use, the shield icon tile, and the two other sign-in and access designs (run page, pull request page).

### 4.2 Queue (surface `inbox`, `useInbox(scenario)`)

**1440 wide (busy)**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ (o)                                                                                (DH.) │ 48
│                    Next up · 1 of 4                                          [refresh]   │
│                    ┌──────────────────────────────────────────────────────────────┐      │
│                    │ #4863                                                        │ mono │
│                    │ Migrate component examples to the new style recipes          │ 2xl  │
│                    │ (x) Rejected · 22 left · 2 rejected · 12 min ago             │ sm   │
│                    │ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │      │
│                    │ │  preview   │ │  preview   │ │  preview   │ │  preview   │  │ 16:10│
│                    │ └────────────┘ └────────────┘ └────────────┘ └────────────┘  │      │
│                    │ ▬▬▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭  11 of 33   [ Review   Enter ] │ 48   │
│                    └──────────────────────────────────────────────────────────────┘      │
│                    Then                                                                  │
│                    ( ) #4831  Update dependency @playwright/test to…  79 changes  1 h ago│ 44
│                    ( ) #4819  Fix a regression where the Combobox p…  12 changes  1 h ago│ 44
│                    ( ) main   Version Packages (#4828)                 3 changes  2 h ago│ 44
│                    >  2 in progress · 2 need attention                                   │ 44
│                                                                                          │
│                    History · Status (3)                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide**

```
┌──────────────────────────────┐
│ (o)                    (DH.) │ 44
│ Next up · 1 of 4             │
│ ┌──────────────────────────┐ │
│ │ #4863                    │ │
│ │ Migrate component        │ │
│ │ examples to the new      │ │
│ │ style recipes            │ │
│ │ (x) 22 left · 2 rejected │ │
│ │ [prev][prev][prev][prev] │ │
│ │ ▬▬▬▬▬▭▭▭▭▭▭▭▭▭  11 of 33 │ │
│ └──────────────────────────┘ │
│ Then                         │
│ ( ) Update dependency @pla…  │ 56, two lines
│     #4831 · 79 changes · 1 h │
│ ( ) Fix a regression where…  │
│     #4819 · 12 changes · 1 h │
│ >  2 in progress · 2 need…   │
│ History · Status (3)         │
│ ┌──────────────────────────┐ │
│ │          Review          │ │ 52, sticky bottom dock
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Regions and primitives**

| Region       | Primitive                                                                                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyebrow      | `Text` label style; refresh is an icon `Button` (`RefreshCw`, `aria-label="Refresh"`) in a `TooltipAnchor`                                                                                                                                                                                                            |
| Hero         | `HeroCard`. Number `Text font-mono`. Title `Heading`. Meta line: `StatusMark` + `Text`. Previews: `grid grid-cols-4 gap-2` of preview frames with `img` (`run.previews`, `alt` is the screenshot name). `MiniRail` + `Text tabular-nums`. Button `Button $layer="brand" $size="lg"` rendered as `LabLink to="review"` |
| Then         | `Text` label; `ThenRows`: `NavSlot` mark, `Text font-mono w-16`, `NavLinkLabel` (truncate), `Text` count, `Text` time (`formatRelativeTime`)                                                                                                                                                                          |
| Fold line    | `Disclosure` with `button={{ children: "2 in progress · 2 need attention", indicator: "chevron-right-start" }}`; inside, the same row shape with the state word; a capturing row has a `Progress $thickness={1}` and "412 of 600"; a failed row has `run.error` as its second line                                    |
| Footer       | `Link` "History", `Link` "Status" with a `Badge $px="md" $layer="danger"` count when `alertCount` is above 0                                                                                                                                                                                                          |
| Refresh line | `Progress $thickness={0.5}` (no value) at the top of the column while `refreshing`                                                                                                                                                                                                                                    |

**Copy (budget: 45 words in `busy`, without run titles; the sketch has 40)**

- Eyebrow: `Next up · 1 of 4`. Section label: `Then`.
- Hero meta: `{State} · {n} left · {n} rejected · {time}` (leave out a part that is 0). Mini rail label: `11 of 33`. Button: `Review`.
- Row: `{n} changes`, `{time}`. Fold line: `{n} in progress · {n} need attention`. Row states: `Capturing · 412 of 600`, `Comparing`, `Failed`, `Rerun needed`.
- Footer: `History`, `Status`.
- A run without a title: `Pull request #7746`, `Main · a225ac0`, `Merge queue · 27b78d0` as the heading, and no number line above it.

**Scenarios**

| Scenario    | Shows                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `busy`      | As drawn. Hero is `groups` review run 1 (#4863)                                                                                                                        |
| `single`    | Eyebrow `Next up`, the hero only ("1 left · 4 min ago"), the footer. No "Then"                                                                                         |
| `empty`     | `StageMessage` without a frame: `CircleCheck` in a success ring, title `All done`, line `Baseline 128 · updated 2 h ago`, the footer links. 8 words. No primary action |
| `first-run` | `StageMessage`: title `No baseline yet`, line `Run the visual tests on main to create one`, primary `Open the setup guide` (external). 16 words                        |
| `loading`   | Hero skeleton (two text bars, four preview blocks, a button-shaped block) and three row skeletons. 0 words. See section 5                                              |
| `error`     | `StageMessage` (danger tint): `Could not load the queue`, `{message}`, `Error ID {reference}`, primary `Retry` (Enter)                                                 |

When no run needs review but runs are in progress, the hero is the first run in progress as a waiting card: state word, `Progress`, `Opens when ready`, no button.

**Interactions and keys:** Enter opens the hero (the button has focus on load). Down and Up move the focus through the hero button and the rows (native focus order, the `Nav` glider follows). Enter on a row opens it. `?` opens the shortcuts. The queue refreshes each 60 s while the tab is visible and keeps its content (`refreshing`, not `loading`). Lab links by run state: needs review or rejected opens `review` scenario `changes` (#4831 opens `large`, the single run opens `one-change`), comparing or capturing opens `comparing`, failed or rerun needed opens `problems`.

**Removed:** the navigation bar and the bell, the page title "Your review queue." with its sentence, the three counters, the "READY TO REVIEW" label, the 240 px cards, the SHA, attempt, and absolute date of each card, the "Review changes" button of each card, and the "Refresh runs" text button.

### 4.3 History (`useHistory(scenario)`)

**1440 wide (full)**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [x]                                                                                (DH.) │ 48
│                    History                                                               │ 2xl
│                    [ (search) Search runs                        / ]   [ All results v ] │ 44
│                    Today                                                                 │
│                    (x) Rejected      #4863  Migrate component examples to t…  12 min ago │ 44
│                    ( ) Needs review  #4831  Update dependency @playwright/t…     1 h ago │ 44
│                    (v) Passed        #4852  Add the combobox select              2 h ago │ 44
│                    (-) Replaced      #4863  Migrate component examples to t…     3 h ago │ 44, dim
│                    Yesterday                                                             │
│                    (v) Passed        main   Version Packages (#4820)            Oct 4    │ 44
│                    …                                                                     │
│                    Latest 100 runs                                                       │ caption at the end
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide**

```
┌──────────────────────────────┐
│ [x]                    (DH.) │ 44
│ History                      │
│ [ Search runs              ] │ 44
│ [ All results            v ] │ 44
│ Today                        │
│ (x) Migrate component exa…   │ 56
│     #4863 · Rejected · 12 min│
│ ( ) Update dependency @pla…  │
│     #4831 · Needs review · 1h│
│ Yesterday                    │
│ (v) Version Packages (#4820) │
│     main · Passed · Oct 4    │
└──────────────────────────────┘
```

**Regions:** title `Heading`. Search `InputGroup` (`InputSlot` `Search`, plain `input` with `aria-label="Search runs"`, `InputSlot $kind="shortcut"` with `Kbd` `/`). Result filter `ComboboxProvider` + `ComboboxSelect aria-label="Result"` + `ComboboxPopover` with one `ComboboxItem` for each entry of `history.states`, each with its count from `history.counts`. Day label `Text` label style (`groupRunsByDay`). Rows `ThenRows` shape: `NavSlot` mark, `Text w-28` state word, `Text font-mono w-16`, `NavLinkLabel`, `Text` time. A replaced run takes `ak-ink-60` on the whole row. End caption `Text` label style.

**Copy (budget: 20 words of chrome; rows have 3 to 5 words plus the title)**

`History` · `Search runs` · `All results` (options: the eight state labels with a count) · `Today`, `Yesterday`, dates · state words from the vocabulary · `Latest 100 runs`. The attempt shows as `attempt 2` in the row only when it is above 1.

**Scenarios**

| Scenario   | Shows                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `full`     | 40 rows in day groups. The page scrolls; the search row is sticky under the header (`Frame $layer` so rows pass under it) |
| `no-match` | The search holds "datepicker". Under it: `No runs match “datepicker”` and a `Button $lightnessOffset` `Clear search`      |
| `empty`    | `StageMessage` without a frame: `No runs yet`, `Runs appear after the first capture`                                      |
| `loading`  | The title and the search field are real and usable. One label skeleton and eight row skeletons                            |

**Interactions and keys:** `/` focuses the search. Typing filters at once (`setQuery`). Down from the search moves into the rows. Enter opens a run (lab: by state, as in 4.2; a replaced run opens `read-only`, a passed run opens `passed`). Escape in the search clears it.

**Removed:** the "ARIAKIT/ARIAKIT" eyebrow, the sentence about the latest 100 runs, the table header and all cell borders, the SHA and attempt line of each row, the absolute date and time, the "Search loaded history…" wording, and "Refresh runs".

### 4.4 Status (`useStatus(scenario)`)

**1440 wide (alerts)**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [x]                                                                                (DH.) │ 48
│                    Fix first · 1 of 3                                         [<] [>]    │
│                    ┌──────────────────────────────────────────────────────────────┐      │
│                    │ (!) Critical                                                 │      │
│                    │ GitHub checks are not delivered                              │ 2xl  │
│                    │ Approvals do not reach the pull request.            (impact) │      │
│                    │ Check the GitHub App access, then follow the guide. (action) │      │
│                    │ Since Oct 5, 14:55 · seen 14 times                           │ sm   │
│                    │                           [ Open the recovery guide  Enter ] │ 48   │
│                    └──────────────────────────────────────────────────────────────┘      │
│                    Then                                                                  │
│                    (!) Database above warning level                         3 min ago    │ 44
│                    (!) Comparison retries used                             35 min ago    │ 44
│                                                                                          │
│                    Database  ▓▓▓▓▓▓▓▓░░  1.57 of 2 GiB      Captures  ▓▓░░░  2 of 5      │
│                    Checked 12 s ago [refresh]                                            │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide (healthy)**

```
┌──────────────────────────────┐
│ [x]                    (DH.) │ 44
│                              │
│            (v)               │ success ring, 56
│          All clear           │ 3xl
│   Checked 12 s ago [refresh] │
│                              │
│ Database                     │
│ ▓░░░░░░░░░   5.5 MiB of 2 GiB│
│ Captures                     │
│ ░░░░░        0 of 5          │
└──────────────────────────────┘
```

**Regions:** eyebrow `Text` + two icon `Button`s (previous, next alert). Hero `HeroCard` shape: severity `Badge $layer={alert.role}` with `BadgeSlot` + `BadgeLabel`; title `Heading`; impact and action `Text render={<p />}`; meta `Text` (`formatDateTime(firstSeenAt)`, `occurrences`); identifiers in a `Disclosure button="Details"` with `Code` for kind, code, and subject; primary `Button $layer="brand" $size="lg" render={<a href={guideUrl} />}`. Then rows `ThenRows` (a click puts that alert on stage). Meters: `Text` label + `Progress value` (`fill={{ $layer: "warning" }}` above the warning size) + `Text tabular-nums` (`formatBytes`). Freshness `Text` + icon `Button` (`aria-label="Check now"`).

**Copy (budgets: healthy 15 words, alerts 40 words plus the alert texts)**

- Healthy: `All clear` · `Checked 12 s ago` · `Database` `5.5 MiB of 2 GiB` · `Captures` `0 of 5`.
- Alerts: `Fix first · 1 of 3` · `Critical` or `Warning` · `{title}` · `{impact}` · `{action}` · `Since {date} · seen {n} times` · `Open the recovery guide` · `Then` · `{title}` `{time}` · the meters · `Checked 12 s ago`.
- Loading: 0 words. Error: `Status unknown` · `{message}` · `Last good check {time}` · `Retry`.

**Scenarios:** `healthy` as in the phone sketch (centered `StageMessage` without a frame, then the meters). `alerts` as drawn: the hero is the first critical alert, else the alert seen last. `overflow` (extra): the "Then" list shows 9 rows and a `Link` "Show 40 more". `loading`: a ring skeleton, a title bar skeleton, two meter skeletons. `error`: `StageMessage` with Retry on Enter.

**Interactions and keys:** Left and Right step through the alerts. Enter opens the guide of the alert on stage. The page checks each 60 s and keeps its content. The page is read-only: do not use `acknowledge` or `dismiss` of the lab hook.

**Removed:** the "OPERATIONS" eyebrow, the description sentence, the summary sentence, the two capacity sentences, the "Technical details" block of each alert (it stays only for the alert on stage), the guide button at the page end, the sentence "No external notifications are sent", and the text button "Refresh alerts".

### 4.5 Pull request (`usePull(scenario)`)

**1440 wide (attempts)**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [x]                                                                                (DH.) │ 48
│                    ┌──────────────────────────────────────────────────────────────┐      │
│                    │ #4863 · ariakit/ariakit                     Open on GitHub ↗ │      │
│                    │ Migrate component examples to the new style recipes          │ 2xl  │
│                    │ (x) Rejected · 22 left · 2 rejected                          │ sm   │
│                    │ a81b6c2 · attempt 2 · 12 min ago                             │ mono │
│                    │ ▬▬▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭  11 of 33   [ Review   Enter ] │ 48   │
│                    └──────────────────────────────────────────────────────────────┘      │
│                    >  2 earlier runs                                                     │ 44
│                       (!) a81b6c2 · attempt 1 · Failed · 1 h ago                         │ 44
│                       (-) 9c2e7f1 · Replaced · 3 h ago                                   │ 44
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 wide**

```
┌──────────────────────────────┐
│ [x]                    (DH.) │ 44
│ ┌──────────────────────────┐ │
│ │ #4863 · ariakit/ariakit  │ │
│ │ Migrate component        │ │
│ │ examples to the new      │ │
│ │ style recipes            │ │
│ │ (x) 22 left · 2 rejected │ │
│ │ a81b6c2 · attempt 2      │ │
│ │ ▬▬▬▬▬▭▭▭▭▭▭▭▭▭  11 of 33 │ │
│ └──────────────────────────┘ │
│ >  2 earlier runs            │
│ Open on GitHub ↗             │
│ ┌──────────────────────────┐ │
│ │          Review          │ │ 52, bottom dock
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Regions:** `HeroCard` (no previews). GitHub `Link` with `ArrowUpRight`. Commit line `Code $layer={false}` + `Text`. Earlier runs `Disclosure` with rows in the `ThenRows` shape (`pull.earlierRuns`; the label of a row is `{sha} · attempt {n} · {state} · {time}`, and the attempt part shows only when the commit has more than one).

**Copy (budget: 25 words)**

| Scenario                 | Stage                                                                                                                      | Primary (Enter)                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `attempts`               | As drawn. `{State} · {n} left · {n} rejected`, `{sha} · attempt {n} · {time}`, `2 earlier runs`                            | `Review` (opens `review` scenario `changes`)          |
| `single`                 | Hero with `(v) Passed · 14 changes approved`. No brand button; two neutral buttons `Open run` (Enter) and `Open on GitHub` | `Open run`                                            |
| `no-runs`                | `StageMessage`: `No visual review needed`, `This pull request changes no screenshots`                                      | `Open on GitHub`                                      |
| `loading`                | `#4863` is real (it is in the URL). Skeleton title, meta, and button                                                       |                                                       |
| `waiting` (extra)        | `StageMessage`: `Capturing screenshots`, `Progress`, `412 of 600`, `Opens when ready`                                      | none; the page opens the review when the run is ready |
| `capture-failed` (extra) | `StageMessage` (danger tint): `Capture failed`, `Rerun the visual tests in CI`                                             | `Open on GitHub`                                      |
| `error` (extra)          | `StageMessage`: `Could not load this pull request`, `{message}`, `Error ID`                                                | `Retry`                                               |

**Interactions and keys:** Enter starts the primary action. A check link from GitHub (`?check=`) does not show this page when the run is ready: the server answers with the run route. This page shows for a direct visit, from the run title popover, and when there is nothing to review.

**Removed:** the "VISUAL REVIEW · PULL REQUEST #7" eyebrow, the icon tile, the heading "Pull request #7" without a title, the back link text "Review queue", the "Check again" button, and the two-sentence waiting text.

### 4.6 Review workspace (`useReviewSession(scenario, { order: "declared" })`, `useReviewShortcuts`)

**1440 x 900**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [x] #4863 Migrate component examples to the… v  a81b6c2    22 left      Saved  [?] (DH.) │ 48 header
│  ▬ ▬▬▬▬▬ ▬▬ ▬▬ ▬▬ ▬▬▬ ▬▬ ▬▬▬▬ ▬▬ ▬▬ ▬▬ ▬▬▬ ▬▬                                            │ 16 rail
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │                                                                                      │ │
│ │       ┌────────────────────────────────────────────────────────────────────┐         │ │
│ │       │                                                                    │         │ │
│ │  [<]  │            one image, 100% (1280 x 720), 1 px ring outside         │   [>]   │ │ 756 stage well
│ │       │            changed regions ringed                                  │         │ │ image box 1296 x 732
│ │       │                                                                    │         │ │
│ │       └────────────────────────────────────────────────────────────────────┘         │ │
│ │                                                                                      │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│ Dialog with initial focus v        [undo] [x Reject  X |v] [v Approve  A |v]    (Baseline│Current) Space  [View] [i] │ 80 dock
│ (v)( )( )( )( )( )  React · Chromium · Light · 0.15%                                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**390 x 844**

```
┌──────────────────────────────┐
│ [x] #4863      22 left   [:] │ 44 header
│ ▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭ │ 12 rail (tap: screenshot sheet)
│┌────────────────────────────┐│
││                            ││
││  one image, fit width, or  ││ 644 stage well
││  the change at 100%        ││ image box 358 x 628
││  tap: baseline / current   ││
││  swipe: next / previous    ││
│└────────────────────────────┘│
│ Dialog with initial…  Current│ 24  name + side chip (the chip also flips)
│ (v)( )( )( )( )( ) All 6 0.15%│ 40  sibling marks
│ [undo] [ x Reject][v Approve]│ 52  + 28 of gaps and padding
└──────────────────────────────┘
```

**Pixel budget**

|                                                  | 1440 x 900                                               | Today                    | 390 x 844                                  | Today  |
| ------------------------------------------------ | -------------------------------------------------------- | ------------------------ | ------------------------------------------ | ------ |
| Chrome above the first possible screenshot pixel | 76 px (48 + 16 + 12)                                     | 408 px                   | 64 px (44 + 12 + 8)                        | 518 px |
| Chrome below                                     | 80 px                                                    | 61 px                    | 144 px                                     | 91 px  |
| Stage well                                       | 1416 x 756 = 82.6% of the viewport                       |                          | 374 x 644 = 73.2%                          |        |
| Image box                                        | 1296 x 732 = 73.2%                                       | 13 to 30% for the images | 358 x 628 = 68.3%                          |        |
| A 1280 x 720 capture                             | 100% scale, 71.1% of the viewport, first pixel at y = 82 |                          | fit width 358 x 201, or the change at 100% |        |

In Side by side at 1440 wide, two panes of 642 x 712 show a 1280 x 720 capture at 50%.

**Frame and primitives**

| Region      | Primitive and layout                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root        | `Shell className="h-dvh"` (fixed app frame recipe). `ShellMain $p="none" $maxWidth="100%"`, `ShellMainBody` with one wrapper `div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto]"` (rail, stage, dock)                                                                                                                                                                                                   |
| Header (48) | `ShellHeader $height="sm" className="text-sm"`. `start`: close `Button` (`X`, tooltip "Back to queue", `LabLink to="inbox"`), run title as `PopoverDisclosure` (ghost button, truncate, at most 40% of the width), SHA `Code $layer={false}` (hidden under 1024 px). `center`: counter `Button` (`22 left`, opens the screenshot sheet). `end`: `SaveState`, `?` icon button, account menu                           |
| Rail (16)   | `Rail` (see below), `px-3`, centered                                                                                                                                                                                                                                                                                                                                                                                 |
| Stage well  | `Frame $darken $rounded="2xl" className="relative mx-3 grid min-h-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center overflow-clip"`. Side lanes are 60 px wide and hold the chevron `Button`s (48 x 48, `ChevronLeft`, `ChevronRight`, tooltips "Previous ←" and "Next →"). The image box has `p-3`                                                                                                                 |
| Image       | `Frame $border $borderType="ring" $rounded="none"` around `img` (size from `width` and `height` times the scale; `image-rendering: pixelated` above 100%)                                                                                                                                                                                                                                                            |
| Dock (80)   | `div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-3"`                                                                                                                                                                                                                                                                                                                                              |
| Dock left   | Line 1: screenshot name `Button` (ghost, `ChevronDown` slot, opens the screenshot sheet). Line 2: sibling marks (`ak.RadioGroup` of `ak.Radio render={<Button $rounded="full" $p={1} />}` with a `StatusMark`, one tab stop, tooltip `2. React · Chromium · Dark · Needs review`), then `Text` with the framework and browser marks, `variant.name`, and `formatRatio(ratio)`                                        |
| Dock center | Undo icon `Button` (`Undo2`, tooltip "Undo Cmd/Ctrl+Z"). Reject: `ButtonGroup $p="none" $gap="none" $rounded="xl"` with `Button $size="lg" $p={3} $lightnessOffset className="min-w-36"` (`ButtonSlot` `X`, `ButtonLabel`, `KeyHint` X) and a caret `ak.MenuButton render={<Button $size="lg" $lightnessOffset aria-label="More reject options" />}`. Approve: the same with `$layer="brand"` (`Check`, `KeyHint` A) |
| Dock right  | Flip switch: `ak.RadioGroup render={<ButtonGroup $border $rounded="full" $size="sm" />}` with two `ak.Radio render={<Button />}` ("Baseline", "Current"), `ButtonGlider`, and a `Kbd` "Space" beside it. View: `PopoverDisclosure` (`Eye` icon, label "View"). Details: icon `PopoverDisclosure` (`Info`)                                                                                                            |
| Live region | `Text className="sr-only" role="status"` with `session.announcement`                                                                                                                                                                                                                                                                                                                                                 |

**Rail.** Build `changes` from `session.items` (declared order): each variant with `reviewable` true, plus each variant with the status `problem` or `comparing`. Do not use `session.next()`: its queue includes unchanged variants. Step with `session.select({ itemKey, variantKey })`.

```tsx
<ak.Composite
  role="navigation"
  aria-label="Changes"
  className="flex h-4 items-center justify-center gap-1 px-3"
>
  {groups.map((group) => (
    <div
      key={group.itemKey}
      className="flex min-w-0 gap-px"
      style={{ flexGrow: group.changes.length }}
    >
      {group.changes.map((change) => (
        <TooltipProvider key={change.id} placement="bottom">
          <TooltipAnchor
            render={
              <ak.CompositeItem
                className="flex h-4 max-w-10 min-w-0 flex-1 items-center"
                aria-current={change.id === variant?.id ? "true" : undefined}
                aria-label={`${change.itemName}, ${change.name}, ${statusLabel(change)}`}
                onClick={() => session.select({ itemKey: change.itemKey, variantKey: change.key })}
              />
            }
          >
            <Frame {...segmentProps(change)} $rounded="full" className={segmentHeight(change)} />
          </TooltipAnchor>
          <Tooltip>
            {change.itemName} · {change.name} · {statusLabel(change)}
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  ))}
</ak.Composite>
```

- Segment shapes (all `w-full`): needs review `$border $edge="warning" $edgeWeight="bold"` (hollow, `h-1.5`); approved `$layer="success"` (`h-1.5`); auto-approved `$layer="success" $mix={40}`; rejected `$layer="danger"` (`h-2.5`); failed `$border $edge="danger"` (`h-2.5`); comparing `$border $borderType="dashed"`. The current segment is `h-3` and has a 2 px brand `Frame` under it.
- Scale rule: when a segment gets less than 6 px, draw one segment for each screenshot with three parts by ratio (approved, rejected, left). When that is still less than 6 px, draw one three-part bar with a position marker. On a phone the rail is a display: a tap opens the screenshot sheet.
- With one change the rail row is empty and the counter is hidden.

**Item navigation.** Up and Down go to the previous and next screenshot in the rail and select its first change that needs review, else its remembered variant, else its first. They stop at each end. The screenshot sheet (`/`, the counter, or the name button) is a `Dialog className="max-w-2xl"` (a bottom sheet at 390 wide) with a `Combobox` (placeholder "Find a screenshot"), one line of totals (`11 approved · 2 rejected · 22 left`), and rows in groups (`Failed`, `Needs review`, `Rejected`, `Approved`, and `Unchanged` closed with a count). A row is a `ComboboxItem` with the variant marks in a `ComboboxItemSlot`, the name as `ComboboxItemLabel`, and `2 of 6` at the end. A name with a path shows the folder in `ak-ink-60` and the leaf in normal ink, and the folder truncates first. Enter jumps and closes.

**Variant switching.** Left and Right (also `Q` and `E`) go to the previous and next change of the rail, and they continue into the next screenshot. `1` to `6` select a variant of the current screenshot. The sibling marks show the verdict of each variant and are the click path. The full label of the selected variant is always printed (`variant.name`); the raw key part is only in Details.

**Compare modes.** One mode at a time. The mode and the zoom stay when the selection changes.

| Mode           | Key                                                                  | Hook mode            | Stage                                                                                                                                                |
| -------------- | -------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flip (default) | hold `Space` for the baseline; `G` baseline, `F` current (they stay) | `new` and `original` | One image. The flip switch shows the side                                                                                                            |
| Blink          | `B`                                                                  | `blink`              | One image that alternates each 600 ms                                                                                                                |
| Side by side   | `S`                                                                  | `side`               | Two panes, one shared pan and zoom, labels `Baseline` and `Current` above the panes (`text-xs`). Columns when width / height is 2 or less, else rows |
| Swipe          | `W`                                                                  | `swipe`              | One image with a divider; the divider is a native `input type="range"` over the image                                                                |
| Diff           | `D` (toggle)                                                         | `overlay`            | The current image at 40% opacity with the red mask on top (`variant.diff`); an opacity range input in the View popover                               |

- A variant whose sizes differ opens in Side by side with both images at one scale and the caption `Size changed · 640 × 400 → 640 × 422` in place of the percentage. An added or removed variant shows its one image with a `Badge` (`Added`, `Removed`); the flip switch and Diff are disabled, with the tooltip `No diff for an added or removed screenshot`.
- View popover (`Popover portal`, `grid gap-3 max-w-80`): a `RadioCardGrid` with the four modes (each `RadioCardLabel` plus a `Kbd`), `CheckboxField`s `Highlight changes` (`H`), `Play the change on arrival`, and `Blink` (`B`), and a zoom `ButtonGroup` (`Fit`, `100%`, `200%`, `400%`, and `Zoom to change` with `Kbd` Z).
- Highlight: rings 4 px outside each region (`variant.regions`, brand color with a canvas-colored outer line). Rings never cover changed pixels.

**Zoom.** "Fit" means the best scale: an image larger than the image box scales down to fit; an image up to half of the box shows at 200%, and up to a quarter at 400% (`viewer.setZoom`). When the fit scale is under 50% (a tall capture, or any wide capture on a phone), the change arrives zoomed to its first region at 100%, and the caption adds `change 1 of 3`. `Z` goes to the next region and then back to fit. `0` is fit, `+` and `-` step. Drag pans, Shift plus an arrow pans by half a box, arrows alone never pan. On a desktop a zoomed tall image has a 44 px wide map in the right lane (the whole image, a brand rectangle for the view, warning dots for regions; a click moves the view).

**Decision flow**

1. The images of the change decode. Until then Reject and Approve are `disabled` with a `ProgressCircular` in their icon slot, and the image box shows a skeleton of the exact image size with a thin `Progress` on its top edge. A key press in this window does nothing and the live region says `Images are loading`.
2. `A` or `X` (or a click) calls `session.approve()` or `session.reject()`. The mark of the variant stamps, the rail segment fills, and the selection moves to the next change that needs review (wraps one time). The images of the next two such changes are preloaded.
3. Whole screenshot: `Shift+A`, `Shift+X`, or the caret menu (`This variant` with `A`, `All 6 variants` with `Shift+A`). Both paths act at once, with no dialog. For 6 s the left zone of the dock shows `6 variants approved` and an `Undo` button.
4. Undo: `Cmd/Ctrl+Z` or the Undo button (`can.undo`). It restores the verdicts and the selection.
5. Save status (header, `role="status"`, icon plus word): `Sending 1` (`ArrowUp`), `Queued 2` (`Cloud`, tooltip `Queued on the server. You can close this tab`), `Saved` (`Check`, then `ak-ink-40`), `Not saved` (`TriangleAlert`, danger). The lab hook has one `saving` state: show it as `Sending {n}`, and keep the `Queued` look in the component.
6. Failed save (`save.status === "error"`): the dock center swaps Reject and Approve for `Retry` (brand, Enter) and `Discard`, and the left zone says `Not saved. Check your connection`.

```tsx
const flip = (event: KeyboardEvent) => {
  if (event.target instanceof HTMLElement && event.target.closest("button, a, input, [role=radio]"))
    return;
  event.preventDefault();
  viewer.setMode("original");
};
useReviewShortcuts(session, {
  keys: {
    " ": flip, // a keyup listener for " " calls viewer.setMode("new")
    arrowright: () => step(1),
    arrowleft: () => step(-1),
    e: () => step(1),
    q: () => step(-1),
    arrowdown: () => stepScreenshot(1),
    arrowup: () => stepScreenshot(-1),
    d: () => viewer.setMode(viewer.mode === "overlay" ? "new" : "overlay"),
    z: (event) => (event.metaKey || event.ctrlKey ? session.undo() : zoomToNextRegion()),
    i: () => setDetailsOpen((open) => !open),
    "/": (event) => {
      event.preventDefault();
      setSheetOpen(true);
    },
    "?": () => setKeysOpen(true),
    enter: () => continueAction(),
  },
});
```

A dock button that takes a pointer click gives up the focus (`if (event.detail > 0) stage.focus()`), so that Space flips and does not press the button again. A button that the keyboard activates keeps the focus.

**Keys (the `?` dialog lists exactly these, in three groups)**

| Group  | Key                     | Action                                                        |
| ------ | ----------------------- | ------------------------------------------------------------- |
| Decide | `A`, `X`                | Approve, reject, then go to the next change that needs review |
| Decide | `Shift+A`, `Shift+X`    | All variants of this screenshot                               |
| Decide | `Cmd/Ctrl+Z`            | Undo                                                          |
| Move   | `←` `→` (or `Q` `E`)    | Previous, next change                                         |
| Move   | `↑` `↓`                 | Previous, next screenshot                                     |
| Move   | `1` to `6`              | Variant of this screenshot                                    |
| Move   | `N`                     | Next change that needs review                                 |
| Move   | `/`                     | Find a screenshot                                             |
| Move   | `Enter`                 | Continue (never decides)                                      |
| Look   | hold `Space`            | Baseline                                                      |
| Look   | `F`, `G`                | Current, baseline                                             |
| Look   | `S`, `W`, `D`, `B`      | Side by side, swipe, diff, blink                              |
| Look   | `H`, `Z`, `0`, `+`, `-` | Highlight, zoom to change, fit, zoom in, zoom out             |
| Look   | `I`, `?`                | Details, shortcuts                                            |

The dialog has a `Shortcuts` switch (Toggle recipe, `session.setShortcutsEnabled`). The `?` button in the header is always visible, so the switch is reachable when the keys are off. Enter means: next change that needs review (when the current change has a verdict), the primary button of a stage message, or nothing.

**Details (`I`, one step away).** Run title popover: `#4863` and the title as a GitHub link, `Commit a81b6c2`, `Attempt 2`, `Baseline 128`, `Captured 12 min ago`, `All runs of #4863` (to the pull request page). Details popover (a `dl` grid of `Text`): `Changed 1,382 px (0.15%)`, `Size 1280 × 720`, `Tolerance {threshold}`, `Reviewed by @login · 12 min ago`, `Key react-chromium-light`, and a `Button $lightnessOffset $size="sm"` `Copy debug info`.

**Copy at rest (budget: 30 words; the sketch has about 25 with data):** `22 left` · `Saved` · the screenshot name · the variant label · `0.15%` · `Reject` · `Approve` · `Baseline` · `Current` · `View`. Chrome words without data: 8.

**Scenarios**

| Scenario          | Rail                                                                   | Stage                                                                                                                                                               | Dock center                                                                                                    |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `changes`         | 33 segments in 12 groups                                               | First change that needs review, Flip, arrival play                                                                                                                  | Undo, Reject, Approve                                                                                          |
| `large`           | 128 segments (about 9 px each at 1440; one for each screenshot at 390) | Same. Counter `79 left`                                                                                                                                             | Same                                                                                                           |
| `one-change`      | Empty row                                                              | The one change. No sibling marks, no counter                                                                                                                        | Same                                                                                                           |
| `passed`          | All solid                                                              | The Done card (below). A click on a segment shows that change                                                                                                       | Undo only                                                                                                      |
| `read-only`       | Verdicts as saved                                                      | Changes can be browsed                                                                                                                                              | `Read-only` + `session.readOnlyReason` (one line) + `Open current run` (brand, Enter). Counter says `Replaced` |
| `comparing`       | Compared segments, the others dashed                                   | `StageMessage` without a frame: `ProgressCircular` with `6 of 16`, title `Comparing screenshots`, line `Opens when ready`                                           | Hidden                                                                                                         |
| `problems`        | Failed segments tall and hollow                                        | A failed variant: `StageMessage` (danger tint) `Comparison failed`, `{variant.error}`. An image that does not load: `Could not load the images` and `Retry` (Enter) | `Failed` + `Rerun the visual tests in CI` + `Open on GitHub`. Counter says `Failed`                            |
| `loading`         | One neutral track that pulses                                          | Skeleton frame, see section 5                                                                                                                                       | Disabled Reject and Approve in their real shape, caption skeletons                                             |
| `error` (extra)   | None                                                                   | `StageMessage`: `Could not load this run`, `{message}`, `Error ID`, `Retry` (Enter), link `Back to queue`                                                           | Hidden                                                                                                         |
| `expired` (extra) | Verdicts as saved                                                      | `Images expired`, `The decisions remain`                                                                                                                            | `Read-only`                                                                                                    |

**Completed state.** When `session.complete` becomes true, the last card leaves and the stage shows the Done card: `Frame $layer="success" $mix={12} $border $edge="success" $rounded="3xl" $p="2rem"`, centered, `max-w-md`.

```
            (v)                                   success ring, 56 px
            Done                                  text-3xl
            33 approved                           or "31 approved · 2 rejected"
            (~) Updating the check on GitHub      then "(v) Check passed on GitHub"
                                                  or "(x) Check failed: 2 rejected"
            [ Next: #4831 · 79 changes   Enter ]  brand, large; with an empty queue: "Back to queue"
            Open #4863 on GitHub ↗    Review again
```

The check line has three states (in the lab, `useSimulatedLoad({ latency: 1200 })` moves it from the first to the second). "Next" is the first other run of the queue that needs review (lab: #4831, scenario `large`). The rail stays, so each change can be opened and decided again. A run that is complete on load opens on this card.

**Phone.** Tap the image to flip (the side chip says `Current` or `Baseline`). A horizontal swipe on the stage goes to the next or previous change when the zoom is fit; a drag pans when it is zoomed; pinch zooms. No press and hold. Reject and Approve are 52 px tall and share the width. The `All 6` chip opens a bottom sheet with `Approve all 6` and `Reject all 6`. The `[:]` menu has View, Details, Screenshots, Open on GitHub, and the account items. No key caps.

**Tab order:** header (close, run title, counter, shortcuts, account), rail (one stop), stage (a named region), sibling marks (one stop), Undo, Reject, its caret, Approve, its caret, flip switch (one stop), View, Details. Approve is the tenth stop (it is after 30 stops today).

**Removed:** the app navigation bar, the sidebar with its header, filter, and "Accepted" section, the main header row with "Queue" and the native progress bar, the identity strip, the 59 px heading block, the variant chip strip, the view and zoom toolbar row, the pane caption rows, the checkerboard, the eight pan buttons, the Details side panel, the whole-item dialog, the four banners, and the footer (keyboard help, "Shortcuts on", "Recompare stored run").

## 5. Loading

Rules: the frame of the page renders at 0 ms from the route alone. A skeleton has the exact size of the content that replaces it. Facts that the previous page knows (run title, counts) come through router state and show at 0 ms. No spinner before 1 s and no text before 2 s. At 2 s one line shows under the stage (`Still loading`). At 5 s a `Retry` button joins it and the load continues. The text "Checking access" does not exist. A `loading` scenario of the lab stays in loading: show the skeleton and reveal the 2 s and 5 s parts with a timer on mount.

| Page         | 0 ms                                                                                                                                                                                                                                      | 300 ms (list data)                                                                                                                                | 1 s                                                                                         | 5 s (slow)                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in      | A deep link shows the skeleton of its target page. On a 401 answer the stage cross-fades to the complete card (150 ms). The card has no loading state                                                                                     |                                                                                                                                                   |                                                                                             | `signing-in`: a `Try again` link under the disabled button                                                                                               |
| Queue        | Corner controls, hero skeleton (two text bars, four preview blocks, a button block), three row skeletons                                                                                                                                  | Hero text, counts, mini rail, rows. `Review` works on Enter. Preview frames are still blocks                                                      | Previews fade in (150 ms)                                                                   | Skeleton, `Still loading`, `Retry`. The account menu and the footer links work                                                                           |
| History      | Close button, the title, the search field (typing is kept), eight row skeletons                                                                                                                                                           | Rows in day groups                                                                                                                                | Complete                                                                                    | Skeleton rows, `Still loading`, `Retry`                                                                                                                  |
| Status       | Close button, a ring skeleton, a title bar, two meter skeletons                                                                                                                                                                           | The state, the alert on stage, the meters, `Checked just now`                                                                                     | Complete                                                                                    | Skeleton, `Still checking`, `Retry`                                                                                                                      |
| Pull request | Close button, `#4863` from the URL, title and meta skeletons, a button block                                                                                                                                                              | The card                                                                                                                                          | Complete                                                                                    | Skeleton, `Still loading`, `Retry`                                                                                                                       |
| Review       | Header with the close button and the run title (from router state, else a bar), the rail as one track, a frame skeleton in the well (16:9 at 60% of the box, or the size of the first preview), disabled Reject and Approve, caption bars | Rail segments, `22 left`, name and variant, sibling marks. The frame takes the real image size (one resize) and a thin `Progress` on its top edge | The first images decode, the change plays, the buttons enable. The next two changes preload | Skeleton, `Still loading` at 2 s (`Loading 33 changes` when the count is known), `Retry` at 5 s. The header, the close button, and the account menu work |

The review page needs only the changes for its first screen. The unchanged group of the screenshot sheet shows a count and loads its rows when it opens.

## 6. Risks, tradeoffs, and earlier decisions that this direction revisits

**Risks and tradeoffs**

1. No list on screen. A reviewer cannot scan the screenshot names of a run without one key press (`/`). The rail groups, the sibling marks, and the queue previews are the answer of this direction.
2. Flip is the default. The baseline is not beside the current image. The arrival play, the flip switch, and `S` (which stays) reduce the risk. The play costs 450 ms of attention for each change; it can be turned off.
3. Hold Space needs the focus rule in 4.6. Without it, Space presses a focused button. `F` and `G` are the contract keys that do the same job without a hold.
4. A change that arrives zoomed to its first region (tall captures, phones) can hide other regions. The caption counts them (`change 1 of 3`) and `Z` steps through them.
5. Whole-screenshot decisions have no confirmation. The 6 s notice and Undo are the safety.
6. The rail does not scale without rules: more than about 230 changes at 1440 wide fall back to one segment for each screenshot.
7. History and Status are less visible than in a navigation bar.
8. The Done card leads to the next run. A reviewer who wants to choose uses the close button.
9. The 48 px targets and wide spacing show fewer things than a dense tool. A maintainer who reviews 50 changes in two minutes loses nothing in the review loop (the keys are the same), but the queue and history show fewer rows.
10. Almost every test pin of Table F breaks (variant links, button names, mode names, the "Accepted" group).

**Fields that are not in the API today:** `Run.previews`, `Run.counts`, `Run.progress`, `Run.error`, `Baseline.updatedAt`; `ReviewVariant.regions`, `ReviewVariant.decidedAt`, `reviewerLogin`; `ReviewRun.counts`, `pullRequest`, `progress`, `supersededBy`; `PullRequest.title`, `runs`, `headSha`; `ServiceAlert.severity`, `impact`, `occurrences`; `repository` and `user` in sign-in answers; `User.name`. The delivery state of the GitHub check (Done card) is not in the fixtures and not in the API. Without `regions` there are no rings and `Z` switches between fit and 100%. Regions must come from the API: if the client computes them from the mask, the mask loads for each change, which reopens P02.

**Earlier decisions and rules**

| Rule or decision                                                                            | What Focus does                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A06, U02 (item list on the left, one review shell, decisions in the main header)            | Revisits. No sidebar; decisions are in a bottom dock                                                                                                                       |
| A06, guide line 17 (commit and attempt above the images)                                    | Partly. The SHA stays in the header on a desktop; attempt and baseline move to the run popover                                                                             |
| A08, A09 ("2 of 6 need review", text with color)                                            | Revisits. The header says `22 left`; "2 of 6" is in the screenshot sheet; marks have shapes and tooltips                                                                   |
| A11 (thumbnail of the first variant)                                                        | Revisits. No thumbnails in the review; previews only in the queue hero                                                                                                     |
| A13, L4 ("Accepted automatically", "Accepted" group)                                        | Revisits the words: `Auto-approved`, groups `Approved` and `Unchanged`                                                                                                     |
| A16, K13 (D is a mask-only red diff)                                                        | Revisits. `D` shows the red mask over the dimmed current image. New modes on `W` and `B`                                                                                   |
| A18, U04 (zoom and position; page-wide arrows with pan buttons)                             | Arrows never pan (U04 kept). One linked view; Shift plus an arrow and drag replace the pan buttons                                                                         |
| A21 (S shows the old image and a labeled empty pane)                                        | Revisits. An added or removed variant shows one image with a badge                                                                                                         |
| A27, D53 (narrow layout with the list above and stacked images; mobile rejected for launch) | Revisits. A single stage with tap to flip; the phone flow is designed                                                                                                      |
| K2, K3, D04 (first visit opens the first variant)                                           | Keeps the behavior of the code today: the first variant that needs review                                                                                                  |
| K5 (Left and Right inside one item)                                                         | Revisits. They continue into the next screenshot                                                                                                                           |
| K11, D21, RULE-06, WORK-17 (whole item)                                                     | Keeps the scope and the keys. No confirmation on either path; needs a maintainer decision                                                                                  |
| X4 (shortcut toggle)                                                                        | Moves into the shortcuts dialog, and the choice is stored                                                                                                                  |
| U03, L1 (variant links with a bar glider)                                                   | Revisits. Variants are marks in a radio group; the URL still updates                                                                                                       |
| D17 (`comfortable` was rejected for `compact`)                                              | Revisits. Large targets and wide spacing; controls stay flat, no bevels                                                                                                    |
| RULE-22 (Space, `/`, Cmd/Ctrl+K, registry)                                                  | Uses hold Space and `/`. No Cmd/Ctrl+K, no bracket keys, no key registry                                                                                                   |
| RULE-24 (phone gestures)                                                                    | One meaning each: tap flips, swipe steps, drag pans, pinch zooms. No press and hold                                                                                        |
| U05, D02, D03, D28, D31, P03, P04, I1 to I9                                                 | Kept: work first with a separate history, variant scope, auto-advance with one wrap, session Undo, router loaders, a virtual list in the sheet, and every review invariant |
