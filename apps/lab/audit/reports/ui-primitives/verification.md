# Verification of the lane "Ariakit UI primitive adoption and styling-system audit"

Verifier: a second auditor who did not write `report.md`. Read-only. No file in the repository was changed.

Path conventions:

- `SRC` = `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel/apps/web/src`
- `ROOT` = `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`
- `UP` = `/Users/diegohaz/Developer/ariakit` (upstream, HEAD `643a23aff`, 2026-10-05)
- `V` = `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-primitives/verify` (my scratch folder)
- `A` = `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-primitives` (the auditor's scratch folder)

My measurements (all re-run by me, Chrome through Playwright, 1440 × 900, dark and light, macOS):

| #   | Command                                                                                 | Output file                                         |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| V1  | `node V/probe.mjs` (workspace fixture, dashboard, history, guest, live preview, 390 px) | `V/probe.json`, summary with `node V/summarize.mjs` |
| V2  | `node V/probe2.mjs` (guest tile, pull page, DOM weight)                                 | `V/probe2.json`                                     |
| V3  | `node V/probe3.mjs` (color-named ink classes)                                           | `V/probe3.out`                                      |
| V4  | `node V/css-weight.mjs` (in-memory Tailwind compile)                                    | `V/css-weight.out`                                  |
| V5  | `node V/markers.mjs <15 names>`                                                         | terminal output, quoted below                       |
| V6  | `rg`, `git log`, `git show`, `diff -rq`, `curl`, `gzip`, `brotli`                       | quoted in each section                              |

Summary of verdicts:

| ID      | Verdict          | Auditor severity | My severity |
| ------- | ---------------- | ---------------- | ----------- |
| PRIM-01 | confirmed        | high             | medium      |
| PRIM-02 | confirmed        | medium           | medium      |
| PRIM-03 | partly-confirmed | high             | medium      |
| PRIM-04 | confirmed        | medium           | low         |
| PRIM-05 | confirmed        | medium           | medium      |
| PRIM-06 | partly-confirmed | medium           | low         |
| PRIM-07 | confirmed        | medium           | medium      |
| PRIM-08 | confirmed        | medium           | medium      |
| PRIM-09 | confirmed        | medium           | low         |
| PRIM-10 | confirmed        | low              | low         |
| PRIM-11 | partly-confirmed | low              | low         |
| PRIM-12 | confirmed        | medium           | low         |
| PRIM-13 | confirmed        | medium           | medium      |
| PRIM-14 | confirmed        | low              | low         |
| PRIM-15 | partly-confirmed | medium           | medium      |
| PRIM-16 | confirmed        | low              | low         |
| PRIM-17 | confirmed        | low              | low         |
| PRIM-18 | confirmed        | low              | low         |
| PRIM-19 | partly-confirmed | medium           | medium      |
| PRIM-20 | confirmed        | medium           | low         |

No finding is refuted. Five findings need a correction to the claim or to the recommendation. The auditor missed one bug of the same family as PRIM-01 and PRIM-02 (see "Missed", item 1) and did not check the binding contract (`ROOT/docs/current-contract.md`, `ROOT/docs/simplification-audit/contract-issue-1.md`). Four recommendations conflict with that contract.

---

## PRIM-01 · `$layer="primary"` is not a recipe color

Verdict: **confirmed**. Corrected severity: **medium**.

Proof that I checked:

- Six uses exist. `rg -n '"primary"' SRC --glob '!components/ariakit/**'` returns `routes/index.tsx:301, 310, 346, 508` and `routes/pulls.$pullNumber.tsx:194, 226`.
- `SRC/components/ariakit/utils/styles.ts:6-13` lists six names. `primary` is not one of them. `SRC/components/ariakit/components/layer.ariakit.react.tsx:97-100` passes any other string through as a raw value.
- `@ariakit/tailwind` `src/output.css:199-202`: `@utility ak-layer-color-* { --_ak-layer-color: --value(--color-*, [*]); }`. With `(--layer-color)` the value is `var(--layer-color)`, which is the bare word `primary`. That is not a CSS color.
- V1, dashboard, both schemes: `reviewChanges bg=238,238,238`, `reviewChangesInline: "--layer-color: primary; …"`, `rootColorPrimary: ""` (the theme variable `--color-primary` is not emitted).
- V1, feasibility of the fix. I swapped the class in the page:

  ```
  swapToBrand: before 238,238,238 → afterBrand 0,106,187, text oklch(1 0 0)
  ```

  So `$layer="brand"` gives the same blue as "Approve & next".

- V1, light scheme: the button surface against its card is 1.158 : 1. Dark scheme: 15.169 : 1 (a white button).
- V3: "Use another account" (`routes/index.tsx:346`) has the same `oklch(0.949994 0.0000497986 23.7884)` background.
- Screenshots that I opened: `A/screens/queue-light-1440.png`, `A/screens/dashboard-queue-dark-1440.png`, `A/screens/run-guest-dark-1440.png`, `V/screens/guest-light.png`, `V/screens/forbidden-light.png`. They show what the finding says.
- `git log -S'$layer="primary"' -- apps/web/src` returns only `f83fef6` (2026-10-05, "Implement the Inbox review interface"). The value is one commit old. No test asserts a button color.

Corrections:

1. The icon tile (`routes/index.tsx:301`) is not gray (238). V2 measured `255,255,255` in both schemes. It is pure white, because a `Frame` has no lightness offset. On the light card (`254,255,255`) it is invisible. On the dark card it is a white square.
2. "The brand color appears only in the review workspace" is not correct. The header logo slot uses it on every page: `SRC/components/app-shell.tsx:30` (`<ButtonSlot $kind="avatar" $layer="brand" …>`).
3. The contract says "Use compact, mostly flat neutral controls" (`contract-issue-1.md:247`). A neutral primary button does not break the contract. The defect is that the code names a color that does not exist. This is why I lower the severity to medium. The maintainer question in the finding is the right one.

---

## PRIM-02 · Four banners use `ak-layer-warning` without `ak-layer`

Verdict: **confirmed**. Corrected severity: **medium**.

Proof that I checked:

- `SRC/review/review-workspace.tsx:690, 695, 701, 706`: `className="text-sm p-3 ak-layer-warning"` four times.
- Readme, line 293: "Pair `ak-layer-*`, `ak-state-*`, and `ak-edge-*` with `ak-layer` on the same element". The quote is exact.
- V1, archived state, both schemes: both banners have `bg: rgba(0, 0, 0, 0)`.
- V1, emulation in the page:

  | Change                                | Dark background | Light background | Text contrast |
  | ------------------------------------- | --------------- | ---------------- | ------------- |
  | add `ak-layer`                        | 253,199,0       | 240,177,0        | 13.3 and 11.0 |
  | add `ak-layer ak-layer-mix` with 15 % | 41,38,25        | 251,242,223      | 15.2 and 18.9 |

  So both alternatives in the finding work as described.

- V2, pull page: `bg 253,199,0` (dark), `240,177,0` (light), classes `ak-layer ak-layer-warning`. The "solid yellow" claim is correct.
- Screenshot `A/screens/workspace-dark-banners.png` shows two plain sentences.

Corrections: none to the facts. One note for the recommendation: a `Frame $rounded="lg"` inside `ShellMainBody` is a nested frame. Check its radius (see PRIM-04). It can need `$forceRounded`.

---

## PRIM-03 · Selection is hand-rolled with `$lighten`

Verdict: **partly-confirmed**. Corrected severity: **medium**.

Proof that I checked:

- Code: `SRC/review/item-list.tsx:199-202` and `:217-222`; `SRC/review/review-workspace.tsx:719-727` and `:739`; `SRC/review/screenshot-filter.tsx:91` and `:162`. All exist as quoted.
- V1 numbers match the finding:

  |                          | Dark                  | Light                       |
  | ------------------------ | --------------------- | --------------------------- |
  | Selected row to sidebar  | 1.258                 | 1.017                       |
  | Variant glider to canvas | 1.258                 | 1.017                       |
  | Selected chip ring       | border 1px, alpha 0.1 | ring spread `0px`           |
  | Unselected chip ring     | border 1px, alpha 0.1 | ring `0 0 0 1px`, alpha 0.1 |
  | Glider ring              | alpha 0               | alpha 0                     |

- Screenshots `A/screens/closeup-variant-selection-light.png` and `-dark.png` show this. In light, the selected chip is the only chip without an outline.

Corrections:

1. "The selected sidebar row is not visible in the light scheme" is too strong. The row surface is not visible (1.017 : 1). But the `Nav` draws a selected bar: `item-list.tsx:307` (`glider={{ $kind: "bar", $state: "selected", $side: "end", … }}`). V1 measured it: 2 × 44 px at x = 253, color `28,29,29` on `252,253,253` in light, `239,242,248` in dark. `A/screens/workspace-light-sidebar.png` shows the bar. The text also changes weight (500). So the sidebar selection is weak but present. The variant-chip part of the finding is fully correct.
2. The recommendation is feasible, but the gain is small. I measured both options:
   - "Minimal" option, emulated in the page (`$lighten` class replaced by `ak-layer-offset-(--layer-lightness-offset)` with the value for `2`): selected row `219,220,220`, 1.348 : 1 in light; unchanged `35,37,41`, 1.258 : 1 in dark.
   - Recipe default, measured on the top navigation in light (`http://127.0.0.1:4310/`): selected link `235,236,236` on `252,253,253`, about 1.16 : 1.

   Both are appearance-aware. Both are below 3 : 1. If the selected variant must be unmistakable, the neutral recipe default is not enough alone. This supports the "colored selection" alternative.

3. Contract `U03` is "Use item links and variant tabs" and the keyboard section says "Use suitable Ariakit composite/tab semantics" (`contract-issue-1.md:280`). A new variant picker must keep link and tab semantics.

Reason for the lower severity: the title claim for the sidebar is overstated, and the dark scheme is correct. The light-scheme variant chip is a real problem.

---

## PRIM-04 · Nested frames lose their radius

Verdict: **confirmed**. Corrected severity: **low** (cosmetic, no functional effect).

Proof that I checked:

- V1 radii: "Approve & next" 2px, "Reject view" 2px, "Details" 6.5px, "Open run" 2px, "Refresh runs" 6.5px, group icon tile 2px, ready-card icon tile 7px, table badge 2px, queue badge pill, popover alert card 2px, popover guide button 2px.
- Cause, confirmed. Readme line 397: "When frames are nested, Ariakit reconciles their effective radii with the parent's radius, padding, and border". Line 816: "`ak-frame-force` — Uses the declared radius exactly, ignoring parent-frame context."
- V1, emulation: adding the class `ak-frame-force` to "Approve & next" changes the radius from 2px to 6.5px. Adding it to the table badge changes 2px to a full pill. So `$forceRounded` works.
- `UP/app/src/sandbox/ariakit-ui-table/index.react.tsx:916` has `<Badge $forceRounded $layer="success">`. `rg -c forceRounded` on that file returns 10.
- Screenshots `A/screens/closeup-open-run-square-dark.png`, `A/screens/closeup-action-bar-light.png`, and my `V/screens/history-search-focus-light.png` (shows rectangular badges) agree.

Corrections:

1. "The primary decision buttons are the only square buttons in the workspace" is not correct. V1: "Undo" 2px and "All 7 changed views…" 2px in the same bar.
2. The direct parent of the decision buttons is the `ButtonGroup` (`review-workspace.tsx:1061`), which is itself a frame (`controlGroup`, `$rounded: "xl"`, `$p: 1`, `SRC/components/ariakit/styles/control.ts:501-506`). It sits in the `$rounded="none" $p={2}` frame. The chain has two levels.
3. The app already has one workaround with `!important` instead of `$forceRounded`: `SRC/components/operations-attention/index.tsx:493` (`rounded-full!` on the alert-count `Badge`).
4. There is a second radius for the same wrapper: "Shortcuts on" and "Accepted (1)" are 8px, "Details" is 6.5px (V1). The finding does not list it.

---

## PRIM-05 · Text is muted with `opacity-*` in 13 places

Verdict: **confirmed**. Corrected severity: **medium**.

Proof that I checked:

- `rg -n 'opacity-\d+' SRC` (without the vendored folder and tests) returns the 13 sites in the finding, plus `placeholder:opacity-50` at `review/screenshot-filter.tsx:109`, which is correctly not counted.
- V1 contrast, same method (text color × ancestor opacity over the first opaque background):

  | Text                               | Dark  | Light | Auditor     |
  | ---------------------------------- | ----- | ----- | ----------- |
  | "4 items" (11px, `opacity-50`)     | 5.336 | 3.962 | 5.34 / 3.96 |
  | Meta strip (10px, `opacity-50`)    | 5.336 | 3.962 | 5.34 / 3.96 |
  | Changed line (12px, `opacity-55`)  | 6.247 | 4.737 | 6.25 / 4.74 |
  | "Screenshots" (10px, `opacity-60`) | 7.258 | 5.710 | 7.26 / 5.71 |
  | Variant index (`ak-ink-40`)        | 5.303 | 4.588 | 5.30 / 4.59 |
  | Image size (`ak-ink-50`)           | 5.355 | 4.588 | 5.36 / 4.59 |

- Readme line 624 quote is exact.

Additions (the auditor listed these as not measured):

- Details panel `dt` labels (`review-workspace.tsx:490`, `[&>dt]:opacity-50`, 12px): 5.336 dark, **3.962 light**. This is a third failing case.
- Batch dialog description (`:1253`, `opacity-60`, 14px): 7.258 dark, 5.710 light. It passes.

Correction: `ak-ink-danger` is not a valid replacement pattern for colored text. See "Missed", item 1.

---

## PRIM-06 · A disabled brand button keeps its brand fill

Verdict: **partly-confirmed**. The measurement is correct. The classification as a possible recipe defect is wrong. Corrected severity: **low**.

Proof that I checked:

- `SRC/review/review-workspace.tsx:1080-1097` exists as quoted.
- V1, archived state, both schemes: `approveDisabled bg=0,106,187 disabled=true`, label color `oklch(1 0 0 / 0.733357)`. Label on fill: 3.726 : 1 (enabled: about 5.5 : 1). `rejectDisabled` label alpha 0.449 (dark) and 0.429 (light).
- Screenshot `A/screens/workspace-dark-banners.png` shows a solid blue disabled button next to a dimmed "Reject view".

What the auditor missed:

1. Upstream documents this behavior as intended. `UP/app/src/sandbox/ariakit-ui-button/index.react.tsx:990-999`:

   ```tsx
   <Example
     title="Disabled brand"
     description="The color stays and the text fades."
   >
     <Button $layer="brand" disabled>Publish</Button>
   ```

2. The readme agrees, line 609: "The utility changes contrast settings only. Use `ak-ink-0` to dim text to the disabled contrast floor."
3. The contract says: "Preserve the complete copied recipe and component behavior, including disabled-state handling" (`contract-issue-1.md:256`).

Corrections:

- The maintainer question "Is the solid fill on a disabled colored button the intended Ariakit UI behavior?" has an answer in upstream: yes.
- The alternative "Report upstream … and wait for a recipe fix" does not apply.
- The app-level option (`$layer={canApprove ? "brand" : true}`) is feasible and does not change the copied recipe. It is a design choice, not a fix. The other two alternatives (hide the group, or keep the fill and show the reason) are also valid choices.

---

## PRIM-07 · `Text` is used 79 times but only once with a text variant

Verdict: **confirmed** for all counts. The sentence "This is the main source of the 'bloated with text' impression" is a judgment. Corrected severity: **medium**.

Proof that I checked:

- `rg -o '<Text\b'` in app code: 79. `rg -n '\$text\b'`: one site, `components/screenshot-viewer.tsx:98`.
- Font-size tokens (my `rg` count): `text-xs` 61, `text-sm` 36, `text-[10px]` 9, `text-[13px]` 6, `text-[11px]` 3, `text-base` 3 (+1 `text-base!`), `text-lg` 2, `text-xl` 3, `text-2xl` 8 (+1 `sm:`), `sm:text-[28px]` 1, `text-3xl` 4 (+3 `sm:`), `text-4xl` 1 (+3 `sm:`), `sm:text-5xl` 1. Thirteen sizes. The numbers match when base and `sm:` forms are added.
- `SRC/components/ariakit/components/text.ariakit.react.tsx:11-23`: the quotes are exact.
- `SRC/components/ariakit/styles/badge.ts:19-22`: `$layer: true`, `$rounded: "full"`, `$size: "xs"`. So `routes/index.tsx:388` restates two defaults.
- V1: `acceptedToggle font=16px`, sidebar rows 13px.

Correction: the 16px size is not one stray button. The review workspace shell has no base font size. `routes/index.tsx:248` sets `text-sm` on the `Shell`. `review/review-workspace.tsx:529` and `routes/pulls.$pullNumber.tsx:151` do not. V1 shows `actionsBar font=16px` and `actionsGroup font=16px` too. Each control without an explicit size inherits 16px there. The finding should name this cause.

---

## PRIM-08 · Fourteen upstream primitives are not vendored

Verdict: **confirmed**. Corrected severity: **medium**.

Proof that I checked:

- `ls UP/packages/ariakit-ui/src/components` returns 27 files. `git ls-tree fc85b809` returns the same 27. The vendored folder has 13. The 14 missing names in the finding are correct.
- I checked the cited call sites: `review-workspace.tsx:599-604` (raw `progress`), `:1041` (separator `div`), `routes/index.tsx:646-663` and `664-687`, `review/screenshot-filter.tsx:58-175`, four raw `code` elements, `rg -o '\btitle='` returns 14.
- The upstream component names in the rewrite table exist (`DialogProvider`, `DialogDisclosure`, `Dialog`, `DialogHeading`, `DialogDescription`, `DialogDismiss`, `DialogScroll`, `Input`, `InputGroup`, `InputSlot`, `ComboboxSelect`, `Progress`, `Separator`, `Code`, `Link`, `Heading`, `HeadingLevel`, `Prose`, `TooltipProvider`, `TooltipAnchor`, `Tooltip`).
- `UP/packages/ariakit-ui/package.json:2-5`: `"name": "@ariakit/ui"`, `"version": "0.0.1"`, `"private": true`.
- `UP/packages/ariakit-ui/src/components/dialog.ariakit.react.tsx:44-47` wraps `ak.Dialog`, so `role="dialog"` stays. The shortcut guard at `review-workspace.tsx:95` (`[role="dialog"]`) keeps working.

Corrections and additions:

1. `UP/.../components/input.ariakit.react.tsx:8` imports `@ariakit/utils`. `apps/web/package.json` does not declare it (it declares `@ariakit/react`, `react-components`, `react-utils`, `tailwind`). Version `0.2.1` is in the pnpm store. Vendoring `Input` needs one new declared dependency.
2. The contract supports the direction: `U01` is "Use the copied components throughout", and `contract-issue-1.md:247` says "Copy Ariakit UI recipes and components". The same paragraph says "Group the recipe and React component in the same file when appropriate". That sentence decides how new files are added (see PRIM-15).
3. Three `title` attributes are on buttons that can be disabled (`review-workspace.tsx:1071, 1089, 1192`). A `Tooltip` on a natively disabled button gets no hover events. Those buttons need `accessibleWhenDisabled` or a wrapper. The auditor lists the native-title doubt in the open questions but not this effect on the recommendation.

---

## PRIM-09 · Four hand-rolled dialogs have three looks

Verdict: **confirmed**. Corrected severity: **low** (cosmetic).

Proof that I checked:

- Code lines `155-186`, `1206-1222`, `1223-1241`, `1242-1296` and the four backdrops at `158, 1211, 1230, 1248` exist as quoted.
- V1:

  |                   | Help dialog                     | Batch dialog     |
  | ----------------- | ------------------------------- | ---------------- |
  | Heading           | `H1`, 14px / 400 (same as body) | `H1`, 18px / 600 |
  | Radius            | 7px                             | 16px             |
  | Background, dark  | 12,14,18                        | 12,14,18         |
  | Background, light | 252,253,253                     | 252,253,253      |

- `UP/packages/ariakit-ui/src/styles/dialog.ts:16, 30-31, 46`: the quoted classes exist.
- Screenshots `A/screens/workspace-dark-help-dialog.png` and `A/screens/workspace-dark-batch-dialog.png` agree with the table.

Correction: the caption "styled title, lifted surface" for the batch dialog is half right. Both dialogs have the canvas color. Neither is lifted. The difference is the heading, the radius, and the padding.

---

## PRIM-10 · `Kbd` and `Tabs` have zero importers

Verdict: **confirmed**. Corrected severity: **low**.

Proof that I checked:

- `rg 'kbd\.ariakit|tabs\.ariakit' ROOT/apps/web` returns no importer. (The untracked `ROOT/apps/lab` folder imports both. It is the temporary design lab and is not part of the audited app.)
- V4 reproduces the numbers exactly:

  ```
  all: candidates=9071 bytes=371158 gzip=47886
  no tabs: candidates=8885 bytes=336336 gzip=43213
  no tabs, no kbd: candidates=8834 bytes=332500 gzip=42522
  no vendored ts/tsx: candidates=6494 bytes=78185 gzip=12260
  ```

- `curl 'http://127.0.0.1:4311/src/review.css?direct' | wc -c` returns `371158`.
- `grep -o` on `dist/client/assets/index-CXm4JU5N.css`: `ui-folder` 24, `tabs` 204, `ui-bevel` 32.
- `PopoverScroll`, `ButtonSeparator`, `<Disclosure`, and the `ShellFooter` parts have no use in app code (`rg`).

Corrections:

1. The saving was measured on the unminified dev output. The production file is minified and has more fallbacks (`@supports` 85 against 43 in dev, `color-mix` 58 against 29). "About 5 KB gzip" is an estimate for production. It was not measured there.
2. The alternative "Delete `tabs.ariakit.react.tsx`" conflicts with the contract. `current-contract.md:54`, rule D10: "Keep the component set, keyboard behavior, license, and source notice. No pruning or replacement is selected." The alternative that keeps the file and excludes it from the scan does not conflict. The syntax is correct for Tailwind 4.3: `@source not "../src/components/legacy";` (https://tailwindcss.com/docs/detecting-classes-in-source-files).

---

## PRIM-11 · `ControlButton` imported as `Button`, and font size by class

Verdict: **partly-confirmed**. The naming facts are correct. The font-size part and the "minimal" recommendation need a correction. Corrected severity: **low**.

Proof that I checked:

- `SRC/components/control-button.tsx:4-13` exists as quoted. `$kind: "flat"` is the default at `button.ariakit.react.tsx:171`.
- `import { ControlButton as Button }` is in `routes/index.tsx:17`, `routes/pulls.$pullNumber.tsx:21`, `routes/runs.$runId.tsx:9`, `components/operations-attention/index.tsx:6`, `review/review-workspace.tsx:25`. `Button as FlatButton` is at `review-workspace.tsx:27`.
- V1 button heights: 25 (view switch), 26 ("Undo"), 35 ("Approve & next"), 33 ("Shortcuts on").
- `git log -S'recipe?: R' -- packages/ariakit-ui/src/components/button.ariakit.react.tsx` returns `87749801f`, which is after the pin. The `recipe` prop is upstream only.

Corrections:

1. **Nine of the 15 `className="text-xs"` overrides do nothing.** They are on the `ControlButton` alias (`review-workspace.tsx:183, 972, 981, 1117, 1126, 1131, 1180, 1188`; `operations-attention/index.tsx:349`). The wrapper also adds `text-[13px]`. Both classes are on the element, and the stylesheet order decides:

   ```
   A/css-full.css:2289:  .text-xs {
   A/css-full.css:2302:  .text-\[13px\] {
   ```

   `text-[13px]` comes later and wins. V1 confirms: "Shortcuts on" (`className="text-xs"`) renders at `13px`. "Close help" renders at `13px`. Only the six overrides on the real `Button` apply: five `FlatButton` uses (`pressedView font=12px`) and `review/screenshot-filter.tsx:158-163`.

2. So the alternative "replace `className="text-xs"` with `$size="xs"`" does not work on the wrapper. `$size="xs"` emits the same `text-xs` class (`control.ts:21`). The wrapper's `text-[13px]` must go first.
3. "`$size` is used once" is not exact. The font-size variant is also at `review-workspace.tsx:737` (`NavLink $size="sm"`), and line 746 then adds `text-xs` to the same element.

---

## PRIM-12 · `!important` overrides fight the Shell and Nav recipes

Verdict: **confirmed**, with a count correction. Corrected severity: **low** (no user-facing defect today; a risk for the next upstream refresh).

Proof that I checked:

- My `rg` count of `!` utilities in app code is **20**, not 18. The two that the auditor's parser missed are in an object literal, not in a JSX attribute: `review/item-list.tsx:373` and `:374` (`className: "min-h-0 flex-1 flex! flex-col overflow-hidden"`). `item-list.tsx` has 5, not 3.
- `[--shell-header-step:calc(48px/14)]` is at `routes/index.tsx:248`, `routes/pulls.$pullNumber.tsx:151`, `routes/runs.$runId.tsx:57`, `review/review-workspace.tsx:529`. The channel is defined at `styles/shell.ts:30`. No upstream sandbox sets it, so it is an internal channel.
- All other cited lines exist.

Corrections to the sample rewrite:

1. `<ShellSidebarBody $p="none" className="flex flex-col">` is not equivalent. The current code keeps `$p={5}` on three sides and removes only the top padding. The recipe has `overflow-y-auto` (`styles/shell.ts:501`), so the app still needs an override to move scrolling into the inner lists.
2. `<ShellFooter $height="sm" …>` does not remove `min-h-10!`. The smallest recipe height is 14 spacing steps (`styles/shell.ts:294`), which is 56px at a 16px font. The app wants 40px. `start` and `end` props do exist (`shell.ariakit.react.tsx:198-209`) and do remove `flex!`.
3. The alternative "build the item list without `Nav`" must keep the contract semantics: "Use suitable Ariakit composite/tab semantics" (`contract-issue-1.md:280`), `U03` "Use item links and variant tabs".

---

## PRIM-13 · Surfaces: 26 prop sets for 33 `Frame` uses

Verdict: **confirmed**. The impact paragraph is a judgment. Corrected severity: **medium**.

Proof that I checked:

- `rg -o '<Frame\b'` in app code: 33. The 26 combinations in `A/typography.out` add up to 33. I opened each cited site.
- V1: `readyCard` against the canvas is 1.017 : 1 in light and 1.098 : 1 in dark. Icon tiles: `1,1,2` (dark) and `205,206,206` (light). Popover alert card against the popover in light: 1.000 : 1 (same color).
- Screenshots `A/screens/dashboard-queue-dark-1440.png` and `A/screens/dashboard-alerts-popover-light-1440.png` agree.

Corrections: none. One note: `--color-canvas` is in the vendored `ui.css:4`. A change of that token must be an override in app CSS (`@theme` after the import), or the vendored file stops being a copy of the pin.

---

## PRIM-14 · Status has four renderings and two vocabularies

Verdict: **confirmed**. Corrected severity: **low**.

Proof that I checked:

- The four renderings and both label functions exist at the cited lines (`routes/index.tsx:130-151, 383-395, 580-582`; `review/review-status.tsx:10-38`; `review/item-list.tsx:270-274`; `review/use-review-session.ts:57-80`).
- V1, dashboard with a failed run: the row "Run failed · Attempt 1" has the icon class `lucide lucide-clock-3`.
- V1, live preview: badge "Needs review", classes `[ak-layer, ak-layer-offset-(--layer-lightness-offset)]`, no `ak-layer-warning`.
- `ROOT/packages/service/src/review-status.ts:50-58`: the type `RunReviewStatus` has no `reviewing` member. `rg '"reviewing"'` finds it only in `preview-fixtures.ts:84`, `routes/index.tsx:132`, a test, and a tooling fixture. So the color gap is preview-only. This claim is now verified by the type, not only by reading.

Addition: the contract limits redesign idea R7. "Counts and text must accompany color" (`contract-issue-1.md:261`). A dot-only status needs visible text or a count next to it.

---

## PRIM-15 · The vendored copy is restructured and reformatted

Verdict: **partly-confirmed**. All facts are correct. The recommendation conflicts with the contract, and the finding does not say so. Corrected severity: **medium**.

Proof that I checked:

- `diff -rq A/pinned-fmt/packages/ariakit-ui/src SRC/components/ariakit` lists 17 differing files: 9 components and 8 style files (`button`, `control`, `edge`, `frame`, `glider`, `layer`, `text-frame`, `text`).
- Independent check without the auditor's formatted copy: `git show fc85b809:packages/ariakit-ui/src/styles/ui.css | tr -d ' \n\t' | shasum` equals the same hash of the vendored `ui.css` (`6f1b4d4f…`). The same holds for `shell.ts` (`8324b908…`). So the content equals the pin.
- `SRC/components/ariakit/styles/button.ts` is one line. The pin's `styles/button.ts` has 161 lines.
- `git log fc85b809..HEAD -- packages/ariakit-ui/src`: 13 commits. `git diff --stat`: `21 files changed, 790 insertions(+), 279 deletions(-)`.
- Upstream `nav.ariakit.react.tsx` exports `NavSlot`, `NavLinkContent`, `NavLinkLabel`, `NavLinkDescription`. `NavIcon` is gone. `SRC/components/app-shell.tsx:5, 59-61` uses `NavIcon`.

What the auditor missed:

1. The inlined layout is a contract instruction, not drift. `contract-issue-1.md:247-254`:

   > Group the recipe and React component in the same file when appropriate. A file may export only one of them when that is all it needs.
   >
   > ```text
   > components/button.tsx   exports button (Clava recipe) and Button (React)
   > components/frame.tsx    recipe and component
   > ```

   `current-contract.md:7` says each saved requirement "remains binding unless an explicit approved rule below supersedes it". No later rule supersedes this one. So "Restore the upstream file layout" needs a contract change first. The finding should state this as part of the maintainer decision.

2. The folder already has both layouts. `NOTICE` lines 5-6: Shell, Table, Badge, and Popover use the upstream layout (recipes in `styles/`). The nine older primitives are inlined.
3. Rule D10 (`current-contract.md:54`) keeps "the component set … license, and source notice". Each option must keep `LICENSE` and `NOTICE`.

The facts and the cost of a refresh are as described. The two alternatives that keep the current structure (a sync script, or a manual refresh with recorded steps) do not conflict with the contract.

---

## PRIM-16 · The theme names "Inter Variable" but the app ships no font

Verdict: **confirmed**. Corrected severity: **low**.

Proof that I checked:

- `SRC/components/ariakit/styles/ui.css:12-14` exists as quoted.
- `rg 'fontsource|@font-face|fonts\.googleapis|\.woff' apps/web/src apps/web/package.json apps/web/public` returns nothing. `public` holds only `favicon.svg`.
- V1: `documentFonts: []`, platform font `.SF NS` (`.SFNS-Bold`) in both schemes.

Additions:

- The source of the token: upstream loads the font in its own app, `UP/app/package.json:63` (`"@fontsource-variable/inter": "5.3.0"`). The copy took the token and not the font.
- The page CSP is `font-src 'self'` (`ROOT/packages/security/src/http.ts:43`). A self-hosted font works. A font from Google Fonts does not load.

---

## PRIM-17 · Stylesheet and DOM weight

Verdict: **confirmed**. Corrected severity: **low**.

Proof that I checked:

- `wc -c` on `dist/client/assets/index-CXm4JU5N.css`: 464,666. `gzip -9`: 59,384. `brotli -q 11`: 32,868. JavaScript gzip sizes: 101,093, 40,101, 43,838. All match.
- V4: 371,158 bytes with all sources and 78,185 without the vendored `.ts` and `.tsx` files. 79 % is correct.
- V2, DOM weight of the workspace fixture: `elements 581, controls 43, averageControlClassChars 1667, classChars 153129, styleChars 18209, htmlChars 248154, classShare 0.617`. Identical.
- `curl http://127.0.0.1:4310/` returns 27,700 bytes. It contains "Checking access and loading runs…" and not "Your review queue". So the server renders only the loading state.

Corrections: none. One note: the title gives the gzip size. Cloudflare normally serves Brotli to browsers, so the transfer size is nearer to the Brotli number. The exact production value was not measured by either of us.

---

## PRIM-18 · Marker classes without a consumer

Verdict: **confirmed**. Corrected severity: **low**.

Proof that I checked:

- V5, each of the 15 names searched as a whole token in `apps/web/src`, `apps/web/tooling`, and `packages`: 13 names have only their own definition line. `review-empty-image` and `review-thumbnail` have two definition lines each and no selector. `dashboard-main` is also a class on the operations fixture wrapper (`components/operations-attention/__tests__/fixture.tsx:9`) and has no selector. `dashboard` has no class selector (`rg '\.dashboard\b'` finds only `.dashboard-alert-count` and `.dashboard-alert-error-mark`).
- `SRC/review.css` has 2 lines. `SRC/styles.css` has 1 line. The three extra imports exist.
- The cause is visible in history: `git show f83fef6 --stat` lists `apps/web/src/review.css | 78 --`.

Corrections to the recommendation:

1. "Import it once from the root" breaks the review fixture harness. `SRC/review/__tests__/fixture.tsx` imports no CSS. It gets the stylesheet only through `review/review-workspace.tsx:66`. The fixture (or its HTML entry) must import the stylesheet if that line goes away.
2. A rename also needs a docs edit: `ROOT/docs/simplification-implementation.md:87` links `../apps/web/src/review.css` and calls it "image canvas CSS". That description is already wrong, because the file has no rules.

---

## PRIM-19 · Horizontal strips overflow without any sign

Verdict: **partly-confirmed**. The measurements are correct. Three statements need a correction. Corrected severity: **medium**.

Proof that I checked:

- V1, 1440 px: `clientWidth 1120, scrollWidth 2079` (dark), `2065` (light), 7 chips of 263 to 307 px, 3 chips fully visible.
- V1, 390 px: view switch `clientWidth 366, scrollWidth 401`. Screenshot `A/screens/workspace-dark-390.png` shows "Baselir".
- `review-workspace.tsx:424` (`/^[1-6]$/`) and `variant-summary.tsx:124` (`index < 6`) exist.

Corrections:

1. "There is no scrollbar" depends on the platform. V1: `scrollbarWidth: auto` and `offsetHeight − clientHeight = 0`. The CSS does not hide the scrollbar. macOS and phones use overlay scrollbars, which appear only during a scroll. Windows, most Linux setups, and macOS with "Always show scroll bars" draw a classic scrollbar under the strip. The finding is true for the maintainer's platform. It is not true everywhere.
2. The limit of six shortcut keys is contract behavior, not a defect: "1–6 | Select that position among the first six variants; absent positions do nothing." (`contract-issue-1.md:273`). The contract also says "Left / Right | Move through declared variant order; visible controls reach all variants." Arrow keys do reach all variants and scroll them into view (`review-workspace.tsx:99-121`).
3. "Six of seven chips share 'Chromium · Light · 1280 × 720'" is fixture data. `review/__tests__/fixture-model.ts:19` builds each label as `` `${key} · Chromium · Light · 1280 × 720` ``. Production labels come from `SRC/api/review.ts:469-481` (framework, browser, color scheme, contrast, forced colors, key). The overflow mechanism is the same in production: each production chip has at least as many parts, and four chips of about 290 px already exceed the 1,120 px strip.
4. "The sidebar text '7 of 7 need review' is the only hint" is not exact. The action bar shows "All 7 changed views…" (`review-workspace.tsx:1055`).
5. The recommendation "show only what differs" must keep the full label reachable. The contract priority list includes "full variant label" (`contract-issue-1.md:261`).

---

## PRIM-20 · History search focus is only an underline

Verdict: **confirmed** for the measurements. The WCAG reference needs a correction. Corrected severity: **low**.

Proof that I checked:

- `routes/index.tsx:656-662` and `:674-679` exist as quoted. `review/screenshot-filter.tsx:71` has `focus-within:outline-2 focus-within:outline-brand`.
- V1, keyboard focus through Tab, both schemes: search `outline: none`, `textDecoration: underline`, wrapper `outline: none`; select `outline: solid 2px`, offset 2px, wrapper unchanged.
- Screenshots `A/screens/closeup-history-search-focus-dark.png` and `A/screens/closeup-history-select-focus-dark.png` show it.
- `SRC/components/ariakit/styles/focus.ts:86` exports `focusWithin`. The second alternative is feasible.

Correction: this is not a WCAG 2.4.7 failure. The W3C text for 2.4.7 gives this example: "When text fields receive focus, a vertical bar is displayed in the field, indicating that the user can insert text" (https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html). The text caret is a focus indicator. The real problem is consistency: three fields, three focus styles, and none uses the recipe ring. The underline also applies to typed text, not only to the placeholder. The finding is a visual consistency finding with a small accessibility benefit.

---

## Screenshots that I opened

From the auditor (`A/screens/`): `workspace-light-sidebar.png`, `closeup-variant-selection-light.png`, `closeup-variant-selection-dark.png`, `workspace-dark-banners.png`, `closeup-history-search-focus-dark.png`, `closeup-history-select-focus-dark.png`, `closeup-open-run-square-dark.png`, `closeup-action-bar-light.png`, `workspace-dark-help-dialog.png`, `workspace-dark-batch-dialog.png`, `run-guest-dark-1440.png`, `queue-light-1440.png`, `workspace-dark-390.png`, `dashboard-alerts-popover-light-1440.png`, `closeup-run-meta-strip-light.png`, `dashboard-queue-dark-1440.png`. Each shows what its caption says, with one exception: the batch dialog is not "lifted" (PRIM-09).

Mine (`V/screens/`): `guest-light.png` and `guest-dark.png` (sign-in card), `forbidden-light.png` and `forbidden-dark.png` (black warning icon, gray "Use another account"), `empty-queue-light.png` and `empty-queue-dark.png` (uncolored success icon), `archived-dark.png` and `archived-light.png`, `help-dialog-dark.png` and `help-dialog-light.png`, `pull-failed-dark.png` and `pull-failed-light.png`, `history-search-focus-*.png` (the clip shows the table badges, not the fields), `live-queue-light.png`.

---

## Missed

1. **Six color-named ink classes generate no CSS.** `ak-ink-danger` (`routes/index.tsx:271`, `components/user-menu.tsx:66`, `components/operations-attention/index.tsx:370, 501`), `ak-ink-warning` (`routes/index.tsx:331`), and `ak-ink-success` (`routes/index.tsx:531`) are not utilities: `@utility ak-ink-*` takes a number or an arbitrary value only (`@ariakit/tailwind/src/output.css:816-821`). The dev and production stylesheets contain 0 rules for them. V3: the warning and success icons have the same color as the heading (`oklch(1 0 0)` dark, `oklch(0 0 0)` light). Error messages and the alert "!" mark are not red. The report says these classes are correct ("How it works", section 3).
2. **Nine `className="text-xs"` overrides on the `ControlButton` alias are dead** because the wrapper's `text-[13px]` wins in the cascade. See PRIM-11, correction 1.
3. **The contract was not consulted.** It decides four recommendations: no pruning of the copied set (D10, PRIM-10), recipe and component in one file (PRIM-15), preserved disabled-state handling (PRIM-06), and the 1–6 keys (PRIM-19). It also limits redesign ideas R4 ("commit/run identity above", `contract-issue-1.md:260`), R5 ("full variant label"), and R7 ("Counts and text must accompany color").
4. **The review workspace and the pull page have no base font size**, while the dashboard shell sets `text-sm`. This is the cause of the 16px action bar, footer, and "Accepted (N)" toggle. See PRIM-07.
5. **Docs drift:** `docs/simplification-implementation.md:87` describes `review.css` as "image canvas CSS". The file has had no rules since `f83fef6`.
6. **The recipe-default selected state is also weak in light** (about 1.16 : 1 on the top navigation, measured). A redesign that relies on the neutral default will not make the selected variant obvious. See PRIM-03.
7. **Dialog headings render as `h1`** (`ak.DialogHeading` default; V1 `headingTag: H1` for both dialogs) while the page already has an `h1` for the item name.
8. **Tailwind scans 78 files outside `src`** (SQL migrations, tooling scripts, README files; V4 `scanned outside src: 78`), because `review.css` sets no `source(...)`. The byte cost is small (236 bytes in the auditor's run), but the scan turns unrelated text into class candidates.
9. **The same wrapper button has two radii** (6.5px in the page body, 8px in the footer and the top navigation), in addition to the 2px cases of PRIM-04.
