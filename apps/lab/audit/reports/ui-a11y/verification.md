# Verification of the lane "Responsive behavior, accessibility, keyboard, theming, and motion"

Verified report: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-a11y/report.md`.
Verification date: 2026-10-05. Read-only. No repository file was changed.

## Method

- I opened every cited file and compared the quoted lines with the source.
- I wrote new probe scripts. I did not reuse the auditor's scripts. They are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-a11y/verify/` (called `$V` below): `v1.mjs` to `v5.mjs`, and `tw-variant.mjs`. Raw output is in `$V/v1.json`, `$V/v2-*.json`, `$V/v3.json`, `$V/v4.json`, `$V/v5.json`. New screenshots are in `$V/screens/`.
- Each probe ran in Chrome through Playwright against port 4310 (routed preview app) and port 4311 (browser-test fixtures).
- I read the contract (`docs/current-contract.md`), the decision records (`docs/simplification-audit/audit-data.json`), and the guide (`docs/review-guide.md`) to find decisions that make a behavior deliberate.
- I checked three platform facts in official documents. The URLs are in the related sections.
- Invoked skill: `ariakit-general-workflow` (the remote is `github.com/ariakit/visonaut`).

Result in one view:

| Verdict          | Findings                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| Confirmed        | 01, 03, 04, 06, 07, 08, 09, 10, 11, 12, 13, 15, 16, 17, 18, 19, 21, 22, 25 |
| Partly confirmed | 02, 05, 14, 20, 23, 24, 26                                                 |
| Refuted          | none                                                                       |

No finding is refuted. Seven findings need a correction. Three corrections change what the maintainer must decide: A11Y-02 (the recommended fix does not work as written), A11Y-05 (the recommendation is an option that the contract already rejected), and A11Y-26 (one part exists only in the preview fixtures).

Fixture limits that the report did not state:

1. The fixture variants have no `labelParts` (`review/__tests__/fixture-model.ts:19`). Production variants have six parts (`api/review.ts:469-481`). Production pills are wider than fixture pills (see A11Y-12).
2. The preview run has a read-only banner of 41px. All numbers in the A11Y-14 table include it.
3. The state `reviewing` comes only from `review/preview-fixtures.ts:84`. The production dashboard cannot return it (see A11Y-26).
4. The production API always sends `recompareAllowed: false` (`api/review.ts:592`). The fixture leaves it undefined, so the fixture shows an enabled "Recompare stored run" button that production never shows.

---

## A11Y-01 · Shortcuts stop after a mouse click on a variant pill

- Verdict: **confirmed**. Severity: **high**.
- Proof:
  - `review/review-workspace.tsx:94-96` contains `.review-variants` in the exclusion selector. Line 729 puts that class on the variant `Nav`.
  - `$V/v1.mjs`, fixture: after a click on pill 2, `"focusAfterPillClick":{"tag":"a","label":"2. Solid …"}`, `"callsAfterA":0`, `"modeAfterD":"side"`, `"h1AfterArrowDown":"Success dialog"`, `"variantAfter3":"2. Solid …"`.
  - Routed app (port 4310): `"focus":{"tag":"a","label":"2. React · Chromium · Dark. Needs review"}`, `"modeAfterD":"side"`.
  - New: the keyboard path has the same defect. Focus on pill 1, `ArrowRight`, then `A`: `"callsAfterA":0`.
  - Recovery: a click on plain text moves focus to the root `div`, and shortcuts work again (`"focusAfterH1Click":{"label":"Review workspace"}`, `"modeAfterDAfterH1Click":"diff"`).
- No guard or contract rule makes this deliberate. Decision U04 says that controls "that consume arrow keys, such as tabs and menus, keep their own keyboard behavior". It does not say that letters must stop.
- Corrections to the recommendation:
  - A smaller change is enough. `followVariantLink` already calls `event.preventDefault()` for its four keys (line 115). The page handler already returns on `event.defaultPrevented` (line 396). So the fix can be the removal of one token:

    ```ts
    // review-workspace.tsx:95, remove ".review-variants, " from the selector
    'input, textarea, select, …, [role="tablist"], [data-screenshot-search]';
    ```

  - Alternative (a) says that `followVariantLink` must call `stopPropagation()`. That call is not necessary, and it does not work in the routed app. `routes/__root.tsx:21` renders `<html>`, so React owns `document`. The page listener is also on `document` (line 446). `stopPropagation()` does not stop a second listener on the same node.
  - Assumption that I did not measure: React registers its root listeners before the effect at line 443 runs, so the React handler runs first. The item list depends on the same order today (`item-list.tsx:335` plus the `defaultPrevented` guard).

## A11Y-02 · Focus jumps to the page root after each decision and after Undo

