# Changes feed: design brief

Direction id: `changes`. Lens: the GitHub "Files changed" page. This brief is complete for a builder. Sizes are targets at a 14 px base font and can differ by 4 px.

## 1. Concept

**Name:** Changes feed.

**Tagline:** Review a run like a pull request: one scroll of changed screenshots that folds shut as you decide.

**The idea in five sentences**

1. A run opens as one page that scrolls, like "Files changed": each screenshot is a box, and each changed variant is a section in that box with its own compare control and its own Approve and Reject.
2. A sticky tree of screenshot paths on the left and one sticky toolbar on top are the only fixed chrome.
3. One change is the cursor at all times. It has a brand rail and labelled buttons with key hints, and it follows the keys, a click, and the scroll.
4. A decision folds the change into a one-line row, and a fully decided screenshot folds into its header, so the open blocks are the work that is left.
5. The other pages use the same parts (boxed row lists, a Runs and Changes tab pair, a merge box, a timeline), so the app reads as the visual-review tab of a pull request.

**Signature moment:** Press `A`. The change folds into a ticked line, the next change rises to the same place under the bar, and the tree gets one more tick. After the last decision the page is a short checklist under "Review complete".

**Principles**

1. One scroll holds the whole run. Nothing is behind a click, and the next change is already on screen and already loaded.
2. A decision folds its block. Open blocks are work, lines are done.
3. The cursor is always visible. A key or a button acts on one marked change, never on an unmarked position of the scroll.
4. Use the GitHub parts only where they carry a Visonaut fact. Do not copy GitHub chrome.
5. Screenshots are the only pictures. Chrome is boxes, mono facts, and one mark for each state.

**Words used in this brief:** screenshot (an item), variant, change (a variant that takes a decision), run, baseline, current, diff. "Screenshot box", "change bar", "line", and "mat" are design terms for builders and never show in the UI.

## 2. Visual system

### 2.1 Layers

| Surface    | Primitive and props                                                 | Notes                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas     | `body`                                                              | The feed, the lists, and the tree lie on the canvas. No page-level card.                                                                                                           |
| Box        | `Frame $border $rounded="xl"` with no fill                          | The unit of every page: screenshot box, run list, merge box, status box. A box is a border, not a raised surface.                                                                  |
| Band       | `Frame $lightnessOffset={1}` with `border-b` or `border-t`          | Header and footer bands of a box. Use `$cover` when the box has padding.                                                                                                           |
| Sticky bar | `Frame $layer` (paints the parent color) with `border-b`            | The toolbar and the change bar. Opaque, no blur. `shadow-sm` only while stuck.                                                                                                     |
| Mat        | `Frame $darken $p={3}`                                              | The recessed surface under screenshots. Each image has a 1 px ring (`Frame $border $rounded="none"`) so the image edge is visible on every theme.                                  |
| Callout    | `Frame $layer={role} $mix={12} $border $edge={role}`                | Read-only, failed run, failed save, completion.                                                                                                                                    |
| Overlay    | `Popover`, `Dialog`, `Tooltip`, `ak.Menu` with the `popover` recipe | The only surfaces with a shadow.                                                                                                                                                   |
| Brand      | `$layer="brand"`                                                    | Three uses only: the Approve button of the cursor change (or the one main button of a page), the cursor rail, and the swipe handle. Gliders and the focus ring use their defaults. |

Borders: each box has one 1 px border. Rows in a box have `border-t` seams. Controls in a bar have no border, except one bordered `ButtonGroup` for the compare control and the outline Reject button. Rows in a list have no border of their own.

### 2.2 Type

| Size                | Use                                                                  | Weight                                    |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| 12 px (`text-xs`)   | Meta lines, counts, captions, key legend                             | 400, 500 for counts                       |
| 14 px (`text-sm`)   | All controls, rows, labels, body text                                | 400, 500 for row titles and change labels |
| 16 px (`text-base`) | Dialog and popover headings, the completion heading                  | 600                                       |
| 20 px (`text-xl`)   | The pull request title on the pull page and the sign-in heading only | 600                                       |

Mono (JetBrains Mono, 12 px, `tabular-nums`): screenshot keys (`dialog/focus/open`), commit hashes, branch names, image sizes, percentages, pixel counts, error IDs. Inter for all other text. In a screenshot key, the folder part has `ak-ink-60` and the last segment has full ink. A long key truncates the folder part first.

Set `text-sm` on the `Shell` root, so every spacing step follows the 14 px base and the density control.

### 2.3 Spacing and density

- Page gutter: `ShellMain $p="1rem"` (also keeps the declared radius of the boxes, see pitfall 3 of the primitives guide).
- Gap between boxes: `gap-3`. Padding of a mat: `$p={3}`. Gap between two panes: `gap-3`.
- Row heights: two-line list row 56 px, one-line list or table row 40 px, tree row 28 px, line (folded change) 32 px, screenshot header 34 px, change bar 36 px, toolbar 45 px, top bar 49 px (`ShellHeader $height="sm"`).
- Content width: lists `max-w-5xl`, pull page `max-w-4xl`, status `max-w-3xl`, review feed full width.

### 2.4 Radius

Boxes `xl`, popovers `2xl`, controls `md`, badges `full`. Screenshots are never rounded. Pass `$forceRounded` to a `Badge` inside a band or a table cell.

### 2.5 Icons

`lucide-react`, 1.25em in a slot, stroke 1.5. Icon-only controls always have `aria-label` and a `Tooltip` with the name and a `Kbd`. Framework and browser marks (React, Solid, Chrome, Firefox, Safari) show before the axis word in a change label, 14 px, only for the axes that differ inside the screenshot.

### 2.6 Status vocabulary

One rule: color tells who must act (warning: you; danger: the check fails; success: a person finished it; neutral: nobody). Shape tells what the thing is. Each mark sits beside a word or a count, or has an `aria-label`.

| Word                                 | For          | Role            | Mark (lucide)                   |
| ------------------------------------ | ------------ | --------------- | ------------------------------- |
| Needs review ("to review" in counts) | run, change  | warning         | `Circle`                        |
| Seen (lab only)                      | change       | warning         | `CircleDot`                     |
| Approved                             | change       | success         | `CircleCheck`                   |
| Passed                               | run          | success         | `CircleCheck`                   |
| Rejected                             | run, change  | danger          | `CircleX`                       |
| New, auto-approved                   | change       | neutral, ink 70 | `CirclePlus`                    |
| Removed, auto-approved               | change       | neutral, ink 70 | `CircleMinus`                   |
| Unchanged                            | variant      | neutral, ink 40 | `Equal`                         |
| Capturing                            | run          | neutral         | `CircleDashed`, static          |
| Comparing                            | run, variant | neutral         | `CircleDashed`, turning         |
| Failed (run), Problem (variant)      | run, variant | danger          | `TriangleAlert`                 |
| Rerun needed                         | run          | danger          | `RefreshCcw`                    |
| Replaced                             | run          | neutral, ink 50 | `CircleArrowRight`              |
| Critical, Warning                    | alert        | danger, warning | `OctagonAlert`, `TriangleAlert` |

Three forms of one component `StatusMark`: mark only (rows and lines), `Badge $layer={role}` with a `BadgeSlot` mark and a `BadgeLabel` (page headers), and a mark strip (one 12 px mark for each variant of a screenshot, in the tree and in the screenshot header; above 8 variants it becomes a count such as `5/12`). A decision that waits for the server shows its mark with a dashed outline.

The diff signs are separate from status: a caption starts with `−` for the baseline and `+` for the current image. Only these two signs take the danger and success text colors.

### 2.7 Motion

| What                      | Motion                                                                                                 | Reduced motion                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Fold on decision          | Height to the line in 140 ms ease-out (`grid-template-rows` 1fr to 0fr), content opacity to 0 in 80 ms | Instant                                                  |
| Scroll to the next change | Instant jump, never smooth                                                                             | Same                                                     |
| Mark change               | Scale 0.8 to 1 in 120 ms                                                                               | None                                                     |
| Image decode              | Opacity 0 to 1 in 120 ms                                                                               | None                                                     |
| Blink mode                | The cursor change alternates each 600 ms. No other block moves                                         | No automatic alternation. Each `B` press flips the image |
| Swipe divider             | Follows the pointer directly                                                                           | Same                                                     |
| Skeleton                  | `animate-pulse`                                                                                        | Static                                                   |
| Comparing mark            | Slow turn                                                                                              | Static dashed ring                                       |

## 3. Shell and navigation

### 3.1 What is always on screen

Every page has one top bar of 49 px and nothing else that is global.

- List pages (queue, history, status): the top bar is sticky. Start: the mark (link to the queue) and `ariakit/ariakit` in `ak-ink-60`. Center: a horizontal `Nav` with a bar glider: `Queue 5`, `History`, `Status 3`. End: a `?` button (keys popover) and the account button.
- Run pages (pull, review): the same bar holds a breadcrumb in place of the nav and it is not sticky (`$sticky={false}`), so it scrolls away. Start: mark, `Queue`, chevron, `#4863 Migrate component examples…` (truncated), state `Badge`. Center: `Runs 3` and `Changes 33` as a horizontal `Nav` with a bar glider. End: commit and attempt in mono (a `PopoverDisclosure` with the run facts), a GitHub icon link, the status dot, the account button.
- Review only: one sticky toolbar under the top bar and the sticky tree.

