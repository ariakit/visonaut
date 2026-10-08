# Folio: Visonaut as an Ariakit sibling (direction `ariakit`)

## 0. Notes for builders

- Direction id: `ariakit`. Build one page variant for each surface: `sign-in`, `inbox`, `history`, `status`, `pull`, `review`. Give each variant `direction: "ariakit"`.
- Base font: put `text-sm` (14 px) on the root wrapper of every page. Use `text-base` (16 px) on the sign-in page only. All pixel numbers in this brief assume 14 px and are targets. Measure them with the screenshot helper and adjust `$p` steps, not pixel values.
- Colors: only `$layer`, `$text`, `$edge` with `canvas`, `brand`, `secondary`, `success`, `warning`, `danger`, plus `$lighten`, `$darken`, `$lightnessOffset`, `$mix`, and `ak-ink-*`. There is no `"primary"`. No hex, no Tailwind palette classes, no pixel radii.
- Data: use the state hooks (`useSignIn`, `useInbox`, `useHistory`, `useStatus`, `usePull`, `useReviewSession`, `useReviewShortcuts`). Narrow on `status` first.
- Shared parts: section 6 lists the kit of this direction. Build each part one time and use it on all pages.
- Fields with "Not in the API today" that this direction uses are listed in section 8. Copy that list into the `tradeoffs` of each variant.
- The pitfalls that matter most here: nested frames lose their radius below 1rem of padding (use `$p="1rem"` or `$forceRounded`), `Heading` has flow margins (`mt-0 mb-0`), `$text` on a control colors only labels and slots, `Text` has no `$ink`, a raised frame on the light canvas needs `$border` or a shadow, and gliders need CSS anchor positioning.

## 1. Concept

**Name:** Folio. **Tagline:** Every screenshot is a folder, every variant a tab.

**The idea in five sentences.** Visonaut looks and moves like a member of the Ariakit product family: a desk, raised sheets, recessed wells, bevel brand actions, gliders, and key caps. The folder tab, the most recognizable Ariakit UI shape, becomes the structure of the product: a screenshot is a folder, its variants are the tabs, and the selected tab joins the stage below it. The first tab of each folder is a cover that shows every variant that takes a verdict, cropped to the changed area, so a decision for the whole screenshot is an informed decision. Each level of the product has one status mark and no more: a ring for the run, a dot strip for the screenshot, a mark on the tab for the variant. Words leave the chrome and go into More info popovers, the same idiom as the example boxes of the Ariakit sandbox.

**Signature moment.** A screenshot opens on its cover. Five variants show the same focus ring at 150%, each with an area box in the secondary color. The reviewer presses `B` and all five blink between baseline and current in sync. The reviewer presses `Shift+A`: checks stamp across the folder tabs from left to right, the ring in the header grows, and the folder glider moves to the next screenshot.

**Five principles.**

1. One folder, three levels: run in the header, screenshot in the list, variant in the folder tabs. Each level shows its status one time, in one mark.
2. Depth, not lines: desk, sheet, well, chip. A border shows only where a surface ends.
3. Marks before words: a status is a shape with a color, a count is a number, and prose lives in a More info popover.
4. Brand means go, secondary means changed: one brand surface for each view, and the diff never shares red with a rejection.
5. Keys are printed on the controls: each action shows its key cap, tabs show their number, and `?` lists everything.

**What this direction does not do** (so that it stays apart from the other seven): no command menu, no floating or hiding chrome, no continuous feed, no persistent run list beside the workspace, no run-level thumbnail grid, no multi-select across screenshots, and no single-question wizard.

## 2. Visual system

### 2.1 Layers

| Surface | Recipe                                                                       | Used for                                                                                   |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Desk    | The `body` canvas. `Shell`, `ShellHeader`, and `ShellSidebar` paint nothing  | Page background, header, screenshot list                                                   |
| Sheet   | `Frame $lighten $border $rounded="2xl" $p="1rem"`. In light, add `shadow-sm` | Cards, the folder, the history table, popovers                                             |
| Well    | `Frame $darken={1.5} $rounded="xl"` inside a sheet                           | The stage, tab strips (the `TabList` is a well by default), preview strips, the table head |
| Chip    | A control inside a well: `Button $lightnessOffset`, `Badge`                  | Buttons in bars, corner badges on the stage                                                |
| Brand   | `$layer="brand"`. One for each view                                          | Inbox hero, sign-in card, the Approve button, the coach popover                            |
| Tint    | `Frame $layer={role} $mix={12} $border $edge={role}`                         | Callouts, the status health card, the completion band                                      |

Rules. A layout wrapper has no layer. Do not nest more than desk, sheet, well, chip. Controls on the brand layer are `$invert` (the main action) or ghost.

### 2.2 Borders and shadows

- A sheet has `$border` (a border in dark, a ring in light). A well has no border in dark; in light give it `$border $edgeWeight="light"`.
- No line under the header and no line between the list and the main area. Depth separates them.
- Row lines exist in one place: the history table (`$borderInline={false}`).
- `Separator` keeps its default dashed line (an Ariakit signature). Use it inside popovers and between the alert list and the health line.
- Shadows: `shadow-sm` on sheets in light only. Popovers, dialogs, and tooltips keep their own `$shadow`.
- The screenshot is never rounded and never has a shadow. A 1 px ring outside the image box shows its bounds: `Frame $border $borderType="ring" $rounded="none"`.

### 2.3 Type

Inter Variable for everything. JetBrains Mono Variable for: commit SHAs, branch names, screenshot keys, image sizes (`1280 × 720`), Error IDs, and the text inside `Kbd` and `Code`.

| Class       | Size  | Weight              | Use                                                  |
| ----------- | ----- | ------------------- | ---------------------------------------------------- |
| `text-xs`   | 12 px | 500                 | Meta, times, corner badges, key legend, micro labels |
| `text-sm`   | 14 px | 400, 500 for labels | Default UI text, rows, buttons                       |
| `text-base` | 16 px | 600                 | Card titles, the screenshot name in the header       |
| `text-lg`   | 18 px | 600                 | Inbox hero title, pull request title, health heading |
| `text-xl`   | 20 px | 600                 | Sign-in heading, empty state headings                |

- Numbers that change use `tabular-nums`.
- Micro labels (group labels in lists, day labels, cover cell headers): `text-xs font-semibold tracking-[0.06em] uppercase ak-ink-60`. This is the title style of the Ariakit sandbox boxes. The text in the source stays sentence case.
- Secondary text: `ak-ink-70`. Tertiary text: `ak-ink-60`. Never `opacity-*`.

### 2.4 Spacing, density, radius

- Page gutter: `ShellMain $p="1.5rem"` on list pages, `$p={2}` in the review workspace.
- Column width: inbox and history `$maxWidth="72rem"`, status `56rem`, pull `48rem`, sign-in card `24rem`, review `100%`.
- Sheet padding `$p="1rem"` (children keep their radius). Gaps `gap-3` inside a sheet and `gap-4` between sheets.
- Heights at 14 px: header 49, toolbar 36, list row 40, small control 32, footer band 48, card 176, hero 168.
- Radius: page sheets `2xl`, wells `xl`, controls `md` (default), badges and chips `full`, thumbnails `md`. Let nested frames compute concentric corners; do not override with `rounded-*`.

### 2.5 Icons and marks

- lucide-react with `strokeWidth={1.5}`; verdict marks use `strokeWidth={2.25}` so that they read at 12 px.
- Framework and browser marks (React, Solid, Chrome, Firefox, Safari) in full color, in slots.
- Axis marks of a variant, in this order: framework mark, browser mark, scheme (`Sun` or `Moon`), contrast (`Contrast`, only for More contrast), forced colors (`SquareDashed`, only when active). Show only the axes that differ inside the screenshot. If no axis differs, show framework and browser.

### 2.6 Color roles and one status vocabulary

| Role        | Meaning                                                      |
| ----------- | ------------------------------------------------------------ |
| `brand`     | The main action, the current place, running work             |
| `secondary` | The diff: mask tint, area boxes, change size, minimap marks  |
| `success`   | Approved, passed, healthy                                    |
| `warning`   | Needs review, rerun needed, a warning alert, read-only notes |
| `danger`    | Rejected, failed, a critical alert, a failed save            |

One vocabulary for run states and variant verdicts. A mark is a lucide icon in `Text $text={role}`; it always has a shape of its own and an `aria-label`.

| Name                             | Run state         | Variant status              | Role                 | Mark                               |
| -------------------------------- | ----------------- | --------------------------- | -------------------- | ---------------------------------- |
| Needs review                     | `needs-review`    | no verdict                  | warning              | `Circle` (hollow)                  |
| Rejected                         | `rejected`        | rejected                    | danger               | `X`                                |
| Approved (variant), Passed (run) | `passed`          | approved                    | success              | `Check`                            |
| Auto-approved                    | none              | added or removed, automatic | success, `ak-ink-60` | `CheckCheck`                       |
| Capturing                        | `incomplete`      | none                        | brand                | `ProgressCircular` with a value    |
| Comparing                        | `comparing`       | `pending`                   | brand                | `ProgressCircular` without a value |
| Failed                           | `failed`          | `error`                     | danger               | `TriangleAlert`                    |
| Replaced                         | `superseded`      | none                        | neutral, `ak-ink-60` | `CornerUpRight`                    |
| Rerun needed                     | `needs-recompare` | none                        | warning              | `RefreshCw`                        |
| Unchanged                        | none              | unchanged                   | neutral, `ak-ink-40` | `Minus`                            |

Kind badges (what the change is): `Added` (`SquarePlus`, success), `Removed` (`SquareMinus`, danger). A changed variant has no kind badge; it shows its ratio (`0.15%`) in a secondary tint.

Three sizes of the same status: **mark** (icon only, in tabs and rows), **dot strip** (one 6 px shape for each variant in a list row: hollow ring, filled dot, filled square, dash; the strip is `aria-hidden` and a `sr-only` text says "2 of 5 need review, 1 rejected"), **badge** (`Badge $layer={role} $forceRounded` with the mark and the name, used in the history table and the pull page).

