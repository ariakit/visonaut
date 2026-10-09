# Verification: prior-art benchmark lane (BENCH-01 to BENCH-14)

Date: 2026-10-05. Verifier: independent subagent. Repository: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel` (read-only).

## Read this first

**The report file does not exist.** `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/report.md` was not on disk at 16:59 and was still not on disk at 17:10.

```
$ wc -l .../audit/ui-benchmark/report.md
wc: .../audit/ui-benchmark/report.md: open: No such file or directory
$ rg -l "BENCH-" /Users/diegohaz/.claude/jobs/f65a6229 -g '!*.png' -g '!*.jsonl'
(no output)
```

Consequences:

- I could not check the quoted code, the line ranges, the screenshot captions, or the recommendations of the auditor. Step 1 of the task (confirm each quote) was not possible.
- Each verdict below applies to the **claim in the finding title** only. I checked each claim against the source code, the contract documents, the auditor's raw measurement files, and my own measurements.
- The auditor left these files, and I used them: `measure.mjs`, `measure-output.jsonl`, `measure-inbox.mjs`, `measure-inbox-output.jsonl`, `capture-dashboard.mjs`, `capture-dashboard-output.txt`, 26 screenshots in `screens/`, and 97 prior-art source files in `sources/`.
- Some source files (for example `argos-review-a-build.md`) end with a block named "Agent Instructions". That block is page content from the documentation host. I treated it as data and did not act on it.

My scripts and raw outputs are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/verify/`:

