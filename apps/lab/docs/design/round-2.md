# Design lab, round 2: the plan

Round 2 is one design, "Ariakit folio", in six pages. This plan says what each page becomes, where each of the 19 picked component variants goes, which conflicts exist and how each one ends, how the lab shows it, and how the build splits into packages.

> **Record note.** This file is the reviewed plan of round 2 as the builders got it, kept as a record. The lab is built from it. The maintainer answered its five open choices with the recommended option of each, and the options that were not picked left the lab: see [round-3.md](./round-3.md). So the words "open" and "recommended" in this file describe round 2, not the lab of today. Sections 1 to 9 and "Review changes" are the plan, word for word, with one exception: a later sentence in section 1 (the row "Scope of a decision"), in section 9, and in item 15 of "Review changes" says that the maintainer settled D-WORK-04 and D-RES-05 in revision r3 of the audit document. The revision of the audit document is not the revision of the lab record in `src/lab/record.ts`. Two sections at the end are not part of the plan: [Amendments of the coordinator](#amendments-of-the-coordinator), which win where they differ from the plan, and [As built](#as-built), which lists where the lab differs from both. A path that starts with `/Users/` names a scratch file of the build session, not a file of the repository.

Input: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/lab2/feedback.md`. All repository paths below start at `apps/lab/` unless they say otherwise. Skills loaded for this repository (`github.com/ariakit/visonaut`): `ariakit-general-workflow`, `ariakit-general-code-style`. Nothing in the repository was changed to write this plan. The browser checks ran against `http://127.0.0.1:4320` with DOM changes in the page only. Their pictures are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/lab2/shots/` (`exp-*.png` and `cmp-*.png`).

- [1. Rules that bind every page](#1-rules-that-bind-every-page)
- [2. The notes of the maintainer](#2-the-notes-of-the-maintainer)
- [3. The six pages](#3-the-six-pages)
- [4. Composition: the 19 picked variants](#4-composition-the-19-picked-variants)
- [5. Conflicts](#5-conflicts)
- [6. Data: what each pick needs](#6-data-what-each-pick-needs)
- [7. Structure of the lab in round 2](#7-structure-of-the-lab-in-round-2)
- [8. Build packages](#8-build-packages)
- [9. Limits of this plan](#9-limits-of-this-plan)
- [Review changes](#review-changes)
- [Amendments of the coordinator](#amendments-of-the-coordinator)
- [As built](#as-built)

Open after the review: 3 new choices (`stage-bar`, `variant-nav`, `hero-layer`) and 2 questions to the maintainer (`pull-scope`, `row-picture`), shown as 5 surfaces. 15 conflicts are settled in the pages.

## 1. Rules that bind every page

These come from the answers of the audit document and from the standing rules. A builder applies them without a new decision.

| Rule                              | Source                                                | What it means in the lab                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stock primitives, stock look      | Standing rule, D-UI-02                                | No custom paint. Layout classes only. No edit in `src/components/ariakit`.                                                                                                                                                                                                                                                                                                   |
| One base size, stock sizes        | D-UI-03 `stock-sizes-one-base`                        | `text-sm` on each page root, `$size` steps on controls, stock Tailwind text sizes. No `text-[…em]` in new code.                                                                                                                                                                                                                                                              |
| Brand main action, tinted banners | D-UI-04 `brand-and-tint`                              | One `Button $kind="bevel" $layer="brand"` for each view. A banner is `Frame $layer={role} $mix={15}` (the kit `Callout` has 12 today: change it to 15).                                                                                                                                                                                                                      |
| Words                             | D-UX-03 `short-eight`                                 | Pages: **Queue**, History, Status. Things: run, screenshot, variant, change. States: Needs review, Rejected, Passed, Capturing, Comparing, Rerun needed, Replaced, Failed.                                                                                                                                                                                                   |
| Keys of today                     | D-WORK-03 `keep-keys`                                 | The review page binds only: Up, Down, Left, Right, `1` to `6`, `A`, `X`, `Shift+A`, `Shift+X`, `S`, `D`, `F`, `G`, `Cmd/Ctrl+Z`, `[`. Plus `W` and `O` from D-WORK-02. The list pages bind no key. The exact `keys` map for `useReviewShortcuts` is in conflict `keys` (5.15): the built-in `S`, `D`, `F`, `G` of the hook must be replaced, or `D` opens the old diff mode. |
| One stage, mask on at load        | D-WORK-02 `one-stage-mask-at-load` with its note      | The first view is one stage with the current image and the mask on. `F` current, `G` baseline in the same place, `D` mask off and on, `S` two panes, `W` swipe, `O` overlay. No blink mode, no held key, no timer.                                                                                                                                                           |
| Scope of a decision               | D-WORK-04 with its note                               | Variant and whole screenshot, and one menu item with no key: `Approve the run…`. The maintainer settled D-WORK-04 as `approve-run` in revision r3 of the audit document: a confirmation that names the count.                                                                                                                                                                |
| End of a review                   | D-WORK-05 `result-page`                               | A run with nothing to review, and the page after the last decision, show a short result page in the place of the stage, with Undo.                                                                                                                                                                                                                                           |
| No dialog for a whole screenshot  | D-WORK-06 `undo-on-both-paths`                        | `Shift+A` and the menu item save at once. The answer asks for two visible things after it: the number of variants and Undo. The bar shows both (conflict `item-receipt`, 5.20).                                                                                                                                                                                              |
| Save words                        | D-RES-02 `no-promise`                                 | The state of a decision is `Saving…` until the receipt is final, then `Saved`. No `Queued`, no `safe to close`. On screen it is the ring in the pressed button (the pick). The word `Saving…` is the tooltip of that button and the text of the live region. The pill does not fade while a decision saves.                                                                  |
| First data                        | D-LOAD-04 `server-loader`, D-LOAD-05 `loader-default` | The document streams the page chrome first and the list after it, so the `loading` scenario of each page is the first load only: the real header, then skeleton blocks (pick `Destination skeleton`). A return to a list page shows the last list at once, with no skeleton. The lab shows the first load.                                                                   |
| An open run page                  | D-RES-03 `on-return`                                  | The page learns about a newer run when the tab returns. In the lab this is the `read-only` scenario: the bar is the message. No poll indicator on the page.                                                                                                                                                                                                                  |
| Fresh lists                       | D-UX-05 `focus-and-interval`                          | No Refresh button. A failed refresh keeps the list and shows its age in a band.                                                                                                                                                                                                                                                                                              |
| Routes                            | D-UX-02 `real-routes`                                 | A screenshot and a variant are a place in the URL. The pull request page waits for the newest run (see conflict `pull-scope`).                                                                                                                                                                                                                                               |
| Data                              | D-UX-04 `fields-with-a-source`                        | The settled design must look right with the fields that the service holds. The lab gets a third data mode for that (section 6).                                                                                                                                                                                                                                              |
| Browser                           | D-RES-04 `keep-scope`                                 | The design target is Chrome Desktop at 1280 and 1440 px. A narrow window must not break (no horizontal scroll, every control reachable), but it gets no design work.                                                                                                                                                                                                         |

## 2. The notes of the maintainer

Each note is a decision. The table gives the exact change and how it was checked.

| #   | Note                                                                                                                                                                           | Change: primitive, prop, value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Sign-in: "the card … should be `$lighten`"                                                                                                                                     | `GuestCard` becomes the kit `Sheet` with `$p="1.5rem"`: `Frame $lighten $border $rounded="2xl"`, and the class `ak-light:shadow-sm` that the kit cards have. The card is then neutral, so the one brand surface of the page moves to the button: `Button $kind="bevel" $layer="brand" $rounded="lg" $p={3}` in place of `Button $invert` (D-UI-04).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Browser, classes swapped on the live card (`shots/exp-signin-lighten.png`). Dark: card `oklch(0.213 0.009 264)` on canvas `oklch(0.163 0.009 264)`. Light: card `oklch(1 0.001 197)` on canvas `oklch(0.993 0.001 197)`, so the border and the shadow are necessary there.                                                                                                                                                                                                   |
| N2  | Sign-in: "the shortcut should not use `<Kbd>` styles … a shortcut slot that's just the shortcut dimmed"                                                                        | The slot exists: `ButtonSlot $kind="shortcut"` (`styles/control.ts`, variant `$kind.shortcut`). Its default `$ink` is 60, and a plain `<kbd>` inside it is soft text (`docs/primitives.md`, section Kbd). Change the kit `ShortcutSlot` (`kits/ariakit/keys.tsx`): render `<kbd>{keys.join("")}</kbd>` in place of one `Kbd` for each key, and remove `$ink={80}`. The same for `InputSlot $kind="shortcut"` and the menu rows (`OptionSlot $kind="shortcut"`). It applies to every control of the six pages, because `ShortcutSlot` is the one kit part. `Kbd` stays only in a tooltip and in the Keys list, as the stock recipes have it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Code (`styles/control.ts:229-296`), and the pictures of the picked variants that already use it (`shots/cmp-viewer-toolbar.png`: `Reject X`, `Approve A`).                                                                                                                                                                                                                                                                                                                   |
| N3  | Inbox: "too dense"                                                                                                                                                             | See the Queue page in section 3 and the conflict `queue-density`. In short: no toolbar, no preview strips, no cards, no key legend, one column of 56rem, one row design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Reasoned from `shots/exp-hero-lighten.png` (16 thumbnails, 3 row designs, 30 chrome words today).                                                                                                                                                                                                                                                                                                                                                                            |
| N4  | Inbox: "I don't like the layer in solid brand color. `$lighten` or maybe brand with `$mix`"                                                                                    | Two possibilities, so it is a choice: `UI-HERO-LAYER`. `lighten`: `Frame $lighten $border $rounded="2xl" $p="1.5rem"`. `brand-mix`: `Frame $layer="brand" $mix={15} $border $rounded="2xl" $p="1.5rem"`. In both, the action is `Button $kind="bevel" $layer="brand"` (it is `$invert` today), and the status mark loses `plain`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Browser (`shots/exp-hero-lighten.png`, `exp-hero-lighten-light.png`, `exp-hero-brand-mix15.png`, `exp-hero-brand-mix15-light.png`). `$lighten` gives exactly the surface of every other sheet (dark `oklch(0.213 0.009 264)`), and in light it is `oklch(1 …)` on a canvas of `oklch(0.993 …)`. Brand at 15% gives a navy tint in dark (`oklch(0.224 0.031 252)`) and a pale blue in light (`oklch(0.929 0.024 247)`). The solid layer of today is `oklch(0.515 0.155 249)`. |
| N5  | Inbox: "The top navigation bar glider is too close to the nav link … It should be connected to the header edge. I think the glider has an option for that."                    | The option is `$barOffset="frame"` of the glider (`styles/glider.ts`, variant `$barOffset`: "`frame` aligns the bar to the group's edge"). The kit already passes it: `glider={[{ $state: "hover" }, { $kind: "bar", $side: "end", $barOffset: "frame" }]}`. The bar is still at the link, because the frame of the `Nav` is only as tall as its links (34 px in a 49 px header). The fix is to make the nav as tall as the header. In `FolioShell`: `center={<ShellHeaderCenter className="self-stretch"><MainNav … /></ShellHeaderCenter>}` (a part element is the part itself, see `renderBarPart`), `Nav className="h-full"`, and `className="self-center"` on each `NavLink` (the `ul` and the `li` of a nav are `display: contents`, so each link is a flex item of the nav). No glider prop changes. Do not use `$barOffset` with a length to push the bar down: the distance then depends on the header height.                                                                                                                                                                                                                         | Browser, two times (planner: `shots/exp-header-glider-stretch.png`; reviewer: `shots/rev-header-glider.png`, with inline styles `align-self: stretch` on the center part, `height: 100%` on the nav, `align-self: center` on the links). Before: nav y 7.5 to 41.5, bar y 39.8 to 41.5, header bottom 49. After: nav y 0 to 49, bar y 47.3 to 49.0, link y 7.5 to 41.5 (it does not move).                                                                                   |
| N6  | Review: "The bar glider on the sidebar must be connected to the right edge of the sidebar (connected to the main panel edges). I think the bar glider has an option for this." | The options are `$side="end"` and `$barOffset="frame"` of `NavGlider` (`styles/nav.ts`, classes `glider-bar-frame` and `glider-bar-end`: `inset-e-0` of the nav). Change the gliders of the list to `[{ $state: "hover" }, { $kind: "bar", $side: "end", $barOffset: "frame" }, { $state: "focus" }]`. In `styles/nav.ts` the pair gives `inset-e-0` of the nav (`glider-bar-frame.glider-bar-end`); `$barOffset="frame"` alone gives the start edge. Two layout changes make "the edge of the nav" equal "the edge of the main panel": (1) the scroll box of the list has no end padding and the `Nav` takes it (`pe-2` on the `Nav`, `ps-2 pe-0` on the scroll box), and (2) the gutter between the sidebar and the main panel goes, and only that one: `ShellMain $p="none"`, and the `div` around the panel (today `flex h-full min-h-0 flex-col gap-2` in `workspace.tsx`) gets `pt-2 pe-2 pb-2`. The panel keeps its gutter to the header, to the window end, and to the window bottom, and its four round corners, as in the page that the maintainer picked. The note asks for the connection, not for a panel that touches the window. | Browser (reviewer: `shots/rev-sidebar-glider.png`). Before: bar x 5.3 to 7.0 (start side), panel x 263 to 1433, y 56 to 893. After: bar x 254.3 to 256.0, sidebar ends at 256, panel x 256 to 1433, y 56 to 893.                                                                                                                                                                                                                                                             |
| N7  | Variant switcher: "As long as the icon in the icon list is also clickable (a router link)."                                                                                    | Each mark of the pager row is a link to its variant: `ButtonGroup $size="sm" $p="none" $gap="xs"` with one `Button render={<PlaceLink … />}` for each variant (one `ButtonSlot` with the mark, `aria-label` with the name and the state, `aria-current` on the selected one), and `ButtonGlider`, `ButtonGlider $state="hover"`, `ButtonGlider $state="focus"`. The ring of today (`Frame $borderType="ring"`, not a control) goes: the stock selected glider marks the selected mark (a lifted disc with a ring; `aria-current` is a selected state for `ui-selected`). With more than 12 variants the pick shows counted marks (`○5 =19`): each counted mark is then a `PlaceLink` to the next variant with that state after the selected one, with the name `Next that needs review` in its tooltip, so that every icon of the list is a link. `PlaceLink` is a new kit part: a router link to a screenshot and a variant (section 7.5).                                                                                                                                                                                                     | Code (`components/variant-switcher/stepper.tsx`, `Pager`; `styles/control.ts` for `$gap="xs"`; `styles/ui.css:1184` for `ui-selected`). The glider with links is the stock pattern of `docs/primitives.md` ("Project" example).                                                                                                                                                                                                                                              |
| N8  | Compare stage: "Diff first, but remember user selection between items, variants, and even runs (probably local storage)"                                                       | A new kit store `useStoredView()` (`kits/ariakit/view-store.ts`) keeps `{ mode, mask }` in local storage under `visonaut-lab:review-view`, with `useSyncExternalStore` and a server snapshot of `{ mode: "new", mask: true }`. The page reads it at each run and writes it at each change. A variant that cannot show the stored mode (a new screenshot has no baseline) shows the current image for that variant only: the stored value does not change. The note wins over the default of D-WORK-02: "current image, mask on" is the view of a browser with no stored value, and after the first change the stored view opens first, also in the next run, also when it is two panes or a mask that is off. The catalog text of the review page says this in one tradeoff line. The zoom is not stored: it stays between variants and screenshots of one run, as the app does today, and a new run opens at Fit. The lab menu of the bar gets `Reset the stored view`, so a reviewer of the lab can see the first view again.                                                                                                                 | Not built. The pattern exists in `kits/ariakit/keys.tsx` (`ShortcutsProvider`).                                                                                                                                                                                                                                                                                                                                                                                              |

## 3. The six pages

Each page shows the recommended option of each open choice. The drawings are at 1440 px. Word counts are chrome words.

### 3.1 Sign in

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                                 ◉ visonaut                                   │
│                    ╭ sheet (lighten, border) ──────────────╮                 │
│                    │ Sign in to review                     │                 │
│                    │ ariakit/ariakit            (improved) │                 │
│                    │ [ → Sign in with GitHub            ↵ ]│  brand bevel    │
│                    │ Needs write access                    │                 │
│                    ╰───────────────────────────────────────╯                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

Changes against round 1:

- N1 and N2. The `↵` is dimmed text in the shortcut slot. Enter works because the button has the focus (`autoFocus`), so the page binds no key: remove `usePageKeys` from `pages/sign-in/ariakit.tsx`.
- The guest card, the no-access card, and the error card are now the same `Sheet` with the same brand button. Nothing else changes.
- Loading: the page needs no data. Error: the card of today.

### 3.2 Queue (surface `inbox`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◉ visonaut  ariakit/ariakit ↗      Queue 4   History   Status 3          (H) │ 49
│                                    ═══════  bar on the header edge           │
│                                                                              │
│          ╭ next run (brand at 15%, border) ───────────────────────╮          │
│          │ #7754 · 14 min ago                                     │          │
│          │ Add a loading state to Button and remove the dimmed    │  text-lg │
│          │ variant                                                │          │
│          │ 18 changes · 1 rejected                     [ Review ] │          │
│          ╰────────────────────────────────────────────────────────╯          │
│          ╭ sheet ─────────────────────────────────────────────────╮          │
│          │ (⊙) Fix Link underline offset in Safari      ▁▁▁▁▁▁▁▁▁▁ │  run row │
│          │     #7753 · 23 min ago                      24 changes │  (bar,   │
│          │ (⊙) Increase the letter spacing token of…   ▁▁▁▁▁▁▁▁▁▁ │  words)  │
│          │     #7752 · attempt 2 · 45 min ago         246 changes │          │
│          │ (⊙) Use the semibold weight for Button la…  ▁▁▁▁▁▁▁▁▁▁ │          │
│          │     #7751 · 1 h ago                          9 changes │          │
│          ╰────────────────────────────────────────────────────────╯          │
│          Running                                                             │
│          ╭ sheet ─────────────────────────────────────────────────╮          │
│          │ (◌) main 8786de4                              Capturing │          │
│          │ (◠) Fix a regression where the Combobox po…   Comparing │          │
│          ╰────────────────────────────────────────────────────────╯          │
│          Needs attention                                                     │
│          ╭ sheet ─────────────────────────────────────────────────╮          │
│          │ (⚠) Add forced colors styles to Checkbox…        Failed │          │
│          │ (↻) main 1a1d4b4                          Rerun needed │          │
│          ╰────────────────────────────────────────────────────────╯          │
└──────────────────────────────────────────────────────────────────────────────┘
```

What changes:

- **Header** (all list pages): the first nav word is `Queue`. The bar glider is on the header edge (N5). The `?` button goes: the list pages have no key (D-WORK-03).
- **No toolbar.** The filter field goes (8 rows need no filter, and History has the search). The Refresh button goes (D-UX-05). The Baseline button goes: the baseline shows only in the empty state (`All reviewed · Baseline 412`).
- **Next run.** One card for the first run of the review group, in the layer of `UI-HERO-LAYER` (recommended: brand at 15%). It has the number and the age, the title (`text-lg`, two lines at most), `18 changes · 1 rejected`, and one `Review` button (brand bevel, a link to the run). The button has no `↵` hint: the page binds no key (D-WORK-03), and the button does not take the focus at load, because a list page must not move the focus of a person who returns to it. The sign-in page keeps its `↵`, because its one button has the focus. No preview strip and no author: the service does not send them (D-UX-04). With the data mode `improved` the avatar and the login show before the age, and nothing else.
- **One row design.** Every other run is the picked run row (`Two lines with review progress`): a compact status pill (a tinted disc with the icon), the title, the identity line (`#7753 · attempt 2 · 23 min ago`, and the login when the data has it), and at the end the state text. A run to review has the review bar of the pick and `24 changes` under it. The bar has the parts that the data gives, as the picked code already does (`getReviewShares` in `run-row/parts/model.ts`): rejected and open with the decided data, and approved, rejected, and open when the run has `counts` (conflict `run-counts`, 5.6). A running run has its state word, and the stock `Progress` with `1,290 of 3,832` only when the data has the progress. A failed run has its state word, and the error sentence only when the data has it. The three cards and the one-line rows of round 1 go.
- **Groups.** The runs to review have no label (they follow the next run). `Running` and `Needs attention` are plain labels in `text-sm` with soft ink. Each group is one `Sheet` with `$p={1}` around a `ButtonGroup $layout="vertical" $p="none"` with hover and focus gliders.
- **Spacing.** Column `maxWidth="56rem"` (72rem today). `gap-6` between the blocks (`gap-4` today). The next run card has `$p="1.5rem"`.
- **Removed.** The key legend, the `/` cap, `J`, `K`, Enter from anywhere, the `92 earlier runs` link (History is in the header).
- **States.** `single`: the next run card alone. `empty` and `first-run`: the `EmptyState` of today. `loading`: the real header at once, then a card skeleton and three row skeletons with the size of the content (Destination skeleton). `error`: the In place band (section 4, row 18): a still skeleton under one danger band with `Try again`. A refresh that fails keeps the rows and shows `Could not refresh · list of 4 min ago` with `Try again`.
- Chrome words on the busy page: about 12 (30 today).

### 3.3 History

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◉ visonaut  ariakit/ariakit ↗      Queue 4   History   Status 3          (H) │
│          ⌕ Search runs                    All results ⌄    Newest ⌄          │
│          Today                                                               │
│          ╭ sheet ─────────────────────────────────────────────────╮          │
│          │ (⊗) Add a loading state to Button…     18 changes · 1 rejected │  │
│          │     #7754 · attempt 3 · 14 min ago          2 earlier ▸ │          │
│          │ (⊙) Fix Link underline offset in Safari      24 changes │          │
│          │ (✓) main 8f2c1aa                                 Passed │          │
│          ╰────────────────────────────────────────────────────────╯          │
│          Yesterday                                                           │
│          ╭ sheet ─ … ─╮                                                      │
│          Latest 100 runs                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The row is the picked run row, the same part as on the Queue. The question of `UI-RUN-ROW` names both pages. The `Table` with four columns goes.
- The two ideas of the folio history stay: day labels, and the runs of one pull request folded under the newest one (`2 earlier`, a `Button $size="xs"` with `aria-expanded` at the end of the identity line; the folded rows are run rows with soft ink and a start indent).
- A closed run uses the two fields of D-UX-04: `Replaced` or `Closed` (the reason), and the last result as the pill (`closedState`).
- The toolbar stays: search, result select, sort select. The `/` cap and the row keys go.
- The page scrolls as a normal page. Remove the fixed page height and the sticky table head.
- Column `56rem`, as the Queue. `loading`: row skeletons. `error`: the In place band over a still skeleton.

### 3.4 Status

The page of round 1 stays. Changes: the shared header, `Callout` at 15%, no `J` and `K`, the In place band for the error state, and the Refresh button goes (the page reads again each minute, D-UX-05; `Checked 12 s ago` stays). With the decided data an alert has no severity, no impact, and no count: the card has the warning tint and each row has its title, its subject, and its time.

```
│                  ╭ (warning or danger tint) ──────────────────────╮          │
│                  │ ▲ 3 alerts                Checked 12 s ago  (i) │          │
│                  │ ▲ Check delivery failed    run #7754    4 min ⌄ │          │
│                  │ ! Database above warning   1,610 MiB    3 min ⌄ │          │
│                  ╰────────────────────────────────────────────────╯          │
│                  ╭ Database ────────────╮ ╭ Captures ─────────────╮          │
```

### 3.5 Pull request

Recommended option of `UI-PULL-SCOPE`: the page waits for the newest run.

```
│          Pull request #7754 · Add a loading state to Button   GitHub ↗       │
│          4f1c9e0 · attempt 3                                                 │
│          ╭ sheet ─────────────────────────────────────────────────╮          │
│          │ (⊗) Rejected            18 changes · 1 rejected         │          │
│          │ [ Review 18 changes ]                                  │          │
│          ╰────────────────────────────────────────────────────────╯          │
│   waiting:         ✓ Capture   ◔ Compare   ○ Review     Opens when ready     │
│   capture-failed:  band: Capture failed · Rerun the visual tests in CI  [Open workflow ↗] │
│   no-runs:         No visual review needed                                   │
```

- The title block has the fields of D-UX-04: title, commit, attempt. `GitHub` and `Open workflow` are links.
- One sheet with the state of the newest run and one action. The commit folder, the segmented bar with its legend, the preview well, and the list of earlier attempts go.
- In the app, a pull request with a run that a person can review opens that run (D-UX-02). The lab shows the page for the scenarios `attempts` and `single` so that the state can be seen.
- The other option, `all-runs`, is the page of round 1 with the shared changes (header, words, pill, dimmed shortcut).

### 3.6 Review workspace

```
1440 × 900, one variant, the recommended options (floating bar, stepper with cover on request)
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ←  #7751 Use the semibold weight for Butt… ⌄    ▯ ↑ button Default 1 / 3 ↓     ▬▬▬▬ 9 left  ▲ (H) │ 49
├──────────────────────────┬───────────────────────────────────────────────────────────────────┤
│ [All ⌄ │ ⌕ Search screen…]│ ‹ ⊙ Chromium · Light  1 / 6 ⌄ ›  ⊙ ⊙ ⊙ ⊙ ⊙ ⊙  ▦ All     0.19% · 292 px · 1 region  Details │ 44
│ ┌──────┐ Default         ▌│ ┌ stage (well) ─────────────────────────────────────────────────┐ │
│ │ crop │ button/page     ▌│ │ Current 416 × 136                  (state chip, top center)   │ │
│ └──────┘ ⊙⊙⊙⊙⊙⊙    0.19% ▌│ │                                                               │ │
│ ┌──────┐ Pill             │ │            ┌───────────────────────────────┐                  │ │
│ │ crop │ button/page      │ │            │ image at Fit (200%), 1 px ring │                  │ │
│ └──────┘ ====⊙⊙    0.39%  │ │            │ red tint, red outline boxes    │                  │ │
│ ┌──────┐ Segmented cont…  │ │            └───────────────────────────────┘                  │ │
│ │ crop │ button/page      │ │                                                               │ │
│ └──────┘ =⊙====    0.67%  │ │   ( ↶ │ ▣ ◧ ◫ ⇔ ◱ │ ± │ − 200% ⌄ + │ ‹ 1/3 › │ ✕ Reject X  ✓ Approve A  ⋯ )  │ │
│                           │ └───────────────────────────────────────────────────────────────┘ │
└──────────────────────────┴───────────────────────────────────────────────────────────────────┘
  sidebar 20rem, on the desk    main panel: starts at the sidebar edge; it keeps its gutter on the other three sides
```

**Shell.** `Shell className="h-dvh"`. `ShellSidebar $width="lg"` (20rem, was 16rem). `ShellMain $p="none"`, and the `div` around the panel has `pt-2 pe-2 pb-2` (N6). The main panel is the kit `Sheet` (`Frame $lighten $border $rounded="2xl"`) with `$p="none"` and a column layout: the variant row, then the stage. The folder of round 1 (`Tabs` around the stage) goes in the recommended option.

**Header.** Start: the back button (tooltip `Queue`) and the run crumb with its popover (as today; the link `All attempts` goes with the option `wait`). Center: the list toggle (tooltip `Hide list` with `[`), and the screenshot stepper (as today; the tooltips have `↑` and `↓`). End: the run progress (a `SegmentedProgress` of 6rem and the count: `9 left`, `All approved`, `2 rejected`, `Comparing 2,342 of 3,832`, `228 not reviewed`), the alerts link, and the account. The ring and its popover go. The `?` button goes: the account menu has the checkbox `Shortcuts` and the item `Keys`, which opens the list (pick `Hints on the controls`).

**Screenshot list** (sidebar).

- The control is the picked `One field`: one `InputGroup $size="sm"` with the status select and the search. No `/` cap. The `Changes | All 626` control goes into the select. The entries, each with its count in the menu: `Changes` (the default; the pick calls it `All`, and it lists every screenshot with a change, as in the pick), `Needs review`, `Rejected`, `Approved`, a separator, and new: `Unchanged`. The first entry cannot keep the word `All` beside an entry `Unchanged`: `All 3` over `Unchanged 623` is false. This one word is the only change to the copy of the pick.
- The row is the picked `Diff thumbnail`: a crop of 6em by 4em, the name, the family and the group (`button/page`), and a third line with one glyph for each variant and the largest ratio (or `Size changed`). The family labels and the browser legend above the dot strips go, because each row names its family. The dot strip goes: the third line of the row has the same information.
- The glider: N6.
- `Unchanged` lists the families as closed disclosures with plain one-line rows inside (the list of the `All` scope of round 1). An unchanged row has no picture. The app loads this list in a second request (D-RUN-02), so the first open shows row skeletons for a moment.
- The key legend at the foot of the list goes.

**Variant row** (44 px, top of the panel). Start: the picked `Stepper with a list` (`‹`, the selected variant with its mark and `1 / 6`, `›`), then the pager of marks as links (N7), then the `All` button (a `LayoutGrid` icon and the word, `aria-pressed`), which shows the cover. End: the picked `One line` summary, then the `Details` button of the picked `Facts popover`. A screenshot with one variant shows its name as text and no stepper.

**Stage.** One recessed well that takes all the room that is left. It is one stage engine for every mode (section 4, rows 8 to 14).

- First view: the current image at Fit, the mask as a red tint at 50%, and one red outline box around each changed region (conflict `diff-color`). Fit enlarges by whole steps (100%, 200%) and scales a large image down. An image that is taller than 1.5 stages fits the width and the stage pans.
- Each image has its label at its top left corner, outside the pixels: `Current 416 × 136`, and `Baseline 416 × 136` in two panes. A dimension that differs is `font-medium` in the warning color. The image has a 1 px ring (pick `Ring`).
- One state chip at the top center of the stage, only when the stage is not one or two loaded images of equal size: a spinner after 400 ms, `Added`, `Removed`, `+2 px`, `Current could not load | Retry`, `No visible change`, `Images expired`, `Comparing` (pick `State chip`).
- Modes: `F` current, `G` baseline in the same place, `S` two panes with one pan and zoom, `W` swipe, `O` overlay (the current image at 50% over the baseline). `D` turns the mask and the boxes off and on. No press and hold, no `T`, no `B`, no `H`.
- A click on a box zooms to its region (about a third of the stage). The mouse wheel with Ctrl and a pinch zoom at the pointer. A drag pans. These are gestures, not keys.

**Bar** (recommended option of `UI-STAGE-BAR`: one floating pill).

- One `Frame $lighten={2} $border $rounded="full" $p={1}` with `shadow-xl` over the bottom center of the stage, in this order: Undo (icon, tooltip with `⌘Z`), separator, the five mode radios as icons (tooltips with the name and the key) with a glider, the mask toggle (`D`), separator, the zoom control (`−`, the percent with the preset menu, `+`), the region stepper (`‹ 1/3 ›`, only with more than one region), separator, `Reject X`, `Approve A` (brand), and the `⋯` menu.
- The pressed button is the save feedback: a ring while it saves (tooltip and live region: `Saving…`), then `Approved` or `Rejected` with a check for 800 ms. No sentence. The live region says the words. The pill keeps its width while a decision saves (the round 1 review fixed this in the pick: the mark takes the place of the key hint).
- A decision for the whole screenshot (`⇧A`, `⇧X`, or the menu item) has no button of its own in the pill, so the feedback goes to the button of the same verdict: `Approve` shows the ring, then `6 approved` with a check (`Reject`: `6 rejected`). The count stays until the next selection or the next decision, not 800 ms, and Undo is enabled beside it. This is the "number of variants and an Undo button" of D-WORK-06 (conflict `item-receipt`, 5.20).
- The `⋯` menu: `Approve all 6` with `⇧A`, `Reject all 6` with `⇧X`, a separator, `Approve the run…` (opens the confirm dialog recipe: `Approve 9 changes?`, `6 were not opened`, `Cancel`, `Approve`; it calls `session.approveRemaining("run")`), a separator, `Copy link`. Then the heading `Lab` with `Fail the next save` and `Reset the stored view`.
- The bar is the message (pick `The bar is the message`). In a blocking state the pill takes the tint of the state and shows only the valid actions: `Not saved · Check your connection` with `Reload` and `Retry`; `Changed by @nilsson-sofia 2 min ago` with `Reload` (without the name: `Changed by another reviewer`); `A newer run replaced this one` with `Open attempt 3`. A run that takes no decision keeps the view controls and shows `Read-only` with `Open newer run`, or `Comparing 2,342 of 3,832` with a `Progress`. `session.readOnlyKind` has six values: `superseded` shows `Open newer run`; `comparing` shows the progress (the numbers only when the data has them); `archived`, `expired`, `failed`, and `stale` show `Read-only` and `session.readOnlyReason` as the tooltip, with no action. The session of the fixtures has no conflict state, so `Changed by …` shows only in the reference surface `Bar states`, which forces the message.
- The pill fades to 45% after 3 s without input and returns on a pointer move, a focus, or a key. With reduced motion it does not fade.
- Fit keeps the pill clear: an image that would reach under the pill fits the stage minus 4rem. A smaller image is centered in the full stage.
- Below 56rem of stage width the bar is a docked bar with two rows (view controls, then Undo and the decisions).

**Cover** (the `All` button). The grid of round 1: one cell for each variant that takes a verdict, cropped to the change, with its label and its mark. A cell is a link to its variant, and the position number of a cell is dimmed text, not a key cap (N2). In the cover the bar has Undo, the mask toggle, `Reject all 6 ⇧X`, `Approve all 6 ⇧A`, and `⋯`. `F` and `G` show the current image or the baseline in every cell. The cover is never the first view (D-WORK-02).

**Result page** (D-WORK-05). When nothing is left, the panel shows this in the place of the variant row and the stage:

```
│                           ✓  All approved            (or: ✕ 2 rejected · Nothing to review) │
│                              9 changes in 3 screenshots                                     │
│                              [ Next run · #7754 ]  [ Queue ]  Pull request ↗                │
│                              ↶ Undo last decision                                           │
│                              All 626 screenshots                                            │
```

It is the content of the picked completion card, as a page and not as a card over the image. `Next run` has the focus, so Enter opens it. `Show rejected` replaces `Queue` when a change is rejected. `All 626 screenshots` sets the status select to `Unchanged`. The list stays. A closed run with no change opens here with `Nothing to review` and `All 626 screenshots match baseline 412`.

When the result page shows and when it leaves, so that a builder does not invent it:

- It shows when `session.complete` becomes true (after the receipt of the last decision, not while it saves), and at load for a run that is complete (`passed`, `clean`).
- It leaves when the person selects a place: a click on a list row, on `Show rejected`, on a pager mark, or a step with an arrow key. The stage of that place then shows, with the bar. `Undo last decision` and `⌘Z` also leave it and return to the place of the decision.
- The run progress in the header (`All approved`, `2 rejected`) is a button while the run is complete: it shows the result page again.
- The bar does not show on the result page: the page has its own Undo.

**Keys printed on the page.** `X` and `A` in the buttons. `⇧A`, `⇧X` in the menu rows. `1` to `6` in the rows of the variant list. Mode keys, `D`, `⌘Z`, `[`, and the arrows in tooltips. Nothing else.

**Loading and errors.** Loading: the real header, row skeletons with the size of a thumbnail row, a variant row skeleton, and a well with the median image box (416 by 170). Error: the shell stays and the panel shows the In place band. An image that fails: the state chip with `Retry`, and the decisions are off.

## 4. Composition: the 19 picked variants

"Kit" is `src/explorations/kits/ariakit/`. "Move" means: the builder moves the named parts into the kit as components that take their data as props, and the page and the reference surface both render them. The scenario hooks of round 1 (`useDecisionBar(scenario)`, `useToolbar(scenario)`, and the others) stay behind as data for the reference surfaces that stay, and go with the surfaces that leave.

| #   | Decision, pick                     | Where it goes                                    | What it replaces in the folio page                                                                        | How                                                                                                                                                                                                                                                                                                                                 | Gallery                                                                                                |
| --- | ---------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | UI-ITEM-ROW, `thumbnail`           | Review, sidebar rows                             | `Row` with `DotStrip`, the family labels, the strip legend (`pages/review/ariakit/screenshot-list.tsx`)   | Move `Thumb`, the row body, `parts/thumb.ts`, `parts/marks.tsx`, `parts/model.ts` to `kit/list/`. The row takes a `SessionItem`. Glider as N6 (the pick has its bar at the start side: the note moves it to the end side). Glyphs from the kit status table. Regions from `kit/regions.ts` when the data has none.                  | Leaves. The ask surface `row-picture` shows the list.                                                  |
| 2   | UI-ITEM-FILTER, `one-field`        | Review, sidebar head                             | The filter `InputGroup` and the `SegmentedControl` scope                                                  | Move the field and `parts/model.ts` (`filterItems`) to `kit/list/`. It already reads `useReviewSession`. Add `unchanged` to the status list and name the first entry `Changes` (3.6). Remove the `/` cap.                                                                                                                           | Leaves.                                                                                                |
| 3   | UI-VARIANT-SWITCHER, `stepper`     | Review, variant row                              | `VariantTabs` and the `Folder` (in the options `stepper-cover` and `stepper`)                             | Move the stepper, the list, the pager, and `parts/pieces.tsx` to `kit/variants/`. The pager marks are links (N7). It takes the item, the selected variant, and the two step actions. For the option `tabs`, copy `pages/review/ariakit/variant-tabs.tsx` to `kit/variants/tabs.tsx` (the kit must not import a page file).          | Leaves. The choice surface `review-variants` shows it.                                                 |
| 4   | UI-DECISION-BAR, `pill`            | Review, bar                                      | The end side of `footer-band.tsx` (`SaveGroup`, `DecisionButtons`, `SplitButton`)                         | Move the pill frame, `Decision`, `More`, `Failure`, the read-only pill, and the idle fade to `kit/bar/`. Rewire from `DecisionBar` to the session: `can`, `save`, `lastCommand`, `approve`, `reject`, `undo`. Drop the cloud and the queued count (D-RES-02).                                                                       | Leaves. The choice surface `review-bar` shows it.                                                      |
| 5   | UI-REVIEW-PROGRESS, `segments`     | Review, header end, and the result page          | `ProgressButton` (ring and popover) in `header.tsx`, and the `complete` state of the footer band          | Move the bar and the count to `kit/result/`, and build the result page from the content of the card (conflict `review-end`).                                                                                                                                                                                                        | Leaves.                                                                                                |
| 6   | UI-DETAILS-PANEL, `facts`          | Review, variant row end                          | `details.tsx` of the page                                                                                 | Move the popover and `parts/model.ts` (`getDetails({ review, item, variant })`, already a pure function) and `parts/copy.tsx` to `kit/stage/details.tsx`. No `I` key.                                                                                                                                                               | Leaves.                                                                                                |
| 7   | UI-SHORTCUT-HELP, `inline-hints`   | All of the review page, and the account menu     | `KeyLegend`, the `?` button, the coach popover, the key caps                                              | Kit: `ShortcutSlot` as N2, `Hint` tooltips with `Kbd`, and the account menu with the `Shortcuts` checkbox item and the `Keys` item (move `KeyList` from `parts/pieces.tsx`, with the key map of section 1). The dialog of round 1 stays as the place of the list.                                                                   | Leaves.                                                                                                |
| 8   | UI-COMPARE-STAGE, `diff-first`     | Review, stage                                    | `stage.tsx` and `plate.tsx` of the page                                                                   | Move `parts/view.ts`, `parts/canvas.tsx`, `parts/pair.tsx`, `parts/regions.ts` to `kit/stage/` as the one stage engine. Remove `useHold`, the `T` key, the press, `H`, and the header row (label and counter move, rows 12 and 10). Add swipe (from the page of round 1) and overlay. Mode and mask come from `useStoredView` (N8). | Leaves. The review scenario `probes` shows the image sizes.                                            |
| 9   | UI-REGION-MARKERS, `outline-boxes` | Review, stage                                    | `AreaBoxes` in `plate.tsx`                                                                                | Move `parts/geometry.ts` (`getMarkRects`: a box of 24 px at least, boxes that give way, brackets for a large region) into the stage engine in place of `RegionMarks` of row 8. A box is a `Button` that zooms to its region. The counter moves to the bar.                                                                          | Leaves.                                                                                                |
| 10  | UI-VIEWER-TOOLBAR, `merged-bar`    | Review, bar                                      | The start side of `footer-band.tsx` (`ViewControls`)                                                      | Move `ModeRadios`, `RegionStepper`, the mask toggle (`HighlightButton`), and `tip.tsx` to `kit/bar/`. The order of the bar is the order of this pick: Undo, view controls, decisions. Drop `SizeBadge` (the state chip has it) and the Blink mode.                                                                                  | Leaves.                                                                                                |
| 11  | UI-ZOOM-PAN, `stepper`             | Review, bar (the control) and stage (the engine) | The zoom `ButtonGroup` with the `ComboboxSelect`                                                          | Move `PresetMenu` to `kit/bar/zoom.tsx` and the levels of `parts/view.ts` (`ZoomLevel`, `getLevelScale`, steps 50 to 800%, `Fit`, `Fit width`, `Actual pixels`, the pixel grid at 800%, zoom at the pointer) into the stage engine. No `0`, `+`, `−` keys and no key text in the menu.                                              | Leaves.                                                                                                |
| 12  | UI-IMAGE-STATES, `state-chip`      | Review, stage top center                         | The stage badges, the `Images expired` callout, the `Comparing` overlay, the `Image did not load` callout | Move the chip and `parts/pieces.tsx` (`Hatch`, `RetryButton`) to `kit/stage/chip.tsx`. The chip takes a state value, so the page and the reference both drive it.                                                                                                                                                                   | Stays as a reference (states that a page scenario cannot reach: slow load, failed load, not uploaded). |
| 13  | UI-CHANGE-SUMMARY, `one-line`      | Review, variant row end                          | The ratio badge on the selected tab, the `Size changed` badge                                             | Move `parts/facts.ts` and `parts/line.tsx` to `kit/stage/summary.tsx`. Rule against repeats: the line shows only the numbers of a change with a mask (`0.19% · 292 px · 1 region`). The chip and the label carry an added, removed, resized, or comparing variant.                                                                  | Leaves.                                                                                                |
| 14  | UI-STAGE-FRAME, `ring`             | Review, stage, each image                        | `PaneLabel`, and the bare image edge                                                                      | Move the label and the ring into the stage engine (`Picture` gets the ring, each pane gets the label).                                                                                                                                                                                                                              | Leaves.                                                                                                |
| 15  | UI-RUN-ROW, `progress`             | Queue and History, and the pull request sheet    | The cards and the one-line rows of the Queue, and the table rows of History                               | Move the row, `ReviewBar`, and `parts/model.ts`, `parts/pieces.tsx` to `kit/run-row.tsx`. The row takes a `Run`. The leading mark is the compact pill of row 16. Keep `getReviewShares` as it is: it already gives two parts without `counts` and three parts with them.                                                            | Leaves. The Queue and History show it in each data mode.                                               |
| 16  | UI-STATUS-MARK, `pill`             | Every page                                       | The kit `StatusBadge` and `StatusMark`                                                                    | Replace the kit status table with `parts/states.ts` (`runMarks`, `variantMarks`) and the kit badge with `Pill`. Add one bare glyph for each state for a strip (conflict `status-forms`).                                                                                                                                            | Stays as a reference: the legend of the vocabulary.                                                    |
| 17  | UI-PAGE-LOAD, `skeleton-shell`     | Every page, the `loading` scenario               | Mostly what the pages do already                                                                          | A rule and not a module: the real chrome at 0 ms, blocks with the size of the content, no words before 3 s, the median image box. The neutral pages of the surface (`parts/queue.tsx`, `parts/run.tsx`) are not the design and go.                                                                                                  | Leaves.                                                                                                |
| 18  | UI-ERROR-STATE, `in-place`         | Every page, each failed load                     | The `Callout` that replaces the content                                                                   | Move the band (`ToneIcon`, `ActionButton`, `ErrorIdField`) to `kit/error-band.tsx`. The region keeps its shape under the band: a still skeleton, the stale rows, or the image well.                                                                                                                                                 | Stays as a reference (five failures that a page scenario does not show).                               |
| 19  | UI-NOTICE, `bar-takeover`          | Review, bar                                      | The `save-error`, `read-only`, `comparing`, and `blocked` states of the footer band                       | Move `MessageRow`, `Receipt`, and the message model (`parts/model.ts`: `getNoticeCommands`, the message kinds) to `kit/bar/message.tsx`. The bar takes one message value.                                                                                                                                                           | Stays as a reference, renamed "Bar states": every message in the bar of the page.                      |

Fifteen surfaces leave the catalog and four stay. A copy of each folder that leaves goes to `/Users/diegohaz/.claude/jobs/f65a6229/tmp/design/parked-r2/`.

## 5. Conflicts

Each conflict has an id, a kind, and its end. A `new-choice` and an `ask-maintainer` become a surface in the lab (section 7). A `one-right-answer` is built into the page.

### 5.1 `stage-bar`: the bottom of the review stage (new choice, UI-STAGE-BAR)

Three picks and the folio page claim the same place. The decision bar `Floating pill` floats over the stage and reserves no row. The viewer toolbar `Merged bar` puts the view controls in the action bar between Undo and the decisions. The notice `The bar is the message` turns that bar into the message. The folio page has a docked band of 48 px with the view controls at the start.

Two of the three agree with every form: the order of the merged bar and the takeover work in a pill and in a docked bar. The real question is: does the one bar float over the pixels, or does it take a row?

Why the picks do not settle it. The maintainer picked the floating pill for the decisions over a docked bar (the variant `dock` of the decision bar), and picked the merged bar for the view controls over a floating pill (the variant `floating-pill` of the viewer toolbar). The specification of the merged bar says: "It joins two components: the maintainer cannot pick the action bar and the toolbar apart." Read together, the picks say "the view controls live in the action bar" and "the action bar floats", which is the option `pill`. Read each alone, the view controls were picked in a bar that does not float, which is the option `dock`. Only the maintainer can say which of the two readings is meant.

| Option               | What it is                                                                                                                                                     | For                                                                                                        | Against                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pill` (recommended) | One floating pill with everything: Undo, view controls, Reject, Approve, `⋯`. It fades when idle. It becomes the message. Fit keeps a large image clear of it. | It holds the three picks as picked. No reserved row: a card (88% of the screenshots) has the whole height. | The pill has 15 controls and is about 700 px wide (the picked pill had 4 controls), so it is over the lower middle of a viewport capture that is zoomed. For a large image at Fit the 4rem gutter takes the height that the docked bar takes, so the gain is only for small images. The view controls fade too, which the maintainer did not pick for the toolbar. The view controls are beside Reject. |
| `dock`               | The same content and order in one bar under the stage, in the place of the band of round 1. It does not fade. It takes the tint of the message.                | Nothing is ever over a pixel, and nothing moves or fades. The simplest to build and to learn.              | It gives up the float of the picked pill and costs a row of 48 px for every image.                                                                                                                                                                                                                                                                                                                      |

Reason for the recommendation: it is the only option that holds the three picks, and its one cost (pixels under the bar) is solved for the first view by the Fit rule. The recommendation is weak: the two options differ only in the place of one bar, and the docked one is the calmer page.

Surface: a page surface (`review-bar`), because the question is about the image area at a real viewport size. Its review must check the pill at 1280 px with the list open (stage about 950 px wide): the pill must leave 1rem at each side, and when it does not fit, the region stepper goes first (the boxes on the image still jump).

### 5.2 `variant-nav`: stepper, tabs, and the cover (new choice, UI-VARIANT-NAV)

The pick `Stepper with a list` replaces the folder tabs. The folder ("every screenshot is a folder, every variant a tab") and the cover of all variants are the idea of the folio review page, and the reviewer named the cover as its signature. Also, the audit answer D-WORK-02 says that one stage opens first, so the cover cannot be the first view in any option.

| Option                        | What it is                                                                                                                                            | For                                                                                                                                                                                        | Against                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `stepper-cover` (recommended) | The picked stepper and the pager of links, and one `All` button that shows the cover in the place of the stage.                                       | The pick and its note hold. The one part of the folio that no pick replaces stays: every variant of a screenshot on screen before `Shift+A`, which is the safety of D-WORK-06 (no dialog). | One more button and a second view. The panel is no longer a folder.                                                 |
| `stepper`                     | The picked stepper and the pager of links. One stage always. No cover.                                                                                | The fewest elements and the smallest build.                                                                                                                                                | A whole-screenshot decision shows one of six variants. The folio idea is gone.                                      |
| `tabs`                        | The folder tabs of round 1, each tab a router link (the note applied to the tabs), with the `All` tab. The first view is the first variant to review. | The folio page as picked, with the same shape as before.                                                                                                                                   | It drops the picked stepper. Icon-only tabs are harder to read than a name, and the strip scrolls from 12 variants. |

Surface: a page surface (`review-variants`).

### 5.3 `hero-layer`: the layer of the next run (new choice, UI-HERO-LAYER)

The note names two possibilities (N4).

| Option                    | What it is                                     | For                                                                                       | Against                                                                                                                                                  |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand-mix` (recommended) | `Frame $layer="brand" $mix={15} $border`.      | The next run keeps its rank with a quiet tint, in both themes. It is the tint of D-UI-04. | A second blue surface beside the brand button.                                                                                                           |
| `lighten`                 | `Frame $lighten $border`, as the sign-in card. | The calmest. One recipe for every card.                                                   | It is the surface of every other sheet, and in light it is almost the canvas (`oklch(1)` on `oklch(0.993)`), so only the size and the button say "next". |

Surface: a page surface (`inbox-hero`, decision UI-HERO-LAYER, `of: "inbox"`), not a component surface. The reason of the recommendation is the rank of the card over the sheets under it, and a card alone on the canvas cannot show that. The two variants are the Queue with one prop changed (`InboxPage heroLayer="brand-mix" | "lighten"`), in the scenarios `busy` and `single`. The Look control gives both themes.

### 5.4 `pull-scope`: the pull request page and D-UX-02 (ask the maintainer, UI-PULL-SCOPE)

The pick `Ariakit folio` for UI-PULL lists every commit and every attempt of a pull request. The audit answer D-UX-02 `real-routes` says: "The pull request page stays a page to wait on, so the pull request designs of the lab are not possible", and its text names the other option for a pull request design of the lab. D-UX-04 gives the pull request page only the title, the commit, the attempt, and the workflow link.

Question: **Is the pull request page the waiting page of D-UX-02 in the folio look, or does it list every run of the pull request (the read of the option `pull-request-first`)?**

| Option               | What it is                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wait` (recommended) | Section 3.5. It needs no new read. It agrees with D-UX-02, D-UX-04, and D-RUN-04.                                                                              |
| `all-runs`           | The page of round 1: commit tabs, the newest attempt, earlier attempts as rows. It needs a read of all runs of a pull request, which no audit answer selected. |

Surface: a page surface (`pull-scope`). The second variant is the page that exists, so it costs little.

### 5.5 `row-picture`: the thumbnail row and "No thumbnails" (ask the maintainer, UI-ROW-PICTURE)

The picked row shows a picture for each screenshot. The text of the audit answer D-UX-04 ends with "No thumbnails". The row can draw without a new field: it loads the stored current image and the stored mask of one variant, and the browser reads the changed regions from the mask (the page of round 1 does that in `use-mask-regions.ts`). That is two image requests for each row in view: one Worker request, one D1 read, and one R2 read each, and no D1 write. A normal pull request has 3 rows.

The text of the audit is against this reading in one place, and the maintainer must see it: the option that was not selected (`all-improved-fields`) names "the Worker serves the stored image, which is one Worker request and one R2 read for each row on screen (REAL-04)" as one of the two ways to a thumbnail. So a picture from stored images is not outside the sentence "No thumbnails" for certain. It needs no field and no producer, which is the reason that the selected option gives, but it has the request cost that the other option names, two times. The stored images are also the full images, not small ones. That is why this is a question and not a settled answer.

Question: **Does "No thumbnails" mean no thumbnail field and no writer (then the row draws the stored images), or no picture in the list at all?**

| Option                            | What it is                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `picture` (recommended, the pick) | The row with the crop, from stored images. In the page.                                                                 |
| `marks`                           | The same row without the picture: name, family and group, glyphs and ratio. About 56 px. No image request for the list. |

Surface: a component surface (`row-picture`) with the list in a frame of 20rem.

### 5.6 `run-counts`: the review bar of the run row and D-UX-04 (one right answer)

The picked run row draws how far a review is: approved, rejected, open. The run list sends `pending` and `rejected` today, and no count of all changes, so the approved share is unknown. D-UX-04 leaves the run counts out ("no source check").

The pick already has the answer. Its specification says: "With the data of today the bar has two parts only: rejected and open", its scenario `no-title` shows that bar, and its code (`getReviewShares`) draws it. So the pick and D-UX-04 both hold, and no question is necessary.

Answer: the row keeps its bar in every data mode. With the decided data the bar has two parts (rejected and open), and with `counts` it has three (approved, rejected, open). The Queue and History follow the Data control, so the maintainer sees both forms in the page. No choice surface. A row never drops the bar for words only: that would remove a part of the pick that works with the decided data.

Two consequences that the catalog text of the Queue says in one line each: (1) with the decided data a run with no rejection shows an empty track, which the round 1 review of the pick already named ("reads as decoration"); (2) the approved part needs one count that D-UX-04 did not select. For the audit document, not for the lab: `apps/web/src/api/dashboard.ts:38` already sums `pending` and `rejected` over `visonaut_comparison_rows` for each run, so the count of changed rows is one more `SUM` in the same statement, with no new read and no D1 write. Capture progress (`1,290 of 3,832`) has no such source.

### 5.7 `compare-keys`: Diff first against D-WORK-02 and D-WORK-03 (one right answer)

The pick has a held `T` and a press on the image that show the baseline, `H` for the tint strength, and `C` for the next region. D-WORK-02 with its note removes the blink and the held key, and D-WORK-03 keeps the keys of today.

Answer: the stage of the pick with the modes and the keys of section 1. `T`, the press, `H`, and `C` go. `D` is the mask switch (in the pick it selects the diff view, which is the same picture). The tint has one strength (50%). The `Current` badge with the tooltip `Hold for Baseline` goes: the label of the Ring pick names the image. The note N8 is built with `useStoredView`.

The note and D-WORK-02 meet in one more place. D-WORK-02 says which view opens first, and the note says that the page remembers the selection, also in the next run. Both hold in this order: with no stored value the first view is the current image with the mask on, and a stored value opens first after that (N8). The mask can so stay off in a new run. The numbers of the change in the variant row and the unpressed mask toggle in the bar are then the only signs of a change, and the catalog text says so.

### 5.8 `zoom`: Stepper with presets against the zoom rules (one right answer)

The pick has the levels 50, 100, 200, 400, and 800%, the presets `Fit`, `Fit width`, and `Actual pixels`, the keys `0`, `+`, `−`, and a control on the stage. The folio page has Fit, 50 to 400%, a Fit that enlarges to 150% and 200%, and the keys `+`, `−`, `Z`. The contract names fit, 100%, and 200%.

Answer: the control and the levels of the pick, in the bar (the merged bar holds the view controls). No zoom key (D-WORK-03). Fit enlarges by whole steps only, 100% and 200% (D-WORK-02: "enlarged by whole steps"; the 150% step of the folio goes). The percent shows the real scale at Fit. The catalog text of the review page says that the levels above 200% change the contract rules K13 and A19.

### 5.9 `review-end`: the completion card against D-WORK-05 (one right answer)

The pick shows a card over the last image. D-WORK-05 says that the result shows "in the place of the stage, with Undo", and that an empty run opens on the same short page.

Answer: the content of the card (result, counts, `Next run`, `Queue`, the pull request link, `Undo last decision`) as the result page of section 3.6. No card over an image. The segmented bar of the pick goes into the header. The line `GitHub check passed` shows only when the data has the state of the check (it is not in D-UX-04).

### 5.10 `list`: the thumbnail row and One field against the folio list (one right answer)

The folio list has rows of 34 px, family labels, dot strips, the scope `Changes | All 626`, and a sidebar of 16rem. The picks have a row of about 80 px and one field.

Answer: both picks win. The list shows only the screenshots with a change, so a normal run has 3 rows and a wide change has 10 of 41 in view. The sidebar becomes 20rem (`$width="lg"`), which takes 64 px from the stage. The scope control becomes the `Unchanged` entry of the status select, so every screenshot is still reachable (D-WORK-05 asks for a link to all screenshots), and the first entry reads `Changes` in place of `All` (3.6). Family labels and dot strips go. The bar glider of the picked row moves from the start side to the end side (N6).

### 5.11 `queue-density`: "too dense" against the two-line row, the pill, and the cards (one right answer)

The note asks for less. The picked row has two lines and the picked mark is the heaviest one. The folio Queue has a hero, three cards with nine thumbnails, and two kinds of rows.

Answer: section 3.2. The density of the page came from the number of things, not from the row height: 16 thumbnails, three row designs, a toolbar, bars, and a legend. D-UX-04 removes the thumbnails, and the picked row replaces the cards and the rows, so the page has one card and one row design. The pill is compact in a row (a disc with the icon), because the text at the end of the row says the state. The full pill with its word is for a place that has no other word: the pull request sheet, the header of a closed run, the legend.

### 5.12 `history-row`: the run row against the history table (one right answer)

The question of UI-RUN-ROW is "Which row should show one run in the Queue and in History?", and the folio History is a table.

Answer: History uses the picked row. The day labels and the fold stay, because they are the idea of the page. The table columns go.

### 5.13 `status-forms`: one vocabulary, two forms (one right answer)

The pill pick sets the icons and the words of the eight run states and the seven variant states. The picked stepper and the picked thumbnail row show bare glyphs in strips of 6 to 24 marks, and six tinted discs in a row are too heavy.

Answer: one table in the kit (`kit/status.tsx`), from `status-mark/parts/states.ts`. Each state has its pill icon and one bare glyph for a strip: `Circle` needs review, `X` rejected, `Check` approved, `CheckCheck` auto-approved, `TriangleAlert` failed, `LoaderCircle` comparing, `Equal` unchanged, `Plus` added, `Minus` removed. A strip uses the glyph, and every other place uses the pill. No part keeps a table of its own.

### 5.14 `diff-color`: red or the secondary color (one right answer)

The folio page tints the diff in the secondary color ("the diff never shares red with a rejection"). The picks `Diff first` and `Outline boxes` use the danger color, the contract says "Pixel diff paints differences red", and the text of D-WORK-02 speaks of "the red pixels".

Answer: red. Two picks and the contract agree, and only the page that the picks replace differs. The color is one kit token (`diffColor` in `kit/tokens.ts`), so a change is one line.

### 5.15 `keys`: the keys of the folio and of the picks against D-WORK-03 (one right answer)

The folio pages bind `J`, `K`, `N`, `0`, `7` to `9`, `B`, `H`, `C`, `R`, `Z`, `+`, `−`, `L`, `I`, `/`, `?`, Enter, and Shift with an arrow. Picks print `/`, `0`, `+`, `−`, `C`, `H`, `T`.

Answer: section 1. Call `useReviewShortcuts(session, { labKeys: false, enabled: shortcuts.enabled, keys })`. `labKeys: false` turns off `J`, `K`, `N`, `U`, `O`, `W`, `B`, `H`, `+`, `−`, and `0` of the hook. The hook still binds `S`, `D`, `F`, and `G` to `session.viewer.setMode`, and its `D` opens the old diff mode. The page does not use `session.viewer` for the mode, so `keys` replaces them (a custom key wins over a built-in one):

```ts
const keys = {
  f: () => stored.setMode("new"),
  g: () => stored.setMode("original"),
  s: () => stored.setMode("side"),
  w: () => stored.setMode("swipe"),
  o: () => stored.setMode("overlay"),
  // D is the mask switch of D-WORK-02, not a mode.
  d: () => stored.setMask(!stored.mask),
  "[": () => setListOpen(!listOpen),
};
```

The arrows, `A`, `X`, `Shift+A`, `Shift+X`, and `Cmd/Ctrl+Z` stay the built-in ones, or the page replaces `a` and `x` as the page of round 1 does when it delays the step to the next place. The hook binds `1` to `9`; the app binds `1` to `6`, and the page prints only `1` to `6`. In a frame of the lab the keys `[` and `]` change the variant of the explorer (`src/lab/bridge.ts`), so the page binds `[` only when it is not in a frame, and the tooltip prints it always. The `Shortcuts` checkbox still turns every key and every hint off.

### 5.16 `stage-repeats`: five picks that show the same fact (one right answer)

`Diff first` has a label, a state badge, and a region counter. `Ring` has a label. `State chip` has the state. `Merged bar` has a size badge and a region stepper. `Outline boxes` has a counter. `Stepper with presets` has a zoom control on the stage. `One line` has the size and the state too.

Answer: each fact has one place.

| Fact                      | Place                  | From                                                        |
| ------------------------- | ---------------------- | ----------------------------------------------------------- |
| Name and size of an image | Label at the image     | `Ring`                                                      |
| State of the stage        | Chip at the top center | `State chip`                                                |
| Numbers of the change     | Variant row, end       | `One line`                                                  |
| Region counter and steps  | Bar                    | `Merged bar`                                                |
| Zoom                      | Bar                    | `Stepper with presets` in the place that `Merged bar` gives |
| Other facts               | `Details`              | `Facts popover`                                             |

### 5.17 `save-words`: `Queued` against D-RES-02 (one right answer)

The pill has a cloud for `Queued` and the words `safe to close`. The notice has `2 queued`. D-RES-02 removes that promise.

Answer: two states, `Saving` (the ring in the pressed button, and a count when more than one decision waits) and `Saved` (the check and the past tense for 800 ms).

### 5.18 `queue-word`: Inbox or Queue (one right answer)

The folio pages say `Inbox`. D-UX-03 `short-eight` says `Queue`, and the picks `Hints on the controls`, `Segmented bar and a card`, and `Two lines with review progress` already say `Queue`.

Answer: `Queue` in the navigation, the titles, the tooltips, and the buttons. The surface id stays `inbox`, so the saved feedback keeps its key.

### 5.19 `narrow`: phone layouts against D-RES-04 (one right answer)

Several picks and the folio pages have a phone layout. D-RES-04 keeps Chrome Desktop only.

Answer: no new phone design. Each page must not scroll sideways at 390 px and must keep each control reachable (the docked bar, the list above the stage as today). The reviews check 1440 and 1280 px first.

### 5.20 `item-receipt`: "no sentence" against the count of D-WORK-06 (one right answer)

The picks `Floating pill` and `The bar is the message` show a save in the pressed button and no sentence. The audit answer D-WORK-06 removes the dialog of a whole-screenshot decision and asks for two visible things in its place: "the number of variants and an Undo button". A whole-screenshot decision has no button of its own in the pill (it is `⇧A`, `⇧X`, or a menu item), so the picks alone show nothing for it but the ring.

Answer: the button of the same verdict carries the count: `6 approved` or `6 rejected` with a check, until the next selection or decision, with Undo enabled beside it (3.6, Bar). It is a count in the place of the word `Approved`, so no sentence is added. In the cover, where the buttons already read `Approve all 6` and `Reject all 6`, the same button shows the same count.

## 6. Data: what each pick needs

The data mode `improved` of the lab has more fields than D-UX-04 gives. Round 2 adds a third mode, `decided`, and makes it the default:

| Mode                     | Fields                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `today`                  | As now.                                                                                                                                                                                                                                                                                  |
| `decided` (new, default) | `today` plus: `Run.title`, `Run.closedReason`, `Run.closedState`, `PullRequest.title`, `PullRequest.headSha`, `ReviewRun.run.title` with the real title, `ReviewRun.pullRequest` with the number and the title, and `ReviewRun.counts` (D-RUN-02 puts the counts in the first response). |
| `improved`               | As now.                                                                                                                                                                                                                                                                                  |

| Pick or page part                                                | Works with `decided`                                                             | Needs more                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Diff thumbnail row                                               | Yes, with stored images: current image, mask, regions read from the mask         | A crop without the mask request needs `diffPreview` and `regions`. See `row-picture`.                                                    |
| One field                                                        | Yes                                                                              |                                                                                                                                          |
| Stepper with a list                                              | Yes (axes from the key text)                                                     |                                                                                                                                          |
| Floating pill, Merged bar, The bar is the message                | Yes                                                                              | The name and the time in a conflict (`reviewerLogin`, `decidedAt`): without them the message is `Changed by another reviewer`.           |
| Segmented bar and result page                                    | Yes (`session.progress`)                                                         | The state of the GitHub check. The line is left out.                                                                                     |
| Facts popover                                                    | Yes                                                                              | `Decided by` needs `reviewerLogin` and `decidedAt`. The row is left out.                                                                 |
| Hints on the controls                                            | Yes                                                                              |                                                                                                                                          |
| Diff first, Outline boxes, One line (`1 region`), region stepper | Yes: the mask loads with the image (D-WORK-02) and the browser reads the regions | A mask of another origin needs CORS headers.                                                                                             |
| Stepper with presets, State chip, Ring                           | Yes                                                                              |                                                                                                                                          |
| Two lines with review progress                                   | Yes: the row, and the bar with two parts (rejected and open)                     | The approved part of the bar needs one count for each run (`run-counts`). Capture progress, the error sentence, and the author stay out. |
| Tinted pill                                                      | Yes                                                                              |                                                                                                                                          |
| Destination skeleton, In place                                   | Yes                                                                              |                                                                                                                                          |
| Queue: next run                                                  | Yes                                                                              | Previews and the author are out.                                                                                                         |
| History                                                          | Yes: `closedReason` and `closedState` are in D-UX-04                             |                                                                                                                                          |
| Status                                                           | Yes, with one tint                                                               | Severity, impact, count.                                                                                                                 |
| Pull request (`wait`)                                            | Yes                                                                              | `all-runs` needs the list of runs of a pull request.                                                                                     |

## 7. Structure of the lab in round 2

### 7.1 Catalog

| Group in the gallery | Surfaces                                                                                                                                                                                                                                        | Decision state    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Open choices         | `review-bar` (page, UI-STAGE-BAR, of `review`), `review-variants` (page, UI-VARIANT-NAV, of `review`), `inbox-hero` (page, UI-HERO-LAYER, of `inbox`), `pull-scope` (page, UI-PULL-SCOPE, of `pull`), `row-picture` (component, UI-ROW-PICTURE) | Open: 5 decisions |
| Pages                | `sign-in`, `inbox` (title `Queue`), `history`, `status`, `pull`, `review`, each with the one variant `ariakit`                                                                                                                                  | Settled           |
| Reference            | `status-mark`, `image-states`, `error-state`, `notice` (title `Bar states`), each with its one variant                                                                                                                                          | Settled           |

- The six page surfaces keep the variant id `ariakit`. Each shows the recommended option of each open choice. Their `summary`, `ideas`, and `tradeoffs` in `catalog-page-variants.ts` get new text from section 3.
- The review surface gets one more scenario: `probes` ("Image sizes": one screenshot for each image size, with a change of 1 pixel, of 2 by 2 pixels, and a real change). The pull surface gets `waiting` and `capture-failed`. The fixtures have all three.
- A choice variant has `direction: "ariakit"`, one sentence as `summary`, the For and Against of section 5 as `ideas` and `tradeoffs`, and the recommended one has `recommendation`.
- Scenarios of the choice surfaces: `review-bar`: `changes`, `problems`, `read-only`, `comparing`. `review-variants`: `changes`, `one-browser`, `problems`, `one-change`. `pull-scope`: `attempts`, `single`, `no-runs`, `waiting`, `capture-failed`, `loading`. `inbox-hero`: `busy`, `single`. `row-picture`: `mixed`, `large`, `long-names`.
- The question of an `ask-maintainer` surface is the sentence of section 5, word for word, and its `description` names the audit answer that it meets, so the decision panel shows why the lab asks.
- The Queue surface says in its `tradeoffs` that the approved part of the run row bar shows only with the data mode `All proposed fields` (conflict `run-counts`). The review surface says that a stored view opens first in the next run (N8).

### 7.2 How a choice costs little code

A page takes its choices as props, and a variant module is a wrapper:

```tsx
// src/explorations/pages/review/ariakit/review-page.tsx
export interface ReviewPageProps extends VariantProps {
  stageBar?: "pill" | "dock";
  variantNav?: "stepper-cover" | "stepper" | "tabs";
}

// src/explorations/pages/review/ariakit.tsx: the settled page
export default function AriakitReview(props: VariantProps) {
  return <ReviewPage {...props} />;
}

// src/explorations/pages/review-bar/dock.tsx: one option
export default function DockedBar(props: VariantProps) {
  return <ReviewPage {...props} stageBar="dock" />;
}
```

The defaults of the props are the recommended options. The other choices work the same way: `InboxPage` takes `heroLayer` (`pages/inbox-hero/brand-mix.tsx` and `lighten.tsx` are wrappers), `PullPage` takes `scope`, and the list row takes `picture`.

### 7.3 Chrome changes

Keep them to this list.

| File                                                                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lab/types.ts`                                                           | `SurfaceEntry` gets `status?: "settled" \| "open"` (absent means open) and `of?: string` (the page surface that a choice surface shows). `LabDataMode` gets `decided`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/lab/surfaces.ts`                                                        | `getSurfaceGroups` groups by name in catalog order (not pages first). A group can now hold pages and components (`Open choices` has both), so `SurfaceGroup.kind` goes, and the two React keys that use it (`routes/index.tsx:157`, `ui/surface-switcher.tsx:85`) become the group name. `getDirectionPages` leaves out a surface with `of`.                                                                                                                                                                                                                                                                            |
| `src/lab/navigation.tsx`                                                     | A link from a choice variant to its own page stays in the choice surface and the variant: when the current surface has `of === to`, the target is the current surface and variant.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/lab/feedback.ts`                                                        | `countAnswered` and the total count only open surfaces.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/lab/ui/feedback-bar.tsx`                                                | The count reads `0 / 5 answered`. The decision menu lists the open decisions first and the settled ones under a heading.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/lab/ui/decision-panel.tsx`                                              | A settled surface shows `Settled in round 1` and the pick, with no options. The notes field stays, so the maintainer can still comment on a settled page. The field already holds the note of round 1 (the saved feedback of the browser keeps it, and `INCORPORATED_FEEDBACK` has the same text, so it does not count as changed). Do not print the note a second time above the field. A reference surface has no notes of round 1 in most cases and shows an empty field.                                                                                                                                            |
| `src/lab/ui/surface-card.tsx`                                                | The badge of a settled surface reads `Settled`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/routes/feedback.tsx`                                                    | Two tables: `Open` (the five choices) and `Settled in round 1` (the 25 decisions with pick, note, and where it lives now, from `record.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/lab/record.ts`                                                          | `revision: "r2"`. `INCORPORATED_FEEDBACK` has the 25 picks and the notes of `feedback.md`, word for word: a note that differs by one character from the saved feedback of the browser shows as a change of round 2. The 15 decisions whose surface leaves the catalog stay in it; the lab code reads the feedback only through the catalog, so they have no effect there. A new export `settledDecisions` has one entry for each of the 25: decision id, title, pick, note, and the place in round 2 (from section 4).                                                                                                  |
| `src/lab/knobs.ts`, `knob-store.ts`, `theme.ts`, `src/fixtures/data-mode.ts` | The Data control has three values, with `decided` as the default: `Decided API`, `API today`, `All proposed fields`. Four places have the two modes written out and need the third: `pickKnobs` (`input.data === "today" \|\| …`), `dataGateClasses` in `knob-store.ts` (whole class strings, one for each mode), `dataModeLabels` in `fixtures/data-mode.ts`, and the `description` of the knob. A browser that saved `improved` or `today` in round 1 would keep that value and never see the decided data, so the storage key of this one knob changes (`getKnobStorageKey("data")` returns `visonaut-lab:data-r2`). |

The directions pages need no change: one direction, six pages.

### 7.4 Records

`README.md` gets the new state (1 direction, 6 pages, 5 open choices, 4 reference surfaces) and the third data mode. `docs/fixtures.md` gets the `decided` column. A copy of this plan goes to `docs/design/round-2.md`.

### 7.5 A place in the URL

The lab has no URL for a screenshot or a variant, and the note N7 asks for router links. The bare preview keeps its search parameters for the look, and the explorer compares frame URLs without the hash (`getCanonicalHref` in `src/lab/bridge.ts`). So the lab uses the hash: `#s=<screenshot key>&v=<variant key>`. In the app the same two values are search parameters of `/runs/<id>` (D-UX-02).

- `PlaceLink` (`kit/place.tsx`): a TanStack `Link` to the current route with the same search, the new hash, and `replace`. A plain click selects without a reload, and a click with Cmd opens the place in a new tab.
- `useReviewPlace(session)`: reads the hash and selects that place, and writes the hash when a key changes the selection.
- The list rows, the pager marks, the tabs of the option `tabs`, and the cover cells are `PlaceLink`s.

## 8. Build packages

Eight packages in four steps. Packages in one step run at the same time and own separate files. Each package ends with `pnpm --filter @visonaut/lab typecheck`, the lint and the format of the repository on its files, and an independent design review.

```
step 1:  P1 lab foundation   ∥   P2 kit core
step 2:  P3 list pages   ∥   P4 stage   ∥   P5 bar   ∥   P6 navigation parts
step 3:  P7 review page
step 4:  P8 finish
```

**Shared rule for the old folders.** `src/explorations/components/<surface>/` of round 1 is a read-only source for every package. Only the owner of a reference surface edits its folder, and only P8 deletes folders.

**Shared rule for the kit.** A package never removes or renames a kit export that a file of another package imports, and never changes its props in a way that breaks that file. P2 adds the new parts and changes the inside of the old ones (`ShortcutSlot`, `MainNav`, `FolioShell`, `Callout`, the status table behind `StatusBadge` and `StatusMark`). The old exports that the pages of round 1 import (`KeyLegend`, `ShortcutsButton`, `KeyCap`, `useRowKeys`, `PreviewWell`, `Folder`) stay until the page that uses them is rebuilt, and P8 removes what nothing imports. So the lab type check is clean after each step.

**Shared rule for the worktree.** `apps/lab` is not tracked by git, so each builder works in this one worktree and not in a worktree of its own. The file ownership below is the only isolation. A type error or a lint error in a file of another package that runs at the same time is reported to the coordinator, not fixed. No builder runs a git command that changes state.

**Shared rule for the checks.** A package is done when the lab type check has no error in its own files, lint and format are clean on its own files, and each of its surfaces renders in the browser in the three data modes and the two themes with no console error. The step is done when the type check of the whole lab is clean.

### P1: lab foundation

- Owns: `src/lab/**`, `src/routes/**`, `src/fixtures/**`, `README.md`, `docs/fixtures.md`.
- Work: section 7.1 (the catalog entries exist before their modules, and the lab shows "Not built yet" until then), 7.3, and the data mode `decided` of section 6 (a new `src/fixtures/data/decided.ts` beside `today.ts`, and each place that tests the mode gets the third case: about 40 tests of the mode in `src/fixtures`, `src/lab`, and `src/routes`). Remove the 15 entries from `catalog-components.ts`. P1 does not edit a file under `src/explorations`: the eight explorations files that read the data mode belong to their packages.
- Needs: nothing.
- Review checks: a browser with saved feedback of r1 opens with 5 open and 25 settled decisions, and the feedback page lists no decision as changed; a browser that saved the data mode `improved` in round 1 opens with `Decided API`; a link inside a choice variant stays in it; `/dev/fixtures` shows the three modes.

### P2: kit core

- Owns: the files directly in `src/explorations/kits/ariakit/` (not its new folders), and `src/explorations/components/status-mark/**`, `src/explorations/components/error-state/**`.
- Work: N2 (`keys.tsx`), N5 (`shell.tsx`), the word `Queue`, the account menu with `Shortcuts` and `Keys`, no `?` button and no `?` key in `FolioShell`, `Callout` at 15%, `diffColor` in `tokens.ts`, the status table and the pill (`status.tsx`, conflict `status-forms`), `run-row.tsx` (row 15), `error-band.tsx` (row 18), `place.tsx` (7.5), `view-store.ts` (N8), the skeleton rules in `README.md`. Rewrite the two reference variants (`status-mark/pill.tsx`, `error-state/in-place.tsx`) on the kit parts. Update the kit `README.md`.
- `regions.ts`: the one reader of changed regions from a mask image, for the stage (P4), the list row (P6), and the cover (P7). Copy `pages/review/ariakit/use-mask-regions.ts` (a store for the document, one entry for each mask URL, `useRegionLookup`) and keep its 8 px join. The lab has three copies of this logic today (the page, `compare-stage/parts/regions.ts`, `viewer-toolbar/parts/regions.ts`); the kit has one.
- Do not delete `preview-well.tsx` and `folder.tsx`: the variant `all-runs` of `pull-scope` is the pull request page of round 1 and uses both, and the option `tabs` of `review-variants` uses the folder. They go when the maintainer answers those two questions.
- It also writes `view-types.ts` first, because P4 implements it and P5 reads it:

```ts
// src/explorations/kits/ariakit/view-types.ts
import type { ViewerMode } from "../../../fixtures/index.ts";

/** The five modes of D-WORK-02. The mask is a switch, not a mode. */
export type ViewMode = Extract<ViewerMode, "new" | "original" | "side" | "swipe" | "overlay">;
export type ZoomLevel = "fit" | "width" | number;

/** What the local storage keeps between screenshots, variants, and runs. */
export interface StoredView {
  mode: ViewMode;
  mask: boolean;
  setMode(mode: ViewMode): void;
  setMask(mask: boolean): void;
}

/** The zoom and the regions of the stage on screen. The bar reads it. */
export interface StageView {
  level: ZoomLevel;
  /** The scale on screen, also at Fit. Null before the stage has a size. */
  scale: number | null;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn(): void;
  zoomOut(): void;
  setLevel(level: ZoomLevel | "actual"): void;
  regionCount: number;
  region: number | null;
  goToRegion(step: 1 | -1): void;
}
```

- Needs: nothing. `place.tsx` uses the `hash` of the TanStack `Link` directly.
- Review checks: bar glider y equal to the header bottom; a shortcut slot has no key cap; the legend surface shows 15 states in both forms.

### P3: list pages

- Owns: `src/explorations/pages/{sign-in,inbox,inbox-hero,history,status,pull,pull-scope}/**`.
- Work: sections 3.1 to 3.5. Choices: `inbox-hero` (two page variants: `brand-mix.tsx` and `lighten.tsx`, each `InboxPage` with one prop), `pull-scope` (two variants: `wait.tsx` and `all-runs.tsx`; `all-runs` is the page of round 1 moved to `pages/pull/ariakit/all-runs.tsx` with only the shared changes).
- Needs: P1 (data mode, catalog) and P2 (run row, pill, error band, shell).
- Review checks: each page in `decided`, `today`, and `improved`; dark and light; 1440 and 1280; the Queue word count; no key is bound; the run row shows a two-part bar in `decided` and a three-part bar in `improved`; the next run card in both layers over the row sheets, in both themes.

### P4: stage

- Owns: `src/explorations/kits/ariakit/stage/**` (new), `src/explorations/components/image-states/**`.
- Work: rows 6, 8, 9, 11 (engine), 12, 13, 14, and the conflicts `compare-keys`, `zoom`, `stage-repeats`, `diff-color`. Exports: `useStageView({ variant, mode })`, which returns a `StageView` of `view-types.ts` (the page calls it and gives the result to the stage and to the bar), `ReviewStage` (props: `variant`, `item`, `view`, `mode`, `mask`, `gutterBottom`), `ChangeLine`, `DetailsButton`, `StateChip`, and the cover cell picture. The mode and the mask come in as props from `useStoredView`. Rewrite the reference variant `image-states/state-chip.tsx` on the kit stage and its chip (see the review checks).
- Needs: P2 (`tokens.ts`, `view-store.ts`, `regions.ts`, status).
- Review checks: scenario `probes` and `problems`: 1 px change, size change, added, removed, tall image, 1280 by 800 capture; no key except the gestures; the label, the chip, and the line never repeat a fact. The stage has no surface of its own until P7 composes it. So P4 renders the whole `ReviewStage` in its reference surface: `image-states/state-chip.tsx` shows the stage with the chip for each scenario, not the chip alone, and the review of P4 checks the modes, the zoom levels, the boxes, and the label there. The composed checks (stage with bar and list) belong to the review of P7.

### P5: bar

- Owns: `src/explorations/kits/ariakit/bar/**` (new), `src/explorations/components/notice/**`.
- Work: rows 4, 7 (hints in the bar), 10, 11 (control), 19, and the conflicts `stage-bar`, `save-words`. Exports: `ReviewBar` (props: `form: "pill" | "dock"`, `session`, `view` from `useStageView`, `stored` from `useStoredView`, `cover`, `message`), `getBarMessage(session)`, and the run approval dialog. Rewrite the reference variant `notice/bar-takeover.tsx` on `ReviewBar` with a forced message.
- Needs: P2. It codes against `StageView` and `StoredView` of `view-types.ts`, so it does not wait for P4.
- Review checks: both forms at 1440 and 1280; each message; the pill never changes width while a decision saves; the menu order; the fade stops with reduced motion.

### P6: navigation parts

- Owns: `src/explorations/kits/ariakit/{list,variants,result}/**` (new), `src/explorations/components/row-picture/**`.
- Work: rows 1, 2, 3, 5, and the conflicts `list`, `variant-nav` (the three forms of the variant control), `review-end`. Exports: `ScreenshotList` (field and rows), `VariantNav` (props: `form`), `RunProgress`, `ResultPage`. The choice `row-picture` (two variants).
- Needs: P2 (status, place, `regions.ts`). The form `tabs` is a copy in `kit/variants/tabs.tsx`; P6 imports no file of `pages/review`.
- Review checks: 3, 41, and 626 screenshots; a name of 68 characters; 12 and 24 variants; each pager mark, each counted mark, and each row is a link (Cmd and click opens a tab at that place); the first entry of the status select reads `Changes`; the bar glider of the list is on the end side.

### P7: review page

- Owns: `src/explorations/pages/{review,review-bar,review-variants}/**`.
- Work: section 3.6 from the parts of P4, P5, and P6: the shell (N6), the header, the keys (conflict `keys`), `useReviewPlace`, the cover on request (the cover of round 1 on the stage parts), the loading and error states, and the two choice surfaces (two and three thin variants). Delete the page files that the kit replaced (`footer-band.tsx`, `stage.tsx`, `plate.tsx`, `details.tsx`, `variant-tabs.tsx`, `use-mask-regions.ts`). The cover cells have no `KeyCap`: the position number of a cell is dimmed text (N2).
- Needs: P4, P5, P6.
- Review checks: glider bar x equal to the sidebar edge and the panel edge, and the panel keeps its gutter at the header, the window end, and the window bottom; the page never scrolls; a full review of `changes` with the keys of today only; `D` turns the mask off and on and never opens a diff mode; `⇧A` shows `6 approved` and an enabled Undo; Undo from the result page; a click on a list row leaves the result page and the header progress returns to it; the stored view after a reload and in another run; the stage share of the viewport at 1440 by 900 (state the number; it was 64.8%).

### P8: finish

- Owns: everything that is left.
- Work: copy the 15 folders that left the catalog to `parked-r2`, then delete them. Remove kit exports that nothing imports (`KeyLegend`, `ShortcutsButton`, `KeyCap`, `useRowKeys`, `DotStrip`, `RunRing`, and others that a search shows), but keep `preview-well.tsx` and `folder.tsx` while `pull-scope` and `review-variants` are open. `docs/design/round-2.md`. The state lines of `README.md`. A full run: each page and each choice in three data modes and two themes at 1440 and 1280, with no console error and no failed request. Check `record.ts` against `feedback.md` word for word.
- Needs: all.

## 9. Limits of this plan

- I did not build anything. The pill width (about 700 px), the row height in a sidebar of 20rem, and the stage share after the changes are estimates from the pictures of the picked variants.
- The glider checks (N5, N6) and the layer checks (N1, N4) used class and style changes in the live page, not props. The classes are the ones that the props emit. A builder must confirm them with the props. For N5 the links take `self-center`, so the `items-start` of the horizontal nav recipe does not need an override.
- N6 was checked in the browser with the gutter removed only at the sidebar side (`shots/rev-sidebar-glider.png`). The panel keeps its corners and its other three gutters.
- Three readings are mine and can be wrong: the list pages lose all keys (D-WORK-03 is a question about the review page, and I applied it to every page because the option with list keys was not selected); the zoom is not part of "remember user selection"; `Kbd` stays in tooltips and in the Keys list.
- The words `Queue`, red for the diff, and History without a table follow from answers and picks, but each one reverses something that the maintainer saw and picked in a folio page. Each is one small change to reverse.
- I read the main file, the review, and the picture of each of the 19 picked variants, and the exports of each `parts` folder. I did not read every `parts` file in full, so a move can meet a dependency on a scenario hook that this plan does not name.
- The specification files in `docs/design/components/` were used through the reviews and the code, not read in full.
- No production request and no measurement of the image requests of a thumbnail row. The cost in `row-picture` is from the text of the audit (REAL-04).
- The session of the fixtures has no conflict with another reviewer, so the message `Changed by …` shows only in the reference surface `Bar states`.
- D-WORK-04 and D-RES-05 were open in the audit document when the plan was written. The maintainer settled both in revision r3 of the audit document as the options that the lab follows (`approve-run` and `stored-name`).

## Review changes

An independent reviewer read this plan against `feedback.md`, the folio code, the 19 picked variants (code, specification, review, and a fresh picture of each), the primitives in `src/components/ariakit`, the lab code in `src/lab`, and the audit answers in `audit/content/decisions.json`. Two notes were measured again in the browser (`shots/rev-header-glider.png`, `shots/rev-sidebar-glider.png`). Skills loaded: `ariakit-general-workflow`, `ariakit-general-code-style`. Nothing in the repository was changed.

What held. Each primitive prop that the plan names exists with that name and that value: `$barOffset="frame"` and `$side="end"` on the glider and on `NavGlider` (`styles/glider.ts`, `styles/nav.ts:341-344`), `ButtonSlot $kind="shortcut"` with a default ink of 60 and a plain `<kbd>` (`styles/control.ts`, `docs/primitives.md:1066`), `$lighten` and `$mix` (`styles/layer.ts:152`, `:342`), `ShellSidebar $width="lg"` (20rem), `ShellMain $p="none"`, `ButtonGroup $gap="xs" $p="none"`, and `aria-current` as a selected state for a glider (`styles/ui.css:1184`). Each component and function that the composition table names exists in the named file. The fixture scenarios `probes`, `waiting`, and `capture-failed` exist. The statement about `apps/web/src/api/dashboard.ts:38` is true.

Changes, with the reason of each:

1. **`run-counts` is settled, not a question (5.6).** The plan asked the maintainer to choose between a bar that needs one more count and a row with words only. The picked run row already draws a two-part bar (rejected and open) with the data of today: its specification says so, its scenario `no-title` shows it, and `getReviewShares` computes it. So the pick and D-UX-04 both hold, and the option `words` would have removed a part of the pick that works. The row now keeps its bar in each data mode, the choice surface is gone, and the open decisions are 5, not 6.
2. **The next run card is compared in the page (5.3).** The surface `hero-layer` showed the card alone. The reason of its recommendation is the rank of the card over the sheets under it, which a card alone cannot show. It is now the page surface `inbox-hero` with two thin variants of the Queue. P3 owns it.
3. **N6 changes only what the note asks (section 2, 3.6).** The plan removed the whole gutter of the main panel, so the panel touched the header, the window end, and the window bottom, and its corners at the window were an open point. The note asks that the bar is connected to the edge of the sidebar and of the panel. The gutter now goes only between the sidebar and the panel (`ShellMain $p="none"` and `pt-2 pe-2 pb-2` on the element around the panel). Measured: bar x 254.3 to 256, panel x 256 to 1433, y 56 to 893.
4. **The key map was not complete (5.15).** The plan gave `keys` for `w`, `o`, and `[` only. `useReviewShortcuts` binds `S`, `D`, `F`, and `G` to `session.viewer.setMode` also with `labKeys: false`, and its `D` opens the old diff mode. The page keeps the mode in `useStoredView`, so these four keys must be in `keys` too. The plan now has the map.
5. **D-WORK-06 asks for a count, and the bar had none (5.20, new conflict `item-receipt`).** A whole-screenshot decision has no button in the pill, so the feedback "in the pressed button" showed nothing for it. The button of the same verdict now shows `6 approved`, with Undo enabled.
6. **The save words were said in two ways (section 1, 3.6).** The rule table said that the bar says `Saving`, and the page section said "no sentence". It is now one statement: the ring in the pressed button is the visible form (the pick), and `Saving…` is its tooltip and the text of the live region (D-RES-02).
7. **The note N8 against the default of D-WORK-02 (section 2, 5.7).** The plan did not say which wins in a new run. The note wins: the default view is for a browser with no stored value. The catalog text says that a mask that is off stays off in the next run, and the lab menu can reset the stored view.
8. **N7 covers each icon (section 2).** With more than 12 variants the pick shows counted marks. Each is now a link to the next variant with that state. The plan also says that the ring of the pick becomes the stock selected glider, because a ring `Frame` is not a control.
9. **`All` beside `Unchanged` (3.6, 5.10).** The plan added `Unchanged` to the status select of the pick and kept the first entry `All`, which then says `All 3` in a run of 626. The first entry reads `Changes`.
10. **`row-picture` says what speaks against it (5.5).** The option of D-UX-04 that was not selected names "the Worker serves the stored image" as a way to a thumbnail, with its cost. The question stays, and its text now quotes that sentence, so the maintainer answers with it in view.
11. **`stage-bar` says why the picks do not settle it (5.1).** The maintainer picked the pill over a docked decision bar, and the merged bar over a floating toolbar. The section now says both, counts the controls of the composed pill (15, against 4 in the pick), and says that the 4rem Fit gutter gives back most of the height gain for a large image. The recommendation stays, marked as weak.
12. **The result page has rules for when it shows and leaves (3.6).** The plan did not say how a reviewer gets from the result page to a screenshot and back.
13. **Lab chrome (7.3).** A saved data mode of round 1 would hide the new default `decided`, so the storage key of that knob changes. `SurfaceGroup.kind` goes, because a group now holds pages and components. The settled decision panel does not print the note two times. Four places with the two data modes written out are named.
14. **Build packages (section 8).** P2 no longer deletes `preview-well.tsx`: the variant `all-runs` of `pull-scope` is the pull request page of round 1 and uses it. A shared rule keeps each kit export until its last user is rebuilt, so the type check is clean after each step. P2 gets `regions.ts`, the one reader of regions from a mask, because P4 and P6 both need it and run at the same time. P6 copies the folder tabs into the kit and imports no page file. P4 shows the whole stage in its reference surface, so that its review has something to look at before P7. The rules for the one shared worktree and for the checks are written down.
15. **Audit answers that the plan did not name (section 1).** D-LOAD-04 and D-LOAD-05 (the skeleton is the first load only), D-RES-03, and the state of D-WORK-04, which was open then. The maintainer settled it in revision r3 of the audit document.
16. **Small text.** The Queue says why its `Review` button has no `↵` and the sign-in button has one. The cover cells have no key cap (N2). The bar says what each of the six read-only kinds of the session shows.

Checked and not changed: `pull-scope` stays a question to the maintainer (the text of D-UX-02 excludes the picked design, and the plan does not drop the pick in silence). `variant-nav` stays a choice of three (the stepper is the pick, and the cover is the idea of the page). `queue-word`, `diff-color`, `history-row`, and the list pages without keys stay settled: each follows from the text of an audit answer, from the contract, or from the question of a picked surface, and section 9 names each as a reversal of something that the maintainer saw.

## Amendments of the coordinator

The coordinator read the reviewed plan and approved it with these changes. Where this section and the plan differ, this section wins.

1. **The merged feedback (P1).** `src/lab/record.ts` takes `INCORPORATED_FEEDBACK` from `/Users/diegohaz/.claude/jobs/f65a6229/tmp/lab2/incorporated.json`, character for character (the note of UI-INBOX has line breaks). Do not copy the notes from `feedback.md`: its table puts that note on one line.
2. **Previews on the next run card (P3).** With the data mode `improved`, the next run card of the Queue shows the preview strip of round 1 (one row, at most four previews), below the title line. With `decided` and `today` it shows none, as the plan says. The reason: the maintainer picked a Queue that showed the changed pictures, and the audit answer D-UX-04 removes the field. The Data control lets the maintainer see what the answer costs.
3. **The question `row-picture` covers the Queue too (P1 for the catalog text, P6 for the surface).** The `description` of the surface `row-picture` ends with this sentence: "The same answer decides the preview pictures on the next run card of the Queue: with the data mode All proposed fields, that card shows them."
4. **D-WORK-04 (P5).** The audit lane finished. Its recommended option is `approve-run`: a menu item with no key, a confirmation that names the number of changes and how many were never opened, ordinary decision rows, and one Undo. It leaves out each failed comparison and each variant that a reviewer rejected. The lab follows it. The maintainer settled D-WORK-04 as `approve-run` in revision r3 of the audit document. Details: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/work-04/notes.md` and the D-WORK-04 part of `apps/lab/audit/content/sections/60-workspace-viewer.html`.
5. **D-RES-05 (P5).** Its recommended option is `stored-name`: the conflict message names the reviewer with the stored profile name, and it has another text for the person's own second tab. Take the exact texts from the option `stored-name` in the record; do not write new ones. The decision was open in the audit document then. The maintainer settled it as `stored-name` in revision r3 of the audit document. The reference surface `Bar states` shows both texts. Details: the decision D-RES-05 in `apps/lab/audit/content/decisions.json` and the D-RES-05 part of `apps/lab/audit/content/sections/65-resilience-a11y.html`.
6. **Readings that stay, and that the catalog text must name.** The three readings of section 9 of the plan stay as planned: the list pages bind no key, the zoom is not a stored selection, and `Kbd` stays in tooltips and in the Keys list. The same for the three reversals: the word Queue, red for the diff, and History without its table. P1 writes one tradeoff line for each in the catalog text of the page that it touches, so that the maintainer sees it and can object in the notes.
7. **Screenshots.** Each builder and each reviewer saves its final pictures to `/Users/diegohaz/.claude/jobs/f65a6229/tmp/lab2/shots/<package>/` with names of the form `<surface>-<scenario>-<width>-<theme>-<data>.png`. The coordinator looks at them.
8. **The dev server.** The lab runs at <http://127.0.0.1:4320> and stays running. Do not stop it, and do not start a second one on that port. A new file under `src` needs no restart.

## As built

The lab is built as the plan and the amendments say, except for the points below. Each point names the section of the plan that it changes. The rules of each kit part are in `src/explorations/kits/ariakit/README.md` and in the `README.md` of `stage/` and of `bar/`.

### The lab and its records

- **The copies of the code that left (section 4, P8).** `parked-r2` was read-only for the builders, so the copies are in the scratch folder of the build session: the 15 component folders in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/lab2/parked-p8/components/`, and the round 1 page files that the kit replaced in `lab2/p3/removed/` and `lab2/p7/removed/`. Four part files of the round 1 Queue (`hero.tsx`, `toolbar.tsx`, `run-card.tsx`, `run-rows.tsx`) have no copy. `apps/lab` is not tracked by git.
- **The catalog files (7.1).** The catalog is `catalog-choices.ts` (the open choices), `catalog-pages.ts` and `catalog-page-variants.ts` (the pages), and `catalog-components.ts` (the reference surfaces). A surface can name in `pages` the pages that it also decides: `row-picture` names `inbox` and `review`.
- **Lab chrome beyond the list of 7.3.** The gallery has no Directions section while the lab has one direction. A surface with one variant has no stepper and no Compare all. A settled surface takes no like, no drop, and no variant note. The preview takes `still=1`, which makes a thumbnail take no focus.
- **The fixture types (section 6).** `ReviewPullRequest.author`, `branch`, and `baseBranch` are optional, because the decided data has only the number, the title, and the URL of a pull request.
- **The reference surface Bar states (7.1).** Its scenario `complete` is gone (the result page has it), and `conflict-own` is new (amendment 5).

### The kit

- **`PlaceLink` is an anchor that navigates with the router (7.5).** The plan names the router `Link`. A router link to the same path has `aria-current="page"`, so every mark of a strip would be the selected one.
- **The page nav has inline room (N5).** `MainNav` has `px-3` beside `h-full`. The nav clips its content with corners that are concentric with the shell. Without the room, the bar of the first link (Queue) and of the last link (Status) lost one corner to that clip, and the bar of History did not. The links do not move.
- **The status table (5.13).** The four states that only a run has also have a glyph, so that the legend shows 15 states in both forms: `Check` passed, `CircleDashed` capturing, `RefreshCw` rerun needed, `ArrowRight` replaced. `Comparing` and `Capturing` are neutral, not brand.
- **The run row (row 15).** A closed run reads its reason (`Replaced`, `Closed`) and keeps its last result as the disc. The count of a run to review is its open changes: `17 changes · 1 rejected` for a run with 18 pending variants, one of them rejected.
- **`zoomSteps` is in `view-types.ts`**, the contract that the stage and the bar share. The two parts never import each other.
- **No round 1 export is left in the kit**, except three files of the questions that were open: `folder.tsx`, `preview-well.tsx`, and `progress.tsx`. Round 3 removed `folder.tsx` and `progress.tsx`. `preview-well.tsx` stays for the next run card of the Queue.

### The pages

- **Queue (3.2).** The meta line of the next run card starts with the compact status pill. The card reads the count of the run row, and its button reads `Review`. The three runs to review of the fixtures have no decision, so their bar is an empty track in each data mode. History shows the bar with its parts.
- **History (3.3).** The `2 earlier` button stands after the age of its row. CSS anchor positioning puts it there, so the page has no copy of the row geometry.
- **Pull request (3.5).** The title prefix is `#7754`, not `Pull request #7754`, so that the title stays on one line. The sheet is one row: the pill, the bar over the count, and the action. The action reads `Review`, and a run that passed has a neutral `Open run`. While the page waits, Capture is the step in progress: without a run, the service does not know that the capture is complete.
- **Review, the bar (3.6, 5.1).** The pill is 874 px wide with 15 controls, not about 700 px. The region stepper is always in the bar, and it is off for a variant without a region: with a stepper that comes and goes, Approve moved under the pointer. The bar has two rows below 57rem of its own width. A message is a sentence: `Not saved. Check your connection.` The conflict texts are the texts of the option `stored-name` of D-RES-05 (amendment 5), not `Changed by …`.
- **Review, the stage (3.6).** The mask lies on the current image only, so `F` and `G` also switch the tint. The state chip has the size of a status pill, and the two chips with Retry are one step larger. A jump to a region stops at 400%. The size in an image label is Inter with tabular figures, as the pick "Ring" has it.
- **Review, the stage share (P7).** At 1440 by 900 the stage is 1097 by 771 px with the pill, which is 65.3% of the viewport, and 1097 by 723 px with the docked bar, which is 61.2%. The page of round 1 had 64.8%.

### The last check

P8 loaded each page, each option of each choice, and each reference surface in the three data modes and the two themes at 1440 by 900 and 1280 by 800. The State section of `README.md` has the result.

The check found two defects of the stage with one cause, and P8 repaired them in `stage/images.ts` and `regions.ts`. The stage kept the images that the document has shown in a set of the module, and it read that set as if it were state.

- **A loaded image stayed hidden.** The end of an image request changed only the set, so no render followed. The image showed with the next render of the stage, which was the next timer of the load clock: 150 ms, 400 ms, or 6 s after the request started. With the two images of the stage held back for 1.5 s, the stage was ready 5.1 s after the last request ended. After the repair it is ready 38 ms after it. With 3 s the numbers are 3.6 s and 99 ms. The fixture images of the lab load in less than 400 ms, so the lab shows the defect only on a slow machine or a slow network.
- **The reference surface Bar states failed hydration in the component explorer.** The explorer takes the parts of a page over from the server markup one by one. A stage that came after another stage with the same image read the set in that render, and it did not agree with the server markup. Before the repair, 12 of 12 loads of `/components/notice` logged a hydration error. After it, 0 of 12 do. The bare preview takes a page over in one pass, so the checks of the earlier packages did not show the defect.

The end of a request is now state of the stage, and neither the set nor the store of mask regions answers in the render that takes over the server markup (`use-hydrated.ts`).

A final review looked at the whole lab after P8: the gallery, the explorers, the feedback page, each page and each option, and one complete review of the scenario `changes` with the keys only and with the pointer only. It repaired the bar of the page nav (see The kit). Its pictures are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/lab2/shots/final/`.