Account: an avatar slot with initials (`ButtonSlot $kind="avatar" $layer="brand"`). The popover has `@diegohaz`, `Write access`, a theme select (System, Light, Dark), and `Sign out`. 8 words.

Service alerts: the `Status` nav link has a count badge (danger for a critical alert, warning for warnings only). Run pages show the same state as a dot button at the end of the top bar. The queue adds one callout line only when a critical alert exists. There is no bell and no banner on other pages.

### 3.2 How a person moves

```text
GitHub check ──► /pulls/4863/changes ──► (same header) Runs tab /pulls/4863
Queue row ─────► /runs/<id> (Changes tab)          │
History row ───► /runs/<id>                        └─► attempt row ─► /runs/<id>
Tree row, J, K, N ─► screenshot and variant inside the feed (URL search changes, no navigation)
Status link ───► /status
```

- Queue to run: Enter on a row, or a click. Run to queue: the mark, the `Queue` crumb, or "Next run" in the completion block.
- Run to pull request: the `Runs` tab. Pull request to run: "Review changes" or an attempt row.
- Screenshot to screenshot: the tree, `↑` and `↓`. Variant to variant: `J` and `K`, `←` and `→`, the scroll.

### 3.3 URL model

| URL                                    | Page                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `/`                                    | Queue                                                                             |
| `/history?q=&state=&sort=`             | History                                                                           |
| `/status`                              | Status                                                                            |
| `/pulls/$number`                       | Pull request, Runs tab. `?check=` keeps its present meaning                       |
| `/pulls/$number/changes`               | Opens the newest run that takes decisions (else the newest run) as `/runs/$runId` |
| `/runs/$runId?item=&variant=&q=&show=` | Review feed. `item` and `variant` are the cursor                                  |

The cursor writes `item` and `variant` with a history replace when it moves by key or scroll, and with a push when the person picks a tree row. A link with `item` and `variant` opens the feed at that change. The view mode is not in the URL. In the lab, use `LabLink` for each of these moves.

### 3.4 Page titles

`(5) Queue · Visonaut`, `History · Visonaut`, `Status · 3 alerts · Visonaut`, `#4863 Migrate component examples… · Visonaut`, `22 to review · #4863 · Visonaut`, `Reviewed · #4863 · Visonaut`, `Sign in · Visonaut`.

### 3.5 Sketches

Desktop, list page and run page:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ ariakit/ariakit          Queue 5    History    Status 3                      ?    DH   │ 49 sticky
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                         ( one centered column of boxes )                                 │
└──────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ Queue › #4863 Migrate component ex… (○ Needs review)   Runs 3  [Changes 33]  2f3a9c1 · attempt 2  ↗ ● DH │ 49 scrolls away
├────────────────────┬─────────────────────────────────────────────────────────────────────┤
│ tree (sticky)      │ toolbar (sticky)                                                     │ 45
│                    │ feed (page scroll)                                                   │
└────────────────────┴─────────────────────────────────────────────────────────────────────┘
```

Phone:

```text
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ ◎  Queue ▾          ●3   DH  │   │ ‹ #4863   ○ 22 to review  DH │ 49
├──────────────────────────────┤   ├──────────────────────────────┤
│ ( one column of boxes )      │   │ jump bar (sticky)            │ 45
│                              │   │ feed                         │
│                              │   │ Reject | Approve (fixed)     │ 56
└──────────────────────────────┘   └──────────────────────────────┘
```

On a phone the nav is a `PopoverDisclosure` named after the current page (`Queue ▾`).

## 4. Pages

### 4.1 Sign-in

**Wireframe, 1440**

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎                                                                                        │ 49
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│       ┌────────────────────────────┐      ┌ sample change, aria-hidden, ink 50 ───────┐ │
│       │ ariakit/ariakit            │      │ ○ React · Dark    0.15%          ✕    ✓   │ │
│       │ Sign in to review #4863    │      │ ┌────────────┐    ┌────────────┐          │ │
│       │ You need write access to   │      │ │  baseline  │    │ current ▢  │          │ │
│       │ ariakit/ariakit.           │      │ └────────────┘    └────────────┘          │ │
│       │ [ Sign in with GitHub    ] │      └────────────────────────────────────────────┘ │
│       └────────────────────────────┘                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Wireframe, 390**

```text
┌──────────────────────────────┐
│ ◎                            │ 49
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ ariakit/ariakit          │ │
│ │ Sign in to review #4863  │ │
│ │ You need write access to │ │
│ │ ariakit/ariakit.         │ │
│ │ [ Sign in with GitHub  ] │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Regions and primitives:** top bar `ShellHeader` with the mark only. Card `Frame $lighten $border $rounded="2xl" $p="1.5rem"` with `max-w-sm`. Repository `Text` mono `ak-ink-60`. Heading `Heading` with `className="mt-0 mb-0 text-xl"`. Button `Button $layer="brand"` with a GitHub mark in a `ButtonSlot`. Sample block: the real change block component with `aria-hidden` and `inert`, the `dialog` scene from `getScreenshotSet`, shown from 1024 px.

**Copy and scenarios**

| Scenario     | Exact copy                                                                                                                                | Words |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `guest`      | `Sign in to review #4863` (without a target: `Sign in to Visonaut`) / `You need write access to ariakit/ariakit.` / `Sign in with GitHub` | 15    |
| `signing-in` | Same card. The button is disabled with a `ProgressCircular` and reads `Opening GitHub`                                                    | 13    |
| `forbidden`  | Badge `@okafor-amara` / `No access` / `You need write access to ariakit/ariakit.` / `Use another account` / `Back to GitHub`              | 14    |
| `error`      | `Could not sign in` / `Try again in a moment.` / `Error ID 7f3a9c` in mono / `Retry`                                                      | 12    |

Word budget: 16 for each state. The sample block shows for `guest` and `signing-in` only.

**Interactions and keys:** Enter activates the button (it has the initial focus). `switchAccount()` returns to `guest`. No other key.

**Removed:** the eyebrow "Visual regression review", the headline "Every change. A clear decision.", the marketing sentence, the nav that cannot work for a guest, and the two other sign-in designs. One gate replaces three.

### 4.2 Inbox (queue)

