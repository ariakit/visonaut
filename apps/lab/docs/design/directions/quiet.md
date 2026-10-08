# Quiet folio (direction `quiet`)

Lab surfaces: `sign-in`, `inbox`, `history`, `status`, `pull`, `review`. Suggested variant id in each surface: `quiet`. The page that the lab calls `inbox` has the name **Queue** in this direction (terminology table of the ui-copy lane).

## 1. Concept

**Name:** Quiet folio. **Tagline:** One sentence, one screenshot, one accent.

**The idea in five sentences.**

1. Each page is one text column on the canvas, and its first line is one sentence that states the result: "4 runs to review", "No open alerts", "22 changes need review", "Review complete".
2. Nothing has a box: there are no cards, no bars, no filled badges, and no rules between rows, so type size, ink strength, and space carry the structure.
3. On the review page the screenshot sits on a sunken mat, and that mat is the only surface on the page.
4. Brand color is on one control for each screen, and that control is always the next action; status color is only on small marks that also differ in shape.
5. The keys are printed as a one-line footnote under the page, so the page teaches the keyboard without toolbars or key caps.

**Signature moment.** A maintainer opens a run. The page is almost empty: one screenshot on a dark mat with the change marked in red, one caption line, and one blue button. The maintainer presses `A`. The plate changes to the next change, and a hairline under the title grows by one step. After the last change the plate goes away and one sentence stays: "Review complete".

**Principles.**

1. **The sentence first.** Each page answers its question in its first line, in words, with the count inside the sentence. No stat tiles, no badges, no eyebrow labels.
2. **The screenshot is the only surface.** Only the mat on the review page has a background. All other content is text on the canvas.
3. **One accent, one action.** Brand color is on one control for each screen: the next action. A screen with nothing to do has no brand color.
4. **Space, not lines.** No borders between things. Whitespace, type size, and ink strength group the content. Status is a small mark with its own shape, never a fill.
5. **Words are counted.** Each screen has a word budget. A word that repeats a fact is removed. The words that stay are set larger.

## 2. Visual system

### 2.1 Layers and borders

| Surface      | Where                                                          | How                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas       | All pages, the head, lists, the outline, the caption, the foot | No layer. Wrappers are plain `div` elements.                                                                                                                          |
| Sunken       | The mat of the review page. Skeleton bars.                     | `Frame $darken $rounded="xl" $p={4}`. Skeleton: `Frame $lightnessOffset={2}`.                                                                                         |
| Raised       | Popover, menu, dialog, tooltip only                            | The primitive defaults, with `$shadow="md"` and `$rounded="xl"`.                                                                                                      |
| Brand        | One `Button $layer="brand"` for each screen                    | Sign-in: Sign in with GitHub. Queue: Review. Pull: Review. Review: Approve (or the one recovery action). History and Status: none. A dialog counts as its own screen. |
| Status tints | None                                                           | No `$mix` tints, no colored frames.                                                                                                                                   |

Borders are used in five places only: (1) a 1 px ring on the screenshot (`Frame $border $borderType="ring" $edgeWeight="light" $rounded="none"`), so the image boundary is visible on each canvas tone; (2) the 2 px progress hairline under the review head; (3) the field edge of the two text inputs (`$edgeWeight="light"`); (4) the border of overlays, as the primitives draw it; (5) focus rings. There is no border on a button, a row, a list, the head, the foot, or the mat. There is no `Separator` and no `Badge` in this direction.

Hover and focus use gliders (`$state: "hover"`, `$state: "focus"`). Selection uses a bar glider and `font-medium`, never a tone change, because a tone change is not visible on the light canvas.

### 2.2 Type

Fonts: Inter Variable for all text. JetBrains Mono Variable only for identifiers: commit, `#number`, Error ID, image sizes, and key letters. Numbers that change use `tabular-nums`.

| Role          | Classes                                                           | Used for                                                               |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Sentence (h1) | `text-3xl font-semibold tracking-tight` (below 48rem: `text-2xl`) | The first line of each document page                                   |
| Lead          | `text-xl font-medium`                                             | Not used at rest; reserved for the completion block subtitle if needed |
| Row title     | `text-base font-medium`                                           | Runs that take decisions                                               |
| Body          | `text-base`                                                       | One-line rows, sentences                                               |
| Meta          | `text-sm ak-ink-60`                                               | Meta lines, result words, section labels (`font-medium`)               |
| Micro         | `text-xs ak-ink-70`                                               | Foot legend, pane labels, group labels in the outline                  |
| Identifier    | `font-mono text-xs ak-ink-70`                                     | Commit, number, size                                                   |
| Review chrome | root `text-sm`; the screenshot name `font-medium`                 | All text on the review page at 48rem and wider                         |

Rules: three weights only (400, 500, and 600 for the h1). No uppercase labels and no letter spacing on labels. Headings use sentence case and no period. No text is smaller than 12 px. Text of 12 px uses ink 70, not ink 60, so that it passes 4.5:1 in the light scheme. Ink levels: 100 for content, 70 for sentences that support, 60 for meta, 40 for replaced or unchanged things.

### 2.3 Space, density, radius

- Document pages: root `text-base`. One column of 48rem (`ShellMain $maxWidth="48rem" $p="1.5rem"`). 64 px of space above the sentence (`pt-16`, phone `pt-8`). 40 px between the sentence block and the first row. 48 px between sections (`gap-12`). Two-line rows have `$p={3}`, one-line rows have `$p={2}`.
- Review page: root `text-sm` (14 px, one spacing step is 3.5 px). Head `h-12` (42 px), hairline `h-0.5` (2 px), caption `h-14` (49 px), tools `h-10` (35 px), foot `h-8` (28 px), outline `w-64` (224 px), page gutter and mat padding 4 steps (14 px).
- All sizes use spacing steps, so the density control of the lab applies. Pixel values in this brief are for the default look.
- Radius: mat `xl`. Buttons, gliders, inputs `lg`. Overlays `xl`. The screenshot has square corners, always: it is pixel evidence.

### 2.4 Icons

`lucide-react` at `strokeWidth={1.5}`, size 1em. An icon is used only where a word costs more: `ArrowLeft` (back), `ArrowUpRight` (external link), `RotateCw` (refresh), `PanelLeft` (Contents; `List` on a phone), `ChevronDown` (select, popover), `Search`, `Ellipsis`, and the status marks. The help button is the character `?`. Framework and browser marks are not used: variant axes are words.

### 2.5 Status vocabulary

One vocabulary for run states and variant verdicts. The color is on the mark only. The word that follows the mark stays in the ink of the text. Each mark has its own shape, so color is never the only signal.

| Word              | Used for                                              | Color role      | Mark                                                                           |
| ----------------- | ----------------------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| Needs review      | Run `needs-review`. A change with no decision.        | warning         | `Circle` with a fill, 0.5em                                                    |
| Rejected          | Run `rejected`. A rejected change.                    | danger          | `X`                                                                            |
| Approved          | A change that a person approved                       | success         | `Check`                                                                        |
| Passed            | Run `passed`                                          | success         | `Check`                                                                        |
| Auto-approved     | An added or removed variant that the service approved | neutral, ink 60 | `Check`                                                                        |
| Comparing         | Run `comparing`. Variant `pending`.                   | neutral         | `ProgressCircular` without a value at 0.875em. Reduced motion: `CircleDashed`. |
| Capturing         | Run `incomplete`                                      | neutral         | The same ring                                                                  |
| Failed            | Run `failed`. Variant `error`.                        | danger          | `CircleAlert`                                                                  |
| Rerun needed      | Run `needs-recompare`                                 | danger          | `RotateCw`                                                                     |
| Replaced          | Run `superseded`                                      | neutral, ink 40 | `CornerUpRight`                                                                |
| Unchanged         | Variant `unchanged`                                   | neutral, ink 40 | `Minus` (variant line only)                                                    |
| Critical, Warning | Alerts                                                | danger, warning | `OctagonAlert`, `TriangleAlert`                                                |

Kind words (they say what a change is, not its state): Changed, Added, Removed. Do not use the short labels of `runStateLabels` in the lab (`Review`, `Stale`, `New`, `Same`). Use the words of this table. The color roles equal `runStateRoles`, `reviewStatusRoles`, and `alertSeverityRoles`.

### 2.6 Motion

- What moves: the hover and focus gliders (primitive default); the screenshot fades in when it has decoded (120 ms, opacity only); the save word fades in and out (150 ms); the progress hairline changes width (200 ms); the completion block fades in (200 ms); skeleton bars pulse.
- What does not move: marks change at once. Nothing slides, scales, or bounces. There is no toast and no confetti.
- Stale pixels are removed at once on a new selection. The fade applies only to the arrival of the new image.
- Reduced motion (`motion-reduce:`): no transitions, skeleton bars are static, the ring mark becomes `CircleDashed`, and the refresh icon does not turn.

### 2.7 Shared parts (build these one time and use them on each page)