```tsx
function StatusMark({ status }: { status: StatusName }) {
  const { label, role, icon: Icon } = MARKS[status];
  return (
    <Text
      $text={role === "neutral" ? undefined : role}
      role="img"
      aria-label={label}
      className="flex"
    >
      <Icon strokeWidth={2.25} />
    </Text>
  );
}
```

### 2.7 Motion

| What moves                                           | How                                                            | Time                       |
| ---------------------------------------------------- | -------------------------------------------------------------- | -------------------------- |
| Folder glider between variant tabs                   | The `TabGlider` of the recipe                                  | 100 ms (`--duration-tabs`) |
| Bar glider in the header nav, hover gliders in lists | The recipe default                                             | recipe default             |
| Verdict stamp on a tab or a cover cell               | The mark scales from 0.6 to 1 and fades in                     | 160 ms, ease-out           |
| Whole-screenshot cascade                             | The stamps run left to right with a 30 ms delay for each tab   | 240 ms maximum             |
| Area boxes on arrival                                | One pulse of the edge opacity                                  | 400 ms                     |
| New image after a selection                          | The well covers the old pixels at once; the new image fades in | 80 ms                      |
| Blink                                                | A hard swap, no cross-fade                                     | interval 600 ms            |
| Popovers, dialogs, tooltips                          | The recipe (`--ease-overshoot`)                                | recipe default             |
| Skeletons                                            | `animate-pulse`                                                | Tailwind default           |

Note of round 4: the screenshot list of the review page has no hover glider. It has the bar glider only, by audit decision D-PERF-01 ([round-4.md](../round-4.md)).

Reduced motion (`motion-reduce:`): gliders jump, the stamp is a color change only, no cascade delay, no pulse, skeletons are still, and Blink does not run by itself (the `B` key flips one time for each press).

## 3. Shell and navigation model

**Always on screen.** One 49 px `ShellHeader $height="sm"` on the desk. Nothing else is fixed on list pages. In the review workspace the header, the screenshot list, and the footer band of the folder are fixed, and only the stage and the list scroll.

**Header on list pages** (inbox, history, status, pull):

- `start`: the mark and the word "visonaut" (a link to the inbox), then the repository as a ghost `Button` with an external link slot (`ariakit/ariakit`).
- `center`: `Nav $layout="horizontal"` with a bar glider and three `NavLink`s: Inbox (a `NavSlot $kind="badge"` with the number of runs to review), History, Status (a `NavSlot $kind="badge" $layer="danger"` with the open alert count; no slot when there is none). The service alert lives here.
- `end`: a `?` icon button (shortcuts dialog, tooltip "Keyboard shortcuts"), then the account: a `Button` with one avatar slot (initials or `avatarUrl`). The account opens a menu (`ak.Menu` with the `popover` and `option` recipes): the login as a label, "Open GitHub profile", "Sign out".

**Header in the review workspace:**

- `start`: a back icon button (tooltip "Inbox"), then the run crumb: a `PopoverDisclosure` with the kind mark (`GitPullRequest`, `GitMerge`, `GitBranch`), the number in mono (`#4863`), the title (one line, `max-w-md truncate`), and a chevron. The popover holds branch, commit, attempt, baseline revision, "Open pull request", "Open commit", and "All attempts" (the pull page).
- `center`: the screenshot stepper: `↑`, the screenshot name (`text-base font-semibold`), the position (`1 / 12`, `ak-ink-60 tabular-nums`), `↓`.
- `end`: the progress button (ring and "22 left"), an alert icon button only when alerts are open (tooltip "3 alerts", link to Status), `?`, the account.

**Moves.** Inbox to a run: click or Enter on a hero, a card, or a row. A run to the inbox: the back button or the mark. History and Status: header links. Pull request: from the GitHub check link, from "All attempts" in the run crumb, and from a history row of a pull request (its number is a link). Screenshot: the list, the header stepper, Up and Down. Variant: the folder tabs, Left and Right, the number keys.

**URL model.**

| Page         | URL                                                                |
| ------------ | ------------------------------------------------------------------ |
| Inbox        | `/`                                                                |
| History      | `/history?q=&result=&sort=`                                        |
| Status       | `/status`                                                          |
| Pull request | `/pulls/4863?commit=4f1c9e0`                                       |
| Review       | `/runs/<id>?s=<screenshot key>&v=<variant key or all>&mode=&zoom=` |

Opening a run pushes a history entry. A screenshot, variant, mode, or zoom change replaces the entry. The mode and the zoom in the URL make a view shareable.

**Page titles.** `(4) Inbox · Visonaut`, `History · Visonaut`, `Status · 3 alerts · Visonaut`, `#4863 Add the combobox select · Visonaut`, `22 left · #4863 Add the combobox select · Visonaut`, `Sign in · Visonaut`.

```
1440, list pages
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ visonaut  ariakit/ariakit ↗         Inbox 4    History    Status 3                 [?]  DH │ 49  desk
│                                       ───────                                                │     bar glider
│               ╭────────────────────────────────────────────────────────────╮                 │
│               │ sheet (raised)     ┌ well (recessed) ┐   ( chip )          │                 │     column ≤ 72rem
│               ╰────────────────────────────────────────────────────────────╯                 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

1440, review
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ←  PR #4863 Add the combobox select ▾     ↑ Dialog with initial focus 1 / 12 ↓   ◔ 22 left [?] DH │ 49
│ list on the desk  │ ╭ folder (sheet) ─────────────────────────────────────────────────────╮  │
│ 256 px            │ │ tab strip (well)                                                    │  │
│                   │ │ ┌ stage (well) ───────────────────────────────────────────────────┐ │  │
│                   │ │ └─────────────────────────────────────────────────────────────────┘ │  │
│                   │ │ footer band                                                         │  │
│                   │ ╰─────────────────────────────────────────────────────────────────────╯  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390, list pages                       390, review
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ ◉   Inbox 4  History  Status │ 49   │ ←  #4863        ◔ 22  [?] DH │ 49
│     ───────              DH  │      │ ↑ Dialog with ini… 1/12 ↓  ⌄ │ 40
│ ╭──────────────────────────╮ │      │ ╭────╮╭────────────╮╭───╮╭──  │ 40
│ │ sheet                    │ │      │ │ stage                     │ │
│ ╰──────────────────────────╯ │      │ │ footer band (two rows)    │ │ 92
└──────────────────────────────┘      └──────────────────────────────┘
```

At 390 the nav links keep their words (three short words fit), the repository chip and the word "visonaut" hide (`@max-3xl/shell:hidden`).

## 4. Page specs

Word budgets count chrome words. Data (titles, names, numbers, times, server messages) does not count.

### 4.1 Sign-in

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                              │
│                                        ◉ visonaut                                            │  y 236
│                         ╭──────────────────────────────────────────╮                         │
│                         │ (brand layer)                            │                         │
│                         │ Sign in to review                        │  text-xl, 600           │
│                         │ ariakit/ariakit                          │  mono, ink 80           │
│                         │                                          │                         │
│                         │ [ (GitHub)   Sign in with GitHub      ↵ ]│  inverted, full width   │
│                         │ Needs write access                       │  text-xs, ink 80        │
│                         ╰──────────────────────────────────────────╯  384 wide, y 288 to 500 │
│                                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390: the same card with 16 px side margins. The mark is at y 120 and the card starts at y 172.
```

| Region                          | Primitive                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page                            | A `div` with `min-h-dvh grid place-items-center text-base`. No `Shell`, no header                                                                         |
| Mark and word                   | `Text` with the logo, `font-semibold`                                                                                                                     |
| Card                            | `Frame $layer="brand" $rounded="2xl" $p="1.5rem"` with `render={<main />}`, `grid gap-4 w-full max-w-sm`                                                  |
| Heading                         | `Heading className="mt-0 mb-0 text-xl"`                                                                                                                   |
| Repository                      | `Text className="ak-ink-80 font-mono text-sm"`                                                                                                            |
| Button                          | `Button $invert $rounded="lg" $p={3}` with `ButtonSlot` (lucide `Github`, or `LogIn` if the icon is absent), `ButtonLabel`, `ButtonSlot $kind="shortcut"` |
| Hint                            | `Text className="ak-ink-80 text-xs"`                                                                                                                      |
| Neutral card (forbidden, error) | `Frame $lighten $border $rounded="2xl" $p="1.5rem"`, the same size and place                                                                              |

Scenarios and exact copy:

| Scenario     | Content                                                                                                                                                                                                                                        | Chrome words |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `guest`      | Heading `Sign in to review`. Repository. Button `Sign in with GitHub`. Hint `Needs write access`. The button has focus                                                                                                                         | 11           |
| `signing-in` | The same card. The button is disabled, its first slot is a `ProgressCircular` without a value, and its label is `Opening GitHub`. Nothing else changes                                                                                         | 9            |
| `forbidden`  | Neutral card. `Badge` with an avatar slot and `@okafor-amara`. Heading `No write access`. Text: the `message` of the data. Buttons: `Use another account` (`$kind="bevel" $layer="brand"`), `Back to GitHub` (ghost, external link slot)       | 9            |
| `error`      | Neutral card. A danger mark (`TriangleAlert`). Heading `Sign-in is unavailable`. Text: the `message` of the data. `Code` with `Error ID` and the reference, and a copy icon button. Button `Try again` (bevel brand; spinner while `retrying`) | 7            |

Interactions: Enter activates the focused button. `signIn()` moves to `signing-in`, and `onRedirect` opens the inbox in the lab. `switchAccount()` returns to `guest`.

Removed: the header and its three links for a guest, the marketing heading and paragraph, the three different sign-in and access-denied designs, and all "Checking access" text. During the access check of a deep link, show the skeleton of the target page (section 5) and swap to this card only when the server answers 401.

### 4.2 Inbox

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ visonaut  ariakit/ariakit ↗         Inbox 4    History    Status 3                 [?]  DH │ 49
│          ⌕ Filter runs            /                                    ↻   Baseline 128      │ 36
│          ╭──────────────────────────────────────────────────────────────────────────╮        │
│          │ (brand layer)                              ┌──────┐┌──────┐┌──────┐┌──────┐       │
│          │ ✕ #4863 · 12 min ago                  (av) │ img  ││ img  ││ img  ││ img  │       │ 168
│          │ Add the combobox select                    └──────┘└──────┘└──────┘└──────┘       │
│          │ 24 changes · 2 rejected                                                  │        │
│          │ [ Review  ↵ ]                                                            │        │
│          ╰──────────────────────────────────────────────────────────────────────────╯        │
│          ╭───────────────────────╮ ╭───────────────────────╮ ╭───────────────────────╮       │
│          │ ┌─────┐┌─────┐┌─────┐ │ │ ┌─────┐┌─────┐┌─────┐ │ │ ┌─────┐┌─────┐        │       │
│          │ └─────┘└─────┘└─────┘ │ │ └─────┘└─────┘└─────┘ │ │ └─────┘└─────┘        │       │ 176
│          │ ○ #4831 Add the com…  │ │ ○ #4819 A very long…  │ │ ○ main  a1b2c3d       │       │
│          │   79 changes · 1 h    │ │   14 changes · 3 h    │ │   6 changes · 5 h     │       │
│          ╰───────────────────────╯ ╰───────────────────────╯ ╰───────────────────────╯       │
│          RUNNING                                                                             │
│          ◔ Merge queue · #4870 #4871       Capturing 212 of 600  ▓▓▓░░░░░            2 min   │ 40
│          ◔ #4855 Fix the dialog focus      Comparing 48 of 120   ▓▓▓▓░░░░            4 min   │ 40
│          NEEDS ATTENTION                                                                     │
│          ▲ #4844 Update the tab glider     Failed · The capture job stopped           1 h    │ 40
│          ↻ main  9f8e7d6                   Rerun needed                               2 h    │ 40
│                                              J K  Navigate    ↵  Open    /  Filter    ?  Keys │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────┐
│ ◉   Inbox 4  History  Status │ 49
│ ⌕ Filter runs            ↻   │ 36
│ ╭──────────────────────────╮ │
│ │ ✕ #4863 · 12 min ago     │ │  brand hero
│ │ Add the combobox select  │ │
│ │ 24 changes · 2 rejected  │ │
│ │ ┌───────┐┌───────┐       │ │  two thumbnails
│ │ └───────┘└───────┘       │ │
│ │ [        Review        ] │ │  44 px target
│ ╰──────────────────────────╯ │
│ ╭──────────────────────────╮ │
│ │ ┌───┐ #4831 Add the co…  │ │  card as a 64 px row with one thumbnail
│ │ └───┘ ○ 79 changes · 1 h │ │
│ ╰──────────────────────────╯ │
│ RUNNING                      │
│ ◔ Merge queue      212 / 600 │ 44
│ NEEDS ATTENTION              │
│ ▲ #4844 Update the…   Failed │ 44
└──────────────────────────────┘
```