**Wireframe, 1440 (`busy`)**

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ ariakit/ariakit           [Queue 5]   History   Status 3                        ?    DH    │ 49
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│    ┌ max-w-5xl ────────────────────────────────────────────────────────────────────────┐     │
│    │ ⬣ A GitHub check needs attention                                        Status ›  │     │ 40 critical only
│    │ [⌕ Filter runs                    /]                              ⟳  12 s ago     │     │ 40
│    │ ┌────────────────────────────────────────────────────────────────────────────────┐│     │
│    │ │ To review · 5                                                                  ││     │ 32 band
│    │ │ ✕  Migrate component examples to the new style rec…  ■■□□□  22 to review · 2 rejected ││ 56
│    │ │    #4863 · diegohaz · 2f3a9c1 · 12 min ago                                   ↵ ││     │
│    │ │ ○  Update dependency @playwright/test to v1.63.0     □□□□□  79 to review       ││     │
│    │ │    #4831 · renovate · 77aa01c · 1 h ago                                        ││     │
│    │ │ ○  Fix Combobox popover reposition after the virtu…  □□□□□  6 to review        ││     │
│    │ │    #4819 · …                                                                   ││     │
│    │ │ ○  main · Move Tooltip closer to its anchor (#4849)  □□□□□  4 to review        ││     │
│    │ └────────────────────────────────────────────────────────────────────────────────┘│     │
│    │ ┌────────────────────────────────────────────────────────────────────────────────┐│     │
│    │ │ Running · 2                                                                    ││     │
│    │ │ ◌  Merge queue · #4846 #4840                    ▓▓▓░░░  Capturing 5 of 8        ││     │ 40
│    │ │ ◌  #4855 Fix Tabs selection indicator position  ▓▓░░░░  Comparing 48 of 120     ││     │
│    │ └────────────────────────────────────────────────────────────────────────────────┘│     │
│    │ ┌────────────────────────────────────────────────────────────────────────────────┐│     │
│    │ │ Needs attention · 2                                                            ││     │
│    │ │ △  #4844 Add forced colors styles to Checkbox…  Failed · capture shard 3 timed out ││  │
│    │ │ ↻  main · a225ac0                               Rerun needed                    ││     │
│    │ └────────────────────────────────────────────────────────────────────────────────┘│     │
│    │ Baseline 128                                                                      │     │
│    └───────────────────────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Wireframe, 390**

```text
┌──────────────────────────────┐
│ ◎  Queue ▾          ●3   DH  │ 49
├──────────────────────────────┤
│ [⌕ Filter runs             ] │
│ ┌──────────────────────────┐ │
│ │ To review · 5            │ │
│ │ ✕ Migrate component exa… │ │
│ │   #4863 · 12 min ago     │ │ 72, three lines
│ │   ■■□□□ 22 to review · 2 rejected │
│ │ ○ Update dependency @pl… │ │
│ │   #4831 · 1 h ago        │ │
│ │   □□□□□ 79 to review     │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Running · 2              │ │
│ │ ◌ Merge queue  Capturing │ │ 48
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Regions and primitives**

| Region           | Primitive                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top bar          | `ShellHeader $height="sm"`, `Nav $layout="horizontal" glider={{ $kind: "bar" }}`, `NavLink` with `NavSlot $kind="badge"`                                                                                                                                                                                                                  |
| Column           | `ShellMain $p="1rem" $maxWidth="64rem"`, one wrapper `div` with `grid gap-3` in `ShellMainBody`                                                                                                                                                                                                                                           |
| Filter           | `InputGroup` with a `Search` slot and `InputSlot $kind="shortcut"` holding `Kbd` `/`                                                                                                                                                                                                                                                      |
| Refresh          | Icon `Button` with a `Tooltip`, relative time as `Text` in a `time` element with the absolute time in `title`                                                                                                                                                                                                                             |
| Group box        | `Frame $border $rounded="xl"`, band `Frame $lightnessOffset={1}` with `TextFrame`                                                                                                                                                                                                                                                         |
| Rows             | `ak.Composite` with `ak.CompositeItem render={<Button render={<LabLink …/>} />}`: `ButtonSlot` mark, `ButtonContent` with `ButtonLabel` (title, 500) and `ButtonDescription` (meta, mono parts), trailing meter and `Text`, `ButtonSlot $kind="shortcut"` with `↵` on the focused row. `ButtonGlider $state="hover"` and `$state="focus"` |
| Meter            | Five 8 px squares (`Frame $rounded="xs"`): success for the approved share, danger for the rejected share, `$lightnessOffset={2}` for the rest. `role="img"` with a full `aria-label`                                                                                                                                                      |
| Running progress | `Progress value $thickness={1}` with `aria-label`                                                                                                                                                                                                                                                                                         |
| Callout line     | Callout recipe with `$layer="danger"`, one line                                                                                                                                                                                                                                                                                           |

**Copy:** nav `Queue`, `History`, `Status`. `Filter runs`. Group heads `To review · 5`, `Running · 2`, `Needs attention · 2`. Row facts `22 to review · 2 rejected`, `79 to review`, `Capturing 5 of 8`, `Comparing 48 of 120`, `Failed · {error}`, `Rerun needed`, `Replaced`. Footer `Baseline 128`. Fixed chrome: 12 words. A row adds at most 4 words to its title and data. Budget for the busy page: 40 words outside titles.

A run without a pull request title uses `getRunTitle(run)`. The number or the branch stays first in mono, so `#7746 Pull request` still reads as a row.

**Scenarios**

| Scenario    | What shows                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `busy`      | Three boxes as drawn. A box with no run is not drawn. The callout line shows only for a critical alert                                                                                                                    |
| `single`    | One box with one row. The row has the focus. Under it, a strip of up to four diff thumbnails from `run.previews` (120 px high) is open, and the row end has a brand button `Review` with `↵`                              |
| `empty`     | No box. A `CircleCheck` mark, `All caught up` (3 words), `Baseline 128 · last run passed 2 h ago`, then a quiet box `Recent` with three one-line rows from `recentRuns`                                                   |
| `first-run` | `No runs yet` / `Run the visual tests in CI to create the baseline.` / button `Open the workflow`. 16 words                                                                                                               |
| `loading`   | See section 5                                                                                                                                                                                                             |
| `error`     | Callout in place of the boxes: `Could not load runs` / `Try again in a moment.` / `Retry` / `Error ID` in mono. After a failed refresh the old rows stay and the line reads `Could not refresh. Showing runs from 15:18.` |

**Interactions and keys:** `J` or `↓` next row, `K` or `↑` previous row (real focus moves), Enter opens the run, `/` focuses the filter, Escape clears it, `?` opens the keys popover. `→` on a row opens its thumbnail strip, `←` closes it. Refresh keeps the rows on screen and shows a 2 px `Progress` under the top bar.

**Removed:** the repository eyebrow, the title "Your review queue.", the sentence under it, the three stat tiles, the 240 px cards, the "Review changes" button on each card, "Attempt 1", absolute dates, the "View history" footer link, and the page blank during a refresh.

### 4.3 History

**Wireframe, 1440 (`full`)**

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ ariakit/ariakit            Queue 5   [History]   Status 3                       ?    DH    │ 49
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│   ┌ max-w-5xl ─────────────────────────────────────────────────────────────────────────┐     │
│   │ [⌕ Search runs                      /]                                  Newest ▾   │     │ 40
│   │ [All 40]  Needs review 4   Rejected 1   Passed 21   Failed 3   Replaced 9   Running 2 │   │ 36
│   │ ┌────────────────────────────────────────────────────────────────────────────────┐ │     │
│   │ │ Run                                             Changes  Status        Commit   When │ │ 32 sticky head
│   │ │ Today                                                                          │ │     │ 28
│   │ │ ✕ #4863 Migrate component examples to the new st…   33   Rejected      2f3a9c1  12 min │ 40
│   │ │ ○ #4831 Update dependency @playwright/test to v1…  128   Needs review  77aa01c   1 h │ │
│   │ │ → #4863 Migrate component examples… · attempt 1      —   Replaced      2f3a9c1   2 h │ │ ink 60
│   │ │ ✓ main  Fix Select popover border radius (#4852)     0   Passed        9c1d0aa   3 h │ │
│   │ │ Yesterday                                                                      │ │     │
│   │ │ ✓ #4835 Update Popover shadow tokens                 12  Passed        51be0d2  Oct 4 │ │
│   │ └────────────────────────────────────────────────────────────────────────────────┘ │     │
│   │ Latest 100 runs                                                                    │     │
│   └────────────────────────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Wireframe, 390**

```text
┌──────────────────────────────┐
│ ◎  History ▾        ●3   DH  │ 49
├──────────────────────────────┤
│ [⌕ Search runs             ] │
│ [All 40 ▾]        [Newest ▾] │
│ Today                        │
│ ┌──────────────────────────┐ │
│ │ ✕ Migrate component exa… │ │ 56, two lines
│ │   #4863 · Rejected · 12 min │
│ │ ○ Update dependency @pl… │ │
│ │   #4831 · Needs review · 1 h │
│ └──────────────────────────┘ │
│ Yesterday                    │
└──────────────────────────────┘
```

**Regions and primitives:** search `InputGroup`. Sort `ComboboxSelect $layer="transparent"` (`Newest`, `Oldest`, `Most changes`). Status tabs: the page tabs recipe (`Tabs` flat, `TabGlider $kind="bar"`, `TabSlot $kind="badge"` counts), one tab for each state in `history.states`, bound to `setFilter`. Table: `Table` with `container={{ $border: true }}`, `$borderInline={false}`, `$p={2}`, `head={{ $sticky: "top" }}`, head cells with `sort` bound to `toggleSort`. Day rows: a `TableRow` with one head cell and `colSpan`, from `groupRunsByDay`, shown only while the sort key is `created`. The run cell holds the mark, the number in mono, and the title as a `Link` to the run. A badge in a cell needs `$forceRounded`; this table uses a mark and a word in place of a badge. On a phone the table becomes the two-line row list of the queue and the tabs become a select.

**Copy:** `Search runs`. Tabs `All 40`, `Needs review 4`, `Rejected 1`, `Passed 21`, `Failed 3`, `Replaced 9`, `Running 2` (Capturing and Comparing share the Running tab). Heads `Run`, `Changes`, `Status`, `Commit`, `When`. Day rows `Today`, `Yesterday`, a date. Footer `Latest 100 runs`. `attempt 1` shows only when the pull request has more than one attempt. Fixed chrome: 22 words. A row adds its status word only. Budget: 30.

**Scenarios**

| Scenario        | What shows                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `full`          | As drawn. Replaced rows at ink 60                                                                                                  |
| `no-match`      | The search field holds `datepicker`. The table body is one row: `No runs match “datepicker”` and a button `Clear filters`. 6 words |
| `empty`         | No tabs and no table. `No runs yet`. 3 words                                                                                       |
| `loading`       | See section 5. The search field takes input before the data arrives                                                                |
| `error` (extra) | The queue error callout                                                                                                            |

**Interactions and keys:** `/` search, `J` and `K` move the row focus, Enter opens the run, a head click sorts, a click on `#4863` opens the pull request page.

**Removed:** the title "Run history.", the sentence about the latest 100 runs, the "Result" select and its label, the placeholder "Search loaded history…", the sentence "Search and filters apply to the loaded runs.", and absolute dates.

### 4.4 Status

**Wireframe, 1440 (`alerts`)**

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ ariakit/ariakit            Queue 5   History   [Status 3]                       ?    DH    │ 49
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│        ┌ max-w-3xl ────────────────────────────────────────────────────────────────┐         │
│        │ Status                                             Checked 12 s ago  ⟳  ⓘ │         │ 40
│        │ ┌────────────────────────────────────────────────────────────────────────┐ │         │
│        │ │ ⬣  1 critical · 2 warnings                                             │ │         │ 44 band, danger tint
│        │ ├────────────────────────────────────────────────────────────────────────┤ │         │
│        │ │ ▸ ⬣ A GitHub check needs attention        3f2a1c9e…      since 14:55   │ │         │ 44
│        │ │ ▾ △ Database capacity needs attention     database       since Oct 3   │ │         │
│        │ │       What to do                                                       │ │         │
│        │ │       {alert.action}                                                   │ │         │
│        │ │       First seen Oct 3, 09:12 · Last seen 3 min ago                    │ │         │
│        │ │       database-capacity · headroom-warning  ⧉          Recovery guide ↗ │ │         │
│        │ │ ▸ △ A backup needs attention              backup-2026-10-04-…  since 04:30 │       │
│        │ ├────────────────────────────────────────────────────────────────────────┤ │         │
│        │ │ Database  ▓▓▓▓▓▓▓▓░░  742.4 of 900 MiB       Captures  ▓▓▓░░░░░  3 of 8 │ │         │ 56 band
│        │ └────────────────────────────────────────────────────────────────────────┘ │         │
│        └────────────────────────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Wireframe, 390**

```text
┌──────────────────────────────┐
│ ◎  Status ▾         ●3   DH  │ 49
├──────────────────────────────┤
│ Status      12 s ago  ⟳  ⓘ   │
│ ┌──────────────────────────┐ │
│ │ ⬣ 1 critical · 2 warnings │ │
│ │ ▸ ⬣ A GitHub check needs │ │ 56, two lines
│ │     attention · 14:55    │ │
│ │ ▸ △ Database capacity …  │ │
│ │ ▸ △ A backup needs …     │ │
│ │ Database ▓▓▓▓▓▓▓░ 742.4 of 900 MiB │
│ │ Captures ▓▓▓░░░░░ 3 of 8 │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Regions and primitives:** heading `Heading` with `text-base` (the page name is the only text heading of this direction, because the box has no other name). Freshness `Text` in a `time` element. Refresh icon `Button` named `Check now`. `ⓘ` is a `TooltipAnchor`. Box `Frame $border $rounded="xl"`. Result band `Frame $layer={role} $mix={12}`. Alert rows: `DisclosureGroup` with one `Disclosure split` for each alert, `DisclosureButton indicator="chevron-right-start"` with the mark, the title, the subject in mono, and the first-seen time. Open content: `Text` label `What to do`, the action sentence, times, `Code` for kind and code with a copy `Button`, a `Link` to `guideUrl`. Meters `Progress` with `aria-labelledby`; the database fill is warning above the warning size and danger above the admission size.

**Copy:** `Status`. `Checked 12 s ago`. Tooltip of `ⓘ`: `Alerts refresh every minute while this page is open. No notifications are sent.` Result line `No open alerts` or `1 critical · 2 warnings`. Row: the alert title, the subject, `since 14:55`. Open row: `What to do`, the action, `First seen`, `Last seen`, `Recovery guide`. Footer `Database`, `742.4 of 900 MiB`, `Captures`, `3 of 8`. Fixed chrome with alerts: 16 words outside the alert texts. Healthy page: 12 words.

**Scenarios**

| Scenario           | What shows                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `healthy`          | Result band with success tint and `No open alerts`. No rows. The footer meters                                                                                                                 |
| `alerts`           | As drawn. The critical alert is first                                                                                                                                                          |
| `loading`          | See section 5                                                                                                                                                                                  |
| `error`            | The box holds one callout: `Could not load alerts` / `Retry`. After a failed refresh the rows stay, the freshness text reads `Showing alerts from 15:18`, and the refresh button reads `Retry` |
| `overflow` (extra) | The first 20 rows and a last row `Show all 50`                                                                                                                                                 |

**Interactions and keys:** `J` and `K` move between rows, Enter or `→` opens a row, `←` closes it. Refresh keeps the content.

**Removed:** the eyebrow "Operations", the two intro sentences, one card with a paragraph for each alert, the line "No external notifications are sent." on the page, the guide button under the list, the header bell, and the wait for the run list.

### 4.5 Pull request

**Wireframe, 1440 (`attempts`)**

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ Queue › #4863 Migrate component ex… (✕ Rejected)    [Runs 3]  Changes 33       ↗   ●   DH  │ 49
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│      ┌ max-w-4xl ──────────────────────────────────────────────────────────────────┐         │
│      │ Migrate component examples to the new style recipes  #4863                  │         │ text-xl
│      │ diegohaz · refactor/style-recipes → main                                    │         │ mono 12
│      │ ┌─────────────────────────────────────────────────────────────────────────┐ │         │
│      │ │ ✕  22 changes to review · 2 rejected               [ Review changes  ↵ ] │ │         │ 64 merge box
│      │ │    Attempt 2 of 2f3a9c1 · 12 min ago                                     │ │         │
│      │ └─────────────────────────────────────────────────────────────────────────┘ │         │
│      │ Runs                                                                        │         │
│      │ ●─ 2f3a9c1  Migrate the dialog examples                              head   │         │ 32 commit
│      │ │    ✕  Attempt 2   Rejected · 22 to review · 2 rejected      12 min ago  › │         │ 40
│      │ │    △  Attempt 1   Failed · capture shard 3 timed out        1 h ago     › │         │
│      │ ○─ 9c1d0aa  Migrate the menu examples                                       │         │
│      │      →  Attempt 1   Replaced · 18 changes                     3 h ago     › │         │
│      └─────────────────────────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Wireframe, 390**

```text
┌──────────────────────────────┐
│ ‹ #4863   ✕ Rejected     DH  │ 49
├──────────────────────────────┤
│ [Runs 3]   Changes 33        │ 40
│ Migrate component examples   │
│ to the new style recipes     │
│ diegohaz · refactor/style-…  │
│ ┌──────────────────────────┐ │
│ │ ✕ 22 changes to review   │ │
│ │   2 rejected · 12 min ago │ │
│ │ [ Review changes       ] │ │
│ └──────────────────────────┘ │
│ Runs                         │
│ ●─ 2f3a9c1 Migrate the dia… │
│ │  ✕ Attempt 2 · Rejected  › │
│ │  △ Attempt 1 · Failed    › │
│ ○─ 9c1d0aa Migrate the men… │
│    → Attempt 1 · Replaced  › │
└──────────────────────────────┘
```

**Regions and primitives:** top bar as in 3.1 (on a phone the tabs move to their own row). Column `ShellMain $maxWidth="56rem" $p="1.5rem"`. Title `Heading` with `text-xl`, the number in `ak-ink-60`. Meta `Text` mono. Merge box `Frame $border $rounded="xl" $p="1rem"`, with `$layer={role} $mix={8}` for the outcome role, `StatusMark`, two `Text` lines, and one `Button $layer="brand" render={<LabLink to="review" scenario="changes" />}` with a `↵` shortcut slot. Timeline: `List $guide $gap={3}` with one `ListItem` for each commit from `pull.commits` (the hash in `Code`, the first line of the message, a `Badge` `head`). Attempt rows: `Button` rows with `render={<LabLink …/>}`, mark slot, `ButtonLabel`, trailing time and a chevron slot.

**Copy:** tabs `Runs 3`, `Changes 33`. Merge box by outcome:

| Outcome                  | Line 1                              | Line 2                                          | Button                            |
| ------------------------ | ----------------------------------- | ----------------------------------------------- | --------------------------------- |
| needs review or rejected | `22 changes to review · 2 rejected` | `Attempt 2 of 2f3a9c1 · 12 min ago`             | `Review changes`                  |
| passed                   | `Passed`                            | `All 12 changes approved · 2 h ago`             | `Open changes` (neutral)          |
| not required             | `Nothing to review`                 | `This pull request does not need visual tests.` | `Back to GitHub`                  |
| waiting                  | `Waiting for CI`                    | `The review opens when the screenshots arrive.` | none, an indeterminate `Progress` |
| capture failed           | `Visual tests failed`               | `Open the failing check on GitHub.`             | `Open the check`                  |
| comparing                | `Comparing 48 of 120`               | none, a `Progress` with a value                 | none                              |

Timeline: heading `Runs`, `head`, `Attempt 2`, the state word, the counts or the error. Fixed chrome: 14 words. Budget for the page: 35.

**Scenarios**

| Scenario                                     | What shows                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `attempts`                                   | As drawn. Enter activates "Review changes"                                                           |
| `single`                                     | Merge box `Passed`. A timeline with one commit and one attempt. The `Changes` tab has no count badge |
| `no-runs`                                    | Merge box `Nothing to review`. No timeline and no `Changes` tab                                      |
| `loading`                                    | See section 5. The number in the top bar comes from the URL                                          |
| `waiting`, `capture-failed`, `error` (extra) | The merge box rows above. `error` uses the queue error callout in the merge box place                |

**Interactions and keys:** Enter is "Review changes" when it exists. `J` and `K` move between attempt rows. A row of a replaced or failed attempt opens that run read-only. The waiting state polls and changes in place; it does not navigate unless the page came from a check link.

**Removed:** the icon tile, the eyebrow "Visual review · Pull request #n", the back link, the "Check again" button, and the role of this page as a redirect hop with one sentence.

### 4.6 Review

This is the main page. Use `useReviewSession(scenario, { order: "declared" })`, so screenshots keep the run order and never move when a decision is saved.

#### Wireframe, 1440, at scroll 0 (`changes`)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ Queue › #4863 Migrate component ex… (○ Needs review)   Runs 3  [Changes 33]     2f3a9c1 · attempt 2  ↗ ● DH │ 49 top bar
├─────────────────────────────┬────────────────────────────────────────────────────────────────────────────────┤
│ [⌕ Filter screenshots    /] │ ▣  Filter ▾               ■■■■□□□□□□□□ 22 to review   ✓ Saved  ↶ Undo  View ▾  ?  Finish ▾ │ 45 toolbar
│                             ├────────────────────────────────────────────────────────────────────────────────┤
│ ▾ dialog                    │ ┌────────────────────────────────────────────────────────────────────────────┐ │
│ ▌   focus/open     ✓○○○○○   │ │ ▾ dialog/focus/open   Chromium        ✓○○○○○  5 to review   Approve all 6 ⇧A  ⋯ │ │ 34 header
│ ▾ combobox                  │ ├────────────────────────────────────────────────────────────────────────────┤ │
│     auto-select/…  ✓✓○      │ │ ✓ React · Light           Approved · you · 2 min                Undo ⌘Z   ▸ │ │ 32 line
│ ▾ menu                      │ ├────────────────────────────────────────────────────────────────────────────┤ │
│     actions/open   ✕✕       │▌│ ○ React · Dark   0.15% · 2 regions      [▥ ◫ ⇹ ↻] ⋯     ✕ Reject X   ✓ Approve A │ │ 36 change bar
│   tabs/default     ○○       │▌│ ┌──────────────────────────────┐    ┌──────────────────────────────┐       │ │ y = 188
│   select/default…  ○○       │▌│ │                              │    │                    ┌───┐     │       │ │
│   tooltip/default  ○○⊕      │▌│ │           baseline           │    │      current       └───┘     │       │ │
│   toolbar/toggle…  ✓○       │▌│ │                              │    │                              │       │ │
│   checkbox/group   ○○○○     │▌│ └──────────────────────────────┘    └──────────────────────────────┘       │ │
│   form/account     ○○       │▌│ − Baseline 1280 × 720               + Current 1280 × 720                    │ │
│   disclosure/list… ○○       │ ├────────────────────────────────────────────────────────────────────────────┤ │
│   table/sortable   ⊕⊕⊕      │ │ ○ Firefox · Light   0.15% · 2 regions   [▥ ◫ ⇹ ↻] ⋯                 ✕    ✓ │ │
│   site/legacy-ins… ⊖⊖       │ │ ┌──────────────────────────────┐    ┌──────────────────────────────┐       │ │
│                             │ │ │                              │    │                              │       │ │
│─────────────────────────────│ │                                                                            │ │
│ J K move · A approve        │ │                                                                            │ │
│ X reject · ? keys           │ │                                                                            │ │
└─────────────────────────────┴────────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe, 1440, while working (after the first key or scroll)

```text
┌─────────────────────────────┬────────────────────────────────────────────────────────────────────────────────┐
│ [⌕ Filter screenshots    /] │ ▣  #4863 · 2f3a9c1   Filter ▾     ■■■■□□□□□□□□ 22 to review   ✓ Saved  ↶  View ▾  ?  Finish ▾ │ 45
│ ▾ dialog                    ├────────────────────────────────────────────────────────────────────────────────┤
│ ▌   focus/open     ✓✓○○○○   │▌○ dialog/focus/open › Firefox · Light   0.15% · 2 regions  [▥ ◫ ⇹ ↻] ⋯  ✕ Reject X  ✓ Approve A │ 36 stuck
│ …                           │▌ ┌──────────────────────────────┐    ┌──────────────────────────────┐          │ y = 93
```

When a change bar is stuck, it shows the screenshot key as a quiet prefix, because the screenshot header is above the viewport. The toolbar shows the run identity when the top bar is out of view. Detect both with an `IntersectionObserver` sentinel.

#### Wireframe, 390

```text
┌──────────────────────────────────────┐
│ ‹ #4863   ○ 22 to review          DH │ 49 scrolls away
├──────────────────────────────────────┤
│ ☰ dialog/focus/open   1/12   ‹  ›  ⋯ │ 45 jump bar, sticky
├──────────────────────────────────────┤
│▌○ React · Dark   0.15%       ⇹ ▾   ⋯ │ 40 change bar, sticky
│▌┌──────────────────────────────────┐ │ y = 142 (93 while working)
│▌│ baseline       ┃         current │ │
│▌│                ┃◂▸               │ │ swipe, fit to width
│▌└──────────────────────────────────┘ │
│▌− 1280 × 720      + 1280 × 720       │
├──────────────────────────────────────┤
│ ✓ React · Light    Approved        ▸ │ 40 line
│ ○ Firefox · Light  0.15%   ⇹ ▾     ⋯ │
│ ┌──────────────────────────────────┐ │
│ │                ┃                 │ │
├──────────────────────────────────────┤
│  ↶     [ ✕ Reject ]   [ ✓ Approve ]  │ 56 fixed, plus the safe area
└──────────────────────────────────────┘
```

On a phone the tree is the jump bar: one row with the current screenshot key, its position, and previous and next buttons. A tap on the name opens the tree in a `Dialog` sheet. This is the "list above the viewer" of rule A27 as one collapsed row. The decision buttons are in the fixed bottom bar and act on the cursor change, whose bar is stuck at the top. The compare control is a select with Swipe (default), Stacked (baseline above current), Overlay, and Flip (a two-state switch `Baseline | Current` under the image). Gestures have one meaning each: a vertical drag scrolls, and a horizontal drag on the swipe handle moves the divider. No tap and no press-and-hold action exists.

#### Pixel budget, 1440 × 900

| State                      | First screenshot pixel                | Region where screenshots render | Share of the viewport |
| -------------------------- | ------------------------------------- | ------------------------------- | --------------------- |
| Today (audit)              | y = 408                               |                                 | 13% to 30%            |
| Scroll 0, tree open        | y = 188 (49 + 45 + 12 + 34 + 36 + 12) | 712 × 1128                      | 62%                   |
| Working, tree open         | y = 93 (45 + 36 + 12)                 | 807 × 1128                      | 70%                   |
| Working, tree closed (`T`) | y = 93                                | 807 × 1384                      | 86%                   |
| `one-change` at scroll 0   | y = 154 (49 + 45 + 12 + 36 + 12)      | 746 × 1384                      | 80%                   |
| Phone, working             | y = 93                                | 695 × 374                       | 79%                   |

Real screenshot pixels: a 640 × 400 pair in side by side uses two 558 × 349 panes (87% scale) and a block of about 433 px, so about 1.9 blocks are visible and about 56% of the viewport is screenshot pixels. A 1280 × 720 image in swipe is 1128 × 634, about 55% of the viewport. The region below a short block is not empty: it shows the next changes.

#### Regions and primitives

| Region           | Primitive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page             | `Shell` with `className="text-sm"`. The page scrolls. Do not use the fixed app frame recipe                                                                                                                                                                                                                                                                                                                                                                                                             |
| Top bar          | `ShellHeader $height="sm" $sticky={false}` with `border-b`. Breadcrumb `ButtonGroup $size="sm"` with `ButtonSeparator $kind="chevron"`. Tabs `Nav $layout="horizontal" glider={{ $kind: "bar" }}`. Run facts `PopoverDisclosure` with mono text                                                                                                                                                                                                                                                         |
| Tree             | `ShellSidebar $width="md" render={<nav />} aria-label="Screenshots"`, shown from 64rem. `ShellSidebarHeader` with an `InputGroup $size="sm"`. `ShellSidebarBody $p={2}` with `Nav render={<div />}`, `NavDisclosure` for a folder, `NavLink` for a screenshot (`aria-current="true"` for the cursor screenshot, bar glider), `NavLinkLabel` in mono, a trailing mark strip in a `NavSlot` with `ms-auto`. Row padding through `--nav-py`. `ShellSidebarFooter` holds the key legend (`Text` with `Kbd`) |
| Toolbar          | `ShellMainHeader $sticky $height="sm"` with one flex `div`: tree toggle `Button` (`PanelLeft`), identity `Text` mono, `PopoverDisclosure` `Filter`, progress (see below), save slot `Text role="status"`, `Button` `Undo`, View menu (`ak.Menu` with the `popover` and `option` recipes), `DialogDisclosure` `?`, `PopoverDisclosure` `Finish`                                                                                                                                                          |
| Feed             | `ShellMain $p="1rem" $maxWidth="100%"`, one wrapper `div` with `grid gap-3` in `ShellMainBody`                                                                                                                                                                                                                                                                                                                                                                                                          |
| Screenshot box   | `Frame $border $rounded="xl" render={<section />}`. Fold behavior from `ak.DisclosureProvider`, `ak.Disclosure render={<Button />}`, and `ak.DisclosureContent`. The header is a flex band (`Frame $lightnessOffset={1}`): the disclosure button with chevron, key, shared axes, mark strip, and count, then a ghost `Button` `Approve all 6` with a `⇧A` shortcut slot, then a menu button                                                                                                             |
| Change bar       | `Frame $layer` with `sticky`, `top` equal to the toolbar height, `border-b`, `z-10`. `StatusMark`, label `Text` (500) with axis marks, facts `Text` mono `ak-ink-60`, compare control, menu button, `Button $border` Reject, `Button $layer="brand"` Approve                                                                                                                                                                                                                                            |
| Compare control  | `ak.RadioGroup render={<ButtonGroup $border $size="sm" />}` with four `ak.Radio render={<Button />}` icon buttons (each also a `TooltipAnchor`) and a `ButtonGlider`                                                                                                                                                                                                                                                                                                                                    |
| Mat              | `Frame $darken $p={3}` with `img` elements sized from `width` and `height`. Captions `Text` mono `text-xs` under each image                                                                                                                                                                                                                                                                                                                                                                             |
| Line             | `Button` (full width, `justify-start`, ghost) as the disclosure trigger of the folded change: mark slot, label, `ButtonDescription`-style text, `Undo` text button on the newest decided line, chevron                                                                                                                                                                                                                                                                                                  |
| Cursor rail      | A 2 px brand bar at the start edge of the cursor section (`Frame $layer="brand"` with `absolute inset-y-0 start-0 w-0.5`)                                                                                                                                                                                                                                                                                                                                                                               |
| Callouts         | Callout recipe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Details          | `Popover` with a two-column facts grid and `Code`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Keys             | `Dialog` with `DialogScroll`, `Kbd`, and a switch (Toggle recipe)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Phone bottom bar | `Frame $layer` with `fixed bottom-0 inset-x-0 border-t`, `ButtonGroup $layout="stretch"`                                                                                                                                                                                                                                                                                                                                                                                                                |

Do not put `overflow-hidden` or `overflow-auto` on a screenshot box, because it stops the sticky change bar. Use `overflow-clip` if the corners need clipping.

#### Item navigation

- **Tree.** A real path tree from `item.key`: the first segment is a folder (`NavDisclosure`), the rest is the row label. A folder with one child joins it (`dialog/focus/open`). Each row ends with the mark strip of its reviewable variants. The row of the cursor screenshot is current and stays in view. A click scrolls the feed to that screenshot and puts the cursor on its first change to review (else its first change).
- **Filter.** The field in the tree head filters the tree and the feed (`session.setQuery`). The toolbar `Filter` popover has four groups of `RadioField` rows with counts from `session.facets`: Status (All, To review, Approved, Rejected, Problems), Kind (All, Changed, New, Removed), Browser, Color scheme. An active filter shows a count in the button. `A`, `X`, and `N` advance inside the filter.
- **Unchanged.** A screenshot with no change is not in the feed and not in the tree. The last row of the tree and the last box of the feed read `472 unchanged screenshots` with a `Show` button. Unchanged variants inside a changed screenshot are one context row in its box: `2 unchanged variants` with `Show`.
- **Keys.** `↑` and `↓` go to the previous and next screenshot and stop at the ends. `J` and `K` go to the next and previous change across screenshots. `N` and `⇧N` go to the next and previous change to review and open it if it is folded.

#### Variant switching

There is no variant strip. The variants of a screenshot are stacked sections in its box, in declared order, each with its mark, so the verdict of every variant is on screen. `←`, `→`, and `1` to `9` move the cursor inside the cursor screenshot. The label of a section shows only the axes that differ inside the screenshot (`React · Dark`), with framework and browser marks. Axes that all variants share print one time in the screenshot header (`Chromium`). The full label is in the `title` of the label and in Details. The mark strip in the header and in the tree is the overview: `✓○○○○○`.

#### Compare modes and zoom

| Mode                    | Key           | Layout in a block                                                                                                                                                                                                                 |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Side by side            | `S`           | Two panes at one scale. Region boxes on the current pane                                                                                                                                                                          |
| Overlay                 | `O`           | The current image with the diff mask on top. A range input under the image sets the mask opacity                                                                                                                                  |
| Swipe                   | `W`           | One pane. Baseline left of the divider, current right of it. The divider starts on the center of the first changed region. The handle is a native range input over the image (`role="slider"`, so the review keys leave it alone) |
| Blink                   | `B`           | One pane. The cursor change alternates each 600 ms, and the caption names the image on screen. Other blocks stay still                                                                                                            |
| Diff, Current, Baseline | `D`, `F`, `G` | In the block menu, with their keys                                                                                                                                                                                                |

- The four icon buttons of the compare control are Side by side (`Columns2`), Overlay (`Layers2`), Swipe (`SeparatorVertical`), Blink (`Repeat`).
- **Auto** is the default view. A block uses Side by side when each pane can show the image at 75% scale or more (image width up to 744 px at 1440 with the tree open). Otherwise it uses Swipe. So small and medium screenshots are pairs, and wide and tall screenshots keep their full width.
- A mode key or the toolbar View menu sets the view for the whole feed and ends Auto (`session.viewer.setMode`). The View menu has `Auto` to return. A click on the compare control of one block changes only that block (a local override).
- **Highlight** is on by default (`H` toggles): a 2 px ring in the warning color around each of `variant.regions`, at least 24 px wide, 4 px outside the region. The mask image loads only for Overlay and Diff.
- **Tall images** are not squeezed. The page scrolls through them, the change bar stays stuck, and a 4 px change ruler on the start edge of the image has one tick for each region. A click on a tick scrolls to that region.
- **Size change:** both images at one scale, top aligned. The band that only one image has is hatched. The caption reads `+ Current 640 × 422 (+22)` and the change bar shows a warning `Badge` `Size changed`.
- **One image:** a new variant shows one pane with `+ New. No baseline.` A removed variant shows one pane with `− Removed. This was the baseline.` A variant with `candidateOmitted` shows the baseline with `= Matched locally. The current image was not uploaded.` The compare control is hidden.
- **Zoom:** Fit (the default: scale down to the pane, never above 100%), 100%, 200% from the block menu or `+`, `-`, `0` on the cursor change. A zoomed block has panes of at most 70vh with native scroll, and the two panes mirror their scroll position, so they always show the same place. No pan buttons.
- The View menu also has `Invert mat` (`$invert` in place of `$darken`), for a screenshot that has the color of the mat.

#### Decision flow

1. **Cursor.** The cursor is `session.variant`. It moves by key, by a click in a block, and by scroll: after a wheel or touch scroll stops for 100 ms, the cursor becomes the topmost open change that still shows 96 px or more under the bars. A scroll that the page makes does not move it.
2. **Guard.** `A` and `X` act only when the images of the cursor change are decoded and the change is on screen. If the cursor is off screen, the first press scrolls to it and decides nothing. While images load, the buttons are disabled and the mark is a dashed ring. A press is never stored for later.
3. **Approve or reject.** `A` or the Approve button calls `session.approve()`. The mark changes at once, the section folds to a line in 140 ms, and the cursor moves to the next change to review in feed order (it wraps one time). The feed jumps so that the new cursor bar is under the toolbar. A click on the button of another block decides that block and then moves the cursor the same way.
4. **Whole screenshot.** `⇧A`, `⇧X`, or `Approve all 6` in the header decides every reviewable variant of the cursor screenshot as one command. There is no confirmation dialog on either path: the count is on the button, every target is stacked in the box, and one Undo restores all of them. The box folds to its header, which then reads `6 approved · Undo ⌘Z`. A refused command changes nothing and shows a warning line in the header: `Not changed. One variant is protected.` with a button `Go to it`.
5. **Fold rules.** A change is open while a person has not decided it. Approved and rejected changes are lines. New and removed variants that the service approved are lines with `New · auto-approved` or `Removed · auto-approved`; `N` skips them. A screenshot whose changes are all decided folds to its header. `E` folds or opens the cursor change without a change to its verdict, and a click on a line does the same.
6. **Save status.** One slot in the toolbar: `Saving 2`, then `Saved` for 1.6 s, then empty. The real app must show three states in this slot with three icons: `Sending 2` (arrow up), `Queued 2` (cloud), `Saved` (check). A line whose decision waits for the server has a dashed mark and reads `Approved · saving`.
7. **Undo.** `⌘Z` or the `Undo` button, enabled only after the server answer (`can.undo`). It restores the verdicts, opens the sections again, and returns the cursor and the scroll to the change. The newest decided line also has an `Undo` text button. `U` clears the verdict of the cursor change (lab only).
8. **Failed save.** The taken-back changes open again. The first of them shows a danger callout under its bar: `Not saved` / `Retry` / `Discard` / `Error ID` in mono. The toolbar slot reads `Not saved` in danger. `A` and `X` are off until the person retries or discards.
9. **Conflict (copy only, the lab has no such state):** a warning line under the change bar: `Conflict · okafor-amara rejected this 1 min ago` with a button `Show`.
10. **Seen and Finish.** A change is seen when 60% of its image area is in the viewport for 800 ms with decoded images. Its mark becomes a ring with a dot. `Finish` opens this popover:

```text
┌ Finish ───────────────────────────────┐
│ 22 to review                          │
│ ■■■■□□□□□□□□  9 approved · 2 rejected │
│ The check fails until every change    │
│ is approved.                          │
│ [ Next to review  N ]  Approve 14 seen │
│ Rejected                              │
│ ✕ menu/actions/open · React · Light   │
│ ✕ menu/actions/open · React · Dark    │
└───────────────────────────────────────┘
```

`Approve 14 seen` opens a confirm `Dialog`: `Approve 14 changes?` / `You scrolled past them in 6 screenshots.` / a list of the screenshot keys with counts / `Cancel` / `Approve 14`. It is one command (`session.approve(targets)`), one Undo restores all of it, and a refusal of one target refuses all. This command crosses screenshots, so it needs a new rule (see section 6).

#### Progress

- Toolbar: a 96 px bar with three segments (approved in success, rejected in danger, the rest as the track) built from three `Frame`s in a `Frame $darken $rounded="full"`, with `role="img"` and a full `aria-label`, then the text `22 to review`. A rejected change counts as reviewed and has its own color.
- Tree and screenshot headers: mark strips.
- Page title: `22 to review · #4863 · Visonaut`.
- No other count exists on the page.

#### Details

- **Run facts:** a popover from the commit text in the top bar: `Commit`, `Attempt`, `Baseline` (revision), `Run ID` with a copy button, `Open the pull request`. 7 words.
- **Change facts:** `Details` in the block menu opens a `Popover`: `Changed 1,152 px (0.15%)`, `Size 640 × 400`, `Threshold`, `Engine`, `Decided by`, the full variant label, `Copy link`, `Copy debug info` (digests and IDs). Nothing in Details repeats a fact that the bar shows.

#### Completed state

When nothing is left to review, the cursor stays, the page jumps to the top, and a completion block is the first thing in the feed. Every box below it is a folded header with a ticked strip.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ✓  Review complete                                                           │
│    31 approved · 6 auto-approved                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ ◌ Updating the check on GitHub        Undo ⌘Z    Open #4863 ↗   [ Next run ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

The check line has three states: `Updating the check on GitHub`, `Check passed on GitHub`, and `GitHub did not take the update` with a link `Status`. With a rejection the block uses the danger role: `Review complete · 2 rejected` / `The check stays failed until a new run.` and lists the rejected changes. `Next run` is the brand button and names the run in its tooltip (`#4831 · 79 to review`). The toolbar button `Finish` becomes `Done` with a check.

#### Keys and how a person finds them

| Group  | Keys                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move   | `J` `K` next or previous change · `N` `⇧N` next or previous to review · `↑` `↓` screenshot · `←` `→` variant · `1` to `9` variant by position · `T` tree · `/` filter |
| Decide | `A` approve · `X` reject · `⇧A` `⇧X` all variants of the screenshot · `U` clear · `⌘Z` or `Ctrl Z` undo                                                               |
| View   | `S` side by side · `O` overlay · `W` swipe · `B` blink · `D` diff · `F` current · `G` baseline · `H` highlight · `+` `-` `0` zoom · `E` fold or open                  |
| Help   | `?` keys                                                                                                                                                              |

The base is key map B of the contract map report. Two differences: `J` and `K` move by change, not by screenshot, and `B` is Blink, so the tree toggle is `T`. No bracket key, no Space, no `⌘K`, no arrow that pans. Page Down, Space, Home, and End scroll the page as the browser does.

Discovery, four places: (1) the cursor change always shows `Reject X` and `Approve A`; (2) every icon control has a tooltip with its name and key; (3) the tree footer has a two-line legend `J K move · A approve · X reject · ? keys`; (4) `?` and the `?` button open the keys dialog, built from `reviewShortcuts` plus the page keys, with a stored switch `Keyboard shortcuts`. The switch turns off every single-character key. With the switch off, the legend and the key hints are hidden.

Focus: a decision does not move the focus to the page root. After `A` the focus goes to the Approve button of the new cursor change. `session.announcement` goes to one `sr-only` live region.

#### Scenarios

| Scenario                   | What shows                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes`                  | As drawn. 12 screenshots in run order. `menu/actions/open` (two rejections), `table/sortable` (three new), and `site/legacy-installation` (two removed) start as folded headers. `form/account` scrolls as a tall image with a change ruler. `disclosure/list/expanded` shows the size change                                                      |
| `large`                    | The same page with 128 changes. Sections outside the viewport use `content-visibility: auto` with a reserved height from the image size, and images load when a section is within 1.5 viewports. The tree has about 20 folders. The last box is `472 unchanged screenshots`                                                                        |
| `one-change`               | No tree and no tree toggle. One box whose header and change bar are one row. The legend moves under the box                                                                                                                                                                                                                                        |
| `passed`                   | The completion block, then only folded headers. `Finish` reads `Done`. `Undo` is off                                                                                                                                                                                                                                                               |
| `read-only`                | A `Badge` `Read-only` in the toolbar in place of `Finish` and `Undo`. One callout at the top of the feed: `Read-only · A newer run replaced this one.` with a link `Open the current run`. Change bars have marks and facts and no decision buttons (the buttons are absent, not disabled). `A` and `X` do nothing and the callout pulses one time |
| `comparing`                | The toolbar shows a `Progress` with `Comparing 6 of 16` in place of the review bar. One callout: `Decisions open when the comparison ends.` Ready changes are open without buttons. A pending variant is a 96 px section with a skeleton mat and the turning mark                                                                                  |
| `problems`                 | A danger callout at the top: `Run failed` / the run error / `Rerun the visual tests in CI.` Problem variants show a callout in the mat place: `Comparison failed` and the reason. The change with a broken image shows `Image did not load` and `Retry` in its mat, and its buttons are off                                                        |
| `loading`                  | See section 5                                                                                                                                                                                                                                                                                                                                      |
| `error`, `expired` (extra) | `error`: the queue error callout in the feed. `expired`: a read-only callout `Read-only · The images of this run expired.` and sections with facts and an empty mat                                                                                                                                                                                |

#### Copy and word budget

Budget: at most 40 chrome words in a 1440 × 900 viewport while working, outside screenshot keys, variant labels, and numbers.

- Toolbar: `Filter`, `22 to review`, `Saved`, `Undo`, `View`, `Finish`. 8 words.
- Tree: `Filter screenshots`, `move`, `approve`, `reject`, `keys`. 6 words.
- Screenshot header: `5 to review`, `Approve all 6`. 6 words.
- Open change: `regions`, `Reject`, `Approve`, `Baseline`, `Current`. 5 words for each open change.
- Line: `Approved · you · 2 min`, `Undo`. 4 words for each line.
- A normal viewport (one header, two lines, two open changes): about 38 words.

#### What was removed

The app nav on the run page, the run header row, the identity strip, the 28 px item heading with its badge and ratio line, the variant chip strip, the mode and zoom toolbar row, the caption rows above the images, the bottom action bar, the page footer (keyboard help, shortcut toggle, the dead "Recompare stored run" button), the "Accepted (N)" section, the pan buttons, the whole-item dialog, the Details side panel, the thumbnails in the list, and every second copy of "N of M need review".

## 5. Loading

Rules for all pages: the shell paints from the route alone. A skeleton has the final geometry, so nothing moves when the data arrives. No text names the wait before 5 s. A refresh keeps the content on screen. A signed-in visit never shows the gate.

| Page    | 0 ms                                                                                                                                                                                                                          | 300 ms                                                                                                                                                                                 | 1 s                                                                                                                                  | 5 s                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-in | The skeleton of the target page (the session is not known yet)                                                                                                                                                                | The gate card, if the answer is "guest"                                                                                                                                                | `signing-in`: the button reads `Opening GitHub` with a spinner                                                                       | A link under the button: `Open GitHub again`                                                                                                                 |
| Inbox   | Top bar with the nav. Filter field (usable). Three band skeletons and five row skeletons of 56 px                                                                                                                             | Real boxes and rows replace the skeleton in place                                                                                                                                      | If the data is late: a 2 px indeterminate `Progress` under the top bar                                                               | One line in the column: `Taking longer than usual` and `Retry`                                                                                               |
| History | Top bar. Search field (usable). Tab strip skeleton. Table head and eight row skeletons of 40 px                                                                                                                               | Tabs with counts and rows                                                                                                                                                              | The same `Progress` line                                                                                                             | The same line and `Retry`                                                                                                                                    |
| Status  | Top bar. The box with a band skeleton, three row skeletons, and two meter skeletons. This page does not wait for the run list                                                                                                 | The result band, rows, and meters                                                                                                                                                      | The same `Progress` line                                                                                                             | The same line and `Retry`                                                                                                                                    |
| Pull    | Top bar with `#4863` from the URL and a title skeleton. Tabs without counts. Merge box skeleton of 64 px. Three timeline row skeletons                                                                                        | Title, state badge, merge box, timeline                                                                                                                                                | The same `Progress` line. The `waiting` outcome is a state with its own progress, not a load                                         | The same line and `Retry`                                                                                                                                    |
| Review  | Top bar with the `Queue` crumb and a title skeleton. Toolbar with three pill skeletons. Tree with eight row skeletons. One box skeleton: a header band, a change bar, and a mat with two 16:10 panes. The top of a second box | Real tree, toolbar counts, headers, change bars with labels and facts. Each mat reserves the exact image size and pulses. Decision buttons are present and disabled, with dashed marks | The images of the first change are decoded and fade in. Its buttons are on and the cursor is on it. The next two changes are loading | A mat that still waits shows `Still loading` and `Retry`. If the list data is still missing: the `Progress` line and `Taking longer than usual` with `Retry` |

A blurred copy of `variant.thumbnail` can fill a mat until the full image decodes.

## 6. Risks, tradeoffs, and decisions that this direction revisits

### Risks and tradeoffs

1. **Long runs.** 79 open changes are a long page. `N`, the tree, the filters, and the folds reduce the cost, but a contact sheet shows the size of the work faster.
2. **First pixel at scroll 0.** The first screenshot pixel is at 188 px on arrival. It is 93 px only after the first key or scroll. A fixed stage can do better on arrival.
3. **Cursor that follows the scroll.** It makes the target of `A` clear, but a person can decide a change that only just became the cursor. The rail, the stuck bar, the on-screen guard, and Undo are the protection.
4. **Fold hides rejections.** A rejected change becomes a line. The danger mark, the tree strip, the Status filter, and the list in the Finish popover keep it findable.
5. **Auto view.** Side by side for small images and swipe for wide ones is two looks in one feed. The compare control always shows the active mode.
6. **The GitHub look sets expectations.** People can expect comments, suggestions, and a submit step. The service has none of these, and decisions save at once.
7. **Performance.** Hundreds of images in one document need lazy loading, `content-visibility`, and release of far images. Each section must know its height before its images load.
8. **Sticky in boxes.** The change bar must stick under a toolbar of a known height, and no ancestor can clip with a scroll container. Check the sticky offset of `ShellMainHeader` when `ShellHeader` is not sticky.
9. **Tests.** This direction breaks most present test pins (the variant nav, `.review-item`, the progress text, the Details and keyboard help buttons, the narrow-layout dialog).
10. **Phone.** The phone flow is designed for exploration. Phone review is outside the launch scope (D53).

### Earlier decisions that this direction revisits

| Decision or rule                                                      | What changes here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U02 (one shell, actions in the main header, the image takes the rest) | A scrolling document replaces the fixed workspace. Actions are in each change bar, so they stay "next to the result" (A06)                                                                                                                                                                                                                                                                                                                                                                                               |
| U03 and L1 (variants are links with a bar glider)                     | No variant strip. Variants are stacked sections with a URL each. The tabs option that the maintainer replaced does not return                                                                                                                                                                                                                                                                                                                                                                                            |
| D04, K2, K3 (remember the last variant for each item)                 | Not used. `↑` and `↓` land on the first change to review of a screenshot                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| U04 (page-wide arrows, pan buttons)                                   | The arrows keep their contract meaning and never pan. The pan buttons go away because zoomed panes scroll together (this makes A18 true). The rejected options `focus-owned` and `pan-mode` do not return                                                                                                                                                                                                                                                                                                                |
| RULE-06, K11 (whole-item paths differ)                                | Both paths have no dialog. The count is on the button and one Undo restores the command                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D02, I8, RULE-27 (scope of a decision)                                | `A` and `X` stay at one variant. "Approve seen" decides variants of more than one screenshot. Its four answers: each target had decoded images on screen for 800 ms; the target list and revisions freeze when the dialog confirms; one Undo restores every target and the scroll position; one refused target refuses the command and the feed scrolls to it. It needs a new rule. The maintainer rejected the wider `item` option for `A` because unseen variants could be accepted; this command takes only seen ones |
| K6 (`1` to `6`)                                                       | `1` to `9`, as the lab hook binds them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| K13 (S, D, F, G)                                                      | All four stay. `O`, `W`, `B`, `H`, and the zoom keys are new. Swipe and overlay were deferred in the revision 9 design, not rejected                                                                                                                                                                                                                                                                                                                                                                                     |
| P02 (load the diff when selected)                                     | Kept. The default highlight uses region boxes from data, and the mask loads only for Overlay and Diff. If the mask becomes the default highlight, P02 `eager` (rejected) returns                                                                                                                                                                                                                                                                                                                                         |
| A07 (full variant label)                                              | The bar shows only the axes that differ. The full label is in `title` and Details                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A11 (thumbnail rule)                                                  | No thumbnails in the tree. Mark strips replace them                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A12, D29 (list order)                                                 | Kept: declared order. The "Accepted" group of the later rule becomes folded headers and one "unchanged" row                                                                                                                                                                                                                                                                                                                                                                                                              |
| A13, L4 ("Accepted automatically", new variants stay visible)         | The words become `auto-approved`. New and removed variants stay in the feed and the tree as lines with their own marks                                                                                                                                                                                                                                                                                                                                                                                                   |
| A21, D30 (one-image states)                                           | A new or removed variant uses one pane with one sentence, not a pair with a labelled empty pane                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A27 (narrow layout)                                                   | The list is one collapsed row above the feed. Images use swipe by default; stacked is an option                                                                                                                                                                                                                                                                                                                                                                                                                          |
| X4 (shortcut toggle)                                                  | It moves into the keys dialog and is stored                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| "Do not add a hotkey registry" (U04 notes)                            | The keys dialog renders from the `reviewShortcuts` list. `/`, `?`, `T`, `E`, `J`, `K`, `N`, `U` are new single-character keys and follow the switch. `⌘K` is not taken                                                                                                                                                                                                                                                                                                                                                   |
| U05 (work first, history as a view)                                   | Kept. Queue and history stay two pages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D17 (compact and flat)                                                | Kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| I7 (no comments, no notes)                                            | Kept. No reject note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Not in the API today

`Run.author`, `branch`, `counts`, `progress`, `previews`, `error`. `PullRequest.title`, `author`, `branch`, `runs`. `ReviewRun.pullRequest`, `counts`, `progress`, `supersededBy`. `ReviewVariant.regions`, `reviewerLogin`, `decidedAt`. `ServiceAlert.severity`, `occurrences`. In the session hook: `clear`, the facet filters, a next change inside the filters, Undo while a save runs, `approve` with targets of several screenshots, the modes overlay, swipe, and blink, the highlight, and the keys `J`, `K`, `N`, `U`, `O`, `W`, `B`, `H`, `+`, `-`, `0`. The seen mark is local state of the page.

### Open choices inside this direction

1. Sticky change bar only (93 px, as specified) or a sticky screenshot header above it (127 px, the name and "Approve all" always visible).
2. Rejected changes fold (as specified) or stay open until the run is complete.
3. "Approve seen" on or off.

## 7. Builder notes

- Files: one module for each surface, `src/explorations/pages/<surface>/changes.tsx`, and shared parts (top bar, `StatusMark`, meter, run row, change block, callout) in one folder beside them. Use `LabLink` for every move between surfaces.
- Review session: `useReviewSession(scenario, { order: "declared" })`. Build the feed list from `session.visibleItems`, without screenshots that have no reviewable, problem, or comparing variant (unless "Show" is on).
- Keys: `session.queue` contains unchanged variants, so pass your own handlers for `j`, `k`, `arrowup`, `arrowdown`, `arrowleft`, and `arrowright` in the `keys` option of `useReviewShortcuts`. They walk the rendered sections and call `session.select(variant)`. Add `e`, `t`, `/`, and `?` there too. `N`, `A`, `X`, and the Shift pairs work as the hook binds them.
- Viewer: the feed view is `session.viewer.mode` plus a local `auto` flag. Each section has an optional local override. Call `useViewer(variant, { mode })` in a section component only when it needs its own swipe position or opacity.
- Section height: compute it from the image sizes, the mode, and the column width, and set `contain-intrinsic-size`. The scroll bar must be correct before any image loads.
- Stuck state: one sentinel `div` above each change bar and one under the top bar, read with an `IntersectionObserver`.
- Seen state: one `IntersectionObserver` with a threshold of 0.6 and a timer of 800 ms for each open section. Keep it in a `Set` in the page state.
- Colors and sizes: only `$layer` roles, named `$rounded` steps, and spacing steps. No pixel value and no hex color, so the Look controls apply. Check each page with `?theme=light`: a box needs its `$border` on the light canvas.

A sketch of one open change section:

```tsx
<section aria-label={`${item.key}, ${variant.name}`} className="relative">
  {current && <Frame $layer="brand" className="absolute inset-y-0 start-0 z-20 w-0.5" />}
  <Frame
    $layer
    className="sticky top-(--feed-top) z-10 flex items-center gap-2 border-b px-3 py-1.5"
  >
    <StatusMark status={variant.status} />
    <Text className="truncate font-medium">{differingAxes(variant, item)}</Text>
    <Text className="ak-ink-60 font-mono text-xs tabular-nums">
      {formatRatio(variant.ratio)} · {formatCount(variant.regions?.length ?? 0, "region")}
    </Text>
    <CompareControl className="ms-auto" variant={variant} />
    <Button $border disabled={!session.can.reject} onClick={() => decide("reject", variant)}>
      <ButtonSlot>
        <X />
      </ButtonSlot>
      <ButtonLabel>Reject</ButtonLabel>
      {current && (
        <ButtonSlot $kind="shortcut">
          <kbd>X</kbd>
        </ButtonSlot>
      )}
    </Button>
    <Button
      $layer={current ? "brand" : undefined}
      disabled={!session.can.approve}
      onClick={() => decide("approve", variant)}
    >
      <ButtonSlot>
        <Check />
      </ButtonSlot>
      <ButtonLabel>Approve</ButtonLabel>
      {current && (
        <ButtonSlot $kind="shortcut">
          <kbd>A</kbd>
        </ButtonSlot>
      )}
    </Button>
  </Frame>
  <Frame $darken $p={3} className="grid gap-2">
    <Panes variant={variant} mode={mode} />
  </Frame>
</section>
```

`StatusMark`, `CompareControl`, `Panes`, `differingAxes`, and `decide` are local helpers of this direction. On a block that is not the cursor, the two buttons are icon-only ghost buttons with `aria-label`.