- `Mark`: the status mark of 2.5.
- `Key`: a key letter without a cap.
- `Sentence`: the h1 with its meta line and an optional action.
- `RunRow`: two densities (two lines, one line).
- `Bars`: skeleton bars with the geometry of the real rows.
- Review: `Plate` (mat and images), `Caption`, `VariantLine`, `ViewControls`, `DecisionCluster`, `Contents`, `ProgressHairline`, `KeysDialog`, `FootLegend`.

```tsx
function Mark({ status }: { status: keyof typeof MARKS }) {
  const { word, role, icon: Icon } = MARKS[status];
  return (
    <Text
      $text={role === "neutral" ? undefined : role}
      role="img"
      aria-label={word}
      className={cx(
        "flex size-[1em] flex-none items-center justify-center",
        role === "neutral" && "ak-ink-60",
      )}
    >
      <Icon className="size-[0.875em]" strokeWidth={2} />
    </Text>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <Text render={<kbd />} className="font-mono text-[0.9em] font-medium">
      {children}
    </Text>
  );
}
```

### 2.8 Rules for builders

- No `Badge`, no `Separator`, no `$mix`, no `$border` on a `Frame` (the screenshot ring is the one exception), no `Kbd` caps (use `Key`).
- Each `Link` takes `$text={false}`, so links are underlined text in the ink of the page and not brand color.
- Each `Progress` and `ProgressCircular` takes a `fill` so that no meter is brand: neutral meters use `fill={{ $invert: true }}` (check the result on `/primitives`), and a warning meter uses `fill={{ $layer: "warning" }}`.
- `Heading` needs `className="mt-0 mb-0 …"` and a `HeadingLevel` around the page. Soft text is `ak-ink-*` on the text element. Put text in `*Label` parts.
- Popovers take `portal` and `$p="1rem"`, so that controls inside keep their radius.
- Sizes of an image come from its `width` and `height` and the scale. These computed pixel values are the only inline sizes.

## 3. Shell and navigation model

### 3.1 What is always on screen

**Document pages (Queue, History, Status, Pull request).** One head line with no background and no rule. It scrolls away with the page, because the page is a document. Left: the word `Visonaut` (home link). Right: `Queue 4`, `History`, `Status`, and the account as two initials. This is 4 words.

- Primitive: `Shell` with `ShellHeader $height="sm" $sticky={false} $p={4}`. `start`: `Button render={<LabLink to="inbox" />}` with the label `Visonaut` (`font-medium`). `end`: `Nav $layout="horizontal" className="text-sm" glider={[{ $kind: "bar" }, { $state: "hover" }, { $state: "focus" }]}` with three `NavLink` elements, then the account button. The bar glider under the current word follows contract rule L1.
- The count after `Queue` is plain text (`tabular-nums ak-ink-60`), not a badge slot. It shows on each document page.
- **Service alert.** No bell and no popover. When alerts are open, the word `Status` gets a dot of 0.5em in the color of the worst severity and the count: `Status 3`. The accessible name is "Status, 3 open alerts". With no alerts the word stands alone.
- **Account.** `ak.MenuButton render={<Button aria-label="Account, @diegohaz" />}` with `ButtonSlot $kind="avatar" $lightnessOffset={2}` and the initials. The avatar is neutral, not brand. The menu (`ak.Menu` with the `popover` and `option` recipes) has two rows: `@diegohaz` (static) and `Sign out`.

**Review page.** No global navigation. One head line: back arrow, run title (opens a popover with the run facts and the account), commit and attempt, `22 left`, the Contents button, and the `?` button. The service alert shows here only as one mark button at the end of the head when an alert is critical. This needs alert data on the run route; the lab does not have it, so the lab omits it.

**Sign-in.** No head and no navigation. A guest does not see links that cannot work.

### 3.2 Moving between places

- Queue row: opens the review of that run directly (no stop at the pull request page). `Enter` opens the first run.
- History row: opens the run. A closed run is read-only.
- Review head: the back arrow goes to the Queue. The run popover has "All runs of #4863" (pull request page) and "Open pull request on GitHub".
- Pull request page: the GitHub check link lands here when the run is not ready. The brand button opens the review.
- Inside a run: the outline (Contents) selects a screenshot, the variant line selects a variant, and `A` or `X` go to the next change that needs review.
- After the last decision: the completion block offers the next run of the Queue.
- Lab scenario map for links: `#4863` or a `rejected` or `needs-review` run goes to review `changes`; `#4831` goes to `large`; the run of inbox `single` goes to `one-change`; `comparing` goes to `comparing`; `failed` goes to `problems`; `superseded` goes to `read-only`; `passed` goes to `passed`. Use `LabLink`.

### 3.3 URL model (for the product; the lab uses `LabLink`)

| URL                                                                                                                                  | Page                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `/`                                                                                                                                  | Queue                                                                                                  |
| `/history?q=<text>&result=<state>`                                                                                                   | History                                                                                                |
| `/status`                                                                                                                            | Status                                                                                                 |
| `/pulls/<number>`                                                                                                                    | Pull request. It works without a `check` parameter. With one, it opens the run when the run exists.    |
| `/runs/<runId>?s=<screenshot key>&v=<variant key>&view=<current, baseline, side, swipe>&diff=<0 or 1>&zoom=<fit, 50, 100, 200, 400>` | Review. Selection and view changes replace the history entry. The state of Contents is not in the URL. |

Sign-in has no route. The block renders at the requested URL, so the return from GitHub keeps the deep link. An unknown URL is a document page with the sentence "Page not found" and the link `Queue`.

### 3.4 Page title pattern

`<state or name> · <object> · Visonaut`: `4 to review · Visonaut`, `History · Visonaut`, `3 alerts · Status · Visonaut`, `#4863 Migrate component examples… · Visonaut`, `22 left · #4863 Migrate component examples… · Visonaut`, `Complete · #4863 … · Visonaut`, `Sign in · Visonaut`.

### 3.5 Sketches

```text
Document shell, 1440
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Visonaut                                                   Queue 4   History   Status 3•   DH  │ 56  head: no bar, no rule, scrolls away
│                                                                                                │ 64  space
│                 The sentence (h1)                                             [ Action  ↵ ]    │
│                 one meta line                                                                  │
│                                                                                                │
│              ●  rows; the marks hang in the left margin, the text keeps one left edge          │
│                                                                                                │
│                 foot line                                                        key legend    │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
                 └──────────────────────── 48rem column, centered ───────────────────────┘

Document shell, 390                         Review shell, 1440
┌──────────────────────────────────────┐    ┌──────────────────────────────────────────────────────┐
│ Visonaut  Queue 4 History Status• DH │ 48 │ ← run title ⌄  commit            22 left   ▤   ?     │ 42
│                                      │ 32 │━━━━━━━━━━━━━━━━━━━───────────────────────────────────│  2
│ The sentence                         │    │ Contents │                                           │
│ one meta line                        │    │ (text    │        mat with the screenshot            │ 744
│ [            Action            ]     │    │ outline) │                                           │
│ ● rows, two lines each,              │    │          │ caption · decisions                       │ 49
│   marks inline                       │    │          │ variants · view                           │ 35
│                                      │    │ key footnote                                         │ 28
└──────────────────────────────────────┘    └──────────────────────────────────────────────────────┘
```

Hanging marks: at 48rem and wider, the `Nav` of a list takes a negative start margin equal to the row padding, the mark slot, and the gap (`-ms-10` with `$p={3}` and a 1.25rem slot), so the row text aligns with the left edge of the sentence. Below 48rem the marks are inline.

## 4. Page specs

### 4.1 Sign-in (`sign-in`: guest, signing-in, forbidden, error)

Hook: `useSignIn(scenario)`.

```text
1440                                                             390
┌────────────────────────────────────────────────────────────┐   ┌──────────────────────────────┐
│                                                            │   │                              │
│                                                            │   │                              │
│                  Visonaut                                  │   │ Visonaut                     │
│                                                            │   │                              │
│                  Sign in to review                         │   │ Sign in to review            │
│                  Needs write access to ariakit/ariakit     │   │ Needs write access to        │
│                                                            │   │ ariakit/ariakit              │
│                  [ Sign in with GitHub ]                   │   │                              │
│                                                            │   │ [   Sign in with GitHub    ] │
│                                                            │   │                              │
└────────────────────────────────────────────────────────────┘   └──────────────────────────────┘
```

**Regions and primitives.** A plain `div` (`grid min-h-dvh content-start justify-items-center pt-[30dvh]`) with one block of 24rem (`grid w-full max-w-96 gap-6 px-6`), text aligned to the start. Wordmark: `Text className="text-sm font-medium ak-ink-60"`. Sentence: `Heading`. Line: `Text render={<p />} className="ak-ink-70"`. Action: `Button $layer="brand" $size="lg"` with `ButtonLabel` (full width below 48rem). Second action: `Link $text={false} render={<button type="button" />}`. No `Frame`, no `Shell`, no head.

**Copy and scenarios.** Budget: 18 words.