| Region       | Primitive                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page         | `Shell`, `ShellHeader`, `ShellMain $p="1.5rem" $maxWidth="72rem"`, one wrapper `div` in `ShellMainBody` with `grid gap-4`                                                                                                                                                                                                                                  |
| Toolbar      | `InputGroup $size="sm"` (search slot, plain `input`, shortcut slot with `Kbd`), a refresh icon `Button` in a `Tooltip`, and a `PopoverDisclosure` `Baseline 128` (the popover gives the update time, the commit, and the screenshot count)                                                                                                                 |
| Hero         | `Frame $layer="brand" $rounded="2xl" $p="1rem"` with `render={<article />}`, `grid grid-cols-[1fr_auto] gap-4`. Title: `Heading className="mt-0 mb-0 text-lg"`. Meta: `Text className="ak-ink-80"`. Marks: `StatusMark` (if a role fails contrast on brand, use the inherited ink). Action: `Button $invert` as a link, with `ButtonSlot $kind="shortcut"` |
| Preview well | `Frame $darken $rounded="xl" $p={1.5}`, `grid grid-flow-col gap-1.5`. Each thumbnail is a link to `?s=<itemKey>` with a `Frame $rounded="md" className="aspect-video w-44 overflow-clip"` and an `img` with `object-cover object-top`                                                                                                                      |
| Card         | A `Button` that renders the link (see the code below)                                                                                                                                                                                                                                                                                                      |
| Group label  | `TextFrame` with the micro label style                                                                                                                                                                                                                                                                                                                     |
| Rows         | `ButtonGroup $layout="vertical" $p="none"` with one `Button $p={3} className="text-start"` for each run: `ButtonSlot` (mark), `ButtonContent` with `ButtonLabel` and no description, a `Text` with the state, a `Progress` (`w-24`, `$thickness={1}`) for running rows, a time. `ButtonGlider $state="hover"` and `$state="focus"`                         |
| Key legend   | The keyboard hint recipe (`Text` with `Kbd`), end-aligned, `ak-ink-60 text-xs`                                                                                                                                                                                                                                                                             |

```tsx
<Button
  $lightnessOffset
  $border
  $rounded="2xl"
  $p={2}
  render={<a href={runHref} />}
  className="w-full flex-col items-stretch gap-2 text-start"
>
  <PreviewWell run={run} count={3} />
  <div className="flex items-center gap-2 px-1 pb-1">
    <ButtonSlot>
      <StatusMark status={run.state} />
    </ButtonSlot>
    <ButtonContent>
      <ButtonLabel>{getRunTitle(run)}</ButtonLabel>
      <ButtonDescription>{`${formatCount(run.pending, "change")} · ${formatRelativeTime(run.createdAt)}`}</ButtonDescription>
    </ButtonContent>
  </div>
</Button>
```

If the `Button` layout fights the column, use a `Frame $lighten $border $rounded="2xl" $p={2}` with one stretched link (`absolute inset-0`) and the focus ring on the frame.

Exact copy (`busy`): placeholder `Filter runs`; tooltip `Refresh`; `Baseline 128`; hero meta `24 changes · 2 rejected`, button `Review`; card meta `79 changes`; labels `Running`, `Needs attention`; row states `Capturing 212 of 600`, `Comparing 48 of 120`, `Failed`, `Rerun needed`; legend `Navigate`, `Open`, `Filter`, `Keys`. Budget: 30 chrome words at most. A run without a title uses `getRunTitle(run)`; a main run shows `main` and the short SHA in mono.