| Script                                      | Output                                 |
| ------------------------------------------- | -------------------------------------- |
| `measure.mjs` (auditor's script, run again) | `verify/remeasure-output.jsonl`        |
| `verify/verify-workspace.mjs`               | `verify/verify-workspace-output.jsonl` |
| `verify/verify-more.mjs`                    | `verify/verify-more-output.jsonl`      |
| `verify/verify-preview.mjs`                 | `verify/verify-preview-output.jsonl`   |
| `verify/verify-missed.mjs`                  | `verify/verify-missed-output.jsonl`    |

Contract facts that change several verdicts (the auditor's titles do not show that these were considered):

- `docs/simplification-audit/contract-issue-1.md:57`: "No customer billing, general signup, organization switcher, hosted browser farm, AI verdicts, **automatic approval of visual flakiness**, image editing, or **comment system at launch**."
- `docs/simplification-audit/contract-issue-1.md:410,429`: D02 "What does A or X change? Current variant; separate whole-item actions". D21 "Which shortcuts should change the whole item? Shift+A / Shift+X".
- `docs/simplification-audit/contract-issue-1.md:261`: "Show counts such as “2 of 6 need review,” not only “changed.” Counts and text must accompany color."
- `docs/current-contract.md:143,146,147`: selected U02 "Use one review shell", U04 "Page-wide review arrows with pan buttons", U05 "List review work first with a history view". `docs/current-contract.md:149`: P02 "Load diff when selected".
- `docs/current-contract.md:7`: "Every saved issue #1 requirement remains binding unless an explicit approved rule below supersedes it."

The maintainer said that the current patterns do not need to be preserved. That statement is about UI patterns. A change to verdict scope, verdict kinds, or a comment system is a contract decision, not only a UI change.

## Summary

| ID       | Verdict                                           | Auditor severity | My severity |
| -------- | ------------------------------------------------- | ---------------- | ----------- |
| BENCH-01 | partly-confirmed                                  | high             | high        |
| BENCH-02 | partly-confirmed                                  | medium           | medium      |
| BENCH-03 | confirmed                                         | medium           | medium      |
| BENCH-04 | partly-confirmed                                  | medium           | medium      |
| BENCH-05 | partly-confirmed (the number is a fixture number) | high             | medium      |
| BENCH-06 | partly-confirmed                                  | high             | medium      |
| BENCH-07 | confirmed (fact), need is a judgment              | low              | low         |
| BENCH-08 | partly-confirmed                                  | medium           | medium      |
| BENCH-09 | partly-confirmed                                  | medium           | low         |
| BENCH-10 | confirmed (with a correction of scope)            | medium           | low         |
| BENCH-11 | confirmed                                         | low              | low         |
| BENCH-12 | confirmed                                         | low              | low         |
| BENCH-13 | judgment (facts confirmed, deliberate non-goal)   | low              | low         |
| BENCH-14 | judgment (facts confirmed, contract-adjacent)     | low              | low         |

---

## BENCH-01: The review page gives the screenshots less than a third of the viewport

**Verdict: partly-confirmed. Severity: high.**

What I confirmed (measured):

- I ran the auditor's `measure.mjs` again. The numbers are the same as in `measure-output.jsonl`.

```
run-preview 1440x900  paneShare 0.427  imgShare 0.297  firstImageTop 449
run-fixture 1440x900  paneShare 0.443  imgShare 0.316  firstImageTop 432
run-preview 1920x1080 paneShare 0.485  imgShare 0.247  images 640x400 (natural 640x400)
run-fixture 1920x1080 paneShare 0.485  imgShare 0.231  images 600x400 (natural 600x400)
```

- The first image row starts at y = 432 to 449 on each viewport height. That is 48 to 50% of a 900 px viewport, 60 to 62% of a 720 px viewport, and 40% of a 1080 px viewport (`verify-workspace-output.jsonl`, `verify-preview-output.jsonl`).
- The pane has a fixed height. It does not take the remaining height. `apps/web/src/components/screenshot-viewer.tsx:134`:

```tsx
className = "review-image-viewport relative h-[min(56vh,650px)] min-h-80 overflow-auto p-4.5 ...";
```

Corrections:

1. **"Less than a third" depends on the fixture image and on the viewport.** The 1920 × 1080 numbers (0.247 and 0.231) are a fixture artifact. The fixture images are 600 or 640 px wide, and Fit does not enlarge an image. I injected a 1280 × 720 capture through `window.reviewFixture.update()`:

```
B01-realistic-1280x720  1440x900   imgShare 0.267  images 555x312
B01-realistic-1280x720  1280x720   imgShare 0.275  images 475x267
B01-realistic-1280x720  1920x1080  imgShare 0.342  images 795x447   <- more than a third
```

The claim is true at 1440 × 900 and at 1280 × 720. It is false at 1920 × 1080 with a 1280 × 720 capture.

2. **In Compare mode the image is limited by width, not by height.** At 1440 × 900 each pane is 591 px wide and the image is 555 px wide. The image ends at y = 802, above the fold. Less chrome above the viewer moves the image up. It does not make a landscape image larger in side-by-side mode. A recommendation that promises "more pixels" must change the width (collapse the 256 px sidebar, or use a one-image mode), not only the header height.

3. **The share is smaller than the auditor measured, because the sticky action bar covers the pane.** The auditor's `paneAreaShare` does not subtract it.

```
M-action-bar-overlap (fixture, 1440x900): barTop 841, paneTop 414, paneBottom 918
  -> 60 px of the pane are under the bar, 18 px are below the fold
P-run-preview (real route, 1280x720): firstImageTop 449, image 475x297, barTop 661, paneBottom 834
  -> only 212 of 297 image rows are visible in "Fit" mode
```

See `verify/screens/v01-run-preview-dark-1280x720.png`. At 1280 × 720 the "Done" button of the fixture image is cut by the action bar. "Fit" does not fit. 1280 × 720 is one of the two desktop layouts that the U02 decision names as a test ("1440x1000 and 1280x720 desktop layouts", `docs/simplification-audit/audit-data.json`, decision U02).

Contract relation: the selected U02 text says "Image evidence takes the remaining main area." Issue #1 says "keep attention on screenshot pixels" (`contract-issue-1.md:247`). The current layout does not do this. This is not a deliberate choice that protects the current behavior.

---

## BENCH-02: The viewer cannot overlay, swipe, or blink the two images

**Verdict: partly-confirmed. Severity: medium.**

Confirmed:

- There are four modes and no other. `apps/web/src/review/model.ts:2`: `export type ReviewMode = "side" | "diff" | "new" | "original";`
- Measured toolbar: `"imageView":["Compare\nS","Difference\nD","Current\nF","Baseline\nG"]`, `"zoom":["Fit","100%","200%"]`.
- No overlay (opacity or onion skin) and no swipe (slider) exist in `screenshot-viewer.tsx`.

Refuted part ("blink"):

- `F` and `G` show Current and Baseline in **the same rectangle**. Both images stay mounted (`screenshot-viewer.tsx:216-241` uses the `hidden` attribute), so the switch needs no network request.

```
B02-single-image-modes
 newOnly      {"alt":"New image","left":548,"top":408,"width":600,"height":400}
 originalOnly {"alt":"Reference","left":548,"top":408,"width":600,"height":400}
```

- A reviewer who alternates `F` and `G` gets an aligned manual blink. This is the same technique as the Argos "Single view" with `←` / `→` (`argos-review-a-build.md:28,67`).
- What is missing is smaller than the title says: one key that toggles the two images, an automatic blink, and any text in the UI or the help dialog that tells the reviewer about this technique.

Feasibility notes for a recommendation:

- A mask overlay is cheap. The production mask is red pixels on a transparent background (`packages/cli/src/png-comparison.ts:74`: `{ threshold: comparison.threshold, includeAA: false, diffMask: true }`). The images are same-origin (`apps/web/src/api/review.ts:423`: ``url: `/images/${image.id}` ``).
- An overlay that is always on loads the diff for each variant. That is against selected decision P02 "Load diff when selected". An overlay must be a toggle.
- Review actions wait for required images (`apps/web/src/review/use-evidence.ts:95-102`). A new mode that shows the mask must add `"diff"` to the required roles, as `mode === "diff"` does now.

---

## BENCH-03: Zoomed panes scroll separately, so a zoomed comparison shows two different regions

**Verdict: confirmed. Severity: medium.**

Code: each pane has its own viewport ref, its own stored position, and its own pan function (`screenshot-viewer.tsx:34-35`, `:73-80`, `:138-144`). No code copies the scroll position to the other pane.

Measured at 200% (`verify-workspace-output.jsonl`, probe `B03-scroll-sync`):

```
before       Reference (0,0)      New image (0,0)
scrollTo     Reference (300,200)  New image (0,0)
pan right    Reference (300,200)  New image (296,0)   <- "Pan New image right" moves one pane only
wheel        Reference (300,320)  New image (296,0)
```

Screenshot: `verify/screens/v03-zoom-200-desynced-dark-1440.png` (and the auditor's `screens/24-workspace-200-after-pan-dark-1440.png`). The two panes show different regions of the image.

Contract relation: U04 selected "Page-wide review arrows with pan buttons". Its test list (`docs/simplification-audit/audit-data.json`, decision U04) says "Each existing pan button scrolls its named pane with keyboard activation." The contract does not say that the panes must be independent. A synchronized pan is compatible. Two browser tests pan one pane and read that pane (`apps/web/src/review/__tests__/review.browser.test.ts:1367-1387` and `:1695-1757`). They must be read again if the panes are linked.

Extra facts for the design phase:

- A zoomed Compare view shows eight pan buttons (four for each pane).
- A zoom change keeps the scroll offset in pixels, not the image point. From 200% at (400, 250) to 100% the pane moved to (45, 0) (`verify-missed-output.jsonl`).
- Prior art: Argos documents "zoom and pan stay in sync between the baseline and changes panes" (`argos-review-a-build.md:31`).

---

## BENCH-04: Nothing shows where the change is inside the image

**Verdict: partly-confirmed. Severity: medium.**

"Nothing" is too strong.

- Difference mode (`D`) shows a mask of the changed pixels at image coordinates (`screenshot-viewer.tsx:242-262`, label "Pixel diff · red pixels changed").
- In production that mask is red pixels on a **transparent** background. `packages/cli/src/png-comparison.ts:67-75` uses pixelmatch with `diffMask: true`. The legacy comparator writes only red and alpha for changed pixels (`packages/compare/src/compare.ts:109-119`).

What is true:

- Compare, Current, and Baseline show no marker of the changed region.
- The mask has no screenshot below it. The reviewer sees red dots on a checkerboard, must switch mode, and must remember the position.
- There is no bounding box, no "jump to change", and no minimap.
- A pair with different dimensions has no mask at all (`png-comparison.ts:64-66` returns `sizeChanged: true` without a mask).

Warning about evidence: the fixture diff is not a mask. `apps/web/src/review/__tests__/fixture-model.ts:26` builds the diff as the full screenshot with a red fill (see `verify/screens/v04-difference-dark-1440.png`). No screenshot in this lane shows what a production mask looks like. A design that is tested only with this fixture will look better than production.

Feasibility: a client can compute bounding boxes from the mask with a canvas, because the images are same-origin and `Cross-Origin-Resource-Policy: same-origin` is set (`apps/web/src/api/images.ts:55`). This needs the mask to load, so it has the same P02 limit as BENCH-02. The auditor marked this finding as not measured. That is correct.

---

## BENCH-05: The variant strip hides the verdict and holds three variants

**Verdict: partly-confirmed. The direction is correct. The number "three" is a fixture number. Severity: medium (auditor: high).**

"Hides the verdict": confirmed.

- The chip content is icons, labels, the truncated key, and the index (`apps/web/src/review/variant-summary.tsx:88-136`). It has no state element.
- The verdict is only in `title` and `aria-label` (`review-workspace.tsx:747` and `:776`).
- Measured after I approved chip 1 and rejected chip 2: the two chips have the same computed color, background, and border as an unreviewed chip.

```
chip 1 aria-label "1. React · … . Approved"   color oklch(1 0 0 / 0.7)  border oklch(1 0.0091 264.28 / 0.1)
chip 2 aria-label "2. Solid · … . Rejected"   color oklch(1 0 0 / 0.7)  border oklch(1 0.0091 264.28 / 0.1)
chip 4 aria-label "4. Contrast · … . Needs review"  (same values)
```

Screenshot: `verify/screens/v05-page-after-approve-reject-dark-1440.png`.

"Holds three variants": true only for the test fixture.

- The fixture label has an extra part that production does not have: `fixture-model.ts:19` ``label: `${key} · Chromium · Light · 1280 × 720` ``.
- Production builds six parts: framework, browser, colorScheme, contrast, forcedColors, key (`apps/web/src/api/review.ts:469-482`). The live notes (`/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live-authenticated.md`) say that real chips read "React · Chromium · Light · react-chrome-default-d…".
- With production-shaped parts the chips are 384 to 413 px wide:

```
B05-fixture-labels     1440x900  total 7  fullyVisible 3  widths [295,287,285,307,297,299,265]
B05-production-labels  1440x900  total 7  fullyVisible 2  widths [413,384,392,404,390,386,401]
B05-production-labels  1920x1080 total 7  fullyVisible 3
```

The correct number for production-shaped labels is **two** at 1440 × 900. Screenshot: `verify/screens/v05-production-labels-dark-1440.png`. The real run in the live notes has 3,832 variants in 626 items, about six for each item.

Why I lowered the severity: the verdict of the selected variant is visible in the badge next to the heading (`review-workspace.tsx:642`), the sidebar gives a count for each item, and Approve moves to the next pending variant. The flow works. The reviewer cannot see the state of the other variants at a glance.

Contract relation: issue #1 asks to "Prioritize run identity, item name, full variant label, review state". The full label is a requirement. The production key repeats the three values that the icons already show.

---

## BENCH-06: The queue uses a 240 px card for 22 words and states each count three times

**Verdict: partly-confirmed. Severity: medium (auditor: high).**

Confirmed (measured again with the same nine mocked runs, `verify-more-output.jsonl`, probe `B06-queue`):

```
1440x900  articles: 240 px high, 22 / 24 / 21 / 23 words, first card top y=361, 2 cards fully visible
390x844   articles: 236 px high, 1 card fully visible
```

Not reproduced: "each count three times".

```
runCountStatements  ["4 runs are ready for review","4 Runs to review"]
pendingStatements   ["64 Awaiting approval","14 views await approval","6 views await approval","41 views await approval","3 views await approval"]
rejectedStatements  ["5 Rejected views","including 2 rejected","including 3 rejected"]
```

- The run count is stated twice in text (`apps/web/src/routes/index.tsx:436-437` and `:452`). The list of four cards implies it a third time.
- The pending total and the rejected total are each stated once (the tiles, `index.tsx:453-454`). The cards state the parts for each run (`index.tsx:502-503`), which are different numbers.
- Only in a queue with one run does the same number appear twice ("2 Awaiting approval" and "2 views await approval." in the preview).

The correct statement is "the run count is stated twice, and each view count is stated as a total and again as parts". Without the report text I cannot see which three places the auditor counted.

Contract relation: the selected U05 option says "Show PR number and available PR title in each **row**, then pending/rejected counts." A card is not required. A dense row design agrees with the selected text. The measurement uses mocked API data in the route fixture, which is acceptable because the card height does not depend on the data.

---

## BENCH-07: The dashboard has no keyboard flow

**Verdict: confirmed as a fact about shortcuts. The need for shortcuts is a judgment. Severity: low.**

- The only key handlers in app code are in the review workspace and the item list:

```
$ rg -n "onKeyDown|keydown" apps/web/src --glob '!**/__tests__/**' --glob '!**/components/ariakit/**'
review/review-workspace.tsx:395,446,447,730
review/item-list.tsx:316
```

`apps/web/src/routes/index.tsx` has none.

- Measured (`B07-dashboard-keys`): the keys `j`, `k`, `Enter`, `r`, `?` do nothing. `ArrowDown` scrolls the page (native).

Correction to the wording: the dashboard has a native keyboard flow. All controls are links or buttons. It takes 8 Tab stops to reach the first "Review changes" link:

```
a:Visonaut review queue, a:Review queue, a:Run history, a:Service status,
button:Service attention, button:Account menu, button:Refresh runs, a:Review changes
```

"No keyboard flow" must read "no shortcut keys and no list navigation". The contract requires "keyboard-only operation" for the review UI and has no requirement for dashboard shortcuts.

---

## BENCH-08: One decision stops at one item, and equal diffs are not grouped

**Verdict: partly-confirmed. Severity: medium.**

Confirmed facts:

- The client builds a command for one variant or for one whole item only (`apps/web/src/review/use-review-session.ts:408-436`):

```ts
const targets = reviewTargets(item);
const selectedTargets = wholeItem ? targets : targets.filter((entry) => entry.id === variant.id);
...
wholeItemKey: wholeItem ? item.key : undefined,
```

- There is no code that groups variants by equal images or equal masks.

Correction 1, the scope is a selected decision, not an omission. D02 says A or X changes the "Current variant; separate whole-item actions". D21 gives `Shift+A` / `Shift+X` to the whole item. The U02 migration note says "Preserve D02/D03/D21 verdict scope and advancement." A run-wide action changes the verdict scope and needs a contract decision.

Correction 2, the server already accepts targets from more than one item. Without `wholeItemKey`, the rows are selected by comparison and id only (`packages/service/src/review-commands.ts:166-170`):

```ts
"SELECT * FROM visonaut_comparison_rows WHERE comparison_id = ? AND id IN (SELECT value FROM json_each(?))";
```

The API limit is `body.targets.length > context.configuration.limits.maximumCaptures` (`apps/web/src/api/review.ts:847-851`), and `maximumCaptures` is 40,000 (`apps/web/src/runtime-defaults.ts:14`). A multi-item command needs no API change.

Platform risk for a recommendation: each target adds four statements to one D1 batch (`review-commands.ts:227-271`: one assertion, one revoke, one insert, one row update). The D1 limits page lists "Queries per Worker invocation: 1000 (Workers Paid) / 50 (Free)" (https://developers.cloudflare.com/d1/platform/limits/). If each batch statement counts as one query, one command with about 245 or more targets reaches the limit. I did not run this, so it is a risk to test, not a measured fact. If the command is split, the rule "The command saves every target or none" (`docs/review-guide.md:49`) no longer holds for the full set.

Grouping feasibility: each image has a digest in the model (`apps/web/src/review/model.ts:10-16`). The client can group by the pair (reference digest, candidate digest) with no API change. An equal mask digest shows equal changed positions, not an equal visual change. Percy states its rule as equal diff geometry and "identical underlying pixels" (`sources/percy-matching-diffs.txt`).

---

## BENCH-09: The item list cannot sort by change size or filter by kind or axis

**Verdict: partly-confirmed. Severity: low (auditor: medium).**

Confirmed:

- No sort. The order is "attention" then "accepted", each in model order (`apps/web/src/review/navigation.ts:34-47`, `apps/web/src/review/item-list.tsx:91-101`).
- The filter has four status options and no kind option (`apps/web/src/review/screenshot-filter.tsx:17-22`). Measured: `"options":["All","Needs review","Approved","Rejected"]`.

Refuted part ("axis"): the search box matches variant keys, labels, and label parts (`item-list.tsx:45-64`):

```ts
...item.variants.flatMap((variant) => [variant.key, variant.label,
  ...(variant.labelParts?.map((part) => part.value) ?? [])]),
```

Measured (`B09-filter`):

```
before     ["Success dialog …","Open menu …","New item …"]
"firefox"  ["Success dialog 7 of 7 need review"]
"menu-dark" ["Open menu 2 of 2 need review"]
```

A reviewer can filter by an axis value with text. The limits are real: the result is a list of items, the variant strip is not filtered, and no control shows that this is possible.

Feasibility: `changedPixels` and `ratio` are on each variant (`model.ts:37,40`), so a sort is a client-only change. The new order must go through `onOrderChange` (`item-list.tsx:102-104`), because the arrow keys use that order (`review-workspace.tsx:413-419`).

---

## BENCH-10: The run page states the review status four times

**Verdict: confirmed, with a correction of scope. Severity: low (auditor: medium).**

Measured on the real route (`verify-preview-output.jsonl`, 1440 × 900):

```
"2 of 2 need review" @y170   sidebar item   (item-list.tsx:256)
"2 of 2 need review" @y63    main header    (review-workspace.tsx:596-598)
"Changes need review" @y101  intro strip    (review-workspace.tsx:620)
"Needs review" @y160         badge by h1    (review-workspace.tsx:642)
```

In the fixture with four items the strings are "7 of 7 need review", "9 of 11 need review", "Changes need review", "Needs review".

Correction: these four texts report three scopes (item, run, variant). The true repetition is the run scope, which is stated as a count, as a label, as a progress bar, and (for one item) again in the sidebar. With the Details panel open, two more status texts appear (`review-workspace.tsx:463-467`).

Contract relation: the count text is required ("Show counts such as “2 of 6 need review,” … Counts and text must accompany color"). A redesign can remove the run-level label that repeats the count. It must keep a count and must keep text next to each colored dot.

---

## BENCH-11: Three vocabularies name the same four image modes, and the guide uses labels that the UI does not have

**Verdict: confirmed. Severity: low.**

| Place                 | Words                                                                                                    | Source                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Toolbar buttons       | Compare, Difference, Current, Baseline                                                                   | `review-workspace.tsx:845,860,874,888`                      |
| Pane captions         | Baseline, Current, Difference                                                                            | `screenshot-viewer.tsx:37-38`                               |
| Help dialog           | "Side by side, red pixel diff, new image only, or original only."                                        | `review-workspace.tsx:174-175`                              |
| Code                  | `"side" \| "diff" \| "new" \| "original"`                                                                | `model.ts:2`                                                |
| Pane accessible names | "Reference", "New image", "Pixel diff · red pixels changed"                                              | `screenshot-viewer.tsx:218,229,245`                         |
| Empty and status text | "New image, no reference", "Pixel diff requires both a reference and a new image."                       | `screenshot-viewer.tsx:219`, `review-workspace.tsx:379,928` |
| Guide                 | "Side by side, `S`", "Pixel diff, `D`", "New only, `F`", "Original only, `G`", "Reference and candidate" | `docs/review-guide.md:31-34`                                |

Guide labels that the UI does not have (checked with `rg` in `apps/web/src`): "Side by side", "Pixel diff" (as a control), "New only", "Original only", "All runs" (`review-guide.md:92`; the UI says "Queue"), "Approve" and "Reject" (the UI says "Approve & next" and "Reject view"), "Retry" (the UI says "Retry images").

---

## BENCH-12: The ? key does not open the shortcut list, and its button is below the fold

**Verdict: confirmed. Severity: low.**

- The key handler has no branch for `?` (`review-workspace.tsx:395-442`; unknown keys reach `else { return; }`).
- Measured: `Shift+Slash` opened 0 dialogs on the fixture and on the real route. A click on the button opened the dialog "Review with the keyboard".
- The button is in the page footer (`review-workspace.tsx:1172-1178`), and the page is taller than the viewport.

```
fixture     1440x900   help y=985   scrollHeight 1018
fixture     1920x1080  help y=1086  scrollHeight 1119
real route  1440x900   help y=1002  scrollHeight 1035
real route  1280x720   help y=901   scrollHeight 934
```

Additions:

- The button has an icon only (26 × 26 px, `aria-label="Keyboard help"`).
- Shortcut hints are visible on the buttons (S, D, F, G, X, A, and 1 to 6). Discovery is not zero.
- The contract key table has no `?`. To add it does not conflict with the contract. The handler must keep the current exclusions (`excludesShortcuts`, `review-workspace.tsx:88-97`). Prior art: Argos and GitHub both open the shortcut list with `?` (`argos-review-a-build.md:62`, `sources/github-shortcuts.txt:50`).

---

## BENCH-13: A rejection has no reason, and there is no place for a note

**Verdict: judgment. The facts are confirmed. The behavior is a recorded non-goal. Severity: low.**

Facts:

- The command has no text field (`apps/web/src/review/model.ts:109-120`).
- The decision table has no note column (`apps/web/migrations/0001_service.sql:143` and the `0024_core_simplification.sql:47` column list).
- No input exists in the review UI.

Contract: `contract-issue-1.md:57` lists "comment system at launch" under "No …". This is deliberate. A recommendation here asks the maintainer to open that scope again.

Related fact that I can prove: the run page has no link to the pull request, where a note can be written today. The only link to GitHub is on the pull route (`apps/web/src/routes/pulls.$pullNumber.tsx:281`).

---

## BENCH-14: Noise has no verdict of its own

**Verdict: judgment. The facts are confirmed. The topic is next to a recorded non-goal. Severity: low.**

Facts:

- `apps/web/src/review/model.ts:1`: `export type ReviewVerdict = "approved" | "rejected";`
- `apps/web/migrations/0001_service.sql:143`: `verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'rejected'))`.

Context that the title does not give:

- `contract-issue-1.md:57` excludes "automatic approval of visual flakiness" at launch.
- The service handles noise before review, with the comparison settings: threshold `0.2` and the pixel caps (`docs/current-contract.md:109`).
- A third verdict is not a UI change. It touches the database constraint, the check result ("Rejected means the variant has been reviewed, but it still fails the visual check", `review-guide.md:47`), and approval reuse by exact identity (C02, `current-contract.md:184`).

Prior art exists (Argos `I` "Ignore a flaky change", `argos-review-a-build.md:75`). Whether Visonaut wants it is a product decision.

---

## Screenshots

All in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/verify/screens/`. Dark scheme. I opened and read each image.

| File                                                                             | What it shows                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v01-run-preview-dark-1280x720.png`                                              | Real route at 1280 × 720. The image starts at y = 449. The sticky action bar cuts the image in Fit mode.                                                            |
| `v01-realistic-1280x720-dark-1440.png`                                           | Fixture with injected 1280 × 720 captures. Each image is 555 × 312.                                                                                                 |
| `v01-realistic-1280x2400-dark-1440.png`                                          | Fixture with injected 1280 × 2400 captures. Each image is drawn about 250 px wide. The bottom is under the action bar. Also shows production-shaped chips: two fit. |
| `v02-current-only-dark-1440.png`, `v02-baseline-only-dark-1440.png`              | Current only and Baseline only. The image is in the same rectangle in both.                                                                                         |
| `v03-zoom-200-desynced-dark-1440.png`                                            | 200% zoom. The two panes show different regions. Eight pan buttons.                                                                                                 |
| `v04-difference-dark-1440.png`                                                   | Difference mode with the synthetic fixture diff (not a production mask).                                                                                            |
| `v05-strip-before-dark-1440.png`, `v05-strip-after-approve-reject-dark-1440.png` | Variant strip before and after one approval and one rejection. No visible change on the chips.                                                                      |
| `v05-page-after-approve-reject-dark-1440.png`                                    | Full page after the two decisions. The sidebar says "1 rejected variant" and does not show the pending count.                                                       |
| `v05-production-labels-dark-1440.png`                                            | Variant strip with six production-shaped label parts. Two chips fit.                                                                                                |
| `v09-filter-menu-dark-1440.png`                                                  | The status filter menu: All, Needs review, Approved, Rejected.                                                                                                      |
| `v-missed-all-approved-dark-1440.png`                                            | State after all decisions: "0 of 11 need review", "Check passed", no completion view.                                                                               |

Auditor screenshots that I opened and that agree with their file names: `05`, `10`, `11`, `14`, `15`, `18`, `24`.

## Redesign ideas

These come from the corrections above. They are inputs for the design-exploration phase, not dispositions. The sketches use only primitives that the app already imports.

### 1. A viewer that takes the remaining height

What changes: one header row replaces the three rows above the viewer (main header, identity strip, heading block). The viewer is a flex child with `min-h-0 flex-1`. The action bar is a row in the layout, not a sticky layer on top of the image.

Why: the first image row moves from y = 432 to about y = 150, the image is never under the action bar, and tall captures get the full height.

```
+--------------------------------------------------------------------------+
| [=] <- Queue  Dialog focus styles · aabbccd · try 2      9/11 [####   ]  |  48
| Success dialog  (o) Needs review  0.05%   [React Chromium Light v] 1/7   |  44
| [Compare|Overlay|Current|Baseline]  [Fit 100% 200%]            Details   |  40
+--------------------------------------+-----------------------------------+
|                                      |                                   |
|            Baseline                  |            Current                |  flex-1
|                                      |                                   |
+--------------------------------------+-----------------------------------+
| Undo   All 7 changed views…                    [x Reject X] [✓ Approve A] |  48
+--------------------------------------------------------------------------+
```

```tsx
<ShellMain className="flex h-dvh flex-col">
  <ShellMainHeader $height="sm" $border>
    {/* run + progress */}
  </ShellMainHeader>
  <Frame $p={3} className="flex items-center gap-3">
    {/* item, status, variant picker */}
  </Frame>
  <div className="min-h-0 flex-1">{/* <ScreenshotViewer /> with h-full panes */}</div>
  <Frame $layer="canvas" $border $p={2}>
    {/* actions, not sticky */}
  </Frame>
</ShellMain>
```

### 2. One linked viewport for the two panes

What changes: one pan and zoom state for the two images. A wheel or drag on one pane moves the two panes. Four pan buttons, not eight.

Why: a zoomed comparison then always shows the same region (BENCH-03).

```tsx
const [view, setView] = useState({ left: 0, top: 0 }); // in image pixels, not scroll pixels
<ImagePane view={view} onViewChange={setView} zoom={zoom} role="reference" />
<ImagePane view={view} onViewChange={setView} zoom={zoom} role="candidate" />
```

### 3. A mask overlay as a toggle, plus a one-key blink

What changes: "Overlay" puts the existing transparent mask on top of Current. `D` toggles it. A second key swaps Baseline and Current in place.

Why: it shows where the change is with the screenshot below it (BENCH-04), and it gives the existing F/G blink one key (BENCH-02). The mask loads only when the toggle is on, which keeps P02.

```tsx
<div className="relative">
  <img src={candidate.url} alt="Current" />
  {overlay && <img src={diff.url} alt="" className="absolute inset-0 mix-blend-multiply" />}
</div>
```

### 4. Variant chips with a state mark, without the repeated key

What changes: each chip shows a state mark with a different shape for each state (not color only, because the contract says that text must accompany color), the three axis values as icons, and no raw key when the key only repeats the axis values. Variants that do not fit go into a menu with a count.

Why: at 1440 px, six chips of about 150 px fit where two chips of 400 px fit now, and the reviewer sees which variants are pending (BENCH-05).

```
(•) React Chromium Light 1   (✓) Solid Firefox Dark 2   (✕) React WebKit Light 3   (•) … 4   +3
```

### 5. Queue rows in place of cards

What changes: one row of about 56 px for each run: PR number, title, pending and rejected counts, age, one action. The three tiles and the sentence under the heading go away, because the rows and the section count carry the same numbers.

Why: nine runs fit in one 900 px viewport. Each number appears once. This agrees with the selected U05 text ("in each row").

```
Ready to review (4)                                              [Refresh]
#5121  Add Dialog focus trap option        14 pending              36 min   Review ->
#5118  Update Menu arrow placement          6 pending · 2 rejected  1 h     Review ->
#5102  Refactor Combobox popover sizing    41 pending               2 h     Review ->
```

## Missed

Items in the scope of this lane that the findings index does not name. One line each.

1. **"Fit" does not fit: the sticky action bar covers the image.** At 1280 × 720 on the real route only 212 of 297 image rows are visible; at 1440 × 900 the bar hides 60 px of each pane (`verify-preview-output.jsonl`, `verify-missed-output.jsonl`).
2. **Tall captures collapse in Fit mode.** A 1280 × 2400 capture is drawn about 250 × 468 px, because Fit clamps to the fixed pane height `h-[min(56vh,650px)]` (`screenshot-viewer.tsx:134,162`).
3. **The sidebar hides the pending count after one rejection.** The row text becomes "1 rejected variant" and no longer says how many variants need review (`item-list.tsx:250-256`; `v05-page-after-approve-reject-dark-1440.png`).
4. **No end-of-review state.** After the last decision the page stays on the last item with "0 of 11 need review" and "Check passed"; "Approve & next" stays enabled and the only exit is "Queue" (`verify-missed-output.jsonl`, probe `M-end-state`).
5. **No link from the run page or the queue card to the pull request or the commit on GitHub.** Only `routes/pulls.$pullNumber.tsx:281` links out.
6. **Zoom has three fixed steps and keeps the scroll offset, not the image point.** 200% at (400, 250) became 100% at (45, 0); there is no wheel zoom and no zoom to a point.
7. **No fixture shows a production-like diff mask.** The fixture diff is the full screenshot with the dialog area filled red (`fixture-model.ts:26`); the production mask is red pixels on a transparent background, so the Difference view was not judged on real content.
8. **The production variant key repeats the axis values.** The live notes quote real chips as "React · Chromium · Light · react-chrome-default-d…"; with labels of that shape that I injected, each chip is 384 to 413 px wide (`api/review.ts:469-482`, `variant-summary.tsx:115-123`).
9. **A retired control is still rendered (read from the code, not seen on production).** The server sends `recompareAllowed: false` for each run (`api/review.ts:592`), so the footer renders a disabled "Recompare stored run" button and a reason paragraph on each non-preview run (`review/client.ts:355`, `review-workspace.tsx:1186-1201`), while `docs/review-guide.md:88` says that the control is retired.
10. **A run-wide decision has a platform limit (not measured).** One review command writes four D1 statements for each target in one batch (`review-commands.ts:227-271`); D1 documents 1000 queries for each Worker invocation on Workers Paid, so a recommendation for "approve all in the run" must test that limit and can need a set-based write or chunks.
11. **The findings were delivered without the report file.** `report.md` is absent, so no quote, line range, or recommendation of the auditor could be checked; the lane must write the report again before the design phase uses it.