| Scenario   | Sentence                   | Line                                            | Actions                                                                           | Words |
| ---------- | -------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- | ----- |
| guest      | Sign in to review          | Needs write access to ariakit/ariakit           | `Sign in with GitHub` (brand)                                                     | 14    |
| signing-in | Sign in to review          | Needs write access to ariakit/ariakit           | The same button, disabled, with a ring in its slot and the label `Opening GitHub` | 12    |
| forbidden  | This account cannot review | @octocat has no write access to ariakit/ariakit | `Use another account` (brand), `Back to GitHub` (link)                            | 18    |
| error      | The service did not answer | Error ID `af4a9c01` (mono)                      | `Try again` (brand)                                                               | 11    |

Each count includes the wordmark. The block keeps its place and its line count in all four scenarios, so nothing moves between them.

**Interactions and keys.** The button has focus on load, so `Enter` signs in. `signIn.signIn()`, `signIn.switchAccount()`, `signIn.retry()`. In `signing-in`, after 5 s the link `Try again` appears under the button.

**Removed.** The app header and its three links, the card, the lock icon, the marketing heading and its paragraph (34 words today), and the three different sign-in designs.

### 4.2 Queue (`inbox`: busy, single, empty, first-run, loading, error)

Hook: `useInbox(scenario)`.

```text
1440, busy (the titles of runs in progress are samples; use the fixture data)
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Visonaut                                                   Queue 4   History   Status 3•   DH  │ 56
│                                                                                                │ 64
│                 4 runs to review                                              [ Review  ↵ ]    │ h1 30, semibold
│                 ariakit/ariakit                                                                │ 14, ink 60
│                                                                                                │ 40
│              ✕  Migrate component examples to the new style recipes      22 left   12 min ago  │ 64  title 16, medium
│                 #4863 · a1b2c3d · 2 rejected                                                   │     meta 12 mono, ink 70
│              ●  Update dependency @playwright/test to v1.63.0            79 left      1 h ago  │ 64
│                 #4831 · 4f1c9e0                                                                │
│              ●  Fix a regression where the Combobox popover does not      6 left      2 h ago  │ 88  the title wraps to 2 lines
│                 reposition after the virtual keyboard closes on iOS Saf…                       │
│                 #4819 · 77aa210                                                                │
│              ●  Version Packages (#4828)                                  3 left      2 h ago  │ 64
│                 main · c0ffee1                                                                 │
│                                                                                                │ 48
│                 In progress                                                                    │ h2 14, medium, ink 60
│              ◌  Rename the tab glider tokens          #4855    Comparing 48 of 120  4 min ago  │ 40  one line
│              ◌  Merge queue, 3 pull requests          9e1d2aa  Capturing            2 min ago  │ 40
│                                                                                                │ 32
│                 Needs attention                                                                │
│              ⊘  Add the datepicker example            #4844    Failed                 3 h ago  │ 40
│              ↻  Version Packages (#4827)              main     Rerun needed           1 d ago  │ 40
│                                                                                                │ 48
│                 Baseline 128 · Updated 12 s ago ⟳                 J K move · ↵ open · ? keys   │ 12, ink 70
└────────────────────────────────────────────────────────────────────────────────────────────────┘
The whole page is about 850 px high: all 8 runs are visible at 1440 x 900 without scroll (today: 2 cards).

390, busy
┌──────────────────────────────────────┐
│ Visonaut  Queue 4 History Status• DH │ 48
│                                      │
│ 4 runs to review                     │ h1 24
│ ariakit/ariakit                      │
│ [            Review            ]     │ brand, 48 high, no key hint on touch
│                                      │
│ ✕ Migrate component examples to the  │ the title wraps to 2 lines
│   new style recipes                  │
│   #4863 · 22 left · 2 rejected · 12 min ago │ one meta line (no commit)
│ ● Update dependency @playwright/te…  │
│   #4831 · 79 left · 1 h ago          │
│ In progress                          │
│ ◌ Rename the tab glider tokens       │
│   #4855 · Comparing 48 of 120        │
│ Needs attention                      │
│ ⊘ Add the datepicker example         │
│   #4844 · Failed · 3 h ago           │
│ Baseline 128 · Updated 12 s ago ⟳    │
└──────────────────────────────────────┘
```

**Regions and primitives.**

- Page: `Shell`, the head of 3.1, `ShellMain $p="1.5rem"` (default 48rem column), `ShellMainBody` with one wrapper `div className="grid gap-12 pt-16 pb-24"`.
- Sentence block: `Heading` (h1) and the brand `Button` in one flex row (`items-center justify-between`), then `Text` for the repository. The button has `ButtonLabel` "Review" and `ButtonSlot $kind="shortcut"` with `<kbd>↵</kbd>`. It links to the first run of `inbox.groups[0]`.
- Lists: one `Nav list={false} glider={[{ $state: "hover" }, { $state: "focus" }]}`. The first group has no label, because the h1 is its label. The other groups are `NavGroup` with `NavGroupLabel` ("In progress", "Needs attention").
- Two-line row (runs that take decisions): `NavLink $p={3} $rounded="lg" render={<LabLink … />}` with `NavSlot` (`Mark`), `NavLinkContent` (`NavLinkLabel` with `line-clamp-2`, `NavLinkDescription` in mono), then `Text className="ms-auto text-sm tabular-nums"` ("22" plus "left" at ink 60), then `Text render={<time dateTime title />} className="w-24 text-end text-sm ak-ink-60"`.
- One-line row (in progress, needs attention): `NavLink $p={2}` with a grid: mark, title (`truncate`), identifier (mono), state word and detail (`text-sm ak-ink-70`), age. The detail is "48 of 120" from `run.progress` or the first words of `run.error`.
- Foot: plain `div` with `Text` items, one icon `Button aria-label="Refresh"` (`RotateCw`), and the key legend (`Key` parts). The legend is hidden on touch devices.
- Title of a run: `getRunTitle(run)`. A run with no title shows the first line of its commit message, or the kind ("Main branch", "Merge queue").
- Meta of a two-line row: `#number` (or `main`), commit, then `attempt n` only when n is above 1, then `n rejected` when n is above 0. The count is `run.pending - run.rejected` and the word `left`.

**Copy.** Budget: 20 fixed words, and at most 9 tokens for each row besides the title. Fixed words at rest in `busy`: head 4 (Visonaut, Queue, History, Status), sentence 3 (runs to review), button 1 (Review), section labels 4, foot 6 (Baseline, Updated, ago, move, open, keys). Total: 18.

| Scenario  | What the page shows                                                                                                                                                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| busy      | As drawn. Sentence: `4 runs to review` (the count is `inbox.counts.review`).                                                                                                                                                                                                                                               |
| single    | `1 run to review`, the brand button, the repository, one two-line row, the foot. No section labels.                                                                                                                                                                                                                        |
| empty     | `Nothing to review` (3 words), the repository, then the section label `Recent` with up to five one-line rows from `recentRuns`, then the foot. No brand button.                                                                                                                                                            |
| first-run | `No runs yet` (3), then one paragraph: `Run the visual tests on main to make the first baseline.` (11), then the link `Read the setup guide` with `ArrowUpRight` (4).                                                                                                                                                      |
| loading   | See section 5. The head is real. Bars replace the sentence, the meta line, and four two-line rows.                                                                                                                                                                                                                         |
| error     | `The queue did not load` (5), the message of the service at ink 70, `Error ID` with the reference in mono when there is one, and the brand button `Try again`. When rows are on screen already (a failed refresh), the rows stay and the foot line says `Could not refresh · Updated 4 min ago` with the link `Try again`. |

**Interactions and keys.** The whole row is one link. `J` or `Down` and `K` or `Up` move the focus through the rows of all groups. `Enter` opens the row with focus, or the first run when no row has focus. `?` opens the Keys dialog, which has the Shortcuts switch. The list refreshes when the tab becomes visible and each 30 s; the rows stay on screen during a refresh and the refresh icon turns (`inbox.refresh()`, `inbox.refreshing`). Hover or focus on a row preloads the run.

**Removed.** The repository eyebrow, "Your review queue." and its sentence, the three stat tiles, the label "READY TO REVIEW", the 240 px cards with an icon tile, a badge, and a "Review changes" button, the "Open run" buttons, the full date and time, the attempt when it is 1, the "Refresh runs" button, the "View history" link, and the bell with its popover.

### 4.3 History (`history`: full, no-match, empty, loading)

Hook: `useHistory(scenario)` and `groupRunsByDay(history.visibleRuns)`.