- Verdict: **partly confirmed**. The behavior is confirmed. The recommended fix does not work as written. Severity: **medium** (auditor: high).
- Proof of the behavior:
  - `review/use-review-session.ts:313-317` and line 470 call `onFocus()`. `review-workspace.tsx:248` focuses the root. Lines 528-534 give the root `tabIndex={0}` and `aria-label`, and no role.
  - `$V/v1.mjs`: after Enter on Approve, `"afterApprove":{"tag":"div","label":"Review workspace","size":"1440x1014"}`, `"outline":"auto 1px rgb(153, 200, 255)"`, next Tab goes to `"Visonaut review queue"`. After Enter on Undo: the same `div`.
  - Routed app: the first Tab stop of the page is the root `div` (`"label":"Review workspace","size":"1440x1035"`).
  - `$V/v3.mjs`: Approve is stop 32 of 35 in the fixture and the root is stop 2. The distance is 30 Tab presses, as the report says.
  - ARIA 1.2 lists `generic` in "Roles which cannot be named" and says "Authors MUST NOT use the aria-label or aria-labelledby attributes to name the element" (https://www.w3.org/TR/wai-aria-1.2/#namefromprohibited).
- Correction 1 (important): "Do not move focus after a decision" does not keep focus on the button. Approve and Reject have `disabled={!ready || …}` (lines 1064-1070 and 1082-1088). `ready` needs `evidence.status === "ready"` (lines 302-307). Each variant change makes the buttons `disabled` while the next images load. Chrome then moves focus to `<body>`.
  - Measurement (`$V/v3.mjs`, focus on Approve, then key `2`): `"frames":[{"value":"disabled|focus-on-approve","count":2},{"value":"enabled|BODY","count":38}]`, `"activeAfter":"body …"`.
  - So without `onFocus()` the focus goes to `<body>`. The next Tab then starts at the top of the page, the same as today. Alternative (a) ("skip `onFocus()` when `document.activeElement` is a button") fails for the same reason.
  - A fix that keeps focus on the control must also keep the control focusable. Ariakit has a prop for this:

    ```tsx
    <Button accessibleWhenDisabled disabled={!ready || …} onClick={() => review("approved")}>
    ```

    I did not test this prop in the app. Another option is to not disable the action buttons during the image load, and to ignore the command in `review()` (line 386 already does this).
- Correction 2: "assistive technology gets no useful name" is not verified. No screen reader was used. Browsers can still expose `aria-label` on a focusable `div`. The standards point is correct. The practical effect is unknown.
- Correction 3: the contract names focus as behavior to keep. `docs/current-contract.md:196`: "The UI must preserve multiple rapid decisions, pending overlays, newer route-model handling, Retry, Undo, focus, and navigation." Line 198: "The workspace keeps layout, image readiness, selection, focus, and navigation." A change of the focus model is a contract change. The report asks the correct question ("Which focus model") but does not cite these lines.
- Severity reason: the shortcut flow (`A`, `X`) works from the root. The loss is for users who use Tab and Enter only, and for screen-reader users, who are outside the launch scope (`docs/review-guide.md:94`).

## A11Y-03 · Item list unreachable when the px media query and the rem container query disagree

- Verdict: **confirmed**. Severity: **low** (auditor: medium). The effect is large, but few users can reach the trigger.
- Proof:
  - `review-workspace.tsx:211-213` uses `matchMedia("(max-width: 1023px)")`. Lines 538 and 570 use the `5xl` container query. Line 559 and lines 625-632 depend on `narrow`.
  - `$V/v2.mjs 03`, default font 20px, window 1200px: `"rootFontSize":"20px","narrowMedia":false,"sidebarVisible":false,"toggleVisible":false,"screenshotsButton":false,"rowsInDom":3,"rowsVisible":0`. Default font 16px, window 1200px: sidebar visible. Default font 20px, window 1300px: sidebar visible (64rem is 1280px).
  - Emulated 15px scrollbar: at 1024, 1030, and 1038 the list, the toggle, and the button are all hidden (`"clientWidth":1009 … 1023`). At 1039 the sidebar returns. At 1023 the "Screenshots" button shows.
- Limit of the scrollbar case: I also ran Chrome with its native scrollbars and no injected CSS at 1030px. Result: `"clientWidth":1030,"sidebarVisible":true`. macOS uses overlay scrollbars by default, so the gap does not exist there. The gap needs scrollbars that take space (Windows, Linux, or the macOS setting "always").
- Check of alternative (b): `matchMedia("(width < 64rem)")` returns `true` at default font 20px and window 1200px (`"remMedia":true`). So alternative (b) fixes the font-size case. It does not fix the scrollbar case (`"remMedia":false` at 1024 with the scrollbar), as the report says.
- The main recommendation (`@5xl/shell:hidden` on the button) is feasible. The button is inside the `shell` container.

## A11Y-04 · Shift+A and Shift+X skip the confirmation that the button path requires

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof:
  - `review-workspace.tsx:426-429` calls `review(verdict, event.shiftKey)`. Lines 1042-1059 only open the dialog. Lines 1242-1296 are the dialog.
  - `$V/v1.mjs`: Shift+A gives `"calls":1,"last":{"verdict":"approved","targets":7,"wholeItemKey":"dialog/open"},"dialogs":[]`. The button gives `"calls":0,"dialogs":["Review all changed views…"]`.
- Context that the report did not give: the direct shortcut is documented and tested, so it is deliberate.
  - `docs/review-guide.md:75`: "`Shift+A` / `Shift+X` | Approve or reject the whole item".
  - `review/__tests__/review.browser.test.ts` has the test "whole item freezes all changed IDs in one undoable command", which presses `Shift+A` and expects one saved command.
- The inconsistency between the two paths is real. The choice between "confirm" and "undo" is a product decision, as the report says. Caps Lock does not trigger it (`shiftKey` stays false).

## A11Y-05 · Arrow keys are taken from focusable scroll regions and from the page

- Verdict: **partly confirmed**. The behavior is confirmed. The report does not say that the contract selected this behavior, and its recommendation is the option that the maintainer did not select. Severity: **low** (auditor: medium).
- Proof of the behavior:
  - `components/screenshot-viewer.tsx:132-137`: `overflow-auto`, `tabIndex={0}`, and the label "Use pan controls or scroll to inspect the image."
  - `$V/v1.mjs` at 200%: `"before":{"top":0,"sh":836,"ch":504}`, `"scrollTopAfterArrowDown":0`, `"h1Before":"Success dialog","h1After":"Open menu"`. Eight pan buttons exist in two groups.
- What the report missed: this is decision U04 in the binding contract. `docs/current-contract.md:146`: "U04 | Page-wide review arrows with pan buttons". The decision record (`docs/simplification-audit/audit-data.json`, id `U04`) asked "What should arrow keys do when the image viewport has focus?" and had three options:
  1. "Let image focus scroll the image" (recommended then, not selected).
  2. "Add an explicit image inspection mode" (not selected).
  3. "Page-wide review arrows with pan buttons" (selected).
- The report's recommendation ("When focus is inside the image stage, arrows pan") is option 1. It reopens a recorded decision. That is permitted in this audit, but the maintainer must know it.
- One real leftover, independent of U04: the `aria-label` tells the user to "scroll", and arrow keys do not scroll. A small fix that keeps U04 is to change the label, or to remove `tabIndex` (the report's alternative a).

## A11Y-06 · Zoomed panes pan independently

- Verdict: **confirmed**. Severity: **medium**.
- Proof: `components/screenshot-viewer.tsx:34-48` keeps `position` in a ref for each `ImagePane`. No code copies one pane's offset to the other. `$V/v1.mjs` at 200%, after `first.scrollTo(200, 150)`: `"positions":[[200,150],[0,0]]`.
- No contract line requires independent panes. The recommendation is feasible.

## A11Y-07 · Shortcut help is hard to find, hints are always on, and the toggle is not remembered

- Verdict: **confirmed**. Severity: **medium**.
- Proof:
  - `review-workspace.tsx:1178` renders `ShortcutHelp` in `ShellFooter`. Line 199 is `useState(true)`.
  - `$V/v1.mjs`: `Shift+?` gives `"dialogsAfterQuestion":[]`. `/` leaves focus on the root. Help button `26x26`. With shortcuts off: `"hintsWhenOff":["Compare S","Difference D","Current F","Baseline G","Reject viewX","Approve & nextA"]`. After reload: `"afterReload":"Shortcuts on"`, and local storage has only `visonaut.review.sidebar`.
  - Footer position on the routed run page: top `995` of 900, `1096` of 1080, `914` of 768 (`$V/v1.json`, keys `A11Y-14-routed-*`).
  - `$V/v3.mjs`: the help button is stop 23 of 24 on the routed page and stop 33 of 35 in the fixture. Both match the report.
  - `rg "kbd\.ariakit" apps/web/src` has no match, so `Kbd` has no import.
- Small note: the toggle already satisfies WCAG 2.1.4 ("turn off"). The criterion does not require that the state persists. The persistence point is a usability point.
- The recommendation is feasible. `pointer-coarse:` exists in the installed Tailwind 4.3.3.

## A11Y-08 · Focus ring clipped on the main navigation, the review search, and the item rows

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof:
  - `$V/v2.mjs 08`: nav link `"outline":"solid 2px offset 1px","rect":[528,8,130,32]`; clipping ancestors `nav … "overflow":"auto/auto","clipPath":"inset(-1440px 0px)","rect":[528,8,385,32]` and `div … "overflow":"clip/clip"` with the same rectangle.
  - My crop `$V/screens/v-focus-nav-link-dark.png` shows the ring on the right edge only. The auditor's four crops show the same clips.
  - `components/ariakit/components/nav.ariakit.react.tsx:73` has the quoted class list. The upstream recipe has the same line (`ariakit/packages/ariakit-ui/src/styles/nav.ts:63`), so a newer copy of the primitive does not fix this. The fix is at the call site.
- The recommendation is feasible. `$p={1}` is `0.25em`, which is 3.25px at the 13px font of the header nav. The ring needs 3px. The review search needs top padding on `ShellSidebarBody` (`pt-0!` at line 557); the report gives no code for that part.

## A11Y-09 · The history search field has no focus ring

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof: `routes/index.tsx:661` has `outline-none focus-visible:underline`. `$V/v2.mjs 08`: `"outline":"none 1px","textDecoration":"underline","frameOutline":"none 3px"` in both schemes. `$V/screens/v-focus-history-search-dark.png` and `v-blur-history-search-dark.png` differ only by the underline of the placeholder.
- Note: the text caret is a second focus mark. The field is not without any indicator. The mismatch with the review search (`review/screenshot-filter.tsx:71`) is correct.

## A11Y-10 · Selected variant is weak in dark, invisible in light, and equal to the others in forced colors

- Verdict: **confirmed**. Severity: **medium**.
- Proof (`$V/v2.mjs 10`):
  - Dark: glider `oklch(0.2634 …)` on canvas `oklch(0.1634 …)`; other pills have a 1px border at 10% alpha. Selected weight 500, others 400 with text alpha 0.7.
  - Light: glider `oklch(1 …)` on canvas `oklch(0.9933 …)`. `$V/screens/v-variant-strip-mixed-light.png` shows the selected pill with no outline and the other pills with an outline.
  - Forced colors: selected and other pills both have `"border":"1px solid rgb(0, 0, 159)"`. The only difference is the weight. `$V/screens/v-variant-strip-forced-colors.png` shows it.
- Added context: `docs/current-contract.md:192` says "Run views and variants use navigation links with a bar glider". The code uses a flat glider with a border (`review-workspace.tsx:719-727`). The report's recommendation (bar glider) matches the contract text. Redesign idea R2-A (Tabs) reverses that later decision ("variant links replace the original U03 tabs").

## A11Y-11 · Variant pills do not show the review status

- Verdict: **confirmed**. Severity: **medium**.
- Proof: `review/variant-summary.tsx:88-136` renders no verdict. Lines 747 and 776 of the workspace put the verdict in `title` and `aria-label` only. In `$V/v2.mjs 10` I set variant 2 to approved and variant 3 to rejected. The labels became "2. … Approved" and "3. … Rejected", and the pills in `$V/screens/v-variant-strip-mixed-dark.png` look the same as the pending pills.

## A11Y-12 · The variant strip hides most variants and costs one tab stop per variant

- Verdict: **confirmed**, and the production case is worse than the report shows. Severity: **high** (auditor: medium).
- Proof:
  - Fixture, 1440px: `"fullyVisible":3,"total":7,"widths":[295,287,285,307,297,299,265]`, `"scrollWidth":2079,"clientWidth":1120`, `"tabbable":7`. Line 424 is `/^[1-6]$/`.
  - Production shape. Ariakit builds the variant key as `[framework, project, viewport, style, colorScheme, contrast, forcedColors].join("-")` (`ariakit/app/src/test-utils/visual.ts:477-487`). The API sends six label parts (`api/review.ts:469-481`). I gave the fixture 12 variants with that shape (2 frameworks × 3 browsers × 2 schemes). Result at 1440px: `"total":12,"fullyVisible":2,"widths":[413,408,390,…,378],"hiddenPx":3638`. Screenshot: `$V/screens/v-variant-strip-production-labels-1440-dark.png`.
  - Each production pill shows the same facts two times: "React · Chromium · Light" as icons with words, then the key `react-chromium-defau…` cut at 192px.
- Caveat for one sentence: "Nothing shows that more exist, except a cut pill" is measured with overlay scrollbars. The strip has `overflow-x: auto` and `scrollbar-width: auto`, so a system with classic scrollbars shows a horizontal scrollbar. I did not measure that.
- See the first item in "Missed": the selected pill also leaves the visible area.

## A11Y-13 · `$layer="primary"` is not a layer color

- Verdict: **confirmed**. Severity: **medium**.
- Proof:
  - `components/ariakit/components/layer.ariakit.react.tsx:84-100` and `utils/styles.ts:6-13`: the known values are `canvas, brand, secondary, success, warning, danger`, and `transparent`. Other strings become `--layer-color`.
  - Six call sites: `routes/index.tsx:301, 310, 346, 508` and `routes/pulls.$pullNumber.tsx:194, 226`.
  - `$V/v2.mjs 13`: "Review changes" has `style="--layer-color: primary; …"`, class `ak-layer-color-(--layer-color)`, background `oklch(0.949994 …)` and color `oklch(0 0 0)` in both schemes. The guest "Sign in with GitHub" button has the same values. The Approve button has `ak-layer-brand` and `oklch(0.515341 0.1546 248.516)`.
  - Screenshots `$V/screens/v-dash-queue-dark.png`, the auditor's `dash-guest-1440-light.png`, and `run-guest-1440-dark.png` show the three looks.
- The upstream `Layer` has no `primary` value either, so a newer copy does not fix it. Both proposed fixes are feasible.

## A11Y-14 · Controls use 40% to 66% of the viewport above the image; sticky bars leave 71px at 400% zoom

- Verdict: **partly confirmed**. All measurements repeat. The table describes the preview run, which has a banner that a normal review does not have. Severity: **medium**.
- Proof:
  - Routed preview, image top: `431` at 1440×900, `431` at 1920×1080, `425` at 1024×768. Scroll heights `1035`, `1136`, `954`. All match the report.
  - Band heights (`$V/v2.mjs 14`): app header 48, run header 48, meta row 26, title block 59, variant strip 38, view controls 55, pane caption 48, action bar 61, footer 40. They match the list in the report.
  - 400% of 1280×1024 (`$V/v3.mjs`): sticky bars `48 + 48 + 89 = 185` of 256px. 200% of 1440×900: `48 + 48 + 59 = 155`, image top `465`.
- Correction: the preview run shows "Preview fixtures are read-only…" (`"warnings":[[233,41,…]]`). The fixture has no banner and an image top of `414`, of which 24px is the fixture's own "Outside search" field. A normal review at 1440×900 starts the image at about **390px (43%)**, and at 1920×1080 at about 390px (36%). The conclusion does not change.
- Note on the standard: WCAG 1.4.10 uses the 256px height for content that scrolls horizontally. The 71px number is a usability fact. It is not a failure of 1.4.10 by itself.

## A11Y-15 · The mobile review flow is a stacked desktop page

- Verdict: **confirmed** as facts. The redesign is a judgment. Severity: **low** (auditor: medium), because `docs/review-guide.md:94` puts mobile outside the launch scope, and the report says so.
- Proof (`$V/v2.mjs 20`, fixture at 390×844 with touch): panes `[521,521]`, page height `1648`, image top `524`, view modes `"clientWidth":366,"scrollWidth":401`, hints visible (`"Compare S","Reject viewX","Approve & nextA"`). After a tap on an item in the dialog: `"h1":"Open menu","dialogOpen":true`. The routed preview numbers in the report (1685 and 561) include the 41px banner.
- `review-workspace.tsx:1206-1222` has no close on select.

## A11Y-16 · Every page has the same title; client navigation drops focus; header links reload the document

- Verdict: **confirmed**. Severity: **medium**.
- Proof (`$V/v2.mjs 16`, port 4310):
  - `"titles":{"queue":"Visonaut","history":"Visonaut","run":"Visonaut"}`. `rg "title:|head:" apps/web/src/routes` finds only `__root.tsx:6` and `:10`.
  - Header link "Run history": 1 document request and a new `/api/runs` request. The "Queue" link in the workspace: 1 document request.
  - The in-page `Link` "View history" (`routes/index.tsx:549`): `"viewHistoryLinkDocs":0,"viewHistoryLinkApi":0`. This is the direct comparison: the same destination costs one full load from the header and nothing from the router link.
  - Focus after client navigation: `BODY` in both cases. No skip link.
- Corrections:
  - "The one client-side transition (queue to run)" is not exact. Router links exist at `routes/index.tsx:510, 549, 592, 707` and in the item and variant lists. All of them leave focus on `body`.
  - Feasibility of "use the router `Link` in the header": `AppHeader` also renders inside the browser-test fixture, which has no `RouterProvider` (`review/__tests__/fixture.tsx:146-199`). The workspace guards its own links for this case (`review-workspace.tsx:749-759`: `route ? <Link … /> : undefined`). `AppHeader` needs the same switch, or the fixture needs a router. I did not test `Link` without a router.
  - The `head` sample is valid for the installed router. `head` receives `loaderData` (`@tanstack/router-core@1.171.32`, `route.d.ts:307`). The documentation says: "TanStack Router will dedupe `title` and `meta` tags, preferring the **last** occurrence of each tag found in nested routes" (https://tanstack.com/router/latest/docs/framework/react/guide/document-head-management). That page describes no focus management and no route announcer.

## A11Y-17 · The end of a review has no visible state

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof: `use-review-session.ts:366-368` calls `onAnnounce`. The target is the `sr-only` paragraph at `review-workspace.tsx:1202-1204`. `$V/v1.mjs` after all approvals: `"progress":"0 of 11 need review","saveState":"1 variant approved. Saved.","announcement":"Review complete. No variants need review.","announcementClass":"sr-only","announcementRect":[1,1],"approveDisabled":false`.
- Addition: the browser test "next pending wraps…" uses `toBeVisible()` on this text. The check passes because the `sr-only` box is 1×1px. The test suite does not show that the message is visible to a sighted user.
- Severity reason: three visible signals exist (the count, the full progress bar, "Check passed"). The missing part is a clear end and a next step.

## A11Y-18 · A quarter of the review text is below 12px, and fixed pixel sizes ignore the user font size

- Verdict: **confirmed**. Severity: **medium**.
- Proof: `$V/v2.mjs 18`: `"sizes":{"10":22,"11":4,"12":51,"13":16,"16":5,"28":1},"total":99,"small":26`. `rg "text-\[1[0-3]px\]" apps/web/src` gives 18 lines outside the tests, in the files that the report names. The screenshot `user-font32-1440-review.png` shows 24px captions beside 13px buttons and a 28px `h1`.
- The `@theme` recommendation is feasible (`--text-*` is a Tailwind 4 theme namespace).

## A11Y-19 · Contrast below 4.5:1 for placeholders and for `opacity-50` text in the light scheme

- Verdict: **confirmed**. Severity: **low**.
- Proof: the review search placeholder has `color: oklab(… / 0.5)` from the Tailwind base style and `opacity: 0.5` from `placeholder:opacity-50` (`review/screenshot-filter.tsx:109`). The result is 25% ink: `#484a4d` on `#0c0e12` (about 2.2:1) and `#bdbebe` on `#fcfdfd` (about 1.8:1). The meta row has `opacity: 0.5` at `10px`. Black at 50% on `#fcfdfd` is about 3.9:1. The history placeholder is 50% ink (about 4.0:1). White at 50% on the dark canvas is about 5.3:1, so the dark scheme passes, as the report says.
- `rg "opacity-[0-9]+" apps/web/src --glob "*.tsx"` gives 14 lines outside the vendored folder. One of them is the placeholder.

## A11Y-20 · Pointer targets are 19px to 35px

- Verdict: **partly confirmed**. The sizes are correct. The reference to WCAG needs a correction. Severity: **low**.
- Proof (`$V/v2.mjs 20`): brand `19.4x22.8`, select `104x19` inside a label of `174.2x43`, input `129.5x20` inside a label of `173.3x43`, header links `31.6x31.6`, Approve `155.9x34.5`, Reject `133.8x34.5`, Undo `65.6x26`, view mode `98.8x25`, help `26x26`.
- Correction: "Below 24px (WCAG 2.5.8 AA minimum)" reads as a failure. The criterion has a spacing exception: "Undersized targets … are positioned so that if a 24 CSS pixel diameter circle is centered on the bounding box of each, the circles do not intersect another target" (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). The brand link and the two history fields have no other target inside such a circle, so they most probably pass. The 44px value is WCAG 2.5.5 (AAA) and platform guidance. It is not an AA requirement.

## A11Y-21 · The color scheme follows the system only, and the image stage has no backdrop control

- Verdict: **confirmed**. The value of a theme control is a judgment. Severity: **low**.
- Proof: `components/ariakit/styles/ui.css:75-82` is the only scheme switch. No `@custom-variant dark` exists. `rg -i "data-theme|setTheme|prefers-color|dark:" apps/web/src` has no match in app code. `components/screenshot-viewer.tsx:134` draws the checkerboard from `currentColor` at 6%. The screenshots `fixture-review-768-light.png` and `run-1440-dark.png` show captures with almost no visible edge.
- I compiled the proposed `@custom-variant dark` with the installed Tailwind 4.3.3 (`$V/tw-variant.mjs`). It compiles and emits both rules:

  ```css
  :root:where([data-theme="dark"], [data-theme="dark"] *) {
    --color-canvas: …;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"], [data-theme="light"] *)) {
      --color-canvas: …;
    }
  }
  ```

- Two details for the recommendation:
  - `@ariakit/tailwind` sets `:root { color-scheme: light dark; }` (`node_modules/@ariakit/tailwind/src/output.css:67`). With a manual theme, the root scrollbar still follows the operating system unless the theme also sets `color-scheme` on `:root`. The plugin output has no other `prefers-color-scheme` rule and no `light-dark()`, so the layers follow the canvas.
  - `ui.css` is a vendored file. The variant can go in `review.css`, so that the vendored copy does not change.

## A11Y-22 · Semantics: unnamed focus targets, one heading on the review page, heading jumps, `title` as the only tooltip

- Verdict: **confirmed**. Severity: **low**.
- Proof (`$V/v2.mjs 18`): `"headings":["H1 Success dialog"]`; `"labelledGenerics":["div tabindex=0 \"Review workspace\"", "div tabindex=0 \"Reference. Use pan controls…\"", "div tabindex=0 \"New image. Use pan controls…\""]`; `"groups":["Search and filter screenshots","Image view","Image zoom","(no name)"]`. `components/operations-attention/index.tsx:318` is an `h1` and line 407 is an `h3`. `routes/index.tsx:405` is `<Text render={<time />}>` with no `dateTime`.
- Detail: the DOM has two more `h1` elements ("Review with the keyboard", "Screenshots"). They are inside closed dialogs with `display: none`, so they do not count.
- The fixture has 37 `title` attributes. The report's number 13 is for the preview run page, which has two variants.
- `Tooltip` is not in the vendored copy. It must be copied from upstream (`ariakit-ui/src/components/tooltip.ariakit.react.tsx`).

## A11Y-23 · Three vocabularies for the same controls, and the review guide does not match the UI

- Verdict: **partly confirmed**. All quotes are correct. One summary sentence is wrong. Severity: **low**.
- Proof: every cited line exists: buttons (`review-workspace.tsx:845, 860, 874, 888`), captions (`screenshot-viewer.tsx:37-38`), labels (`:218, :229, :245`), pan labels (`:120-121`), help text (`:175`), guide (`docs/review-guide.md:15, 31-34, 69-80, 88, 92`).
- Correction: "One unit has four names (view, variant, screenshot, item)" joins two concepts. The item has two names ("Screenshots", "Previous screenshot" and "items", "Review items"). The variant has two names ("Reject view", "changed views" and "Variants", "variant approved"). The dashboard also says "views" (`routes/index.tsx:454, 502`).
- Addition for the "Recompare stored run" point: the API sends `recompareAllowed: false` for every run (`apps/web/src/api/review.ts:592`) and always sends a reason (lines 593-598). So in production the footer shows a disabled button and a sentence on every run page. See "Missed".

## A11Y-24 · Shortcuts read `event.key`, so `[` and letters fail on some keyboard layouts

- Verdict: **partly confirmed**. The code reading is correct and the synthetic events repeat. No real layout was tested. The recommendation needs a correction. Severity: **low**.
- Proof: `review-workspace.tsx:398-399`. `$V/v2.mjs 24` with a wait after each event: `[` with `altKey` and `ctrlKey` leaves the sidebar open; `[` with `altKey` leaves it open; `key: "ф", code: "KeyA"` gives `"calls":0`; plain `[` closes the sidebar; `key: "a"` gives `"calls":1`.
- Correction: "Match letters on `event.code`" moves the problem. `event.code` is the physical position. On AZERTY the key with the letter A has the code `KeyQ`, and Dvorak moves most letters. Then the hints on the buttons are wrong for those users. A safer rule uses the character when it is a Latin letter and uses the position only as a fallback:

  ```ts
  const letter = /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : event.key;
  ```

  The report's alternative ("Accept both") is close to this. The proposal to replace `[` with a key that needs no modifier is sound.

## A11Y-25 · Reduced motion is respected for large motion; small transitions remain

- Verdict: **confirmed**. Severity: **low**.
- Proof (`$V/v2.mjs 25`): no preference: `control|scale|100` ×34, `glider|…|100` ×2, three shell entries at 300ms. Reduce: the shell entries are gone; `control|scale|100` ×34 and `glider|…|100` ×2 remain. Code: `styles/shell.ts:27` (`motion-reduce:[--shell-motion:0]`), `styles/popover.ts:34`, `styles/glider.ts:150-153` (no reduced-motion rule), `styles/ui.css:37` (`--duration-overshoot: 500ms`).

## A11Y-26 · Dashboard status color and icon do not follow the status

- Verdict: **partly confirmed**. The icon and the grammar points are confirmed. The gray badge exists only with preview data. Severity: **low**.
- Proof of the confirmed parts:
  - `routes/index.tsx:580-582` uses `Clock3Icon` for every row of `RunGroup`. With mock data, the rows "Run failed" and "New capture needed" have `icon=lucide lucide-clock-3` (`$V/v2.mjs 13`, `$V/screens/v-dash-queue-dark.png`).
  - `routes/index.tsx:502`: a run with `pending: 1` renders "1 view await approval."
- Correction for the gray "Needs review" badge: the production dashboard cannot return the state `reviewing`.
  - `apps/web/src/api/dashboard.ts:125` sets `state: summary.status`.
  - `packages/service/src/review-status.ts:50-58` limits the status to `superseded | failed | incomplete | needs-recompare | comparing | passed | rejected | needs-review`.
  - Only `review/preview-fixtures.ts:84` sends `state: "reviewing"`. The auditor's mock data used the same value.
  - So the gray badge shows on the public preview (the first thing a visitor sees) and not in production. The `reviewing` branch in `stateLabel` (line 132) is preview-only code. The fix can be one line in the preview fixture.
- Second correction: `superseded` cannot be in the "Needs attention" group in production. The actionable query needs `active=1` and excludes the states `failed` and `superseded` (`dashboard.ts:70-71`). `failed` can still appear through a dead comparison task (`review-status.ts:81`). The list filter at `routes/index.tsx:419-421` has a branch that production does not use.

---

## Verification screenshots

All paths are under `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-a11y/verify/screens/`.

- `v-focus-nav-link-dark.png`, `v-focus-nav-link-light.png`: header link with focus; the ring shows on one edge (A11Y-08).
- `v-focus-history-search-dark.png`, `v-blur-history-search-dark.png`, `v-focus-history-search-light.png`, `v-blur-history-search-light.png`: history search with and without focus (A11Y-09).
- `v-variant-strip-mixed-dark.png`, `v-variant-strip-mixed-light.png`: pill 1 selected, pill 2 approved, pill 3 rejected (A11Y-10, A11Y-11).
- `v-variant-strip-forced-colors.png`: forced colors; all pills have the same border (A11Y-10).
- `v-variant-strip-production-labels-1440-dark.png`: 12 variants with production label parts; 2 fit at 1440px (A11Y-12).
- `v-dash-queue-dark.png`, `v-dash-queue-light.png`: mocked queue with every production status and `reviewing` (A11Y-13, A11Y-26).
- `v-dash-guest-light.png`: gray "Sign in with GitHub" (A11Y-13).
- `v-review-complete-1440-dark.png`: all variants approved (A11Y-17).
- `v-font20-1200.png`: default font 20px, window 1200px; no list and no button (A11Y-03).
- `v-400pct-of-1280x1024-run.png`, `v-200pct-of-1440x900-run.png`: zoom equivalents (A11Y-14).
- `v-run-390-light.png`: preview run on a phone viewport (A11Y-15).
- `v-selected-pill-after-auto-advance-1440.png`, `v-selected-pill-after-shortcut-1440.png`, `v-selected-pill-after-shortcut-1024.png`: the selected pill is outside the visible strip (Missed 1).
- `v-disabled-actions-dark.png`, `v-disabled-actions-light.png`: disabled Approve with the full brand fill (Missed 3).
- `v-footer-production-like.png`: footer with the production value `recompareAllowed: false` (Missed 4).

## Missed

Each item is in the scope of this lane. Each has a measurement or a file reference. None is a full finding.

1. **The selected variant leaves the visible strip, and its name is shown nowhere else.** After four approvals at 1440px the fifth variant is selected, the strip has `scrollLeft: 0`, and the selected pill is at x 1486 to 1787 while the strip ends at 1408 (`$V/v5.json`, `v-selected-pill-after-auto-advance-1440.png`). Keys `1`-`6` and `←` / `→` do the same. Only `followVariantLink` scrolls (`review-workspace.tsx:119`). The reviewer approves images with no visible variant name. With production labels this starts at the third variant.
2. **A focused action button loses focus to `<body>` at each variant change.** Approve and Reject are `disabled` while the next images load (`review-workspace.tsx:1064-1070, 1082-1088`). Measured: 2 frames disabled, then `document.activeElement` is `BODY` (`$V/v3.json`). This also blocks the fix that A11Y-02 recommends.
3. **A disabled primary button looks enabled.** On the preview run page Approve is `disabled` and keeps the brand fill `oklch(0.515341 0.1546 248.516)`. Only the label alpha changes from 1 to 0.73 (`$V/v4.json`, `v-disabled-actions-light.png`). Reject and Undo fade correctly.
4. **Every production run page shows a disabled "Recompare stored run" button and a 16px sentence in the footer.** The API always sends `recompareAllowed: false` and a reason (`apps/web/src/api/review.ts:592-598`). The guide calls the control retired (`docs/review-guide.md:88`). The "Recompare now" button (`review-workspace.tsx:979-989`) can never render in production. Production-like footer: `v-footer-production-like.png`.
5. **Production variant pills state every fact two times.** Icons with words for framework, browser, and scheme, then the variant key that joins the same values, cut at 192px (`review/variant-summary.tsx:84-122`; key format in `ariakit/app/src/test-utils/visual.ts:477-487`). Pills are 375 to 413px wide (`$V/v2-10.json`).
6. **After an item is fully approved, the list shows no selected row.** The item moves into the collapsed "Accepted" group. The auditor's `state-review-complete-1440-dark.png` shows the selected item "Open menu" in the stage and only "New item" in the list.
7. **Contract and code differ on the variant glider.** `docs/current-contract.md:192` says variants use "navigation links with a bar glider". The code uses a flat glider with a border (`review-workspace.tsx:719-727`).
8. **The guide promises a full variant label that the page does not show.** `docs/review-guide.md:23`: "The full variant label and result appear above the image controls." The full label is only in `title`, in `aria-label`, and in the closed Details panel.
9. **The `reviewing` state and the `superseded` queue branch are dead in production.** `routes/index.tsx:132` and `:419-421` handle values that `packages/service/src/review-status.ts:50-58` and `apps/web/src/api/dashboard.ts:70-71` cannot produce. Only the preview fixture reaches them.
10. **Sticky bars and focus were not checked against WCAG 2.4.11 (Focus Not Obscured).** At 320×256 the sticky bars cover 185 of 256px (`$V/v3.json`). Neither the auditor nor I measured whether a focused control can sit under a bar.