| Scenario    | What it shows                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `busy`      | Hero (#4863, first run of the `review` group), three cards, two Running rows, two Needs attention rows                                                                                                            |
| `single`    | The hero only (meta `1 change`), then one text link `33 earlier runs` to History                                                                                                                                  |
| `empty`     | The empty state recipe in a dashed frame: a success-tint mark (`Check`), heading `All reviewed`, text `Baseline 128 · updated 2 h ago` (data), button `Open History`                                              |
| `first-run` | The same frame: a brand-tint mark (`ImagePlus`), heading `No baseline yet`, text `The first full run on main creates it`, link `Setup guide`                                                                      |
| `loading`   | The real header and toolbar (disabled), a hero skeleton (`Frame $layer="brand" $mix={10}`, 168 px, pulse), three card skeletons, two row skeletons. `aria-busy` and `aria-label="Loading runs"`. No visible words |
| `error`     | A danger callout in place of the list: heading `Runs did not load`, the `message` of the data, button `Try again`. The header stays                                                                               |

Interactions and keys: `J` or Down and `K` or Up move a roving focus through hero, cards (row by row), and rows. Enter opens the focused run; with no focus in the list, Enter opens the hero. `/` focuses the filter (`inbox.setQuery`). `?` opens the shortcuts dialog. Refresh keeps the content on screen: the icon spins while `refreshing` and a 2 px indeterminate `Progress` shows under the toolbar.

Removed: the eyebrow `ARIAKIT/ARIAKIT`, the heading "Your review queue.", the sentence "4 runs are ready for review.", the three stat tiles, the label "Ready to review", the sentence on each card ("14 views await approval."), the commit, attempt, and absolute date line, the "Review changes" button on each card, the "Open run" button on each row, the footer link "View history", and the labeled "Refresh runs" button.

### 4.3 History

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ visonaut  ariakit/ariakit ↗         Inbox 4    History    Status 3                 [?]  DH │ 49
│          ⌕ Search runs                 /          All results ▾     Newest ▾                 │ 36
│          ╭──────────────────────────────────────────────────────────────────────────╮        │
│          │ Run                                           Result        Changes  When │        │ 36  head (well)
│          │ TODAY                                                                    │        │ 28
│          │ ✕ #4863 Add the combobox select  (av)  2 earlier ▸  Rejected       24  12 min     │ 40
│          │ ○ #4831 Add the combobox select  (av)               Needs review   79   1 h       │ 40
│          │ ◔ #4855 Fix the dialog focus     (av)               Comparing       –   4 min     │ 40
│          │ ✓ main  a1b2c3d  Update the tokens                  Passed          0   3 h       │ 40
│          │ YESTERDAY                                                                │        │ 28
│          │ ✓ Merge queue · #4790 #4791                         Passed          0   1 d       │ 40
│          │ ✓ #4788 Fix the select scroll    (av)  1 earlier ▸  Passed         12   1 d       │ 40
│          │ …                                                                        │        │
│          │ Latest 40 runs                                                           │        │ 32  foot
│          ╰──────────────────────────────────────────────────────────────────────────╯        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────┐
│ ◉   Inbox 4  History  Status │ 49
│ ⌕ Search runs                │ 36
│ All results ▾     Newest ▾   │ 36
│ TODAY                        │
│ ✕ #4863 Add the combobox…    │ 56  two lines
│   Rejected · 24 · 12 min   ▸ │
│ ○ #4831 Add the combobox…    │ 56
│   Needs review · 79 · 1 h    │
│ YESTERDAY                    │
│ ✓ Merge queue · #4790 #4791  │ 56
│   Passed · 0 · 1 d           │
└──────────────────────────────┘
```

| Region          | Primitive                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar         | `InputGroup $size="sm"` (search), `ComboboxSelect $layer="transparent" $size="sm"` for the result (items: `All results` and each state in `history.states` with its count), `ComboboxSelect` for the sort (`Newest`, `Oldest`, `Most changes`)                                              |
| Table sheet     | `Table` with `container={{ $border: true, $lighten: true, $rounded: "2xl" }}`, `$borderInline={false}`, `$p={2}`, `head={{ $sticky: "top" }}`, `className="text-sm"`                                                                                                                        |
| Day label       | A `TableRow` with one `TableCell header="row" colSpan={4}` in the micro label style, from `groupRunsByDay(history.visibleRuns)`                                                                                                                                                             |
| Run cell        | `StatusMark`, the number in mono (a link to the pull page for a pull request), the title (`truncate`, a link to the run that stretches over the row), an avatar (`Frame $rounded="full" $forceRounded` with the image), and the fold `Button $size="xs"` with `aria-expanded` (`2 earlier`) |
| Result cell     | The status badge (`Badge $layer={role} $forceRounded` with mark and name)                                                                                                                                                                                                                   |
| Changes cell    | `numeric`, `getRunChangeCount(run)`, a dash when null                                                                                                                                                                                                                                       |
| When cell       | `Text render={<time />}` with `formatRelativeTime` and the absolute time in `title`                                                                                                                                                                                                         |
| Folded attempts | More `TableRow`s under the run, with `ps-8` on the first cell and `ak-ink-70` text                                                                                                                                                                                                          |

Exact copy: `Search runs`, `All results`, `Newest`, column heads `Run`, `Result`, `Changes`, `When`, fold `2 earlier`, foot `Latest 40 runs`. Budget: 14 chrome words. State names come from the status vocabulary.

Fold rule: runs with the same `pullRequestNumber` form one group. The newest run is the row; the others fold under it. The fold opens by itself when the result filter is `Replaced` or when the search matches only an older attempt. Day labels show only for the time sort.

| Scenario        | What it shows                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full`          | Day groups, about 16 rows in the first screen, the foot line                                                                                                      |
| `no-match`      | The toolbar keeps the query `datepicker`. The table body is one empty state: heading `No runs match "datepicker"`, button `Clear search` (`history.resetFilters`) |
| `empty`         | The toolbar is disabled. Empty state: heading `No runs yet`, text `Runs appear after the first capture`                                                           |
| `loading`       | The real toolbar (a typed query applies when the data arrives), the table frame with one day label skeleton and ten row skeletons                                 |
| `error` (extra) | The danger callout of the inbox with `Runs did not load`                                                                                                          |

Interactions and keys: `/` focuses the search. `J` and `K` (or Down and Up) move the row focus; Enter opens the run; Right opens a fold and Left closes it. The select menus keep their own keys.

Removed: the three explanations of the 100-run limit and the client-side search (one foot line stays), absolute dates in the rows, the kind printed two times for a run without a title, and most "Replaced by a newer run" rows (folded).

### 4.4 Status

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ visonaut  ariakit/ariakit ↗         Inbox 4    History    Status 3                 [?]  DH │ 49
│                  ╭ (danger tint) ─────────────────────────────────────────────╮              │
│                  │ ▲ 3 alerts                       Checked 12 s ago   ↻   (i) │              │ 56
│                  │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │              │
│                  │ ▲ Check delivery failed    run #4863        14×   4 min    ⌄  │              │ 44
│                  │ ! Database above warning   742.4 MiB       576×   3 min    ⌄  │              │ 44
│                  │ ! Backup copy failed       Oct 5 backup      3×   2 h      ⌄  │              │ 44
│                  ╰──────────────────────────────────────────────────────────────╯              │
│                  ╭ DATABASE ───────────────────╮ ╭ CAPTURES ───────────────────╮              │
│                  │ 742.4 of 900 MiB            │ │ 3 of 8 running              │              │ 104
│                  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│░░░        │ │ ▓▓▓▓▓▓▓░░░░░░░░░░░░         │              │
│                  │ Warns at 720 MiB            │ │                             │              │
│                  ╰─────────────────────────────╯ ╰─────────────────────────────╯              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────┐
│ ◉   Inbox 4  History  Status │ 49
│ ╭──────────────────────────╮ │
│ │ ▲ 3 alerts        ↻  (i) │ │
│ │ Checked 12 s ago         │ │
│ │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ │
│ │ ▲ Check delivery failed  │ │ 56
│ │   run #4863 · 14× · 4 min│ │
│ │ ! Database above warn…   │ │ 56
│ ╰──────────────────────────╯ │
│ ╭ DATABASE ────────────────╮ │
│ │ 742.4 of 900 MiB ▓▓▓▓░░  │ │
│ ╰──────────────────────────╯ │
│ ╭ CAPTURES ────────────────╮ │
│ │ 3 of 8 running   ▓▓░░░░  │ │
│ ╰──────────────────────────╯ │
└──────────────────────────────┘
```

| Region      | Primitive                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health card | `Frame $layer={serviceHealthRoles[status.health]} $mix={12} $border $edge={role} $rounded="2xl" $p="1rem"` with `render={<section />}`. For `healthy`, the role is `success`                                                                                                                                                                                                                                                                                                 |
| Health line | `Heading className="mt-0 mb-0 text-lg"` (the `h1` of the page) with a `StatusMark`, a `Text render={<time />}` with `Checked 12 s ago`, a refresh icon `Button` in a `Tooltip`, and the More info `PopoverDisclosure` (`Info` icon)                                                                                                                                                                                                                                          |
| Separator   | `Separator` (dashed, the default)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Alert rows  | `DisclosureGroup` with one `Disclosure` for each alert. `DisclosureButton` with `icon` (the severity mark: `TriangleAlert` danger for critical, `CircleAlert` warning for warning), `label` (the title), a `DisclosureButtonSlot` with the subject in mono, a `DisclosureButtonSlot $kind="badge"` with the occurrences (`14×`), and the last-seen time. Content: the `impact`, the `action`, `First seen Oct 5, 14:55`, and a `Button $size="sm" $border` link `Open guide` |
| Meters      | Two stat cards (`Frame $lighten $border $rounded="2xl" $p="1rem"`): a micro label, the value in `text-lg font-semibold tabular-nums`, a `Progress` with `fill={{ $layer: role }}`, and for the database a 2 px marker at the warning point and the line `Warns at 720 MiB`                                                                                                                                                                                                   |
| More info   | `Popover portal` with `PopoverHeading` `About this page` and one paragraph                                                                                                                                                                                                                                                                                                                                                                                                   |

Exact copy: heading `All systems normal` or `3 alerts`; `Checked 12 s ago`; tooltips `Check now`, `More info`; in an open alert `First seen`, `Open guide`; meters `Database`, `Warns at`, `Captures`, `running`. More info text (hidden until opened): `Alerts refresh each minute while this page is open. No notifications are sent. The list shows open alerts only; it does not certify every dependency.` Budget: 12 chrome words on screen.

| Scenario           | What it shows                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `healthy`          | A success-tint card with `All systems normal` and the check time, no rows and no separator. The two meters in the brand fill        |
| `alerts`           | A danger-tint card (one critical alert), three rows sorted by severity then by last seen. The database meter in the warning fill    |
| `loading`          | A neutral card skeleton (56 px), two meter skeletons with empty tracks. No words                                                    |
| `error`            | A neutral card with a danger callout: heading `Status did not load`, the `message` of the data, button `Try again`. The meters hide |
| `overflow` (extra) | The row list scrolls inside the card (`max-h-96 overflow-auto`), and a foot line says `50 shown · more exist`                       |

Interactions and keys: Tab moves through the rows; Enter or Space opens a row (native disclosure). `J` and `K` move between rows. Refresh keeps the content and spins the icon. The list is read-only: no acknowledge and no dismiss.

Removed: the page heading with two intro sentences, the line "No external notifications are sent.", the runbook paragraph on each alert card (now inside the disclosure), the page-level guide button, the bell and its popover in the header, and the five names for this feature (one name: Status).

### 4.5 Pull request

```
1440
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ visonaut  ariakit/ariakit ↗         Inbox 4    History    Status 3                 [?]  DH │ 49
│                      PR #4863  Add the combobox select                       GitHub ↗        │ 32
│                      (av) diegohaz · feat/combobox-select → main                             │ 24
│                      ╭───────────────────╮╭────────────╮                                     │
│                      │ ✕ 4f1c9e0  head   ││ ↱ 9a2b7c1  │                                     │ 40  commit tabs
│                     ─╯                   ╰────────────────────────────────────╮              │
│                      │ ✕ Rejected · attempt 2 · 12 min ago                    │              │
│                      │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░                   │              │
│                      │ 5 approved · 2 rejected · 22 need review               │              │
│                      │ ┌──────┐┌──────┐┌──────┐┌──────┐                       │              │
│                      │ └──────┘└──────┘└──────┘└──────┘                       │              │
│                      │ [ Review 22 changes  ↵ ]                               │              │
│                      │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │              │
│                      │ ▲ Attempt 1 · Failed · The capture job stopped   40 min │              │ 40
│                      ╰────────────────────────────────────────────────────────╯              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

390
┌──────────────────────────────┐
│ ◉   Inbox 4  History  Status │ 49
│ PR #4863             GitHub ↗│
│ Add the combobox select      │
│ diegohaz · feat/combobox-…   │
│ ╭────────────────╮╭────────  │ 40  tabs scroll
│ │ ✕ 4f1c9e0 head ││ ↱ 9a2b…  │
│─╯                ╰───────────│
│ ✕ Rejected · attempt 2       │
│ ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░   │
│ 5 approved · 2 rejected · 22 │
│ ┌───────┐┌───────┐           │
│ └───────┘└───────┘           │
│ [    Review 22 changes     ] │ 44
│ ▲ Attempt 1 · Failed         │
└──────────────────────────────┘
```

| Region          | Primitive                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page            | `Shell`, `ShellHeader`, `ShellMain $p="1.5rem" $maxWidth="48rem"`                                                                                                                                                                                                                                                                                                 |
| Title block     | `Heading className="mt-0 mb-0 text-lg"` with the number in mono (`ak-ink-60`). Meta line: avatar `Frame`, login, branch and base in mono. A `Button $size="sm" $border` link `GitHub` with an external slot                                                                                                                                                       |
| Commit folder   | `Tabs $rounded="2xl" $p={1}` with `defaultSelectedId` on the head commit. `TabList aria-label="Commits"`; one `Tab` (folder kind) for each entry of `pull.commits`: `TabSlot` with the mark of `commit.latest.state`, `TabLabel` with the short SHA in mono, a `TabSlot $kind="badge"` with `head` on the head commit. `TabGlider` for selected, hover, and focus |
| Panel           | One `TabPanel` for each commit, `grid gap-3 p-3`: the status line (badge, `Attempt 2`, time), the segmented progress bar and its legend, a preview well with four thumbnails, the main action, a dashed `Separator`, and the earlier attempts as rows (`ButtonGroup $layout="vertical"`)                                                                          |
| Main action     | `Button $kind="bevel" $layer="brand"` with `ButtonLabel` and `ButtonSlot $kind="shortcut"`                                                                                                                                                                                                                                                                        |
| Steps (waiting) | `List $gap={2}` with `ListItem checked`, `ListItem progress={0.35}`, `ListItem checked={false}`                                                                                                                                                                                                                                                                   |

```tsx
<Frame
  $darken
  $rounded="full"
  role="img"
  aria-label="5 approved, 2 rejected, 22 need review"
  className="flex h-1.5 w-full overflow-clip"
>
  <Frame $layer="success" style={{ flexGrow: counts.approved }} />
  <Frame $layer="danger" style={{ flexGrow: counts.rejected }} />
  <Frame $layer="warning" $mix={40} style={{ flexGrow: counts.undecided }} />
</Frame>
```

Exact copy: `GitHub`; tab badge `head`; `Attempt 2`; legend `approved`, `rejected`, `need review`; action `Review 22 changes`; earlier rows `Attempt 1` and the state name. Budget: 14 chrome words.

| Scenario                 | What it shows                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempts`               | Two commit tabs. Head tab: attempt 2 (`Rejected`, bar, thumbnails, `Review 22 changes`) and one earlier row (attempt 1, `Failed`, the error). Previous commit tab: `Replaced`, the note `Read-only`, a neutral button `Open run` |
| `single`                 | One tab. Panel: `Passed`, a full success bar, the main action `Back to #4852` (bevel brand, external), a neutral button `Open run`                                                                                               |
| `no-runs`                | No folder. One sheet: a success mark, heading `No visual review needed`, text `No screenshots were captured for this pull request`, button `Back to #4871`                                                                       |
| `loading`                | The number from the URL shows at once (`PR #4863`). A title skeleton, two tab skeletons, a panel skeleton of 240 px                                                                                                              |
| `waiting` (extra)        | One tab with a brand ring. Panel: heading `Waiting for screenshots`, the three steps `Capture`, `Compare`, `Review` with live progress, the note `Opens when ready`. The page opens the review when `reviewRun` appears          |
| `capture-failed` (extra) | Panel: a danger callout with heading `Capture failed`, text `Rerun the visual tests in CI`, button `Open workflow`                                                                                                               |

Interactions and keys: Left and Right move between commit tabs (the tab list owns these keys). Enter activates the main action when no control has focus. A check link of an old attempt selects its commit tab and shows a warning callout: `A newer commit replaced this run` with the link `Open the current run`.

Recommended for the real app: when exactly one run is reviewable, the check link opens the review directly, and this page shows only when there is a choice, a wait, or a failure.

Removed: the single card with "Waiting for screenshots.", the "Check again" button (the page refreshes by itself and says `Opens when ready`), the eyebrow, the second back link, and the dead end of an old check link.

### 4.6 Review workspace

```
1440 × 900, single view (a variant tab is selected)
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ←  PR #4863 Add the combobox select ▾       ↑  Dialog with initial focus  1 / 12  ↓      ◔ 22 left [?] DH │ 49
│ ⌕ Filter 12      / │ ╭───────╮╭───────────╮╭──────────────────────────────────╮╭───────────╮╭───────────╮ │
│ (Changes 9│All 12) │ │ ▦ All 0││✓ Re Ch Lt 1││○ Re Ch Dk  React · Chromium · Dark 2││○ So Ch Lt 3││✕ Re Fx Lt 4│ │ 40
│                    │─╯        ╰───────────╯                                    ╰──────────────────────── │
│ ▌Dialog with in… ✓○○✕○│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│  Combobox with…  ○○○○ │ │ 1280 × 720                                                   0.15%   (i) │ │
│  Actions menu    ○○✓  │ │                                                                          │ │
│  Tabs            ○○–  │ │                                                                          │ │
│  Select          ○○○  │ │               current image at Fit, 1125 × 633                           │ │ 722
│  Tooltip         ○○✓✓ │ │               ┌────┐  area box and mask tint in the secondary color      │ │
│  Toolbar with…   ✓✓   │ │               └────┘                                                     │ │
│  Checkbox group  ○○○○ │ │                                                                          │ │
│  Account form    ○○   │ │                                                                          │ │
│ ▸ Unchanged 3         │ └──────────────────────────────────────────────────────────────────────────┘ │
│ A Approve  X Reject   │ (Overlay│Side by side│Swipe│Blink) ⋯  − Fit +  ‹ Area 1/3 ›    ↶ Undo  ✓ Saved  ✕ Reject X  ✓ Approve A ▾ │ 48
│ ↓ Next     ? Keys     │                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘

The same folder on the cover (the All tab is selected)
│ ╭───────╮╭───────────╮╭───────────╮╭───────────╮╭───────────╮╭───────────╮                          │
│ │ ▦ All 0││✓ Re Ch Lt 1││○ Re Ch Dk 2││○ So Ch Lt 3││✕ Re Fx Lt 4││○ Re Ch Fc 5│                    │
│ ╯        ╰────────────────────────────────────────────────────────────────────────────────────────── │
│ ┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐              │
│ │ 1 REACT · CHROMIUM · LIGHT│ │ 2 REACT · CHROMIUM · DARK │ │ 3 SOLID · CHROMIUM · LIGHT│              │
│ │ ✓                  0.15% │ │ ○                  0.15% │ │ ○                  0.15% │              │
│ │  [crop of the change]    │ │ ▌[crop of the change]  ▐ │ │  [crop of the change]    │   brand ring │
│ └──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘   on cell 2  │
│ ┌──────────────────────────┐ ┌──────────────────────────┐                                           │
│ │ 4 REACT · FIREFOX · LIGHT │ │ 5 REACT · CHROMIUM · FORCED│                                         │
│ │ ✕        Differs   1.20% │ │ ○                  0.15% │                                           │
│ └──────────────────────────┘ └──────────────────────────┘                                           │
│ (Overlay│Blink)  Crop C  ⋯                         ↶ Undo  ✓ Saved   ✕ Reject all 5 ⇧X   ✓ Approve all 5 ⇧A ▾ │

390 × 844
┌──────────────────────────────┐
│ ←  #4863        ◔ 22  [?] DH │ 49
│ ↑ Dialog with ini… 1/12 ↓  ⌄ │ 40  opens the list inline
│ ╭─────╮╭───────────────╮╭────│ 40  tabs scroll
│ │ All ││○ React · Dark ││○ So│
│ ╯     ╰──────────────────────│
│ ┌──────────────────────────┐ │
│ │ 1280 × 720   0.15%   (i) │ │
│ │                          │ │
│ │  one image, Overlay      │ │ 607
│ │  press and hold: baseline│ │
│ │                          │ │
│ └──────────────────────────┘ │
│ (Ov│2up│Sw│Bl) ⋯  Fit   1/3  │ 40
│ ↶     ✕ Reject    ✓ Approve ▾│ 52
└──────────────────────────────┘
```

In the sketches, `Re Ch Lt` stands for the React mark, the Chrome mark, and the sun icon. `Fc` is forced colors.

#### Regions and primitives

| Region          | Primitive                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root            | The fixed app frame recipe: `Shell className="h-dvh text-sm"`. The page never scrolls                                                                                                                                                                                                                                                                                                                                                            |
| Header          | `ShellHeader $height="sm"` with `start`, `center` (`ShellHeaderCenter $shrink`), `end` as in section 3                                                                                                                                                                                                                                                                                                                                           |
| Run crumb       | `PopoverProvider`, `PopoverDisclosure`, `Popover portal`                                                                                                                                                                                                                                                                                                                                                                                         |
| Stepper         | `ButtonGroup $size="sm"` with two icon `Button`s (in `Tooltip`s with `Kbd`) and a `TextFrame`                                                                                                                                                                                                                                                                                                                                                    |
| Progress        | `PopoverDisclosure` with a `ProgressCircular` (20 px box, `value={progress.ratio}`, `fill={{ $layer: "success" }}`) and `ButtonLabel` `22 left`                                                                                                                                                                                                                                                                                                  |
| Screenshot list | `ShellSidebar open={listOpen} $width="md" render={<nav aria-label="Screenshots" />}`. `ShellSidebarHeader`: the filter `InputGroup $size="sm"` and the scope control. `ShellSidebarBody $p={2}`: the `Nav`. `ShellSidebarFooter`: the key legend                                                                                                                                                                                                 |
| Scope control   | `ak.RadioGroup` that renders `ButtonGroup $border $size="sm" $layout="stretch"`, two `ak.Radio`s that render `Button` (`Changes 9`, `All 12`), `ButtonGlider $kind="bevel"`                                                                                                                                                                                                                                                                      |
| List rows       | `Nav render={<div aria-label="Screenshots" />} glider={[{ $state: "hover" }, { $kind: "bar" }, { $state: "focus" }]}`. `NavLink` with `NavLinkLabel` (the name, `$truncate`) and a `NavSlot className="ms-auto"` with the dot strip. With more than 12 visible screenshots, use `NavGroup` and `NavGroupLabel` for each family (the first segment of the key). Unchanged screenshots are in a `NavDisclosure` (`Unchanged 3`) at the end, closed |
| Main            | `ShellMain $p={2} $maxWidth="100%"`, one wrapper in `ShellMainBody` with `flex h-full min-h-0 flex-col`                                                                                                                                                                                                                                                                                                                                          |
| Folder          | `Tabs`, `TabList`, `Tab`, `TabSlot`, `TabLabel`, `TabGlider`, `TabPanels`, `TabPanel single` (code below)                                                                                                                                                                                                                                                                                                                                        |
| Stage           | `Frame $darken={1.5} $rounded="xl"` with `relative min-h-0 flex-1 overflow-clip`. Corner chips are `Badge`s. The info button is an icon `PopoverDisclosure`                                                                                                                                                                                                                                                                                      |
| Cover cell      | A `Button` (`$rounded="lg" $p={1.5}`, column layout) with a micro label, a mark, a ratio, and a crop box (`Frame $darken` with `overflow-clip`). The current variant has `$border={2} $edge="brand" $edgeRaw`                                                                                                                                                                                                                                    |
| Footer band     | A `div` with `flex h-12 items-center gap-2 px-1` and the class `@container`. Labels of the mode buttons hide below 60rem of band width                                                                                                                                                                                                                                                                                                           |
| Mode control    | `ak.RadioGroup` that renders `ButtonGroup $border $size="sm"`, one `ak.Radio` that renders `Button` for each mode (icon slot and label), `ButtonGlider $kind="bevel"`, `ButtonGlider $state="focus"`. Each button is a `TooltipAnchor` with its `Kbd`                                                                                                                                                                                            |
| More menu       | `ak.MenuButton` and `ak.Menu` with the `popover` and `option` recipes                                                                                                                                                                                                                                                                                                                                                                            |
| Zoom            | `ButtonGroup $border $size="sm"`: `−`, a `ComboboxSelect $layer="transparent"` with `Fit`, `50%`, `100%`, `200%`, `400%`, and `+`                                                                                                                                                                                                                                                                                                                |
| Area stepper    | `ButtonGroup $size="sm"` with two icon buttons and a `TextFrame` `Area 1/3`                                                                                                                                                                                                                                                                                                                                                                      |
| Undo            | `Button $size="sm"` with an `Undo2` slot, the label, and a shortcut slot                                                                                                                                                                                                                                                                                                                                                                         |
| Save slot       | `TextFrame role="status"` with a fixed width (`w-28`), a mark, and one or two words                                                                                                                                                                                                                                                                                                                                                              |
| Reject          | `Button $lightnessOffset $text="danger"` with an `X` slot, `ButtonLabel`, and a shortcut slot with `Kbd`                                                                                                                                                                                                                                                                                                                                         |
| Approve         | `ButtonGroup $p="none"` with `Button $kind="bevel" $layer="brand"` (a `Check` slot, the label, a shortcut slot) and an `ak.MenuButton` that renders a second brand `Button` with a chevron (`aria-label="More decisions"`)                                                                                                                                                                                                                       |
| Callouts        | The callout recipe: `Frame $layer={role} $mix={12} $border $edge={role} $rounded="xl" $p={3}`                                                                                                                                                                                                                                                                                                                                                    |
| Shortcuts       | `Dialog className="flex flex-col gap-4 max-w-xl"`, `DialogHeading`, `DialogScroll`, rows from `reviewShortcuts` with `Kbd`, and the toggle recipe for `Keyboard shortcuts`                                                                                                                                                                                                                                                                       |
| Coach           | The brand `Popover` with `PopoverArrow`, anchored to Approve                                                                                                                                                                                                                                                                                                                                                                                     |

Note of round 4: the list rows of the review page have the bar glider only, by audit decision D-PERF-01 ([round-4.md](../round-4.md)). The hover glider and the focus glider of the row "List rows" are not in the lab.

```tsx
<Tabs
  selectedId={view === "all" ? "all" : variant.key}
  setSelectedId={(id) => (id === "all" ? setView("all") : openVariant(String(id)))}
  $rounded="2xl"
  $p={1}
  className="flex min-h-0 flex-1 flex-col"
>
  <TabList aria-label="Variants" $size="sm">
    {item.variants.length > 1 && (
      <Tab id="all">
        <TabSlot>
          <LayoutGrid />
        </TabSlot>
        <TabLabel>All</TabLabel>
        <TabSlot $kind="shortcut">
          <kbd>0</kbd>
        </TabSlot>
      </Tab>
    )}
    {item.variants.map((entry, index) => (
      <Tab key={entry.key} id={entry.key}>
        <TabSlot>
          <StatusMark status={entry.status} />
        </TabSlot>
        <AxisMarks variant={entry} item={item} />
        {view === "single" && entry.key === variant.key && <TabLabel>{entry.name}</TabLabel>}
        {index < 9 && (
          <TabSlot $kind="shortcut">
            <kbd>{index + 1}</kbd>
          </TabSlot>
        )}
      </Tab>
    ))}
    <TabGlider />
    <TabGlider $state="hover" />
    <TabGlider $state="focus" />
  </TabList>
  <TabPanels className="flex min-h-0 flex-1 flex-col">
    <TabPanel single className="flex min-h-0 flex-1 flex-col gap-2">
      {view === "all" ? <Cover /> : <Stage />}
      <FooterBand />
    </TabPanel>
  </TabPanels>
</Tabs>
```

`openVariant(key)` calls `session.selectVariant(key)` and `setView("single")`. Each unselected tab is a `TooltipAnchor`: the tooltip gives the full label, the status name, and the key.

#### Screenshot navigation

- The list is the map. A row is 32 px: the name on one line and the dot strip. The count that rule A08 asks for is in the `sr-only` text and in the tooltip of the row ("2 of 5 need review").
- Default scope `Changes`: screenshots with a changed, added, removed, comparing, or failed variant. Scope `All` adds the unchanged screenshots. Set the scope through the session filters, so that `visibleItems`, `queue`, Up, and Down use the same list. Use `useReviewSession(scenario, { order: "declared" })`.
- Family labels show only with more than 12 visible screenshots. Build the groups by a walk over `visibleItems`: start a new group each time the first key segment changes. This keeps the visual order equal to the key order.
- The header stepper repeats Up and Down for the pointer and names the current screenshot. It is the only item control on a phone, where a tap on the name opens the list inline above the stage (a `Disclosure`, no dialog).
- `L` and a `PanelLeft` button in the list header collapse the list. A run with one visible screenshot (`one-change`) starts with the list collapsed.
- `/` focuses the filter. The filter placeholder carries the count (`Filter 12 screenshots`).

#### Variant switching

- Tabs keep the declared order. Each tab has a verdict mark, the axis marks, and its number (1 to 9). The selected tab also prints the full label (`React · Chromium · Dark`), so the full label is visible at all times in single view.
- Width: about 104 px for an unselected tab and 230 px for the selected tab. Seven variants and the All tab use about 930 px of the 1,147 px strip. With more tabs the strip scrolls and the selected tab scrolls into view.
- The All tab hides when the screenshot has one variant.
- Left and Right move through the variants and stop at each end, in both views. In the cover they move the brand ring.
- `0` opens the cover, and a second `0` returns to the last variant tab. A number key opens that variant in single view. Enter in the cover opens the ringed variant.
- The view (cover or single) stays when the screenshot changes. The first screenshot of a run opens on the cover.

#### The cover

- Cells: one for each variant that takes a verdict or has a problem (changed, added, removed, comparing, failed), in the declared order. Unchanged variants are one chip at the end (`2 unchanged`); a click adds their cells.
- Grid: 2 cells in two columns, 3 in three, 4 as 2 × 2, 5 or 6 as 3 × 2, 7 to 9 as 3 × 3, more as 4 columns with scroll.
- Each cell has a header (number, full label in the micro label style, mark, ratio) and an image box.
- Crop rule: when the union box of the `regions` covers less than 25% of the image, the box shows that union with a 24 px margin, at the largest scale up to 200% that fits. Otherwise it shows the whole image at Fit with area boxes. `C` and the `Crop` button switch between the two.
- Layers in a cell: the current image, the mask tint, and the area boxes. `B` starts Blink in all cells in sync. `G` shows the baseline and `F` the current image in all cells. `H` hides or shows the boxes.
- A changed cell whose ratio is more than two times the median of the screenshot gets a `Badge $layer="secondary"` `Differs`.
- Added cells show the current image and the `Added` badge. Removed cells show the baseline and the `Removed` badge. Comparing cells show a skeleton and a brand ring. Failed cells show a danger tint, `No images`, and the error text.
- Decisions are possible only when the current image and the mask of every cell are decoded. This is stricter than rule A26.
- In the cover the footer promotes the whole screenshot: `Reject all 5` and `Approve all 5` with their `Shift` key caps. `A` and `X` still act on the ringed cell.

#### Compare modes and zoom

| Mode                                   | Key           | What it shows                                                                                                                                                                  |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overlay (default)                      | `O`           | The current image at full stage size, the mask as a tint in the secondary color, and area boxes. `H` turns the boxes off                                                       |
| Side by side                           | `S`           | Baseline and current with corner badges `Baseline` and `Current`, one linked pan and zoom. For an added or removed variant, the absent side is a labeled empty pane (rule A21) |
| Swipe                                  | `W`           | One box, baseline at the start side of a draggable divider and current at the end side. The divider is a native range input over the image                                     |
| Blink                                  | `B`           | One box that swaps baseline and current each 600 ms. A corner badge names the image on screen. A second `B` stops it                                                           |
| Current only, Baseline only, Diff only | `F`, `G`, `D` | In the More menu. `G` then `F` is a manual blink. `D` shows the mask alone on the well and is unavailable when an image is absent (rule A22)                                   |

```tsx
<div className="relative" style={{ width, height }}>
  <img src={variant.candidate.url} width={width} height={height} alt="Current" />
  {variant.diff && (
    <Layer
      $layer="secondary"
      aria-hidden
      className="absolute inset-0 [mask-size:100%_100%]"
      style={{ maskImage: `url("${variant.diff.url}")`, opacity: viewer.overlayOpacity }}
    />
  )}
  {viewer.highlight === "regions" &&
    variant.regions.map((region, index) => (
      <Frame
        key={index}
        $border={2}
        $edge="secondary"
        $edgeRaw
        $rounded="sm"
        aria-hidden
        className="absolute"
        style={toStageRect(region, scale)}
      />
    ))}
</div>
```

- Set the first mode and highlight one time when the session is ready: `session.viewer.setMode("overlay")` and `session.viewer.setHighlight("regions")`.
- An area box is at least 24 screen pixels wide and high, so a 1 px change is visible.
- Zoom: Fit, 50%, 100%, 200%, 400%. Fit scales down to fit and scales up to 200% at most, in the steps 100%, 150%, 200%; above 100% use `[image-rendering:pixelated]`. `+` and `−` step, `Z` switches between Fit and 100%, and a double click does the same at the pointer.
- One transform for all panes. Drag pans. `Shift` with an arrow key pans by half a stage. Plain arrows never pan (decision U04 stays).
- Tall images (taller than 1.5 stages at fit width): Fit means fit width, the stage scrolls, and a 48 px minimap at the end edge shows the whole image, the view box, and one secondary mark for each area.
- `R` and `Shift+R` go to the next and the previous area and center it. The stepper shows `Area 1/3`.
- A size change (the mask marks every pixel): the stage starts in Side by side, top aligned, with a warning badge `Size changed · 640 × 400 → 640 × 422`, a hatched band on the extra area, and no mask tint.
- At Fit, a press and hold on the image shows the baseline until release (pointer and touch). When zoomed, the same gesture pans.
- The More menu also has `Stage background` with `Auto`, `Light`, `Dark`, and `Checker`. Derive each from the layer colors.
- Corner chips on the stage: the size in mono at the top start, the ratio in a secondary tint and the info button at the top end.

#### Decision flow

1. `A` or the Approve button calls `session.approve()`. The mark on the tab stamps at once. The selection moves to the next variant in `queue` that needs review, inside the screenshot first, then in the next screenshot. The folder glider, the list glider, and the header name move with it.
2. `X` or the Reject button does the same with `session.reject()`.
3. `Shift+A` and `Shift+X`, the two menu items of the split button, and the two cover buttons call `approveItem()` and `rejectItem()`. The label always names the count (`Approve all 5`). There is no dialog on any path. The stamps run from left to right.
4. Save state, in the fixed slot beside Undo: a spinner and `Saving 2` (sending), a `Cloud` mark and `Queued` (admitted by the server; the lab hook has no such state, so show it when the app provides it), a check and `Saved` for 1.6 s, then empty. The three states keep different marks (invariant I4).
5. Undo: the button or `Cmd/Ctrl+Z` calls `session.undo()` and restores the verdicts, the selection, and the view. The button is disabled while `can.undo` is false.
6. A failed save: the footer band takes a danger tint, the left group hides, and the band shows `Not saved · 2 decisions`, `Retry` (bevel brand), and `Discard`. The marks return to their earlier state. New decisions wait.
7. A refused decision: the save slot shows a warning mark and the reason from `session.announcement`, with a `Next` button (`nextUndecided()`).
8. Images not ready: Approve and Reject are disabled, the Approve slot shows a small `ProgressCircular`, and the tooltip says `Images are loading`. A key press in this state does nothing and the save slot shows `Loading images`.
9. Coach: on the first visit a brand popover on Approve says `Review with the keyboard` and lists `A`, `X`, `↓`, and `?` with `Kbd`, with the button `Got it`. Store the dismissal.

#### Progress

- One ring in the header for the run: `progress.ratio` in success, and the text `22 left`. A danger dot on the ring shows when `progress.rejected` is above 0.
- The popover of the ring gives the breakdown and teaches the marks: the segmented bar, then `5 approved`, `2 rejected`, `22 need review`, `6 auto-approved`, `7 unchanged`, each with its mark.
- The dot strip of each list row is the progress of a screenshot. The tab marks are the progress of the variants. No other count exists on the page.

#### Details

`I` or the info button on the stage opens a popover with a two-column grid: `Size` (baseline to current), `Changed` (pixels and ratio), `Threshold`, `Engine`, `Decided by` (reviewer and time), and one button `Copy debug info` (ids and digests as text). Six labels, no prose. Run facts are in the run crumb, not here.

#### Completed state

When `session.complete` becomes true, the selection stays (rule K9). The ring is full with a check. The footer band takes a success tint and replaces the decision buttons: a check, `Review complete`, the counts (`27 approved`), the check line (`Updating the GitHub check`, then `Check is green on GitHub`, or `GitHub did not take the update` with a link to Status), and two buttons: `Open #4863` (neutral, external) and `Next run` (bevel brand, Enter) or `Inbox` when no run is left. The left group of the band (modes and zoom) stays, so the reviewer can still inspect.

#### Scenarios

| Scenario          | What it shows                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes`         | The cover of the first screenshot. The list has the screenshots with changes and `Unchanged` closed. Ring `22 left`                                                                                                                                                                                     |
| `large`           | Family labels in the list (`DIALOG`, `COMBOBOX`), `Unchanged` closed with its count, ring `79 left`. The list virtualizes or shows 50 rows for each group with a `Show more` row                                                                                                                        |
| `one-change`      | The list is collapsed. The folder has one tab and no All tab. The stage is 78% of the viewport. The coach popover is open                                                                                                                                                                               |
| `passed`          | All marks are checks, the ring is full, and the footer shows the completion band with `Open #4863` and `Next run`                                                                                                                                                                                       |
| `read-only`       | The decision buttons are absent. The end side of the footer is a warning callout line: `Read-only`, the `readOnlyReason`, and the link `Open current run`. Marks and tabs stay                                                                                                                          |
| `comparing`       | Comparing variants have a brand ring on tab and cell and a skeleton image. The end side of the footer shows a `Progress` with `Comparing 6 of 16` and `Review opens when done`. The header ring has no value                                                                                            |
| `problems`        | A danger callout line in the footer: `Run failed`, the `run.error`, and `Open workflow`. Failed variants have the danger mark. The variant with the broken image shows a centered callout in the stage: `Image did not load` and `Retry`. A failed image is never shown as added, removed, or unchanged |
| `loading`         | The workspace skeleton of section 5: header, eight list row skeletons, four tab skeletons, the stage with a thin `Progress` at its top edge, and the footer with disabled real controls                                                                                                                 |
| `expired` (extra) | The stage shows a neutral callout: `Images expired` and one line of the summary. No decision buttons                                                                                                                                                                                                    |

#### Keys

| Key                   | Action                                                                           | In the app today                |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| Up, Down, `K`, `J`    | Previous or next screenshot in the list; stop at each end                        | Arrows yes                      |
| Left, Right           | Previous or next variant; stop at each end                                       | Yes                             |
| `1` to `9`            | The variant at that position, in single view                                     | `1` to `6`                      |
| `0`                   | The cover; again to return                                                       | No                              |
| Enter                 | In the cover: open the ringed variant                                            | No                              |
| `A`, `X`              | Approve or reject the current variant, then go to the next one that needs review | Yes                             |
| `Shift+A`, `Shift+X`  | Approve or reject all variants of the screenshot                                 | Yes                             |
| `N`, `Shift+N`        | Next or previous variant that needs review                                       | No                              |
| `O`, `S`, `W`, `B`    | Overlay, Side by side, Swipe, Blink                                              | `S` only                        |
| `F`, `G`, `D`         | Current only, Baseline only, Diff only                                           | Yes                             |
| `H`, `C`              | Area boxes on or off; crop on or off in the cover                                | No                              |
| `R`, `Shift+R`        | Next or previous area                                                            | No                              |
| `+`, `-`, `Z`         | Zoom in, zoom out, Fit or 100%                                                   | No                              |
| `Shift` with an arrow | Pan all panes                                                                    | No                              |
| `L`, `I`, `/`, `?`    | List on or off, details, filter field, shortcuts                                 | No (`[` toggles the list today) |
| `Cmd/Ctrl+Z`          | Undo                                                                             | Yes                             |
| Escape                | Close a popover, a menu, or a dialog. It never rejects                           | Yes                             |

Not bound: `[` and `]` (the lab uses them), Space, `Cmd/Ctrl+K`, and `U`. Pass the added and changed keys through the `keys` option of `useReviewShortcuts`: `0`, the digits (they must also set the view), `z`, `r`, `c`, `l`, `i`, `/`, `?`, `enter`, the arrow keys with `event.shiftKey` for pan, and `u` as a no-op.

Where a person finds the keys: the key cap on each button, the number on each tab, the tooltip of each icon button, the four-key legend in the list footer, the coach popover, and the `?` dialog. The dialog has the switch `Keyboard shortcuts`; store it. With the switch off, key caps and the legend hide.

#### Exact copy and word budget

Header: tooltip `Inbox`; `22 left`. List: `Filter 12 screenshots`, `Changes`, `All`, `Unchanged`; legend `Approve`, `Reject`, `Next`, `Keys`. Folder: `All`. Footer: `Overlay`, `Side by side`, `Swipe`, `Blink`, `Fit`, `Area`, `Undo`, `Saved`, `Reject`, `Approve`. Cover: `Crop`, `Reject all 5`, `Approve all 5`, `Differs`, `2 unchanged`. Budget: 26 chrome words in single view and 30 in the cover. The status of the run shows one time (the ring), where the audit counted 6 to 11 places.

#### Pixel budget at 1440 × 900 (14 px base)

| Measure                                               | Value                                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Chrome above the first screenshot pixel               | 115 px: header 49, gutter 7, folder edge and padding 5, tab strip 36, panel padding 7, well padding 11 (408 px today) |
| Chrome below the stage                                | 75 px: gap 8, footer band 48, paddings and gutter 19                                                                  |
| Stage well                                            | x 275 to 1422, y 104 to 826: 1,147 × 722 px, 64% of the viewport. 78% with the list collapsed                         |
| 1280 × 720 capture in Overlay, Swipe, or Blink at Fit | 1,125 × 633 px, 55% of the viewport (13 to 30% today). 67% with the list collapsed                                    |
| The same capture in Side by side at Fit               | Two panes of 558 × 314 px, 27%. 41% with the list collapsed                                                           |
| 640 × 400 capture in Overlay at Fit                   | 150%: 960 × 600 px, 44%                                                                                               |
| Phone, 390 × 844                                      | First pixel at y 141. Stage 382 × 607 px, 70% of the viewport                                                         |

Build check: the stage must take all the remaining height (`min-h-0 flex-1`) and the document must never scroll.

#### Removed, compared with the current workspace

The app navigation row on run pages; the identity strip (commit, attempt, baseline revision), now in the run crumb; the item heading row with its badge and its "0.05% changed · 120 changed pixels" line, now two corner chips; the text "9 of 11 need review" and its bar; the dimensions and the raw key in each variant chip; the mode and zoom toolbar row and the caption row above each pane; the eight pan buttons; the `Accepted (N)` group (approved screenshots stay in place and unchanged ones are under `Unchanged`); the "All 7 changed views…" menu and its dialog; the page footer with "Shortcuts on", "Keyboard help", and the retired "Recompare stored run" control; the list header "SCREENSHOTS · 4 items".

## 5. Loading

Rules for all pages. The header shows at 0 ms with real navigation. A skeleton has the exact size of the content that replaces it. No centered spinner and no sentence before 5 s. Never the words "Checking access". Images get a box of their known size at once and fade in over 80 ms when decoded.

| Page         | 0 ms                                                                                                                                                                                                                                                        | 300 ms                                                                                                                                  | 1 s                                                                                                                                           | 5 s                                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in      | The full card. It needs no data                                                                                                                                                                                                                             | The same                                                                                                                                | The same                                                                                                                                      | The same. After a click, the button shows its spinner until the browser leaves                                                                                                                                                                                               |
| Inbox        | Header, toolbar (disabled), hero skeleton, three card skeletons, two row skeletons                                                                                                                                                                          | Titles, counts, marks, and times. Preview boxes are skeletons                                                                           | Thumbnails are in. The page is complete                                                                                                       | If no data: the refresh icon is a spinner and a line under the toolbar says `Still loading runs`. History and Status links work                                                                                                                                              |
| History      | Header, a usable search field, the table frame with ten row skeletons                                                                                                                                                                                       | Rows, day labels, counts in the result select                                                                                           | Complete                                                                                                                                      | The foot line says `Still loading runs`                                                                                                                                                                                                                                      |
| Status       | Header with the last known alert count, a neutral card skeleton, two empty meter tracks                                                                                                                                                                     | The health card with its color, the rows, the meters                                                                                    | Complete                                                                                                                                      | The card says `Still checking`; data of an earlier check stays with its time                                                                                                                                                                                                 |
| Pull request | Header, `PR #4863` from the URL, a title skeleton, two tab skeletons, a panel skeleton                                                                                                                                                                      | Title, tabs, state, the bar, the main action (enabled)                                                                                  | Thumbnails are in                                                                                                                             | A line under the title says `Still loading`. The `GitHub` button works from 0 ms                                                                                                                                                                                             |
| Review       | The whole workspace frame: header (with the run number and title if the person came from a list), eight list row skeletons, four tab skeletons, the stage well with an indeterminate `Progress` at its top edge, and the footer with disabled real controls | List rows with dot strips, tabs with marks, the ring, and the image boxes at their real size as skeletons. Decisions are still disabled | The first images are decoded: the cover cells or the stage image fade in, and Approve and Reject become enabled. The next screenshot preloads | If the list is not here: the filter placeholder says `Loading screenshots` and the stage shows one quiet line, `Still loading this run`. If the list is here but an image is slow: the box keeps its skeleton, and after 2 s a line under it says `Loading image 1280 × 720` |

After the first load, a refresh never blanks a page: the content stays and the refresh control shows the activity.

## 6. Kit of this direction

| Part                                  | Recipe                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StatusMark`, dot strip, status badge | Section 2.6                                                                                                                                         |
| `AxisMarks`                           | Slots with the framework mark, the browser mark, and the scheme, contrast, and forced colors icons; only the axes that differ inside the screenshot |
| Sheet, well, tint callout             | Section 2.1                                                                                                                                         |
| Preview well                          | A recessed frame with up to four 16:9 thumbnails that are links                                                                                     |
| Segmented progress bar                | Three `Frame`s in a recessed full-round `Frame` (section 4.5)                                                                                       |
| Card link                             | A `Button` in a column layout that renders the link (section 4.2)                                                                                   |
| Key legend                            | The keyboard hint recipe with `Kbd`                                                                                                                 |
| More info button                      | An `Info` icon `PopoverDisclosure`, as in the Ariakit sandbox boxes                                                                                 |
| Empty state                           | The dashed frame recipe with a tint mark, a heading, one line, one button                                                                           |
| Skeleton                              | `Frame $lightnessOffset={2}` with `animate-pulse motion-reduce:animate-none`                                                                        |
| Folder                                | `Tabs` with folder `Tab`s and three `TabGlider`s (variants in the review, commits on the pull page)                                                 |
| Segmented control                     | A radio group that renders a bordered `ButtonGroup` with a bevel glider                                                                             |
| Split brand button                    | A `ButtonGroup $p="none"` with a bevel brand `Button` and a menu button                                                                             |
| Shortcuts dialog                      | A `Dialog` with rows from `reviewShortcuts` and the switch                                                                                          |

## 7. Risks, tradeoffs, and earlier decisions that this direction revisits

Earlier maintainer decisions and binding rules:

| Rule or decision                                                                                                                                   | What this direction does                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `contract:192` and U03: variant links with a bar glider (tabs were replaced because a route change through `setSelectedId` breaks modified clicks) | Folder tabs for variants. Mitigation: each `Tab` renders a link, and the selection comes from the URL                            |
| K3: the first visit opens the first variant                                                                                                        | The first visit opens the cover                                                                                                  |
| K6: keys `1` to `6`                                                                                                                                | Keys `1` to `9`, and `0` for the cover                                                                                           |
| A16: the pixel diff is red                                                                                                                         | The diff uses the secondary color. Red means rejected or failed only                                                             |
| P02: load the diff when selected (`eager` was rejected)                                                                                            | Overlay is the default, so the mask loads with the image                                                                         |
| U02: Approve, Reject, save state, and Undo in the main header                                                                                      | They are in the footer band of the folder                                                                                        |
| U04: page-wide arrows with pan buttons                                                                                                             | Arrows stay page-wide. Pan moves to drag and `Shift` with an arrow, and the pan buttons go                                       |
| D17: compact, mostly flat controls (`comfortable` with bevels was rejected)                                                                        | One bevel for the main action and bevel gliders in segmented controls; radius and depth are larger than today                    |
| D02 and D21: a decision is for one variant; whole-item actions are separate                                                                        | The scope stays variant or screenshot. The cover makes the whole-screenshot action the main button, with every variant on screen |
| Tests pin a confirmation dialog on the whole-item button                                                                                           | No dialog on any path. Undo and the count in the label replace it                                                                |
| A07: full variant label                                                                                                                            | Full label on the selected tab, in cover cells, and in tooltips. Other tabs are icon-only                                        |
| A08 and A09: counts and text with color                                                                                                            | Marks have shapes and names for assistive technology. The visible count of a row is in its tooltip                               |
| A06: commit and run identity above the images                                                                                                      | The header shows the number and the title. Commit, attempt, and baseline are in the run crumb popover                            |
| A11: thumbnail of the first declared candidate variant                                                                                             | The list has no thumbnails. Inbox thumbnails come from `previews`                                                                |
| `contract:194`: accepted items stay under `Accepted`                                                                                               | Approved screenshots stay in place. Only unchanged ones go under `Unchanged`                                                     |
| D29: declared order                                                                                                                                | Kept. Family labels follow the declared order                                                                                    |
| A27 and D53: narrow layout with the list above the viewer; Chrome Desktop only                                                                     | A phone layout with an inline list row above the stage and one image                                                             |
| `feedback-ui.md:96`: do not add a hotkey registry                                                                                                  | The shortcuts dialog renders from `reviewShortcuts`, which is a list of keys                                                     |
| X4: a visible shortcut toggle                                                                                                                      | The switch is inside the `?` dialog and is stored                                                                                |

Other risks:

- Cost of the cover: the current image and the mask of each reviewable variant load for each screenshot (up to 14 requests for 7 variants). It needs preload of the next screenshot, a cache rule, and baselines that load on the first Blink. Service thumbnails are 256 px at most and are probably absent on current runs, so the cover uses full images.
- Crops and area boxes need `regions`. The server can add them, or the client can compute them from the mask on a canvas. Without them the cover shows whole images.
- Icon-only tabs have a learning cost, and the contrast and forced colors icons are not well known. The tooltips and the cover labels carry the words.
- A folder tab strip with more than nine variants scrolls, and the numbers stop at 9.
- The solid brand hero and the brand sign-in card are loud for a tool that a person uses daily. A fallback is a 15% brand tint with a brand edge.
- On the light canvas a raised sheet has almost the canvas color. Each sheet needs its ring and `shadow-sm`. Check every page with `?theme=light`.
- Gliders need CSS anchor positioning. A selected folder tab still paints itself without it, but the travel is lost.
- Status marks on the brand layer can fail contrast. Use the inherited ink there.
- The `Queued` save state has no value in the lab hook. The band reserves its place.
- The tab list must hold only tabs. All other controls stay in the footer band, which costs one 48 px row.

## 8. Fields that are not in the API today

- Run: `previews`, `counts`, `progress`, `author`, `branch`, `commitMessage`, `error`, `mergeGroupPullRequests`, `updatedAt`.
- Baseline: `updatedAt`, `testedSha`, `screenshots`.
- Pull request: `title`, `author`, `branch`, `baseBranch`, `state`, `headSha`, `runs`.
- Service alert: `severity`, `impact`, `occurrences`.
- Review: `pullRequest`, `counts`, `progress`, `supersededBy`, `regions`, `reviewerLogin`, `decidedAt`.
- Session behavior that the app does not have: the kind filter behind the `Changes` scope, the viewer modes Overlay, Swipe, and Blink, the zooms 50% and 400%, the highlight, the area stepper, `J` and `K`, `N`, and Undo while a save runs.
- User: `avatarUrl`. Sign-in: a target (run or pull request number) for the heading.

Process note: the Ariakit skill preflight ran for this repository (`ariakit-general-workflow`, `ariakit-general-markdown`). No repository-specific workflow skill exists for `ariakit/visonaut`. This task edited no file.