```text
1440, full
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Visonaut                                                   Queue 4   History   Status      DH  │ 56
│                                                                                                │ 64
│                 History                                                                        │ h1
│                 [ ⌕  Search runs                                   / ]      All results ⌄      │ 40  input and select
│                                                                                                │ 40
│                 Today                                                                          │ h2 14, medium, ink 60
│                 15:18  ✕  Migrate component examples to the new style reci…  #4863   Rejected  │ 40  one line
│                 15:02  ●  Update dependency @playwright/test to v1.63.0      #4831   Needs review │
│                 14:40  ◌  Rename the tab glider tokens                       #4855   Comparing │
│                 11:16  ↱  Migrate component examples to the new style reci…  #4863   Replaced  │ ink 40
│                 09:05  ✓  Version Packages (#4827)                           main    Passed    │
│                                                                                                │ 32
│                 Yesterday                                                                      │
│                 19:36  ✓  Fix the dialog backdrop flash                      #4790   Passed    │
│                 …                                                                              │
│                 Latest 100 runs                                                                │ 12, ink 70
└────────────────────────────────────────────────────────────────────────────────────────────────┘

390, full
┌──────────────────────────────────────┐
│ Visonaut  Queue 4 History Status  DH │
│ History                              │
│ [ ⌕ Search runs                    ] │
│ All results ⌄                        │
│ Today                                │
│ ✕ Migrate component examples to th…  │ two lines for each row
│   15:18 · #4863 · Rejected           │
│ ● Update dependency @playwright/te…  │
│   15:02 · #4831 · Needs review       │
└──────────────────────────────────────┘
```

**Regions and primitives.**

- Sentence block: `Heading` "History". History is an archive, so its first line is its name.
- Controls, one row: `InputGroup $rounded="lg" $edgeWeight="light" className="flex-1"` with `InputSlot` (`Search`), a plain `input` (`min-w-0 flex-1`, `aria-label="Search runs"`, placeholder `Search runs`), and `InputSlot $kind="shortcut"` with `Key` "/". Then `ComboboxProvider` with `ComboboxSelect $layer="transparent" aria-label="Result"` and `ComboboxPopover unmountOnHide`. Each `ComboboxItem` shows a result word and its count (`ComboboxItemLabel`, then the count at ink 60). Only the results in `history.states` are listed. The first item is `All results`.
- List: `Nav list={false}` with hover and focus gliders. One `NavGroup` for each day, with `NavGroupLabel` (`Today`, `Yesterday`, `Oct 3`).
- Row: `NavLink $p={2}` with the grid `grid-cols-[3.5rem_1.25rem_minmax(0,1fr)_4.5rem_7rem]`: time of day in mono (UTC, `HH:MM`, from the timestamp without a locale call), `Mark`, title (`truncate`; `font-medium` only when the run takes decisions), identifier in mono, result word (`text-sm ak-ink-70 text-end`). A replaced run prints at ink 40. The commit and the attempt are in the `title` of the row.
- Foot: `Text` "Latest 100 runs" (the number is `history.limit`).

**Copy.** Budget: 12 fixed words. At rest: head 4, History 1, Search runs 2, All results 2, Latest runs 2. Total: 11, plus the day labels and the result words.

| Scenario      | What the page shows                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| full          | 40 runs in 5 day groups.                                                                                                                          |
| no-match      | The controls keep the query. The list is replaced by one line: `No runs match “datepicker”` and the link `Clear search` (`history.resetFilters`). |
| empty         | `History` and one line: `No runs yet` (3). No controls.                                                                                           |
| loading       | `History`, the two controls (usable: text typed early applies on arrival), one bar for a day label, and eight one-line row bars.                  |
| error (extra) | `History did not load` and the brand button `Try again`.                                                                                          |

**Interactions and keys.** `/` puts the focus in the search field. `Escape` in the field clears it. `J`, `K`, `Up`, `Down` move through the rows. `Enter` opens the run. `?` opens Keys. A row opens the run: a closed run is read-only.

**Removed.** The eyebrow, "Run history." and the sentence about 100 runs, the "Refresh runs" button, the bordered table with its header row (Run, Result, Created), the filled badges, the second line with commit and attempt in each row, the full date and time in each row, and the label "Result" in front of the select.

### 4.4 Status (`status`: healthy, alerts, loading, error)

Hook: `useStatus(scenario)`. This direction does not use `acknowledge` and `dismiss`: the alert list is read-only, as in the app.

```text
1440, healthy                                                    1440, alerts
┌──────────────────────────────────────────────────────────┐    ┌───────────────────────────────────────────────────────────────┐
│ Visonaut                  Queue 4  History  Status   DH  │    │ Visonaut                     Queue 4  History  Status 3•  DH  │
│                                                          │    │                                                               │
│        No open alerts                                    │    │        3 open alerts                                          │
│        Checked 12 s ago ⟳                                │    │        Checked 12 s ago ⟳                                     │
│                                                          │    │                                                               │
│        Database   5.5 MiB of 2 GiB    ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁   │    │     ⯃  GitHub check delivery failed                           │ title 16, medium
│        Captures   0 of 5 running      ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁   │    │        Check the GitHub App access, then follow the recovery  │ action, ink 70
│                                                          │    │        guide to resume the check.                             │
│        Visonaut sends no notifications · Recovery guide ↗│    │        Critical · run #4863 · since 14:55 · seen 4 min ago ·  │ meta, mono, ink 70
└──────────────────────────────────────────────────────────┘    │        14 times                                    Details ⌄  │
                                                                │                                                               │ 32
390: the same single column. Each capacity row stacks:          │     △  Database above the warning level                       │
label and value on one line, the meter under it.                │        …                                                      │
                                                                │                                                               │
                                                                │        Database   1.6 GiB of 2 GiB · above the warning level ▇▇▇▇▇▁│ warning fill
                                                                │        Captures   2 of 5 running                             ▇▇▁▁▁▁│
                                                                │        Visonaut sends no notifications · Recovery guide ↗     │
                                                                └───────────────────────────────────────────────────────────────┘
```

**Regions and primitives.**

- Sentence block: `Heading` with the health sentence. Meta: `Text` "Checked 12 s ago" (`formatRelativeTime(status.checkedAt)`) and an icon `Button aria-label="Check now"` (`RotateCw`, `status.refresh`).
- Alert entry: a plain `article` in a `div className="grid gap-8"`. The mark hangs in the margin (`OctagonAlert` in danger for critical, `TriangleAlert` in warning). Title: `Heading` (h2, `text-base font-medium mt-0 mb-0`). Action sentence: `Text render={<p />} className="ak-ink-70"` with `alert.action`. Meta line in mono: the severity word, `alert.subject`, `since` with the time, `seen` with the relative time, and the count of occurrences. Then `Disclosure` with the button label `Details`: `Code` parts for kind, code, and subject, the `impact` sentence, and a `Button` "Copy". When the alert has a `runId`, the subject is a `Link` to the run.
- Capacity: two rows in a grid `grid-cols-[6rem_minmax(0,1fr)_12rem]`: label (`Text` ink 60), value (`formatBytes`, `tabular-nums`), and `Progress $thickness={0.5}` with a neutral fill. Above the warning size the fill is `warning` and the value adds "above the warning level".
- Footnote: `Text` "Visonaut sends no notifications" and `Link $text={false}` "Recovery guide" to `status.guideUrl`.

**Copy.** Budget: 24 words when healthy; with alerts, 12 fixed words and at most 30 for each alert. Healthy at rest: sentence 3, Checked ago 2, Database of 2, Captures of running 3, footnote 4, Recovery guide 2, head 4. Total: 20.

| Scenario         | What the page shows                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| healthy          | `No open alerts`. The sentence does not say that all systems work, because the list covers alerts only.                                                                                           |
| alerts           | `3 open alerts` (or `1 open alert`), three entries with the critical one first, then capacity with the database above its warning size.                                                           |
| loading          | A bar for the sentence, a bar for the meta line, two entry bars, and the two capacity rows with empty meters. The footnote is real.                                                               |
| error            | `Status did not load` (4) and the brand button `Try again`. When alerts are on screen already, they stay, and the meta line says `Could not check · Checked 4 min ago` with the link `Try again`. |
| overflow (extra) | More than six alerts: each entry is one line (mark, title, subject, seen) and opens on selection. A last line says `More alerts exist. Resolve these first.` when `hasMore` is true.              |

**Interactions and keys.** The page checks again each minute and when the tab becomes visible. `?` opens Keys. No other keys.

**Removed.** The eyebrow "OPERATIONS", "Service status." and its two sentences, the "Refresh alerts" button, the alert cards and the rule in each card, "Technical details" with a native marker, the button "Open the operations and recovery guide" (now a 2-word link), and the bell with its popover in the header.

### 4.5 Pull request (`pull`: attempts, single, no-runs, loading)

Hook: `usePull(scenario)`.

```text
1440, attempts
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Visonaut                                                   Queue 4   History   Status      DH  │ 56
│                                                                                                │ 64
│                 #4863 Migrate component examples to the new style recipes ↗                    │ overline 14: number mono, title medium
│                 22 changes need review                                        [ Review  ↵ ]    │ h1
│                 2 rejected · a1b2c3d · attempt 2 · 12 min ago                                  │ meta
│                                                                                                │ 48
│                 Earlier runs                                                                   │ h2
│              ⊘  a1b2c3d · attempt 1          Failed · capture timed out             1 h ago    │ 40  one line
│              ↱  9f8e7d6                      Replaced                               3 h ago    │ 40  ink 40
└────────────────────────────────────────────────────────────────────────────────────────────────┘

390, attempts
┌──────────────────────────────────────┐
│ Visonaut  Queue 4 History Status  DH │
│ #4863 Migrate component examples to  │
│ the new style recipes ↗              │
│ 22 changes need review               │
│ 2 rejected · attempt 2 · 12 min ago  │
│ [            Review            ]     │
│ Earlier runs                         │
│ ⊘ a1b2c3d · attempt 1                │
│   Failed · 1 h ago                   │
│ ↱ 9f8e7d6                            │
│   Replaced · 3 h ago                 │
└──────────────────────────────────────┘
```

**Regions and primitives.**

- Overline: `Link $text={false} href={github}` with the number in mono (ink 60), the title (`font-medium`), and `ArrowUpRight`. It wraps to two lines at most.
- Sentence block: `Heading` (h1) with the state sentence from `pull.outcome`, the brand `Button` (only when `pull.reviewRun` exists), and one meta `Text`.
- Earlier runs: `Nav` with hover and focus gliders. Each row is a `NavLink $p={2}` with `Mark`, commit and attempt in mono, the result word with the first words of the error (`text-sm ak-ink-70`), and the age. The rows come from `pull.earlierRuns`. A row opens that run as read-only.

**Copy.** Budget: 25 words.

| Scenario               | Sentence                         | Meta and actions                                                                                                                        |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| attempts               | `22 changes need review`         | `2 rejected · a1b2c3d · attempt 2 · 12 min ago`, brand `Review`, then `Earlier runs` with two rows                                      |
| single                 | `Passed`                         | `14 approved · b2c3d4e · 1 h ago` (or `No visual changes · …`), and a ghost `Button` "Open run". No brand button.                       |
| no-runs                | `No visual review needed`        | `This change needs no screenshots.` No action besides the overline link.                                                                |
| loading                | A bar                            | The overline shows `#4863` from the URL at once and a bar for the title. Bars for the meta line and two rows.                           |
| waiting (extra)        | `Waiting for screenshots`        | `CI is still uploading. The review opens when it is ready.` and a thin `Progress` without a value. The page opens the review by itself. |
| capture-failed (extra) | `Capture failed`                 | `Rerun the visual tests in CI.` and the link `Open the workflow run`.                                                                   |
| error (extra)          | `This pull request did not load` | The brand button `Try again`.                                                                                                           |

**Interactions and keys.** `Enter` activates the brand button. `J` and `K` move through the earlier runs. `?` opens Keys.

**Removed.** The card, the icon tile, the eyebrow "VISUAL REVIEW · PULL REQUEST #7", the heading "Pull request #7", the back link "Review queue", the "Check again" button (the page checks by itself), and the "Open on GitHub" button (the overline is the link).

### 4.6 Review (`review`: changes, large, one-change, passed, read-only, comparing, problems, loading)

Hooks: `useReviewSession(scenario)` and `useReviewShortcuts(session, { keys })`.

#### Layout and pixel budget

Root: `div className="grid h-dvh grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] text-sm"`. No `Shell`, no page scroll. Row 1: head (both columns). Row 2: progress hairline (both columns). Row 3: Contents on the left; on the right a flex column with the mat (`min-h-0 flex-1`), the caption, and the tools. Row 4: foot (both columns).

```text
1440 x 900, scenario changes, default view (current image with the diff on)
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ←  #4863 Migrate component examples to the new style recipes ⌄   a1b2c3d · attempt 2     22 left   ▤   ? │ 42  head
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──────────────────────────────────────────────────────────────────│  2  progress (11 of 33)
│ Needs review              ┌────────────────────────────────────────────────────────────────────────────┐ │
│▌Dialog with initial f…  6 │                                                                            │ │
│ Combobox with auto se…  1 │    ┌────────────────────────────────────────────────────────────────────┐  │ │
│ Tabs                    2 │    │                                                                    │  │ │
│ Select                  2 │    │                                                                    │  │ │
│ Tooltip                 2 │    │      the current image, the diff mask on top, change regions       │  │ │ 744
│ Toolbar with a presse…  1 │    │      ringed. 1280 × 720 shown at 1174 × 660                        │  │ │ mat
│ Checkbox group          4 │    │                                                                    │  │ │ (the only
│ Account form            2 │    │                                                                    │  │ │  surface)
│ Disclosure list         2 │    └────────────────────────────────────────────────────────────────────┘  │ │
│ Rejected                  │                                                                            │ │
│ Actions menu            2 └────────────────────────────────────────────────────────────────────────────┘ │
│ Approved                    caption, one line (see the detail below)                                     │ 49
│ Sortable data table         tools, one line                                                              │ 35
│ Legacy installation p…                                                                                   │
│ Unchanged 7 ›               ↑↓ screenshot    ←→ variant    B flip    D diff    C contents    ? keys      │ 28  foot
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  └──── 224 ────┘└──────────────────────────────── 1202 ────────────────────────────────────────┘└ 14 ┘

Detail of the lines under the mat (1202 px wide)
caption 49 │ Dialog with initial focus · React · Chromium · Light   ● Needs review   0.15% changed   Details          Saved   Undo   ⋯   Reject X   [ Approve A ] │
tools   35 │ ● React · Chromium · Light   ● Dark   ● Firefox   ● WebKit   ● Solid   ● Forced colors            Baseline  Current  Side by side  Swipe   ■ Diff   Fit ⌄ │
foot    28 │ ↑↓ screenshot    ←→ variant    B flip    D diff    C contents    ? keys                                                                                │
```

| Measure at 1440 x 900                          | Today                                     | Quiet folio                                                                                      |
| ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Chrome height (above and below the image area) | 469 px (408 above, 61 below)              | 156 px (44 above, 112 below)                                                                     |
| First screenshot pixel                         | y = 408 (45% of the height)               | y = 58 (6%) for an image that fills the height; y = 86 for a 1280 × 720 image, which is centered |
| Image area (the mat)                           | 13% to 30% of the viewport for the images | Mat 1202 × 744 = 69% of the viewport with Contents open; 1412 × 744 = 81% with Contents closed   |
| A 1280 × 720 screenshot, default view          | two images of about 555 px width          | one image of 1174 × 660 = 60% of the viewport (Contents open), 1273 × 716 = 70% (closed)         |
| The same in Side by side                       | 29%                                       | 2 × 580 × 326 = 29% (open), 2 × 685 × 385 = 41% (closed)                                         |

Fit scales an image down to the mat and never up. A small screenshot (320 × 120) stands at 100% in the middle of the mat.

#### Head (42 px)

Plain `div className="flex h-12 items-center gap-2 px-2"`. Each icon button has a `Tooltip` with its name and key.

- Back: `Button aria-label="Queue" render={<LabLink to="inbox" scenario="busy" />}` with `ArrowLeft`.
- Run title: `PopoverDisclosure` (see-through button) with the number in mono at ink 60, the title (`font-medium`, `truncate`, at most 36rem), and a small `ChevronDown` slot. The `Popover portal $p="1rem"` is a two-column grid: `Commit` (link), `Attempt`, `Baseline`, `Opened`; then the links `Open pull request on GitHub` and `All runs of #4863` (pull request page); then `Signed in as @diegohaz` and `Sign out`.
- Identity: `Text className="font-mono text-xs ak-ink-70"` with the commit, and `attempt 2` only when the attempt is above 1. Rule A06 of the contract keeps the run identity above the images. Hidden below 64rem.
- Right end (`ms-auto`): `Text` with `progress.remaining` and the word `left` at ink 60. Then `Button aria-label="Contents" aria-pressed` (`PanelLeft`). Then `Button aria-label="Keys"` with the label `?`.

#### Progress hairline (2 px)

A flex row of three `Frame` elements with `flexGrow` from `session.progress`: approved (`$layer="success"`), rejected (`$layer="danger"`), left (`$lightnessOffset={2}`). The wrapper has `role="img"` and `aria-label="9 approved, 2 rejected, 22 left"`. This line is the one rule on the page, and it replaces the count text, the native progress bar, and the status sentence of the current UI. A run with rejections is never a full green bar.

#### Contents (224 px, item navigation)

`Nav aria-label="Contents" list={false} glider={[{ $kind: "bar", $side: "start" }, { $state: "hover" }, { $state: "focus" }]} className="w-64 overflow-y-auto px-2 [--nav-py:--spacing(1.5)]!"`. It is a text outline: no thumbnails, no boxes, no marks in the rows.

- Groups in the order of `session.groups`, without the empty ones: `Failed`, `Needs review`, `Comparing`, `Rejected`, `Approved`, `Unchanged`. Each is a `NavGroup` with a `NavGroupLabel` (`text-xs font-medium ak-ink-70`). The group is the state of its rows, so a row needs no mark.
- Row: `NavLink $p="var(--nav-py)"` (28 px) with `NavLinkLabel` and a trailing `Text className="ms-auto text-xs tabular-nums ak-ink-70"`. The trailing text is `item.counts.undecided` when it is above 0 (accessible name "6 of 6 need review"), or the word `Added` or `Removed` for a screenshot that has only auto-approved variants. The current row has `aria-current="true"` and `font-medium`.
- Long names: split the name at its last `/`. The prefix is soft and can shrink (`truncate min-w-0 ak-ink-60`). The last segment keeps its full text when it fits. A real name such as `ariakit-tailwind-7466/applied-light-week-hover` then reads as a soft prefix and a clear leaf.
- `Unchanged` is a `NavDisclosure`, closed, with the count of screenshots: `Unchanged 7`. In the product this group must use the virtual list of decision P04 (a real run has about 600 unchanged screenshots).
- Filter: `InputGroup $size="sm" $edgeWeight="light"` at the top with the placeholder `Filter screenshots` and the key hint `/`. It shows when the run has more than 12 screenshots, or after `/`. It calls `session.setQuery`. No match: `No screenshot matches` and the link `Clear`. Decisions then move to the next change inside the filter.
- Open by default at 80rem and wider when the run has more than one screenshot. `C` or the head button toggles it. From 64rem to 80rem it is closed by default and pushes the mat when open. Below 64rem it opens in a `Dialog`.

#### Mat and compare model: one plate, two layers

`Frame $darken $rounded="xl" $p={4} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden me-4"` (and `ms-4` when Contents is closed). No checkerboard.

```tsx
<Frame
  $border
  $borderType="ring"
  $edgeWeight="light"
  $rounded="none"
  className="relative"
  style={{ width, height }}
>
  <img
    src={image.url}
    width={image.width}
    height={image.height}
    alt={`${side} image, ${variant.name}`}
    className="block size-full"
  />
  {diffOn && variant.diff && (
    <img src={variant.diff.url} alt="" className="absolute inset-0 size-full opacity-60" />
  )}
</Frame>
```

The view is one of four values, plus one switch:

| Control                   | Key | What the mat shows                                                                                                                                                                                                                                                                                       | Lab state                                                                   |
| ------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Current (default)         | `F` | The current image at the full mat size                                                                                                                                                                                                                                                                   | `viewer.setMode("new")`                                                     |
| Baseline                  | `G` | The baseline image in the same rectangle                                                                                                                                                                                                                                                                 | `viewer.setMode("original")`                                                |
| Flip                      | `B` | Changes between Baseline and Current. Press it several times to blink by hand. There is no automatic blink.                                                                                                                                                                                              | A custom key that sets `original` or `new`                                  |
| Side by side              | `S` | Two panes, baseline left and current right, at one scale. Each pane has a micro label above it (`Baseline 1280 × 720`, `Current 1280 × 720`). Below 48rem the panes stack.                                                                                                                               | `viewer.setMode("side")`                                                    |
| Swipe                     | `W` | One rectangle. The baseline is under the current image, which is clipped at a divider (`clip-path: inset(0 0 0 X%)`). The divider is a full-size invisible `input type="range"` with a visible 2 px `Frame $invert` line. Micro labels `Baseline` and `Current` stand in the two top corners of the mat. | `viewer.setMode("swipe")`, `viewer.swipePosition`                           |
| Diff (switch, default on) | `D` | The diff mask at 60% opacity over the image, and a 1 px danger ring around each changed region (with 0.5rem of padding and a minimum size of 1.5rem, so that a 7 px change is easy to find). In Side by side the mask is on the current pane.                                                            | `viewer.setHighlight("mask")` and `"none"`; the rings use `variant.regions` |

- The default is Current with Diff on: it answers "where is the change" in the first second and gives the image the full mat. The baseline is one key away (`B`), in the same rectangle, so a small shift shows as motion.
- The view and the zoom stay when the selection changes.
- Zoom: `ComboboxSelect $layer="transparent" $size="sm" aria-label="Zoom"` with `Fit`, `50%`, `100%`, `200%`, `400%`. Keys `0`, `+`, `-`. Above Fit there is one pan state for all panes: drag with the pointer or use the wheel. Arrow keys never pan (decision U04 stays). A click on a region ring zooms to 200% at that region; `0` returns.
- Size change (the `disclosure` scene): the mask marks each pixel, so Diff is off and disabled with the tooltip `The size changed`. The view is Side by side at one scale with the tops aligned, and the caption says `Size 640 × 400 → 640 × 422` in place of the percentage.
- Added variant: one pane, Current. `Baseline`, `Side by side`, `Swipe`, and `Diff` are disabled. Removed variant: one pane, Baseline. Unchanged variant with `candidateOmitted`: Baseline, and the caption says `Unchanged · the current image was not uploaded`.
- Pending variant: a centered ring and the word `Comparing`. Variant with an error: a centered `Mark`, `This comparison failed`, and the message of the variant at ink 70. An image that does not load: the frame keeps the exact size of the image and shows `The current image did not load` (or `The baseline image did not load`) with a `Button $lightnessOffset` "Retry". This is never shown as an added, removed, or unchanged result.

#### Caption (49 px): what is shown, and the decision

Plain `div className="flex h-14 items-center gap-4 ps-1 pe-4"`.

Left part (`min-w-0 flex-1 truncate`), one line of text:

- `Heading` (the h1 of the page, `text-sm font-medium mt-0 mb-0`): the screenshot name.
- `Text className="ak-ink-70"`: the full variant label (`variant.name`, for example `React · Chromium · Light`). Rule A07 of the contract asks for the full label; it is here, one time.
- `Mark` and the state word: `Needs review`, `Approved`, `Rejected`, `Auto-approved`, `Comparing`, `Failed`, `Unchanged`.
- The change fact at ink 70: `0.15% changed` (`formatRatio`), `Added`, `Removed`, or the size change.
- `PopoverDisclosure $size="sm"` with the label `Details` (key `I`).

Right part (the decision cluster, `flex-none`), in this order:

1. **Status slot** (`Text role="status" className="max-w-96 truncate text-xs ak-ink-70 text-end"`). One slot shows, by priority: a refusal with its reason; `Not saved`; `Sending 2`; `Queued 2`; `Saved` (it fades after 1.6 s); the receipt of a whole-screenshot command (`Approved all 6`); `Undone`. The product keeps Sending, Queued, and Saved as three different words (invariant I4). The lab hook has one state: show `Sending n` while `save.status` is `saving`.
2. `Button` "Undo" (see-through, disabled when `!can.undo`, tooltip `Undo ⌘Z`).
3. `ak.MenuButton` with `Ellipsis` and `aria-label="More decisions"`. The menu has `Approve all 6 variants` (`⇧A`) and `Reject all 6 variants` (`⇧X`). The number is the count of changes of this screenshot that the command covers.
4. `Button` "Reject" with the shortcut slot `X` (see-through).
5. `Button $layer="brand"` "Approve" with the shortcut slot `A`. This is the one brand element of the page.

Decision flow:

- `A` or `X` (or a click) sets the verdict of the current variant. The mark in the variant line changes at once, the count in Contents and in the head goes down, and the hairline grows. The selection moves to the next change that needs review (`autoAdvance`, it wraps one time). The images of the next two changes are loaded before they are needed, so the next plate shows without a wait.
- Reject and Approve are disabled until the images of the current selection have decoded (invariant I1). If the images take more than 300 ms, a thin `Progress` without a value shows at the top edge of the mat. The buttons keep their place and their size in each state, so a second click never misses.
- `⇧A` and `⇧X` are one decision for all changes of the screenshot. There is no confirmation dialog on the key path or on the menu path. The status slot shows the receipt (`Approved all 6`) and Undo is the next control.
- `⌘Z` or `Ctrl+Z` takes back the last decision and restores the selection.
- A failed save: the cluster changes to a danger `Mark`, the words `Not saved`, the brand button `Retry` (`session.retrySave`), and the see-through button `Discard` (`session.discardFailedSave`). Reject and Approve are not shown until one of them is used. In the product, `Retry` sends the same command, and a conflict shows its sentence in the same slot.
- Focus stays on the control that the person used, because the buttons never unmount.

#### Tools (35 px): variants and view

Plain `div className="flex h-10 items-center gap-6 ps-1 pe-4"`.

- Variant line (left, `min-w-0 flex-1 overflow-x-auto`): `Nav aria-label="Variants" $layout="horizontal" glider={[{ $kind: "bar" }, { $state: "hover" }, { $state: "focus" }]}` with one `NavLink` for each variant: `NavSlot` with the `Mark` of the verdict, then `NavLinkLabel`. Variants stay links with a bar glider (contract rule L1), and an arrow key opens the variant at once (decision U06).
- Short labels: the first variant shows its full label. Each other variant shows only the parts that differ from the first (`Dark`, `Firefox`, `Solid`, `Forced colors`). A `Tooltip` on each link gives the full label and the position key. Six variants need about 570 px, so all are visible; today three of seven are visible and none shows a verdict.
- A screenshot with one variant has no variant line.
- View controls (right): `ak.RadioGroup render={<ButtonGroup $size="sm" $p="none" aria-label="View" />}` with four `ak.Radio render={<Button />}` (`Baseline`, `Current`, `Side by side`, `Swipe`) and `ButtonGlider $kind="bar"`. Then the Diff switch: a `Button $size="sm" aria-pressed` with a `Square` icon in a `Text $text="danger"` (filled when on, hollow when off) and the label `Diff` (`font-medium` when on, ink 60 when off). The red square is the legend of the red mask. Then the zoom select.

#### Foot (28 px): the keys as a footnote

`div className="flex h-8 items-center gap-5 px-4 text-xs ak-ink-70"`: `↑↓ screenshot`, `←→ variant`, `B flip`, `D diff`, `C contents`, `? keys`. Each key is a `Key`. Only keys that apply are shown (no `←→ variant` when there is one variant). The foot is hidden on touch devices and when "Key hints" is off.

Complete key map (one meaning for each key):

| Keys             | Action                                                    | Origin                             |
| ---------------- | --------------------------------------------------------- | ---------------------------------- |
| `↑` `↓`          | Previous or next screenshot in Contents; stop at each end | contract K1                        |
| `←` `→`          | Previous or next variant; stop at each end                | contract K5                        |
| `1` to `9`       | The variant at that position                              | contract K6 has 1 to 6             |
| `J` `K`          | Next or previous change, across screenshots               | lab                                |
| `N` `⇧N`         | Next or previous change that needs review                 | lab                                |
| `A` `X`          | Approve or reject, then the next change that needs review | contract K7                        |
| `⇧A` `⇧X`        | Approve or reject all changes of the screenshot           | contract K11                       |
| `⌘Z` or `Ctrl+Z` | Undo                                                      | contract K14                       |
| `F` `G`          | Current, Baseline                                         | contract K13 and the guide         |
| `B`              | Flip between Baseline and Current                         | new                                |
| `S` `W`          | Side by side, Swipe                                       | K13, lab                           |
| `D`              | Diff on or off                                            | changed: it was the mask-only view |
| `0` `+` `-`      | Fit, zoom in, zoom out                                    | lab                                |
| `C` `I` `/` `?`  | Contents, Details, filter, Keys                           | new                                |
| `Escape`         | Close a popover or a dialog. It never rejects.            | contract K15                       |

For the lab: call `useReviewShortcuts(session, { keys })` and pass handlers for `d` (toggle the highlight), `b` (flip), `o` and `h` (do nothing: this direction has no separate overlay view), `c`, `i`, `/`, and `?`. On mount, set the view to `new` and the highlight to `mask`. `?` works also when shortcuts are off.

**Keys dialog** (`Dialog className="flex max-w-xl flex-col gap-4"`): `DialogHeading` "Keys", a `DialogScroll` with three groups from `reviewShortcuts` (`Move`, `Decide`, `View`) in two columns, each row a `Key` set and one to four words, then two `CheckboxField` rows: `Shortcuts` (`session.setShortcutsEnabled`) and `Key hints` (the foot), then `DialogDismiss` "Close". About 60 words. Both switches are remembered in the product.

#### Details (`I`)

`Popover portal $p="1rem" className="grid max-w-80 gap-3"`, anchored to the caption, with a two-column grid (label at ink 60, value in mono):

```text
Details
Changed     1,843 px · 0.15%
Size        1280 × 720
Threshold   0.2 · pixelmatch
Decision    Approved by @diegohaz · 12 min ago      (or: None yet)
Run         a1b2c3d · attempt 2 · baseline 128
[ Copy debug info ]
```

The engine and the threshold stay, because the contract asks for them. Identifiers and digests go to the clipboard with `Copy debug info`.

#### Scenarios

| Scenario      | What the page shows                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| changes       | As drawn. Head: `22 left`. Hairline: 9 approved, 2 rejected, 22 left.                                                                                                                                                                                                                                                                                                                   |
| large         | Head: `79 left`. Contents has the filter field and long groups; `Unchanged` is closed. All other parts are the same.                                                                                                                                                                                                                                                                    |
| one-change    | No Contents and no variant line (one screenshot, one variant), so the mat is 1412 px wide. Head: `1 left`. The foot shows `B flip`, `D diff`, `? keys`. After the decision the completion block shows.                                                                                                                                                                                  |
| passed        | The completion block (below) in place of the mat, the caption, and the tools. Contents stays. A row of Contents opens that screenshot as a plate again; the first row of Contents, `Review complete`, returns to the block.                                                                                                                                                             |
| read-only     | The plate, the variant line, and the view controls work. The decision cluster is not rendered. In its place: a warning `Mark`, the text `Read-only · A newer run replaced this one`, and the brand button `Open current run` (it uses `review.supersededBy`). Other causes use one sentence each: `Read-only · This run is the baseline`, `Read-only · The images of this run expired`. |
| comparing     | Head: `Comparing 6 of 16` in place of the count. Contents lists the screenshots; the group `Comparing` has ring marks. A compared variant shows its plate. In place of the decision cluster: the text `Decisions open when the comparison ends` and a `Progress` of 6rem with the value.                                                                                                |
| problems      | Contents starts with the group `Failed`. The run is failed, so in place of the decision cluster: a danger `Mark` and `Failed · Rerun the visual tests in CI`; the run error is in the run popover. The mat shows the three problem states of the compare model above (failed comparison, image that does not load with Retry).                                                          |
| loading       | See section 5.                                                                                                                                                                                                                                                                                                                                                                          |
| error (extra) | In place of the mat: the sentence `This run did not load`, the Error ID in mono, and the brand button `Try again`.                                                                                                                                                                                                                                                                      |

#### Completed state

When `session.complete` is true and the person did not select a screenshot after that, the right column shows a centered text block of 28rem on the canvas (no mat):

```text
Review complete                                  h1, text-3xl
27 approved · 6 auto-approved                    ink 70
◌ Updating the check on GitHub                   one line with three states
[ Next run  ↵ ]   Update dependency @playwright/test to v1.63.0
Open #4863 on GitHub ↗     Queue
```

- With rejections: `25 approved · 2 rejected`, then `Rejected changes keep the check red.`
- The check line has three states: `Updating the check on GitHub` (ring mark), `The check passed on GitHub` (success mark), `GitHub did not take the update` with the link `Status` (danger mark). This needs the delivery state of the check, which the API does not give today; the lab shows the first state and then the second after 1.5 s.
- The brand button is `Next run` with the title of the next run of the Queue beside it. When the Queue is empty, the brand button is `Open #4863 on GitHub`.
- Undo still works here.

#### 390 x 844

```text
┌──────────────────────────────────────┐
│ ←  #4863 Migrate component ex… ⌄  22 │ 48  head ("22" is the count that is left)
│━━━━━━━━━━━━──────────────────────────│  2
│┌────────────────────────────────────┐│
││                                    ││
││                                    ││
││     current image, fit to width    ││ 638 mat (374 wide, 73% of the screen)
││     diff mask on top               ││
││                                    ││
││                                    ││
│└────────────────────────────────────┘│
│ ‹  Dialog with initial f… · Light  3 of 33  › │ 48  position row: one flat list of changes
│ [ Baseline | Current ]   ■ Diff   ⋯  │ 44  view row
│ [   Reject   ] [      Approve      ] │ 64  two buttons of 48 px
└──────────────────────────────────────┘
```

- Root `text-base` below 48rem, so targets are 44 px or more. Chrome: 206 px. The mat is 638 px high; the first pixel of a tall image is at y = 58 (today: y = 518).
- Position row: `‹` and `›` call `session.previous()` and `session.next()` through the flat list of changes. The text between them (screenshot name, short variant label, `3 of 33`) is a `DialogDisclosure` that opens Contents in a `Dialog` with `DialogScroll`. In the dialog, the current screenshot row shows its variants as child rows with marks.
- View row: the two-part control `Baseline | Current` (a `ButtonGroup` with a glider) is the flip. It also names the image on screen, so the mat needs no label. `⋯` opens a menu with `Undo`, `Approve all 6 variants`, `Reject all 6 variants`, `Side by side` (stacked), `Swipe`, `Zoom to 100%`, and `Details`. The save word shows in this row.
- No gestures with a hidden meaning: no swipe and no press-and-hold. Drag pans a zoomed image and that is all.
- No foot legend.

#### Words

Budget: 30 fixed words at rest. Count for `changes`: head 1 (left), Contents 5 (Needs review, Rejected, Approved, Unchanged), caption 7 (Needs review, changed, Details, Undo, Reject, Approve), tools 8 (Baseline, Current, Side by side, Swipe, Diff, Fit), foot 6. Total: 27. All other text on the page is data.

#### Removed, compared with the current UI

The app header with three links on the run page. The second header row with the "Queue" button and the sidebar button. The meta strip (the commit and the attempt are in the head; the baseline revision and the run status are in the popover). The item heading block with its 30 px title, its badge, and "0.05% changed · 120 changed pixels". The variant chips with four icons, four words, a size, and a key number (265 to 307 px each). The row of view buttons with icons and letters, and the view that shows the mask alone. The pane caption rows (48 px). The checkerboard. The sidebar header "SCREENSHOTS · 4 items", the joined status select and search field, the 26 px thumbnails, the sentences "7 of 7 need review", and the group "Accepted (1)". The sticky decision bar surface, "All 7 changed views…" and its confirmation dialog, and the label "Approve & next". The footer with "Keyboard help", "Shortcuts on", and "Recompare stored run". The Details sidebar. The four banners. "9 of 11 need review" and its progress bar. The eight pan buttons.

## 5. Loading

Rules for all pages: at 0 ms the page shows its fixed frame (the head words, a fixed heading, the foot legend) and bars with the exact geometry of the real content. There is no spinner and no sentence. Content replaces the bars in place with a 120 ms fade and no layout shift. A wait gets words only at 5 s. The words "Checking access" never show. A deep link shows the skeleton of its target first; if the session check answers that the person is a guest, the skeleton changes to the sign-in block. Bars: `Frame $lightnessOffset={2} $rounded="sm" className="animate-pulse motion-reduce:animate-none"` inside a wrapper with `aria-busy="true"` and an `aria-label` such as "Loading runs". Late text uses a delayed fade (the lab has `animate-lab-late` for 1 s; use the same keyframes with a 5 s delay).

| Page         | 0 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 300 ms                                                                                                                                                                                                                               | 1 s                                                                                                                                           | 5 s (the wait is still open)                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in      | The complete page. It needs no data.                                                                                                                                                                                                                                                                                                                                                                                                                               | No change                                                                                                                                                                                                                            | No change                                                                                                                                     | In `signing-in`: the link `Try again` shows under the button.                                                                                                         |
| Queue        | The head (words, a neutral circle for the account). A bar for the sentence (16rem by 2.25rem), a bar for the meta line, four two-line row bars with a circle for the mark. No button, no foot.                                                                                                                                                                                                                                                                     | The sentence, the brand button, the rows, the sections, and the foot replace the bars.                                                                                                                                               | No change. The bars pulse.                                                                                                                    | Under the bars: `Still loading` and the link `Try again`. The bars stay.                                                                                              |
| History      | The head, the heading `History`, the search field and the select (both usable), one bar for a day label, eight one-line row bars.                                                                                                                                                                                                                                                                                                                                  | The day groups and the rows.                                                                                                                                                                                                         | No change                                                                                                                                     | `Still loading` and `Try again`.                                                                                                                                      |
| Status       | The head, a bar for the sentence, a bar for the meta line, two entry bars, the two capacity rows with empty meters, the real footnote.                                                                                                                                                                                                                                                                                                                             | The sentence, the entries, the meters.                                                                                                                                                                                               | No change                                                                                                                                     | `Still loading` and `Try again`.                                                                                                                                      |
| Pull request | The head, the overline with `#4863` from the URL and a bar for the title, bars for the sentence, the meta line, and two rows.                                                                                                                                                                                                                                                                                                                                      | All content. If the run is ready and the person came from a check link, the review opens.                                                                                                                                            | No change                                                                                                                                     | `Still loading` and `Try again`.                                                                                                                                      |
| Review       | The head: the back arrow, a bar for the title (or the real title and count when the person came from the Queue, which has them), the Contents and `?` buttons. An empty hairline track. Nine row bars in Contents. The mat (the real surface) with one frame bar of 16:9 at 60% of its width. A bar in the caption. Reject and Approve are rendered and disabled, so nothing moves later. No tools. The real foot legend, so the keys can be read during the wait. | The title, `22 left`, the hairline, Contents, the caption, the variant line, and the view controls are real. The mat shows a frame with the exact size of the selected screenshot (from its width and height), and the frame pulses. | The image has decoded and fades in over 120 ms. Reject and Approve become enabled. The images of the next two changes load in the background. | If the list is still open: `Still loading` and `Try again` under the title bar. If only the image is still open: `Still loading the images` and `Retry` in the frame. |

After the first load: a refresh never blanks a page. A new selection on the review page removes the old pixels at once and resizes the frame to the new image; the image shows when it has decoded (the next two changes are loaded before, so `A` and `X` show the next plate without a wait). A thin `Progress` without a value at the top edge of the mat shows only after 300 ms.

## 6. Risks, tradeoffs, and earlier decisions that this direction revisits

**Risks of the lens.**

- Small marks in place of badges are harder to scan from a distance, most of all in History with 40 rows.
- Text buttons without borders have a weaker affordance. Reject looks like a word until hover. The hover glider and the key letters must do this work.
- The strict rule "one brand control for each screen" means that links, the progress line, and switches are not brand color. A builder who uses a primitive default (a `Link`, a `Progress` fill, a checked box) can break the rule by accident.
- The default view shows one image. A reviewer who expects two images must press `S` one time; the view then stays.
- Contents has no thumbnails, so a screenshot is found by its name only.
- No decision is wider than one screenshot. A run with 79 open changes needs at least one key press for each screenshot (`⇧A`), and often 79.
- No sort by change size and no filter chips. The filter is text only.
- Soft ink on the light canvas: 12 px text must use ink 70. Check the light scheme for each page.
- The document pages use more type size and more space than the current UI. This is the opposite of decision D17 (`compact` was selected, `comfortable` was rejected). The review page stays compact.
- The foot legend costs 28 px. It can be turned off in the Keys dialog.

**Earlier decisions and binding rules that this direction changes.** Each one needs a maintainer decision before it goes into the product.

| Rule or decision                                                                                            | What this direction does                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P02 "Load diff when selected" (rejected: eager)                                                             | The diff is on by default, so the mask loads with each selection. The mask becomes shown evidence, so it must be in the set that a decision waits for (invariant I1).                                   |
| K13 and A16 (S, D, F and a red mask-only view)                                                              | `D` becomes a switch for the mask over the image. The mask-only view goes away. Swipe (`W`) and flip (`B`) are new. The design record of revision 9 deferred swipe and overlay; it did not reject them. |
| A21 and D30 (a labeled empty pane for an addition or a removal)                                             | One pane. The caption says `Added` or `Removed`, and the controls that need two images are disabled.                                                                                                    |
| A27 and D53 (narrow layout: list above the viewer, stacked images; phone flows are not in the launch scope) | The phone layout has one plate with a flip control, and Contents is in a dialog.                                                                                                                        |
| A11 (thumbnail of the first declared variant)                                                               | No thumbnails.                                                                                                                                                                                          |
| A08 ("2 of 6 need review")                                                                                  | The Contents row shows the bare count; the full phrase is the accessible name.                                                                                                                          |
| L4 and A13 (the group "Accepted", the words "Accepted automatically")                                       | Six groups by state, with the words `Approved`, `Unchanged`, and `Auto-approved`.                                                                                                                       |
| U02 (decisions in the main header)                                                                          | The decisions are under the image, at its right corner. Rule A06 "review actions next to the result" holds.                                                                                             |
| K11 and RULE-06 (the button path of the whole-item command has a confirmation dialog)                       | No confirmation on either path. A visible receipt and Undo replace the dialog.                                                                                                                          |
| K8 ("next pending in visible order")                                                                        | With a filter, the next change is inside the filter.                                                                                                                                                    |
| K6 (keys 1 to 6)                                                                                            | Keys 1 to 9.                                                                                                                                                                                            |
| X4 (visible shortcut toggle)                                                                                | The switch is in the Keys dialog, which `?` and the foot open on each page.                                                                                                                             |
| U04 notes ("do not add a hotkey registry")                                                                  | The Keys dialog renders from the list `reviewShortcuts`. There is no command palette and no `Cmd+K`. Arrow keys never pan, as selected.                                                                 |
| L5 and invariant I4 (sending, queued, saved)                                                                | Kept: three words in one slot. The lab hook can show only one of them.                                                                                                                                  |
| D17 (compact, mostly flat controls)                                                                         | Flat: yes. Compact: only on the review page.                                                                                                                                                            |

Kept without change: U03 and L1 (item links, variant links with a bar glider), U05 (review work first, History as its own page), U06, D02, D03, D04, D21, D28, D29 (the order inside each group), D31, invariants I1 to I9, and no reject note and no noise verdict.

**Fields that are not in the API today** (the lab fixtures have them): `Run.counts`, `progress`, `error`, `commitMessage`, `updatedAt`; `PullRequest.title` and `runs`; `ReviewRun.pullRequest`, `counts`, `progress`, `supersededBy`; `ReviewVariant.regions`, `reviewerLogin`, `decidedAt`; `ServiceAlert.severity`, `impact`, `occurrences`, `runId`. Also needed and in no fixture: the delivery state of the GitHub check for the completion block, the pull request URL on the sign-in data, and alert data on the run route. Lab-only behavior that this direction uses: the six groups, the filter that limits the next change, Swipe, the zoom levels 50% and 400%, keys `J`, `K`, `N`, `W`, `0`, `+`, `-`.

**Fallbacks if a part is refused.** Without regions: the mask alone marks the change, and the zoom keys do the rest. Without eager masks: Diff starts off and `D` loads the mask. Without the phone scope: the phone layout stays a lab exploration. Without pull request titles: rows show the first line of the commit message, or the kind and the commit.
