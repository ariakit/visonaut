# Review workspace chrome: list, filters, header, metadata, variant chips, details, decision bar, and states

Lane: `ui-workspace`. Finding prefix: `WORK`. This audit is read-only. No repository file was changed.

Scope: `apps/web/src/review/review-workspace.tsx`, `item-list.tsx`, `screenshot-filter.tsx`, `variant-summary.tsx`, `review-status.tsx`, `use-review-session.ts`, `navigation.ts`, `sidebar-preference.ts`, `model.ts`, and `apps/web/src/review.css`. The screenshot viewer (`components/screenshot-viewer.tsx`) belongs to another lane. I cite it only where the chrome around it depends on it.

Evidence sources: the fixture harness on port 4311, the preview route on port 4310, and the source. All paths below are relative to `apps/web/src` unless they start with `/` or `docs/`. Scratch scripts and screenshots are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-workspace/`.

Skills loaded: `ariakit-general-workflow`, `ariakit-general-markdown`. Read as reference: `ariakit-ariakit-tailwind`, `ariakit-ariakit-ui-styles`.

## How it works (map)

### Files

| File                           | Lines | Role                                                                                                                                                                                                                              |
| ------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review/review-workspace.tsx`  | 1299  | One component (`ReviewSession`, lines 195-1299) that renders the whole page: shell, both sidebars, header rows, banners, variant chips, view controls, decision bar, footer, and four dialogs. It also owns the keyboard handler. |
| `review/item-list.tsx`         | 403   | Sidebar list. Owns search and filter state. Splits items into "attention" and "accepted" groups. Two virtual lists.                                                                                                               |
| `review/screenshot-filter.tsx` | 177   | One control that joins a status tag and a search field. Built from `Tag*` and `Combobox*` parts of `@ariakit/react-components`.                                                                                                   |
| `review/variant-summary.tsx`   | 137   | Content of one variant chip: brand icons, labels, key text, index number.                                                                                                                                                         |
| `review/review-status.tsx`     | 39    | Verdict `Badge` (color and icon from `kind` and `verdict`).                                                                                                                                                                       |
| `review/use-review-session.ts` | 568   | Optimistic model, save queue, Undo, refresh, recompare, comparison polling.                                                                                                                                                       |
| `review/navigation.ts`         | 179   | Pure helpers: `needsReview`, `partitionItems`, `reviewTargets`, `nextPending`, `verdictLabel`, `applySavedReview`.                                                                                                                |
| `review/sidebar-preference.ts` | 9     | Storage key and an inline head script for the sidebar preference.                                                                                                                                                                 |
| `review/model.ts`              | 187   | Types.                                                                                                                                                                                                                            |
| `review.css`                   | 2     | Only `@import "tailwindcss"` and the vendored `ui.css`. The many `review-*` class names in the TSX files have no CSS rules. They are test and script hooks only.                                                                  |

### Layout tree (`review/review-workspace.tsx`)

1. `Shell` root, `tabIndex={0}`, `aria-label="Review workspace"` (528-534).
2. `AppHeader` (535, defined in `components/app-shell.tsx:21-71`). Sticky. 48 px.
3. Left `ShellSidebar` (536-561): header "Screenshots" plus "N items" (547-554), then `ItemList` when the viewport is not narrow (559).
4. `ShellMain` (562):
   - `ShellMainHeader` (563-608). Sticky. 48 px. Sidebar toggle, "Queue" link, run title, "P of T need review", native `<progress>`.
   - `ShellMainIntro` (609-622). 26 px. Commit, attempt, baseline revision, run status.
   - `ShellMainBody` (623): the narrow-only "Screenshots" button (625-632), the heading row (633-688) with item name, `ReviewStatus` badge, changed pixels, previous, next, and "Details"; four possible banners (689-710); the variant chips `Nav` (712-782).
   - `Frame.review-result` (787-1004): protected-decision note (799-804), closed summary (805-814), view and zoom controls (817-923), "Pixel diff requires..." note (924-930), loading and error strips (940-991), `ScreenshotViewer` (992-1000).
   - Empty state (1007-1016).
   - Sticky decision bar (1017-1139): Undo, "All N changed views...", "Reject view", "Approve & next", then a save-state row (1099-1137).
5. Right `ShellSidebar` "Capture details" (1142-1171). Content is `captureDetails` (460-524).
6. `ShellFooter` (1172-1205). Not sticky. Keyboard help, "Shortcuts on/off", "Recompare stored run", and the screen-reader live region.
7. Dialogs: items on narrow screens (1206-1222), details on narrow screens (1223-1241), whole-item confirmation (1242-1296), keyboard help (149-187).

### State

`ReviewSession` holds 12 `useState` values (196-213): selection, view mode, zoom, shortcuts on or off, image retry counter, announcement, sidebar open, details open, items dialog open, batch scope, filtered order, narrow viewport. `useReviewSession` adds 7 more (`use-review-session.ts:121-127`). `ItemList` holds the search text, the status filter, and the "Accepted" open state (`item-list.tsx:89-107`). The filtered order goes up to the workspace through `onOrderChange` (`item-list.tsx:102-104`), so the workspace arrows follow the filter.

Two different tests decide the narrow layout. The sidebars use a CSS container query on the shell (`$show="5xl"`, 538 and 1147). The dialogs use a JavaScript media query on the viewport (`window.matchMedia("(max-width: 1023px)")`, 211-225).

### Sequence: one approval with the `A` key

1. `keydown` reaches the `document` listener (443-448). `onKeyDown` (395-442) returns early when the event was prevented, repeats, shortcuts are off, `excludesShortcuts` matches (88-97), or Alt is down.
2. `review("approved")` (385-389) returns without feedback when `ready` is false (302-307) or `reviewBlocked` is true.
3. `session.review` (`use-review-session.ts:402-442`) builds a command with target IDs and expected revisions, then calls `save`.
4. `save` (279-401) adds the command to the queue and starts `commands.save` for it at once (286-305). It sets `pendingReviews`, so the model shows the verdict optimistically (133-136).
5. `save` calls `nextPending` on the full model (313) and then `onSelect(next)` (315) and `onFocus()` (317). `nextPending` (`navigation.ts:144-163`) walks all items in model order and wraps once. It does not know about the search or the filter.
6. In the real route, `select` (249-252) calls `route.onSelect`, which calls `navigate({ search, replace: true })` (`routes/runs.$runId.tsx:118-132`). The loader does not run again because `loaderDeps` uses only `comparison` (`runs.$runId.tsx:34`).
7. `useEvidence` resets for the new variant (`use-evidence.ts:43-45`). `ready` stays false until the reference and candidate images decode. The decision buttons are disabled and a "Loading this comparison's images..." strip appears above the panes (940-949).
8. Network, counted from `review/client.ts:305-338`, not measured: the first decision sends `POST /api/review-sessions`. Each decision sends `POST /api/comparisons/:id/commands` with `queued: true`. While the answer says `queued`, the client waits 500 ms and reads `GET /api/commands/:id/queued` again. So each decision costs at least 2 requests and at least 500 ms before confirmation. Admission is serialized through one promise chain (307-323).
9. On the result, `applySavedReview` (`navigation.ts:85-142`) writes the confirmed revision. The command goes on the Undo history (354-357). The bar shows "1 variant approved. Saved." (360-365).

### Measured chrome budget (fixture, offsets normalized to the workspace top)

At 1440 x 900, the first screenshot pixel is at y = 408.

| Row                                         | y range | Height | Owner     |
| ------------------------------------------- | ------- | ------ | --------- |
| App header                                  | 0-48    | 48     | app shell |
| Main header: toggle, Queue, title, progress | 48-96   | 48     | this lane |
| Metadata strip                              | 96-122  | 26     | this lane |
| Body padding                                | 122-154 | 32     | this lane |
| Heading block: name, badge, changed pixels  | 154-213 | 59     | this lane |
| Gap                                         | 213-233 | 20     | this lane |
| Variant chips                               | 233-271 | 38     | this lane |
| Gap                                         | 271-286 | 15     | this lane |
| View and zoom controls                      | 286-341 | 55     | this lane |
| Pane label "Baseline 600 x 400"             | 342-390 | 48     | viewer    |
| Viewport padding                            | 390-408 | 18     | viewer    |
| Decision bar (sticky bottom)                |         | 61     | this lane |

| Viewport          | Chrome above first image pixel | Share of viewport height | Image visible without scroll | Decision bar |
| ----------------- | ------------------------------ | ------------------------ | ---------------------------- | ------------ |
| 1920 x 1080       | 408 px                         | 37.8%                    | 400 of 400 px                | 61 px        |
| 1440 x 900        | 408 px                         | 45.3%                    | 370 of 370 px                | 61 px        |
| 1280 x 720        | 408 px                         | 56.7%                    | 229 of 317 px                | 61 px        |
| 1024 x 768        | 402 px                         | 52.3%                    | 231 of 231 px                | 61 px        |
| 390 x 844 (touch) | 518 px                         | 61.4%                    | 213 of 235 px                | 91 px        |

On the preview route (port 4310) the read-only banner adds 41 px: 449 px at 1440 x 900 (49.9%) and 579 px at 390 x 844 (68.6%).

## Findings

### WORK-01 · Keyboard shortcuts stop after a mouse click on a variant chip

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:88-97`. The exclusion selector ends with `.review-variants`: `'input, textarea, select, ... [role="tablist"], .review-variants, [data-screenshot-search]'`. Measured in the fixture (`probe-interaction.mjs`): `shortcut scope: after clicking variant chip 2, focus on chip=true; pressing A saved 0 command(s)`, `pressing D with focus on chip left viewer mode = side`, `pressing ArrowDown with focus on chip left heading = Success dialog`. Measured on the real route (port 4310): after a click on chip 2, `{"focusInVariants":true}`, then `D` left `data-mode` at `"side"`. After a click on the `h1`, `D` changed it to `"diff"`. Screenshot `screens/62-chip-focused-shortcuts-ignored-dark-1440.png`.
- What happens: A click on a chip leaves focus on the chip link. All page shortcuts are then ignored: `A`, `X`, `S`, `D`, `F`, `G`, `1` to `6`, Up, and Down. Only Left, Right, Home, and End work, through `followVariantLink` (99-121). There is no message. `docs/review-guide.md:67` and `:84` list only text fields, editable content, menus, and dialogs as exclusions.
- Impact: The most natural mixed flow fails silently: click a variant, look, press `A`. The reviewer must click somewhere else first. A click on a sidebar row does not have this problem (measured: `A` saved 1 command).
- Recommendation: Remove `.review-variants` from the selector. `followVariantLink` already calls `preventDefault` for the arrow keys, and the document handler already returns on `event.defaultPrevented` (396). So the arrows do not run twice.

  ```ts
  // review-workspace.tsx:94-96
  return !!element.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"], [data-screenshot-search]',
  );
  ```

- Alternatives: (a) Minimal: after a chip click, call `focusWorkspace()` so focus returns to the root. (b) Make the chips a roving-tabindex composite (one Tab stop) and keep the page shortcuts active inside it. This also helps WORK-29. (c) Replace chips with a control that does not take focus on click (see Redesign ideas, variant switcher).
- Maintainer decision needed: no.

### WORK-02 · The selected variant chip scrolls out of view, and nothing else on screen names the selected variant

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:369-375` (`selectVariant` only updates the selection) and `:729` (`className="review-variants max-w-full mb-4"`, computed `overflow-x: auto`). Only `followVariantLink` calls `scrollIntoView` (119). Measured (`probe-variants.mjs`): `navScrollWidth 2079`, `navClientWidth 1120`, 7 chips of 265 to 307 px. After Right x4: `selectedLeft 1486, navRight 1408, selectedFullyVisible false, navScrollLeft 0`. Measured (`probe-flow.mjs`) with six `A` presses: chips 4, 5, 6, and 7 report `fullyVisible false`, `scrollLeft 0`. Screenshots `screens/64-after-six-approvals-selected-chip-hidden-dark-1440.png` and `screens/25b-variant-7-selected-offscreen-dark-1440.png`.
- What happens: The strip holds about 3.7 chips at 1440 px wide and 1.2 chips at 390 px. When the page shortcut or "Approve & next" selects a later variant, the strip does not scroll. The screen shows four chips and none is selected. The heading shows only the item name. `docs/review-guide.md:23` says "The full variant label and result appear above the image controls", but the label exists only in the chip, its `title`, and the Details panel.
- Impact: After the third approval in an item with seven variants, the reviewer cannot see which variant is on screen. This is the normal path of the main flow. Wrong approvals are possible because the two panes look alike across variants.
- Recommendation: Scroll the selected chip into view when the selection changes, and print the selected variant label next to the item name.

  ```tsx
  useEffect(() => {
    document.getElementById(variant.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [variant.id]);
  ```

- Alternatives: (a) Minimal: the effect above. (b) Remove the horizontal strip. Use a switcher that always fits (icon-only segmented tabs, a select with "3 / 7", or a matrix). (c) Show all variants of an item at once (layout F in Redesign ideas).
- Maintainer decision needed: no for the scroll fix. Yes for the switcher form: which variant switcher should replace the chip strip?

### WORK-03 · "Approve & next" moves 20 px after the first decision, and a second click at the same pointer position misses

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:1099-1137`. The save-state row is added inside the sticky bar (`<div className="basis-full px-1.5">`) when `saveState.message` is not empty. Measured (`probe-button-shift.mjs`) at three viewports: `1440x900: approve button y before=854-888, after first approval=834-868, shift=-20px; element at the original pointer position={"tag":"DIV",...,"isApprove":false}; second click at same position saved 0 command(s)`. The same result at 1280 x 720 and 390 x 844. `probe-layout-shift.mjs`: bar height 61 px, then 81 px after one saved decision, then 97 px after a failed save.
- What happens: The first approval adds the line "1 variant approved. Saved." below the buttons. The bar is anchored to the bottom, so the buttons move up by 20 px. The button is 34 px high. A pointer in the lower 20 px of the button (59% of its height) is no longer over the button.
- Impact: A mouse reviewer who clicks "Approve & next" two times without moving the pointer saves only one decision. The second click hits nothing and gives no feedback. The message row stays, so the shift happens once per page load, at the worst moment. Error messages make the bar 97 px high and move the buttons again.
- Recommendation: Give the bar a fixed height. Move transient messages out of the layout (a toast, or an inline status slot that always reserves its space on the same row as Undo).
- Alternatives: (a) Minimal: reserve the message row at all times (`min-h`), at a cost of 20 px. (b) Put the status text between the left and right groups on the same row and truncate it. (c) A floating toast region above the bar that does not push content.
- Maintainer decision needed: no.

### WORK-04 · Variant chips do not show the verdict

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence: `review/variant-summary.tsx:88-136` renders icons, labels, the key text, and the index. It never reads `variant.verdict` or `variant.kind`. The verdict is only in `title` and `aria-label` (`review-workspace.tsx:747`, `:776`). Screenshot crop `screens/crop-variants-after-approve-dark.png`: chip 1 is approved and looks the same as chips 3 and 4. Screenshot `screens/32-saving-queued-three-dark-1440.png`: two approved, one rejected, no mark on any chip.
- What happens: The page shows the verdict of the selected variant only (the badge next to the item name). The other variants of the item show no state. Error and pending variants also have no mark on the chip.
- Impact: The reviewer cannot answer "what is left in this item?" without a visit to each chip. The sidebar row gives only a count. A rejected or failed variant is easy to miss.
- Recommendation: Put a verdict mark on each chip: a small status dot or icon (pending, approved, rejected, automatic, error, comparing), with the same colors as `ReviewStatus`.

  ```tsx
  <ButtonSlot $size="xs" aria-hidden>
    <VerdictIcon variant={variant} /> {/* Check, X, Circle, CircleAlert, Clock3 */}
  </ButtonSlot>
  ```

- Alternatives: (a) Minimal: a colored dot before the index number. (b) Replace the index number with the verdict icon and show the number only as a `Kbd` hint on hover. (c) Group chips into "To review" and "Done" segments.
- Maintainer decision needed: no.

### WORK-05 · 408 px of chrome sits above the first screenshot pixel (45% of a 1440 x 900 viewport, 57% at 1280 x 720, 61% on a phone)

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: L
- Evidence: `measure-chrome.mjs`, table in "How it works". Rows: `review-workspace.tsx:535` (app header), `:563-608` (main header), `:609-622` (metadata), `:633-688` (heading), `:712-782` (chips), `:817-923` (view controls), then the viewer pane label. At 1280 x 720: `imageHeight 317, imageVisibleHeight 229, imageFullyVisibleWithoutScroll false`. Screenshot `screens/71-default-dark-1280.png` (the image is cut at the fold under the decision bar).
- What happens: Seven stacked rows come before the image: app header, run header, metadata strip, heading block, chips, view controls, pane label. The decision bar takes 61 px more at the bottom. At 1440 x 900 the image area between the chrome and the bar is 431 px (48%). At 1280 x 720 "Fit" does not fit: 88 px of a 317 px image are below the bar.
- Impact: The product exists to compare pixels, and less than half of the screen shows pixels. On a 13-inch laptop the reviewer must scroll the page for each variant to see the bottom of a small screenshot. This matches the maintainer's "bloated" complaint.
- Recommendation: Collapse the rows into one top bar and one bottom dock. Target 44 to 48 px above and 48 to 56 px below. See layouts A, B, and C in Redesign ideas. Size the image area from the remaining height (`flex-1 min-h-0`), not from `min(56vh, 650px)`.
- Alternatives: (a) Minimal: remove the metadata strip (move it to Details), merge the heading into the main header, and put the chips and view controls on one row. This saves about 150 px with no new patterns. (b) Auto-hide: the heading and metadata scroll away and only one sticky row stays. (c) A "focus mode" toggle that hides everything except the image and a floating decision pill.
- Maintainer decision needed: yes. Which layout direction should the design lab build first?

### WORK-06 · A disabled "Approve & next" keeps its brand fill and looks enabled

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:1080-1097` (`$layer="brand"` with `disabled`). Vendored recipe `components/ariakit/styles/control.ts:69-77`: the disabled classes are `bg-none! ak-ink-0! *:ak-ink-0!`. `bg-none` removes the background image, not the background color. Measured (`probe-styles.mjs`), dark and light: enabled `background oklch(0.515341 0.1546 248.516), color oklch(1 0 0)`. Disabled (archived run) `disabled true, background oklch(0.515341 0.1546 248.516), color oklch(1 0 0 / 0.733357)`. Screenshots `screens/29-read-only-archived-dark-1440.png`, `screens/36-offline-error-dark-1440.png`, `screens/43-error-variant-dark-1440.png`, `screens/58-empty-run-dark-1440.png`.
- What happens: In every blocked state (read-only run, save error, loading images, comparison error, empty run) "Reject view" dims, but "Approve & next" stays bright blue. Only the label alpha changes from 1 to 0.73.
- Impact: The primary action invites a click or a key press that does nothing. Together with WORK-08 the page gives no signal that input is ignored.
- Recommendation: Do not paint the brand layer while disabled.

  ```tsx
  <Button $layer={approveDisabled ? undefined : "brand"} $border={approveDisabled} disabled={approveDisabled}>
  ```

- Alternatives: (a) Minimal: the conditional prop above. (b) Add `ui-disabled:ak-layer-mix-20` (or similar) for layered buttons in the vendored recipe and report it upstream. (c) Hide the decision buttons in states where review is impossible (see WORK-16).
- Maintainer decision needed: yes. Is the unchanged fill for disabled layered buttons intended upstream in Ariakit UI, or should the recipe change?

### WORK-07 · The viewer jumps 41 px down and back up each time images load

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:940-949`. The loading strip is a normal block before `<ScreenshotViewer>`. Measured (`probe-layout-shift.mjs`): `ready: viewerTop 342`, `loading next variant: viewerTop 383`, `ready again: viewerTop 342`. Screenshot `screens/67-keys-ignored-while-images-load-dark-1440.png` (pane label at y = 407) against `screens/64-...png` (y = 366).
- What happens: When the selection changes and an image is not decoded yet, the text "Loading this comparison's images..." takes a 41 px row. Both panes move down. When the images are ready the row goes away and the panes move up.
- Impact: In a 50-approval session the image position flickers up to 50 times. The eye must find the comparison area again each time. The same strip position is used for errors, so an error also moves the image.
- Recommendation: Show loading state inside the pane (the viewer already prints "Loading image..." in the empty pane) or as an overlay. Do not add a row.
- Alternatives: (a) Minimal: position the strip absolutely over the top of the panes. (b) Keep the previous images dimmed until the new ones decode. (c) A thin indeterminate `Progress` line on the top edge of the canvas.
- Maintainer decision needed: no.

### WORK-08 · Key presses during image load are dropped without feedback, and the next images are not preloaded

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: `review/review-workspace.tsx:385-389`: `if (!ready) return;`. `review/use-evidence.ts:43-45` resets image state on each selection. No preload exists: `rg -n "preload|prefetch|new Image|fetchPriority" review components/screenshot-viewer.tsx routes` finds only `loading="lazy"` on thumbnails (`item-list.tsx:237`). Measured (`probe-dropped-key.mjs`) with a held candidate image: `after first A: {"calls":1,"evidence":"loading","approveDisabled":true,"announcement":""}`, `after A, A, X while the candidate image loads: {"calls":1,...,"announcement":"","saveState":"1 variant approved. Saved."}`, `after images load: {"calls":1}`.
- What happens: `docs/review-guide.md:41` explains the rule: actions wait for the images of the current selection. That rule is sound. But a key press in the waiting window is discarded, with no announcement and no visible change. The bar still says "1 variant approved. Saved." and "Approve & next" still looks enabled (WORK-06). Each new selection starts 2 image requests (3 in diff mode) and none starts early.
- Impact: The speed of a 50-approval session is set by image latency. Fast reviewers lose key presses and may think a variant was approved. On a slow connection every step has a dead time that preloading would remove.
- Recommendation: Preload the evidence of the next pending variant as soon as the current one is ready. Show a clear "loading" state on the decision bar while input is blocked.

  ```ts
  const next = nextPending(model.items, selection);
  useEffect(() => {
    for (const image of [nextVariant?.reference, nextVariant?.candidate]) {
      if (image) new Image().src = image.url;
    }
  }, [nextVariant?.id]);
  ```

- Alternatives: (a) Minimal: announce "Images are loading" when a decision key is ignored, and fix WORK-06. (b) Preload one step ahead (above). (c) Preload N ahead with `<link rel="preload" as="image">` and a small concurrency limit. (d) Buffer one key press and apply it when the images become ready. This option weakens the "decide only on visible pixels" rule and needs a decision.
- Maintainer decision needed: yes. Is one-step preloading acceptable for R2 and Worker cost?

### WORK-09 · Warning and alert banners have no visual treatment

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:690`, `:695`, `:701`, `:706`: `className="text-sm p-3 ak-layer-warning"`. The base utility `ak-layer` is missing. The vendored `Layer` maps `warning` to `"ak-layer ak-layer-warning"` (`components/ariakit/components/layer.ariakit.react.tsx:92`), and the `@ariakit/tailwind` readme always pairs them (`/Users/diegohaz/Developer/ariakit/packages/ariakit-tailwind/readme.md:224`). Measured (`probe-interaction.mjs`): both banners report `"background":"rgba(0, 0, 0, 0)"`, `"border":"0px"`, `"radius":"0px"`. Screenshots `screens/29-read-only-archived-dark-1440.png`, `screens/54-terminal-failed-with-error-dark-1440.png`, `screens/55-not-ready-dark-1440.png`, `screens/56-recompare-pending-dark-1440.png`.
- What happens: The run error (`role="alert"`), the read-only notice, the "Review is unavailable until..." notice, and the "A new comparison is being prepared..." notice render as plain body text between the heading and the chips. Each one also pushes the viewer down by 41 px.
- Impact: The most important state of the page (this run cannot be reviewed, or it failed) looks like a caption. A reviewer can miss it and press keys that do nothing.
- Recommendation: Use the `Layer` or `Frame` primitive, with an icon, and put the notice in a fixed place (for example the status slot of the top bar).

  ```tsx
  <Frame
    $layer="warning"
    $rounded="lg"
    $p={3}
    role="status"
    className="flex items-center gap-2 text-sm"
  >
    <LockIcon aria-hidden /> {model.readOnlyReason}
  </Frame>
  ```

- Alternatives: (a) Minimal: add `ak-layer ak-layer-mix-15 ak-frame-lg` to the four class strings. (b) One `StatusBanner` component with `tone` and `action` props that all four states use. (c) Replace the banners with a state pill in the header ("Read-only", "Comparing", "Failed") and a popover with the long text.
- Maintainer decision needed: no.

### WORK-10 · Save errors, conflicts, and success use the same small gray text

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:1104-1114`: one `div` with `text-xs ak-ink-60` for every status. Only the ARIA role changes. Messages come from `use-review-session.ts:272-277` ("Conflict. ..." and "Not saved. ..."), `:364`, `:386`. Screenshots `screens/35-conflict-dark-1440.png`, `screens/36-offline-error-dark-1440.png`, `screens/38-queued-unconfirmed-dark-1440.png`, `screens/33-saved-undo-enabled-dark-1440.png`.
- What happens: "Not saved. Connection lost." and "Conflict. The decision changed... Updated by octocat." look the same as "1 variant approved. Saved.": 12 px, 60% ink, bottom left corner. The recovery buttons ("Retry same command", "Refresh current state") have no border or fill and look like bold text.
- Impact: A failed save blocks all later decisions (`saveState.status === "error"` disables every action), but the cause is the least visible text on the page. The unqueued-error case is also the case where a closed tab loses the decision.
- Recommendation: Give errors and conflicts a danger or warning surface, an icon, and bordered action buttons. Keep success quiet.
- Alternatives: (a) Minimal: `ak-text ak-text-danger` plus an icon for error and conflict, and `$border` on the two buttons. (b) A toast or banner that sits above the bar with the retry action. (c) Turn the bar itself into the error state: replace Reject and Approve with "Retry" and "Refresh" until the error is resolved, so the only possible actions are the visible ones.
- Maintainer decision needed: no.

### WORK-11 · A click or a key in the search field opens the status menu, and the menu covers the results

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: `review/screenshot-filter.tsx:102-111`: the search input is rendered as `ak.Combobox`, and its popover (129-173) lists the four status options. Measured (`probe-interaction.mjs`): `filter: popover visible after clicking the search input: true`, `filter: popover visible after typing one character: true`, `popover geometry while typing: {"popover":{"top":168,"bottom":333,"height":165},...,"rowsCovered":3}`. Screenshots `screens/20-search-results-dark-1440.png` (results hidden), `screens/21-search-popover-closed-dark-1440.png` (after Escape), `screens/89-mobile-filter-popover-dark-390.png`. The browser tests press Escape after each `fill` for this reason (`review/__tests__/review.browser.test.ts:1897-1898`, `:1921-1922`).
- What happens: The reviewer types "menu". A 165 px "Review status" menu opens under the field and hides the first three result rows. The options do not relate to the typed text. The reviewer must press Escape to see the results. The status trigger is exposed as `role="option"` inside a `listbox` named "Active review status" with `aria-live="polite"`, and it has `tabindex="-1"`, so Tab does not reach it.
- Impact: Search, the fastest way to reach one item among hundreds, takes an extra key press each time and shows the wrong thing first. The joined control also leaves about 100 px for the search text when the filter is "Needs review" (`screens/18-filter-needs-review-dark-1440.png`).
- Recommendation: Separate the two functions. Use a plain search input, and a status control that shows counts.

  ```tsx
  <Input placeholder="Search screenshots" value={query} onChange={...} />
  <TabList aria-label="Review status">
    <Tab id="pending">To review <Badge>9</Badge></Tab>
    <Tab id="rejected">Rejected <Badge>1</Badge></Tab>
    <Tab id="done">Done <Badge>14</Badge></Tab>
  </TabList>
  ```

- Alternatives: (a) Minimal: keep the control, but open the popover only from the tag button (`showOnClick={false}`, `showOnChange={false}`, `showOnKeyPress={false}` on the combobox). (b) Segmented tabs with counts (above). (c) Token search (`is:pending browser:firefox`). (d) A filter button with a popover of checkboxes for status, framework, browser, and color scheme.
- Maintainer decision needed: yes. Should filters stay status-only, or should they also cover framework, browser, and scheme?

### WORK-12 · "Approve & next" ignores the active search and filter

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/use-review-session.ts:312-316` calls `nextPending(optimisticModel.items, ...)` on the full model. `review/navigation.ts:144-163` has no filter input. The arrow keys use the filtered `order` (`review-workspace.tsx:413-419`). Measured (`probe-flow.mjs`): with the search "Open menu" the list shows one row. After two approvals: `{"heading":"Success dialog","rows":["review-item-menu%2Fopen"],"currentRowVisible":false}`. Screenshot `screens/63-advance-leaves-filtered-list-dark-1440.png`.
- What happens: Up, Down, and the previous and next buttons stay inside the filtered list. The automatic advance after a decision leaves it. The page then shows an item that is not in the list, with no selected row.
- Impact: A reviewer who filters to one area (for example "combobox") to review it as a batch is moved to another area after the last variant of the first item. The filter looks broken.
- Recommendation: Pass the visible order to the session, and pick the next pending variant inside it first.

  ```ts
  nextPending(
    order.map((index) => optimisticModel.items[index]),
    selection,
  );
  ```

- Alternatives: (a) Minimal: as above, and stay in place when the filtered list has no pending variant. (b) Keep the global advance but clear the search with a visible notice. (c) Show "Filter complete. 7 more need review outside this filter" with a button.
- Maintainer decision needed: yes. When the filtered set is done, should the page stay, or leave the filter?

### WORK-13 · Status and counts are shown in up to 11 places, and "need review" appears 6 times above the fold

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: Measured (`probe-interaction.mjs`, default fixture, 1440 x 900): `text volume above the fold: 145 words in 95 text nodes; "need(s) review" occurrences: 6`. Sources: sidebar header "N items" (`review-workspace.tsx:551-553`), each row "P of T need review" (`item-list.tsx:249-257`), row status dot (`:270-274`), "Accepted (N)" (`:378`), header "P of T need review" plus `<progress>` (`review-workspace.tsx:595-605`), run status label (`:620`), verdict badge (`:642`), changed pixels (`:644-649`), "All N changed views..." (`:1055`), chip `title` and `aria-label` (`:747`, `:776`), Details panel (`:463-467`, `:491-495`). Screenshot `screens/10-default-dark-1440.png`.
- What happens: The same two facts (how much is left, and what is the state of this thing) are printed at four levels (run, item, variant, selection) in different words and sizes. The Details panel repeats three of them again, with a different number format ("0.05% changed" in the heading and "120 (0.0500%)" in the panel).
- Impact: The page reads as text-heavy, and no single place is the trusted one. The eye has to scan five regions to answer "am I done?".
- Recommendation: One fact, one place. Run level: one progress element in the top bar ("9 left"). Item level: a compact counter or dot strip in the row. Variant level: the mark on the chip (WORK-04). Selection level: the badge. Remove the run status sentence when it only repeats the progress ("Changes need review").
- Alternatives: (a) Minimal: delete the metadata-strip status text and the first three lines of the Details panel, and shorten rows to "7 left". (b) A segmented progress bar that carries approved, rejected, and pending in one element. (c) Counts only in the filter tabs (WORK-11) and nowhere else.
- Maintainer decision needed: no.

### WORK-14 · The progress bar is full and green on a rejected run, and it starts almost full when most captures are unchanged

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:317-326` (`total` counts every variant, `pending` counts only `needsReview`) and `:599-604` (`value={total - pending}`, class `accent-brand`). `navigation.ts:10-15`: a rejected variant does not need review. The server adds every unchanged capture to the model (`api/review-inventory.ts:95-168`, `outcome: "unchanged"`). Screenshot `screens/47-run-rejected-dark-1440.png`: "0 of 11 need review", a full green bar, and the status "Rejected changes" in 10 px text. Screenshot crop `screens/crop-main-header-meta-dark.png`: the fill is green although the brand color is blue.
- What happens: The bar measures "has any verdict", not "passes". A run with rejections shows 100% green. Unchanged and automatically accepted variants count as done from the start, so a run with 2,000 captures and 12 changes starts at 99.4% (computed from the code, not measured on real data). The native `<progress>` ignores the theme: it renders green in both schemes.
- Impact: The one element that looks like run health tells the reviewer the wrong thing in the two cases that matter: a failed review and a large run.
- Recommendation: Use changed variants as the denominator, and show rejected and error segments in their own colors. Use the upstream `Progress` primitive (not vendored yet).

  ```tsx
  <Progress value={approved / changed} fill={{ $layer: rejected ? "danger" : "success" }} aria-label="Review progress" />
  <Text>{pending ? `${pending} left` : rejected ? `${rejected} rejected` : "All approved"}</Text>
  ```

- Alternatives: (a) Minimal: change the denominator to `reviewTargets` and color the bar by run status. (b) A three-segment bar (approved, rejected, pending). (c) Drop the bar. Show a status pill with a count.
- Maintainer decision needed: no.

### WORK-15 · There is no visible "review complete" state

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/use-review-session.ts:366-368`: `onAnnounce("Review complete. No variants need review.")`. The announcement renders only in `<p className="sr-only" role="status">` (`review-workspace.tsx:1202-1204`). `navigation.ts:144-163` returns `null` when nothing is pending, and the selection stays (`docs/review-guide.md:45`). Screenshots `screens/45-run-passed-dark-1440.png` and `screens/46-run-passed-light-1440.png`: the only visible signs are "0 of 11 need review" and "Check passed" in 10 px text at 50% opacity.
- What happens: After the last approval the page looks the same as before. The last item stays selected with the same buttons. No link leads to the queue or to the next run.
- Impact: The end of the task, the moment the reviewer wants to hear about, is silent. The reviewer must read small text to know that the GitHub check passed.
- Recommendation: Show a completion state in the main area or the bar: verdict summary, check state, and the next action.

  ```tsx
  <Frame $layer="success" $rounded="xl" $p={4} role="status">
    <Text render={<h2 />}>Review complete</Text>
    <Text>9 approved. The visual check passed.</Text>
    <Button render={<Link to="/" />}>Back to queue</Button>
  </Frame>
  ```

- Alternatives: (a) Minimal: copy the announcement into the visible save-state row and make the run status a colored badge. (b) Replace the decision bar with a "Done" bar (summary, Undo, Back to queue, Next run). (c) Navigate to the next run in the queue after a short delay with an Undo option.
- Maintainer decision needed: yes. After the last decision, should the page stay, offer the next run, or return to the queue?

### WORK-16 · The decision bar renders in states with nothing to decide, and it floats in the middle of the page

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:1017-1139`: the bar renders unconditionally, as `sticky bottom-0` inside normal flow. Screenshots `screens/58-empty-run-dark-1440.png` (empty run: "All 0 changed views...", a bright "Approve & next", bar at y = 333), `screens/52-closed-summary-dark-1440.png` (closed summary: bar at y = 433 with 400 px of empty page below), `screens/29-read-only-archived-dark-1440.png`, `screens/88-mobile-read-only-dark-390.png`.
- What happens: For an empty run, a closed summary, and any read-only run, the full bar still shows Undo, the whole-item command, Reject, and Approve, all disabled (with WORK-06 on Approve). When the content is short, the bar sits right under it, not at the bottom.
- Impact: Dead controls take 61 to 91 px and suggest that review is possible. The floating bar looks like a layout error. Read-only history is a common view (every closed run).
- Recommendation: Do not render decision controls when `model.archived`, `!model.items.length`, or `evidenceState === "summary"`. Show a one-line read-only bar, or nothing. Pin the bar to the viewport bottom through the shell grid, not through `sticky` in flow.
- Alternatives: (a) Minimal: wrap the bar in `{!model.archived && item && variant && (...)}`. (b) Replace it with a neutral strip: "Read-only: this run is in the baseline" plus previous and next. (c) Move decisions into an inspector column that is simply absent for read-only runs (layout B).
- Maintainer decision needed: no.

### WORK-17 · The whole-item command is inconsistent: a menu chevron opens a modal, the mouse path needs a confirmation that `Shift+A` skips, and the labels do not match

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:1042-1059` (button "All {targets.length} changed views..." with `ChevronDown`), `:1242-1296` (modal "Review all changed views" with "Reject whole item (N)" and "Approve whole item (N)"), `:426-429` (`review("approved", event.shiftKey)` saves at once). `docs/review-guide.md:49` names the buttons "Approve whole item" and "Reject whole item". Screenshots `screens/39-whole-item-dialog-dark-1440.png`, `screens/41-new-item-added-dark-1440.png` ("All 1 changed views..."), `screens/86-mobile-whole-item-dialog-dark-390.png`.
- What happens: (1) The trigger looks like a dropdown and opens a centered modal with a list of every variant, each with the same badge. (2) Mouse: 2 clicks and a confirmation. Keyboard: `Shift+A`, no confirmation, and it approves variants the reviewer has not seen. (3) Three names for one command: "All N changed views...", "Review all changed views", "Approve whole item (N)". (4) With one target the label reads "All 1 changed views...". (5) Neither button shows its shortcut.
- Impact: The safest path is the slowest and the riskiest path is the fastest. The command is hard to find because its label does not contain "approve".
- Recommendation: Make it a split button on Approve and Reject. The menu holds the scoped commands with their shortcuts. Decide on one confirmation rule for both input methods.

  ```tsx
  <ButtonGroup>
    <Button $layer="brand">Approve <Kbd>A</Kbd></Button>
    <PopoverDisclosure render={<Button $layer="brand" aria-label="More approve options" />}><ChevronDown /></PopoverDisclosure>
  </ButtonGroup>
  <Popover>{/* Approve all 7 in this item  ⇧A */}{/* Approve all unreviewed in this item */}</Popover>
  ```

- Alternatives: (a) Minimal: rename the trigger to "Approve or reject all 7..." and hide it when there is one target. (b) Split buttons (above). (c) No confirmation in either path, but a toast with Undo ("7 variants approved. Undo"), because Undo already exists. (d) Show all variants at once (layout F), so that a whole-item approval is an informed action.
- Maintainer decision needed: yes. Should a whole-item decision need a confirmation, in both paths, or in neither?

### WORK-18 · The recompare UI is dead in production

- Kind: dead-code
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence: Server: `api/review.ts:592` sends `recompareAllowed: false` for every model, and `api/review.ts:950-987` shows that `POST /api/runs/:id/recompare` always throws. The constant says "Server recomparison is retired. Capture a new complete run with trusted local Submit." (`api/review.ts:101-102`). `docs/review-guide.md:88`: "**Recompare stored run** is retired." Client: the button still renders for every non-preview run (`review/review-workspace.tsx:1186-1197`), plus the reason paragraph (`:1199-1201`), the "Recompare now" button (`:979-989`), the "A new comparison is being prepared..." banner (`:705-710`), `recompare()` and `pendingComparison` (`use-review-session.ts:127`, `:507-547`), and `commands.recompare` (`review/client.ts:355-360`). The fixture keeps it alive because it leaves `recompareAllowed` undefined, which defaults to `true` (`review-workspace.tsx:328`).
- What happens: In production the footer always shows a disabled "Recompare stored run" button and an unstyled 16 px sentence about a retired feature. The enabled path can never run.
- Impact: About 80 lines of state and UI, 8 or more browser tests (`review.browser.test.ts:1434-1672`), and one permanent dead control. The tests give confidence in a path that users cannot reach.
- Recommendation: Remove the recompare command, button, banner, state, and tests. Keep the status polling for runs that are still comparing (it does not depend on recompare).
- Alternatives: (a) Minimal: hide the button and the paragraph when `recompareAllowed` is false. (b) Full removal (above). (c) Keep the code behind the server flag if recompare may return.
- Maintainer decision needed: yes. Is server recomparison gone for good?

### WORK-19 · Keyboard help and the shortcut toggle are always below the fold, the toggle is not saved, and hints stay visible when shortcuts are off

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:1172-1205` (`ShellFooter`, static position). Measured (`measure-chrome.mjs`): `documentScrollHeight` is larger than the viewport at every size: 1095 against 1080, 994 against 900, 893 against 720, 913 against 768, 1624 against 844. The viewer height is `h-[min(56vh,650px)]` (`components/screenshot-viewer.tsx:134`), so the page fits only when the viewport is taller than about 1,141 px. `:199`: `useState(true)` for shortcuts, with no storage. Screenshots `screens/12-default-dark-1440-fullpage.png`, `screens/13-footer-scrolled-dark-1440.png`, `screens/61-shortcuts-off-footer-dark-1440.png` (the `S`, `D`, `F`, `G`, `X`, `A` hints are still shown with shortcuts off), `screens/50-keyboard-help-dark-1440.png`.
- What happens: The only entry to the shortcut list is a 26 px icon in a footer that needs a page scroll. When the page scrolls, the heading and metadata scroll away and the sidebar header slides under the app header. The help dialog prints keys as plain text (the vendored `Kbd` primitive is not used), and its title has no heading style. "Shortcuts off" resets on each load.
- Impact: The app is keyboard-first, but a new reviewer cannot find the keys. The page has a second scroll container (the document) for 40 px of footer.
- Recommendation: Remove the footer. Put a "?" button (shortcut `?`) in the top bar. Save the toggle in `localStorage` next to the sidebar preference. Hide `ButtonSlot $kind="shortcut"` when shortcuts are off or the device has no keyboard (`@media (hover: none)`). Use `Kbd` in the help list.
- Alternatives: (a) Minimal: make the footer sticky or move its two buttons into the main header. (b) A help popover from the top bar. (c) A command palette that lists every action with its key.
- Maintainer decision needed: no.

### WORK-20 · The UI uses three vocabularies for the same things, and the review guide uses a fourth

- Kind: copy
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence, all in `review/review-workspace.tsx` unless noted. Variant: "Variants" (`:728`), "variant" (`:173`, `use-review-session.ts:364`), "view" ("Reject view" `:1077`, "All N changed views..." `:1055`), "capture" ("Capture details" `:1155`). Item: "Screenshots" (`:549`), "items" (`:552`), "Previous screenshot" (`:654`), "whole item" (`:1280`). Reference image: "Baseline" (`:888`), "reference" ("Pixel diff requires both a reference and a new image." `:928`), "original" (`:175`). Candidate image: "Current" (`:874`), "new image" (`:175`, `:928`), "candidate" (`use-evidence.ts:92`). Diff: "Difference" (`:860`), "red pixel diff" (`:175`), "Pixel diff" (`:379`). Approved: "Approved" (filter, `screenshot-filter.tsx:20`), "Accepted (N)" (`item-list.tsx:378`), "This acceptance is already saved." (`use-review-session.ts:349`). Decision: "decision" (`:1113`), "command" ("Retry same command" `:1122`). `docs/review-guide.md:31-34` names the view controls "Side by side", "Pixel diff", "New only", "Original only". The buttons say "Compare", "Difference", "Current", "Baseline". `docs/review-guide.md:92` says "Use **All runs** to return to the dashboard". The link says "Queue" (`:584`). `docs/review-guide.md:94` says the layout "stacks the list and images on narrow screens". The list is a dialog there (`:1206-1222`).
- What happens: One reviewer action touches three words for the same object. Example: select a "variant" chip, press "Reject view", read "1 variant rejected", then open "Capture details".
- Impact: Extra reading cost on every screen, and the help text and the guide do not match the buttons they describe.
- Recommendation: Pick one word per concept and apply it to labels, messages, ARIA names, and the guide. A possible set: item, variant, baseline, current, diff, approve, reject, decision.
- Alternatives: (a) Minimal: fix the help dialog and the guide to match the buttons. (b) A shared `copy.ts` module with all strings, so that drift is visible in one file. (c) Full pass over the model names too (`reference`, `candidate`), which is a larger change.
- Maintainer decision needed: yes. Which words are canonical: "baseline and current" or "reference and new image"? "variant" or "view"? "approved" or "accepted"?

### WORK-21 · In the light scheme the selected chip and the selected list row are almost invisible

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:719-727` (chip glider: `$lighten: 2`, `$border: true`) and `review/item-list.tsx:201`, `:219` (`$lighten={index === selectedIndex ? 2 : false}`). Screenshot crops `screens/crop-heading-variants-light.png` (the selected "React" chip has no border and no fill, and the unselected chips have a border) and `screens/crop-sidebar-top-light.png` (the selected row is white on a near-white canvas). Dark crops for comparison: `screens/crop-heading-variants-dark.png`, `screens/crop-sidebar-top-dark.png`.
- What happens: Selection is expressed with "lighten", which has no room on a white canvas. In the chip strip the result is inverted: the selected chip is the only one without an outline.
- Impact: In the light scheme the reviewer cannot see which variant or item is selected except by bold text and a 2 px bar at the sidebar edge.
- Recommendation: Use appearance-aware separation for selection (numeric `ak-layer-*` or `$selectedPush`, per the `@ariakit/tailwind` readme table: "Selected row ... should remain visibly separate in either theme"), not `lighten`.
- Alternatives: (a) Minimal: replace `$lighten: 2` with a numeric layer offset on the glider and rows. (b) A brand-tinted selected state. (c) Tabs with the `TabGlider` primitive, which already handles both schemes.
- Maintainer decision needed: no.

### WORK-22 · Seven font sizes, 16 text elements at 10 px, and two unstyled 16 px outliers

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: Measured (`probe-styles.mjs`): `"fontSizes":{"16px":3,"13px":13,"10px":16,"11px":3,"12px":53,"28px":1,"14px":1}`, `"acceptedToggle":{"text":"Accepted (1)","fontSize":"16px"}`, `"footerReason":{"text":"The stored images have expired.","fontSize":"16px"}`. Source counts (`rg`) in the five lane TSX files: 130 `className` attributes, 8 size utilities (`text-xs` x32, `text-sm` x10, `text-[10px]` x7, `text-[11px]` x3, `text-lg`, `text-2xl`, `text-[28px]`, `text-[13px]`), 5 dimming values through 2 mechanisms (`opacity-60` x7, `ak-ink-60` x5, `opacity-50` x4, `opacity-55`, `ak-ink-40`), and 17 `!important` utilities (for example `flex!` x5, `pt-0!`, `pb-0!`, `py-0!`, `min-h-10!`, `duration-0!`). Screenshots `screens/crop-accepted-toggle-dark.png`, `screens/30-read-only-archived-footer-dark-1440.png`.
- What happens: Most of the page is 10 to 12 px text at 50 to 60% opacity. The metadata strip is 10 px at 50% opacity. Two elements have no size class and fall back to 16 px: the "Accepted (N)" toggle (`item-list.tsx:377-379`) and the recompare reason (`review-workspace.tsx:1199-1201`). They are the largest text after the heading.
- Impact: The hierarchy is accidental. The least important label in the sidebar is the largest, and the run identity is the hardest to read. Small low-contrast text is the main cause of the "ugly" impression.
- Recommendation: A three-step type scale for the workspace (for example 12, 13, 15 px, with 20 px for the item name), one dimming mechanism (`ak-ink-*`), and no text below 11 px. Express it through `Text` variants, not per-element utilities.
- Alternatives: (a) Minimal: add `text-xs` to the two outliers and raise the 10 px text to 11 px. (b) A small set of local text recipes (`label`, `meta`, `body`, `title`). (c) Adopt the upstream `Heading` and `TextFrame` primitives.
- Maintainer decision needed: no.

### WORK-23 · The item row spends its space on a 26 px thumbnail and hides useful state

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: `review/item-list.tsx:231-244` (thumbnail slot `$size="2xl"`), `:250-257` (one description, chosen by priority: errors, then comparing, then rejected, then pending), `:258-265` (a "Removed" badge, but no "New" badge), `:270-274` (color-only dot, `aria-hidden`). Measured (`probe-interaction.mjs`): `thumbnail: rendered 26x26, slot 26x26, row 215x44`. Screenshots `screens/14-many-items-dark-1440.png`, `screens/16-many-items-accepted-open-dark-1440.png`, `screens/42-removed-item-dark-1440.png`, `screens/51-long-names-dark-1440.png`.
- What happens: (1) A full screenshot is drawn in 26 x 26 CSS px. It carries no information. (2) An item with 1 rejected and 3 pending variants says only "1 rejected variant". The pending count is hidden. (3) Accepted rows say "0 of 3 need review". (4) New items have no mark, but removed items do. (5) Names such as `ariakit-tailwind-7466/applied-light-week-hover` wrap to three lines in a 215 px row. (6) The sidebar header always shows the total ("24 items"), not the filtered count.
- Impact: The list uses 44 px per row and still makes the reviewer open an item to learn its state. 15 rows fit at 1440 x 900.
- Recommendation: Choose one of two honest directions: a dense text row (28 px, 25 or more rows visible) with a per-variant dot strip, or a visual row with a diff thumbnail large enough to read (96 px or more). See the item row alternatives in Redesign ideas.
- Alternatives: (a) Minimal: drop the thumbnail, show "3 left · 1 rejected", add a "New" badge, and truncate names in the middle. (b) Dot strip per variant. (c) Tree rows: item, then variants. (d) Group by path prefix with `NavGroup`.
- Maintainer decision needed: yes. Dense text list or visual thumbnail list?

### WORK-24 · Each variant chip is 265 to 307 px wide because it repeats the same facts as icons, labels, and key text

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: Server label: `api/review.ts:469-482` builds `labelParts` from framework, browser, color scheme, contrast, forced colors, and then `row.variant_key`. Chip: `review/variant-summary.tsx:97-123` renders an icon and a label for each part, then the key text. Measured (`probe-variants.mjs`): `"chipWidths":[295,287,285,307,297,299,265]`. Screenshot `screens/24-variants-many-labelparts-dark-1440.png`: one chip reads "React, Chromium, Light, monitor icon, ban icon, react-chromium-default-defau..., 1". Screenshot `screens/87-mobile-many-variants-dark-390.png`: one clipped chip is visible on a phone.
- What happens: The key text repeats the parts that the icons already show. "Contrast: no preference" and "Forced colors: none" are default values, but they still get a monitor icon and a ban icon with no label. The `title` attribute is the only explanation (9 `title` tooltips in the lane; the upstream `Tooltip` primitive is not vendored).
- Impact: 12 variants need about 3,500 px of horizontal scroll. Default-value icons add noise to every chip. Touch users cannot see `title` text.
- Recommendation: Show only the dimensions that differ between the variants of this item. Hide default values. Do not print the key when the parts describe it.

  ```ts
  // Show a part only when at least two variants of the item differ in it.
  const varying = kinds.filter((kind) => new Set(item.variants.map((v) => part(v, kind))).size > 1);
  ```

- Alternatives: (a) Minimal: hide `contrast` and `forcedColors` parts with default values and drop the key text when all parts have icons. (b) Icon-only chips (about 64 px) with a real `Tooltip`. (c) A matrix popover: rows are framework and browser, columns are color scheme. (d) A vertical variant list in an inspector column.
- Maintainer decision needed: no.

### WORK-25 · The Details panel repeats the header, prints raw IDs, and its links do not look like links

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence: `review/review-workspace.tsx:460-524`. Lines 463-467 repeat the variant label, verdict, and run status. Lines 468-472 print "Run {id} · Attempt · Commit · Comparison N" as one sentence. Lines 473-489 are plain `<a>` elements with no class. Lines 490-522 are a `<dl>` with "Engine / codec", "Policy / threshold", "Capture profiles" (digests), and "Comparison" (`{model.comparisonId} · {variant.id} · decision revision {variant.revision}`). The panel starts below the main header (`$from="intro"`, `:1145`), and the left sidebar starts at the main header (`$from="main"`, `:539`). Screenshots `screens/26-details-open-dark-1440.png`, `screens/28-details-open-with-history-dark-1440.png`, `screens/84-mobile-details-dialog-dark-390.png`.
- What happens: The first three lines are already on the page. The reviewer field that matters ("maintainer-1") is the last token of a dot-separated line. IDs and digests cannot be copied with one click. "Original comparison" is a link that looks like text. `docs/review-guide.md:41` promises image digests, but the panel does not show them. The button label is "Details" with a "settings" icon (`Settings2`).
- Impact: The panel costs 256 px of image width and gives little that a reviewer needs for a decision. Its main use is debugging.
- Recommendation: Split it in two: a small popover with the facts a reviewer may want (dimensions, changed pixels, threshold, reviewer, time), and a "Debug info" disclosure with copyable IDs. Use `Table` or the upstream `List`, `Link`, and `Code` primitives.
- Alternatives: (a) Minimal: delete lines 463-467, style the links, and add copy buttons. (b) A popover (no layout change when it opens). (c) An inspector with `Disclosure` sections. (d) A "Copy debug info" button only.
- Maintainer decision needed: yes. Who is the Details panel for: reviewers or operators?

### WORK-26 · Phone layout: 518 px of controls before the image, 213 px of image, and targets as small as 19 x 23 px

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence: Measured at 390 x 844 with touch (`measure-chrome.mjs`): `chromeAboveFirstImagePixel 518, imageVisibleHeight 213, decisionBarHeight 91, documentScrollHeight 1624`. Target sizes: `"Visonaut review queue":"19x23","Queue":"68x23","Previous screenshot":"29x29","Compare S":"99x25","Fit":"46x25","Undo":"66x26","Reject viewX":"134x35","Approve & nextA":"156x35"`. Overflow: `variantsScrollWidth 2079, variantsClientWidth 358`, `viewGroupScrollWidth 401, viewGroupClientWidth 366`. Keyboard hints render on touch: `"kbdHintsVisible":["X:13","A:13"]`. Screenshots `screens/80-mobile-default-dark-390.png`, `screens/82-mobile-default-dark-390-fullpage.png`, `screens/85-mobile-offline-error-dark-390.png` (the bar is 165 px high with an error), `screens/83-mobile-screenshots-dialog-dark-390.png`.
- What happens: Eleven rows of controls come before the image. The two panes stack, so baseline and current are never on screen together. The decision buttons are 35 px high and left-aligned. Two links are below the 24 x 24 px minimum of WCAG 2.2 SC 2.5.8. `docs/review-guide.md:94` says that mobile workflows have a separate validation scope.
- Impact: Review on a phone is possible but slow and error-prone. If phone review is not a goal, the current layout still costs code (two extra dialogs and a second layout test).
- Recommendation: Decide the goal first. If phones are in scope: one 44 px top bar, a swipe or tap overlay to flip between baseline and current, a bottom sheet for the list, and two full-width 48 px decision buttons.
- Alternatives: (a) Minimal: hide key hints on touch, make Reject and Approve full width and 44 px high, and collapse the view and zoom rows into one menu. (b) A dedicated phone layout (layout G in Redesign ideas). (c) State that phones are read-only and show a simple stacked report.
- Maintainer decision needed: yes. Is phone review a supported workflow?

### WORK-27 · Hand-built UI stands where Ariakit UI primitives exist

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence: Imports of vendored primitives across the app (`rg`, excluding tests and the vendored folder): `button` 12, `text` 9, `frame` 6, `shell` 5, `badge` 3, `nav` 3, `layer` 2, `popover` 1, `table` 1. `Kbd`, `Tabs`, and `TextFrame` are vendored and not imported by any app file. Hand-built parts in this lane: native `<progress>` (`review-workspace.tsx:599-604`), four `ak.Dialog` instances with repeated `Frame`, `fixed`, and `bg-black/50!` classes (`:155-158`, `:1206-1211`, `:1223-1230`, `:1242-1248`), a `div` separator (`:1041`), four raw `<p>` banners (`:689-710`), two `<dl>` lists (`:165-182`, `:490-522`), 9 `title` tooltips, key hints as plain text (`:166-181`), and a search control from raw `Tag*` and `Combobox*` parts (`screenshot-filter.tsx:58-175`). Raw element counts in the lane TSX files: 20 `<div>`, 17 `<p>`, 14 `<dt>` and `<dd>` pairs. Upstream has `dialog`, `tooltip`, `progress`, `separator`, `list`, `combobox`, `input`, `heading`, `link`, and `code` (`/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components`), which the pinned copy (`components/ariakit/NOTICE`, commit `fc85b809`) does not include.
- What happens: The page mixes primitives with one-off Tailwind strings. Each one-off piece has its own spacing, radius, and color choices (see WORK-09, WORK-21, WORK-22). `docs/current-contract.md:54` (D10) says "Keep the component set... No pruning or replacement is selected", so the vendored set is frozen by contract.
- Impact: The maintainer expects the app to show what Ariakit UI can do. Today about half of the workspace chrome is not Ariakit UI, and it is the half that looks wrong.
- Recommendation: Update the vendored copy to a newer upstream commit that has `dialog`, `tooltip`, `progress`, `separator`, `input`, `combobox`, `list`, `heading`, `link`, and `code`. Then replace the hand-built parts one by one. The design lab can use the upstream source directly.
- Alternatives: (a) Minimal: use what is already vendored (`Kbd` in help, `Tabs` for the filter and view modes, `Popover` for details, `Layer` for banners, `Table` for details). (b) Update the vendored copy (above). (c) Consume `@ariakit/ui` as a package if upstream publishes one.
- Maintainer decision needed: yes. Does contract item D10 allow an update of the vendored component set?

### WORK-28 · "Queue" and the comparison-history links are plain anchors that reload the document, and three links to "/" sit in the top 96 px

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `review/review-workspace.tsx:580` (`render={<a href="/" />}`), `:474-487` (history links as `<a href>`), `components/app-shell.tsx:29` and `:52-58` (logo and "Review queue" as `<a href>`). Measured on the preview route in dev mode (`probe-flow.mjs`): `queue link: document load events after click=1; requests by type={"document":1,"stylesheet":1,"script":221,"other":1,"fetch":2}`. The script count is a dev-server number (unbundled modules). The fact that matters is 1 document request. Playwright also resolved three links to "/" on the run page: "Visonaut review queue", "Review queue", and "Queue".
- What happens: Leaving a run for the queue throws away the client app and loads the document again, with a new server render and the access checks that come with it. The item rows and chips use the router `Link` (`item-list.tsx:205-214`, `review-workspace.tsx:750-758`), so the pattern is known in this file.
- Impact: This is a direct part of the maintainer's "pages load slowly" complaint for the loop: queue, run, queue, next run. It also drops any client cache of the queue.
- Recommendation: Use the router `Link` for all three, and keep only one visible way back.

  ```tsx
  <Button $p={1} render={<Link to="/" />}>
  ```

- Alternatives: (a) Minimal: change `:580` and the two history links. (b) Also change `AppHeader` (another lane owns it). (c) Add `preload="intent"` on the queue link so that the queue data is ready before the click.
- Maintainer decision needed: no.

### WORK-29 · 30 Tab stops come before "Approve & next", and each variant chip is one of them

- Kind: accessibility
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: Measured (`probe-interaction.mjs`): the Tab order from the workspace root has 30 stops before "Approve & next": 4 app header links, search, 1 list stop, "Accepted", sidebar toggle, "Queue", next, "Details", 7 chips, 4 view buttons, 3 zoom buttons, 2 image viewports, the whole-item button, Reject, Approve. The chips are `NavLink` elements with no roving tabindex (`review-workspace.tsx:732-780`). The list is a composite with one stop (`item-list.tsx:120-126`).
- What happens: A keyboard user who does not use the letter shortcuts must press Tab 30 times, or 35 times with 12 variants. The status filter tag has `tabindex="-1"` and is reached only with Left from the search field.
- Impact: Low for the target user (shortcuts exist), but it is the fallback path when shortcuts are off, and shortcut discovery is weak (WORK-19).
- Recommendation: Make the chip strip, the view modes, and the zoom buttons composite groups with one Tab stop each (`Tabs` or `ak.Composite`). That gives about 14 stops.
- Alternatives: (a) Minimal: roving tabindex on the chips only. (b) Landmarks plus a "Skip to decision" link. (c) Put the decision buttons first in DOM order inside the main region.
- Maintainer decision needed: no.

### WORK-30 · `review-workspace.tsx` is one 1,100-line component

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence: `wc -l`: 1299 lines. `ReviewSession` spans 195-1299. It has 12 `useState` calls (196-213), 4 effects, 1 keyboard handler with 12 branches (395-442), 4 dialogs, and JSX from 527 to 1298 with nesting up to 12 levels (for example `:787-1004`). The four mode buttons are four copies of the same 14 lines (`:834-890`). The disabled rule is written 5 times with small differences (`:1044-1046`, `:1064-1070`, `:1082-1088`, `:1271-1277`, `:1284-1290`).
- What happens: Header, sidebars, chips, toolbar, decision bar, footer, and dialogs share one closure. Any layout change touches the same function as the keyboard and selection logic.
- Impact: The redesign phase must change layout a lot. With the current shape, each variant would need a copy of the whole function. Review of changes is hard because diffs mix layout and behavior.
- Recommendation: Split behavior from layout before or during the redesign. A `useReviewWorkspace(model, commands, route)` hook returns selection, order, evidence, flags (`canApprove`, `canReject`, `canUndo`), and actions. Small components take that object: `RunBar`, `ItemSidebar`, `VariantSwitcher`, `ViewToolbar`, `DecisionBar`, `DetailsPanel`, `ShortcutHelp`.

  ```tsx
  const workspace = useReviewWorkspace({ model, commands, route });
  return <FocusLayout workspace={workspace} />; // or <InboxLayout />, <FeedLayout />
  ```

- Alternatives: (a) Minimal: extract `DecisionBar`, `VariantSwitcher`, and `DetailsPanel` as components and compute the disabled flags once. (b) The hook plus layouts split (above). (c) A context provider for the workspace state, so that layout variants in the design lab can share the real behavior.
- Maintainer decision needed: no.

### WORK-31 · The sidebar preference needs an inline head script on every route, although the run route renders only on the client

- Kind: simplification
- Severity: low. Confidence: medium. Measured: no. Effort: S
- Evidence: `review/sidebar-preference.ts:3-9` (comment: "The run route renders on the client. Read this in the document head so its first render uses the saved layout"), `routes/__root.tsx:23-26` (the script is in the root `<head>` of all routes), `routes/runs.$runId.tsx:31` (`ssr: false`), `review/review-workspace.tsx:202-206` (the initial state reads `document.documentElement.dataset.reviewSidebarOpen`), `:226-233` (an effect writes the dataset and `localStorage`). No CSS rule reads `data-review-sidebar-open` (`rg "reviewSidebarOpen|review-sidebar-open"` finds only these files).
- What happens: The preference travels from `localStorage` to a data attribute to React state. Because the workspace first renders in the browser, the `useState` initializer could read `localStorage` directly. The data attribute has no other reader.
- Impact: One inline script (with a nonce) on every page, one extra module, and one extra concept. No user-visible defect.
- Recommendation: Read `localStorage` in the initializer and delete the head script, unless server rendering of the run page is planned.
- Alternatives: (a) Keep it if the run route will become server-rendered (then make CSS read the attribute so that it has a purpose). (b) Remove it (above). (c) Store the preference in a cookie so that a server render can use it.
- Maintainer decision needed: yes. Will `/runs/$runId` stay client-rendered?

### WORK-32 · A click on a list row selects the first pending variant, but the arrow keys select the remembered variant

- Kind: inconsistency
- Severity: low. Confidence: medium. Measured: no. Effort: S
- Evidence: `review/review-workspace.tsx:457`: `variantKeyForItem={(entry) => entry.variants.find(needsReview)?.key ?? entry.variants[0]?.key}`. In route mode the row is a `Link` with that key and no click handler (`item-list.tsx:196-229`, `onClick={route && variantKey ? undefined : () => selectItem(index)}`). The keyboard path calls `selectItem` (`review-workspace.tsx:355-368`), which prefers `remembered.current.get(next.key)`. `docs/review-guide.md:82` says "Each item remembers its last selected variant."
- What happens: In the real route, a mouse click on an item ignores the remembered variant. Up and Down honor it. The fixture (no route) uses `selectItem` for both, so the browser tests do not see the difference.
- Impact: Small. A reviewer who goes back to an item with the mouse lands on a different variant than with the keyboard.
- Recommendation: Build the row link from the remembered variant first, or handle the plain left click with `selectItem` and keep the `href` for new-tab use.
- Alternatives: (a) Leave it and change the guide. (b) Use the same rule in both paths (above).
- Maintainer decision needed: no.

### WORK-33 · Status polling runs every 2 seconds with no backoff while a run is incomplete

- Kind: cost
- Severity: low. Confidence: medium. Measured: no. Effort: S
- Evidence: `review/use-review-session.ts:144-149` (`awaitingComparison` is true for `incomplete` and `comparing` runs), `:185-258` (`schedule(2000)` after each poll, in a `finally` block, including after errors), `review/client.ts:352-354` (`GET /api/runs/:id/state`). The loop stops only when the tab is hidden or the state becomes ready or failed.
- What happens: An open tab on a run that waits for its capture sends 30 requests per minute until the capture ends. Each request passes the server access checks (another lane measures their cost). The save-state row is rewritten after each poll with "... Review actions are unavailable until it is ready."
- Impact: Counted from the code: 1,800 requests per hour per open tab on a waiting run. Low at maintainer scale, but each request has the cost of the access path.
- Recommendation: Back off (2 s, 4 s, 8 s, up to 30 s) and add jitter. Reset on visibility change.
- Alternatives: (a) Leave it. (b) Backoff (above). (c) One `ETag` or `If-None-Match` state endpoint that the edge can answer. (d) Server push, which is likely too much for this app.
- Maintainer decision needed: no.

### WORK-34 · Small visual defects in the sidebar

- Kind: visual
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: Screenshot `screens/23-item-row-hover-focus-dark-1440.png`: the focus ring of a row is cut on the left and right by the scroll container (`item-list.tsx:343`, `overflow-auto`), so only the top and bottom arcs show. Screenshot crop `screens/crop-sidebar-top-dark.png`: the filter box touches the header divider because the body uses `pt-0!` (`review-workspace.tsx:557`). Screenshot `screens/16-many-items-accepted-open-dark-1440.png`: rows under "Accepted" are indented 14 px more than the main rows and use a different hover fill, and the group has two size caps (`max-h-[50%]` at `item-list.tsx:367` and `max-h-[30dvh]` at `:383`). The last visible main row is cut by the "Accepted" toggle with no divider.
- What happens: Several one-off layout overrides meet at the sidebar edges.
- Impact: Cosmetic, but they are the details that make the sidebar look unfinished.
- Recommendation: Give the scroll area 2 px of inline padding for the focus ring, restore the top padding, use one list with a `NavGroup` label for "Accepted" (or tabs, see WORK-11), and one size rule.
- Alternatives: (a) Fix each item as above. (b) Rebuild the sidebar from one of the row alternatives in Redesign ideas.
- Maintainer decision needed: no.

## Redesign ideas

Notation in the sketches: `●` pending, `✓` approved, `✕` rejected, `!` error, `◌` comparing, `+` new, `−` removed. `⚛` React, `◆` Solid, `◎` Chromium, `🦊` Firefox, `◈` WebKit, `☀` light, `☾` dark. Numbers at the right edge are row heights in px.

### Workspace layouts

#### Layout A · Focus canvas: one top bar, one bottom dock

- What changes: The seven rows above the image become one 44 px bar: back, run title, item name with position, state pill, progress, help, user. The chips, view modes, zoom, and decisions move to one 52 px dock at the bottom. The sidebar stays, and `[` hides it. Details open in a popover. Messages are toasts.
- Why it is better: Chrome goes from 469 px (408 above and 61 below) to 96 px at 1440 x 900. The image area grows from 431 px to about 800 px. The decision buttons never move (WORK-03). All image controls are in one place near the hand.
- Sketch:

  ```
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │ ◉ ‹ Queue │ #5123 Dialog focus styles › dialog/open  3/24 │ ● Needs review  ▓▓▓░ 9 left  ?  (DH)│ 44
  ├───────────────┬────────────────────────────────────────────────────────────────────┤
  │ 🔍 Search     │                                                                    │
  │ To review 9   │      ┌───────────────────┐      ┌───────────────────┐              │
  │ ▸ dialog/open ●●●●●●●     Baseline 600×400  │      │   Current 600×400 │              │
  │   menu/open   ●●│      │                   │      │                   │              │
  │ + new/open    ✓ │      │                   │      │                   │              │
  │ Rejected 1  ▸ │      └───────────────────┘      └───────────────────┘              │
  │ Done 14     ▸ │                                                                    │
  │               ├────────────────────────────────────────────────────────────────────┤
  │               │ ⚛◎☀✓ ⚛◎☾● ◆◎☀● ◆◎☾● … 3/7 │ ⇆ Side  ± Diff  ▣ │ Fit ▾ │ ↶ │ ✕ Reject X │ ✓ Approve A ▾ │ 52
  └───────────────┴────────────────────────────────────────────────────────────────────┘
  ```

  ```tsx
  <Shell>
    <ShellHeader
      $height="sm"
      start={<RunCrumbs />}
      center={<ItemPosition />}
      end={<RunProgress />}
    />
    <ShellSidebar open={sidebarOpen} $width="md">
      <ItemSidebar />
    </ShellSidebar>
    <ShellMain $maxWidth="100%" $p={0}>
      <ShellMainFull className="flex min-h-0 flex-1">
        <ScreenshotViewer />
      </ShellMainFull>
    </ShellMain>
    <ShellFooter
      $height="md"
      start={<VariantSwitcher />}
      center={<ViewToolbar />}
      end={<DecisionButtons />}
    />
  </Shell>
  ```

#### Layout B · Triage inbox: list, canvas, inspector

- What changes: Three columns, like a mail client. The left column is a tree: items, with their variants as child rows that carry verdict marks. The center is the image and a thin view toolbar only. The right column is an inspector: variant facts, then Approve and Reject at the top of the column, then Disclosure sections (Result, Capture, History, Debug). There is no chip strip and no bottom bar.
- Why it is better: The variant list shows every verdict (WORK-04) and is never off-screen (WORK-02). The decision controls and the facts that support the decision are together. For read-only runs the inspector simply has no buttons (WORK-16). Wide screens use their width.
- Sketch:

  ```
  ┌───────────────────────────────────────────────────────────────────────────────────┐
  │ ◉ ‹ Queue │ #5123 Dialog focus styles                    ▓▓▓░░ 9 left   ?  (DH) │ 44
  ├──────────────────┬──────────────────────────────────────────┬─────────────────────┤
  │ [To review 9][Rejected 1][Done 14] │ ⇆ Side  ± Diff  ▣ Current  ▢ Baseline   Fit ▾│ dialog/open        │ 36
  │ 🔍               ├──────────────────────────────────────────┤ ⚛ React · ◎ Chromium │
  │ ▾ dialog/open  5/7│                                          │ ☀ Light · 1280×720  │
  │    ⚛◎☀  React light  ✓│   ┌───────────┐   ┌───────────┐         │ ● Needs review      │
  │  ▸ ⚛◎☾  React dark   ●│   │ Baseline  │   │ Current   │         │ ┌─────────────────┐ │
  │    ◆◎☀  Solid light  ●│   │           │   │           │         │ │ ✓ Approve     A │ │
  │    ◆◎☾  Solid dark   ✕│   └───────────┘   └───────────┘         │ │ ✕ Reject      X │ │
  │ ▸ menu/open     2/2│                                          │ └─────────────────┘ │
  │ ▸ new/open   +  ✓ │                                          │ All 7 in item ⇧A ▾  │
  │                  │                                          │ ▾ Result            │
  │                  │                                          │   120 px · 0.05%    │
  │                  │                                          │ ▸ Capture  ▸ History│
  └──────────────────┴──────────────────────────────────────────┴─────────────────────┘
  ```

#### Layout C · Filmstrip: a bottom strip of diff thumbnails

- What changes: No left sidebar. A 96 px strip at the bottom shows one card per item (or per variant): a readable diff thumbnail, the name, and a verdict mark. The image area is the full width. The top bar is the same as in layout A. The decision buttons float at the bottom right of the image.
- Why it is better: Thumbnails become useful because they are large and show the diff, not the full page (WORK-23). The eye moves left to right in the same order as the review. Full width helps wide screenshots in side-by-side mode.
- Sketch:

  ```
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │ ◉ ‹ Queue │ #5123 › dialog/open · ⚛ React ◎ Chromium ☀ Light   ● 3 of 9   ?  (DH) │ 44
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │                                                                                    │
  │        ┌───────────────────────────┐      ┌───────────────────────────┐            │
  │        │         Baseline          │      │          Current          │            │
  │        └───────────────────────────┘      └───────────────────────────┘            │
  │                                                     ┌───────────────────────────┐  │
  │                                                     │ ↶  ✕ Reject X  ✓ Approve A│  │
  ├─────────────────────────────────────────────────────┴───────────────────────────┴──┤
  │ ◂ ┌────┐✓ ┌────┐✓ ╔════╗● ┌────┐● ┌────┐● ┌────┐✕ ┌────┐● ┌────┐● ┌────┐● ▸  [All ▾]│ 96
  │   │diff│  │diff│  ║diff║  │diff│  │diff│  │diff│  │diff│  │diff│  │diff│           │
  │   dialog  dialog  dialog  menu    menu    select  tab     tooltip toolbar          │
  └────────────────────────────────────────────────────────────────────────────────────┘
  ```

#### Layout D · Contact sheet first: a grid with multi-select, then a lightbox

- What changes: The run opens as a grid of cards, one per changed variant: a diff thumbnail at 240 px or more, the item name, variant icons, changed percent, and a checkbox. Sort by changed percent. Select many cards and approve them in one command. A click (or Enter) opens a full-screen lightbox with the current viewer, `A`, `X`, and arrow keys.
- Why it is better: Most visual diffs are obvious at thumbnail size. The reviewer can clear 40 of 50 changes with one selection and one command, and open only the doubtful ones. This changes the cost of 50 approvals from 50 steps to a few.
- Sketch:

  ```
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │ ◉ ‹ Queue │ #5123 Dialog focus styles     [To review 9][Rejected 1][Done 14]  🔍   │ 44
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │ Sort: Most changed ▾   Group: Item ▾        ☑ 6 selected   ✕ Reject   ✓ Approve 6  │ 40
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │ dialog/open                                                                        │
  │ ┌──────────┐☑ ┌──────────┐☑ ┌──────────┐☑ ┌──────────┐☐ ┌──────────┐☐              │
  │ │  diff    │  │  diff    │  │  diff    │  │  diff    │  │  diff    │               │
  │ └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘               │
  │ ⚛◎☀ 0.05%    ⚛◎☾ 0.05%    ◆◎☀ 0.05%    ◆◎☾ 1.20%    ⚛🦊☀ 0.31%                   │
  │ menu/open                                                                          │
  │ ┌──────────┐☑ ┌──────────┐☑                                                        │
  │ └──────────┘  └──────────┘                                                         │
  └────────────────────────────────────────────────────────────────────────────────────┘
  ```

- Note: This needs diff thumbnails of useful size from the server (today the thumbnail is one small image per variant result). It also needs a decision on bulk approval across items.

#### Layout E · Changes feed: one scrolling page, like "Files changed"

- What changes: No selection model. All changed variants are a vertical feed of cards under sticky item headers. Each card has the two images (or a swipe overlay), its own Approve and Reject, and a "Viewed" style state. `J` and `K` move between cards. `A` and `X` act on the card at the top of the viewport. Reviewed cards collapse to one line. Images load lazily as cards come near.
- Why it is better: Scrolling is the fastest way to scan many small images. Nothing is hidden behind a click. The next images preload by nature (WORK-08). There is no chip strip, no "selected but off-screen" state, and no sticky bar that moves.
- Sketch:

  ```
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │ ◉ ‹ Queue │ #5123 Dialog focus styles          ▓▓▓░░ 9 left  ✓ Approve rest ▾   ?  │ 44
  ├───────────────┬────────────────────────────────────────────────────────────────────┤
  │ dialog/open 5 │ dialog/open                                    ✓ Approve item ⇧A   │ 36 sticky
  │ menu/open   2 ├────────────────────────────────────────────────────────────────────┤
  │ new/open  + 1 │ ✓ ⚛◎☀ React · Chromium · Light        approved by you   ↶ Undo  ▸  │ 32 collapsed
  │ select/open 1 ├────────────────────────────────────────────────────────────────────┤
  │               │ ● ⚛◎☾ React · Chromium · Dark   0.05%        ✕ Reject X  ✓ Approve A│
  │               │ ┌───────────────────────┐ ┌───────────────────────┐                │
  │               │ │       Baseline        │ │        Current        │                │
  │               │ └───────────────────────┘ └───────────────────────┘                │
  │               ├────────────────────────────────────────────────────────────────────┤
  │               │ ● ◆◎☀ Solid · Chromium · Light  0.05%        ✕ Reject    ✓ Approve │
  └───────────────┴────────────────────────────────────────────────────────────────────┘
  ```

#### Layout F · Variant matrix: all variants of one item on screen

- What changes: The unit of review becomes the item. The main area shows every variant of the selected item as small multiples in a grid: rows are framework and browser, columns are color scheme. Each cell shows the current image with the diff as an overlay, and a verdict mark. One primary action approves the item. A click or a number key zooms one cell into the two-pane view.
- Why it is better: A visual change usually affects all variants of an item in the same way. Today `Shift+A` approves six unseen variants (WORK-17). Here the reviewer sees them all first. 50 changes in 10 items become 10 informed decisions. An outlier (one browser that differs) is visible at once.
- Sketch:

  ```
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │ ◉ ‹ Queue │ #5123 › dialog/open  3/24            ● 5 of 7 left      ?  (DH)        │ 44
  ├───────────────┬────────────────────────────────────────────────────────────────────┤
  │ dialog/open ● │                 ☀ Light                  ☾ Dark                    │
  │ menu/open   ● │ ⚛ React ◎    ┌──────────────┐✓       ┌──────────────┐●            │
  │ new/open  + ✓ │              │  diff overlay │        │  diff overlay │             │
  │               │              └──────────────┘        └──────────────┘             │
  │               │ ◆ Solid ◎    ┌──────────────┐●       ┌──────────────┐●            │
  │               │              └──────────────┘        └──────────────┘             │
  │               │ ⚛ React 🦊   ┌──────────────┐●       ┌──────────────┐!            │
  │               │              └──────────────┘        └──────────────┘             │
  │               ├────────────────────────────────────────────────────────────────────┤
  │               │ Overlay: Diff ▾   Size: S M L      ↶   ✕ Reject item ⇧X  ✓ Approve item ⇧A │ 52
  └───────────────┴────────────────────────────────────────────────────────────────────┘
  ```

#### Layout G · Phone card stack

- What changes: One 44 px top bar (back, "3 of 9", menu). One image area with a tap or swipe to flip between baseline and current (or a slider overlay). The variant is a compact select ("React · Chromium · Light, 2 of 7"). Two full-width 48 px buttons at the bottom. The item list is a bottom sheet. No key hints.
- Why it is better: Chrome goes from 518 px above and 91 px below to 44 px above and about 112 px below. Baseline and current share the same pixels, which is the only way to compare on a narrow screen. Targets meet 44 px.
- Sketch:

  ```
  ┌──────────────────────────────┐
  │ ‹  dialog/open      3 of 9  ⋯ │ 44
  ├──────────────────────────────┤
  │                              │
  │     ┌──────────────────┐     │
  │     │                  │     │
  │     │   Current        │     │
  │     │   (tap: Baseline)│     │
  │     └──────────────────┘     │
  │       ○ Baseline ● Current ○ Diff │
  ├──────────────────────────────┤
  │ ⚛◎☀ React · Light   2/7  ▾  │ 44
  │ ┌────────────┐┌─────────────┐│
  │ │  ✕ Reject  ││  ✓ Approve  ││ 48
  │ └────────────┘└─────────────┘│
  └──────────────────────────────┘
  ```

### Item list row

1. Dense one-line row (28 px). What changes: no thumbnail. A status glyph, the name with middle truncation, and a "left" counter. Why: 25 or more rows are visible, and every row answers "what is left". Sketch: `● combobox/open-with-groups      5 left`, `✕ checkbox/checked        1 rej · 2 left`, `✓ select/open`.
2. Row with a variant dot strip (36 px). What changes: one dot per variant, colored by verdict, replaces the sentence "5 of 6 need review". Why: the row shows every variant state without words, and it matches the marks on the variant switcher. Sketch: `combobox/open-with-groups   ✓●●●●✕`.
3. Thumbnail card (96 px or more). What changes: a large diff thumbnail with the name and dots below it. One or two columns. Why: thumbnails earn their space only when the change is visible in them. Sketch:

   ```
   ┌───────────────┐
   │  diff image   │  dialog/open
   └───────────────┘  ✓●●●●●●   0.05%
   ```

4. Tree row. What changes: the item row expands to variant rows (as in layout B). Why: it removes the chip strip and makes each variant a list target with its own mark.
5. Grouped by path prefix. What changes: `NavGroup` labels from the first path segment ("button", "combobox", "dialog"), with a group counter and a group approve action. Why: Ariakit items come in families, and a reviewer thinks in families.

   ```tsx
   <NavGroup>
     <NavGroupLabel>
       combobox <Badge>7 left</Badge>
     </NavGroupLabel>
     <NavLink aria-current="page">
       open-with-groups <VariantDots item={item} />
     </NavLink>
   </NavGroup>
   ```

### Filter control

1. Status tabs with counts. What changes: `TabList` with "To review 9", "Rejected 1", "Done 14", "All 24". The "Accepted" disclosure goes away. Why: the counts replace four other count displays (WORK-13), and one click changes the filter.
2. Plain search plus a filter popover. What changes: an `Input` for text, and a "Filter" button that opens a `Popover` with checkbox groups (status, framework, browser, scheme, kind). Active filters show as removable badges. Why: it scales to more dimensions and never covers the results (WORK-11).
3. Token search. What changes: one field that accepts `is:pending browser:firefox scheme:dark menu`, with suggestions from a `Combobox`. Why: fast for maintainers who know the vocabulary, and a filter can be shared in the URL.
4. Command palette. What changes: `Cmd+K` opens a `Combobox` dialog to jump to an item or run a command ("Approve all in item", "Show rejected"). Why: jump-to-item is the real job of search here, and it teaches shortcuts.
5. Minimal fix. What changes: keep the joined control, but open the menu only from the tag button. Why: smallest change that stops the menu from covering results.

### Variant switcher

1. Icon tabs with verdict marks. What changes: each variant is a 60 to 70 px tab with two or three icons and a verdict dot. A real `Tooltip` gives the full label and the key. The full label of the selected variant is printed once next to the item name. Why: seven variants fit in 480 px, so nothing scrolls (WORK-02, WORK-24). Sketch: `[⚛◎☀ ✓][⚛◎☾ ●][◆◎☀ ●][◆◎☾ ✕][⚛🦊☀ ●]`.
2. Only-what-differs chips. What changes: a chip shows only the dimensions that vary inside this item ("Light", "Dark" when only the scheme differs). Why: shortest honest label.
3. Matrix popover. What changes: a button "React · Chromium · Light (2 of 7)" opens a small grid: rows are framework and browser, columns are scheme, and cells are verdict marks. Why: it mirrors how the variants are defined, and it scales to 12 or 24 variants.

   ```
            ☀    ☾
   ⚛ ◎      ✓   [●]
   ◆ ◎      ●    ✕
   ⚛ 🦊     ●    !
   ```

4. Select with stepper. What changes: `‹  React · Chromium · Light  2/7 ▾  ›`. Why: fixed width, good on phones, and it always names the selected variant.
5. Vertical list in an inspector. What changes: variants as rows with marks and number hints (layout B). Why: room for the full label and the reviewer name.
6. Thumbnail strip. What changes: one small current-image thumbnail per variant with a mark. Why: a light and a dark variant are told apart by sight, without icons.

### Decision bar

1. Fixed dock. What changes: a constant-height bar. Left: Undo. Center: status text in a reserved slot. Right: Reject and Approve with `Kbd` hints. Why: nothing moves (WORK-03), and one slot holds every message.
2. Split buttons. What changes: Approve and Reject each have a menu arrow with scoped commands and their keys ("This variant A", "All 7 in item ⇧A", "All unreviewed in item"). Why: the whole-item command becomes discoverable and consistent (WORK-17).

   ```tsx
   <ButtonGroup $gap="xs">
     <Button $layer="brand">
       <ButtonSlot>
         <Check />
       </ButtonSlot>
       <ButtonLabel>Approve</ButtonLabel>
       <ButtonSlot $kind="shortcut">A</ButtonSlot>
     </Button>
     <PopoverDisclosure render={<Button $layer="brand" aria-label="More approve options" />}>
       <ChevronDown />
     </PopoverDisclosure>
   </ButtonGroup>
   ```

3. Floating pill. What changes: a rounded `Frame` with `$lighten` that floats over the bottom center of the image and fades while the pointer is idle. Why: no reserved row at all, good for the focus layout.
4. Inspector placement. What changes: the buttons are at the top of the right column (layout B). Why: the decision sits next to the evidence facts, and read-only runs have no bar.
5. Error mode. What changes: when a save fails, the bar swaps Reject and Approve for "Retry" and "Refresh" on a danger surface. Why: the only valid actions are the only visible actions (WORK-10).
6. Toast with Undo. What changes: after each decision a toast says "Approved React · Light. Undo (⌘Z)". Why: feedback at the place of attention, and Undo is one click away without a permanent button.

### Status and progress display

1. One segmented bar. What changes: a 4 px bar under the top bar with approved, rejected, and pending segments. A hover or focus popover gives the numbers. Why: one element replaces the count text, the native progress, and the status sentence (WORK-13, WORK-14).

   ```
   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒░░░░░░░░░░░░░░░    14 approved · 1 rejected · 9 left
   ```

2. Progress ring with a count. What changes: `ProgressCircular` with "9" inside, next to the run title. Why: smallest footprint, and it reads as "items left".
3. State pill. What changes: one `Badge` next to the title that says "9 to review", "1 rejected", "Passed", "Read-only", "Comparing", or "Failed", with the long text in a popover. Why: it also replaces the four banners (WORK-09).
4. Per-item dot strips only. What changes: no run-level number at all, only the filter tab counts. Why: least text.
5. Completion card. What changes: when nothing is left, the main area shows the summary and next actions (WORK-15). Why: a clear end to the task.

### Details panel

1. Popover with a facts grid. What changes: an "i" button opens a `Popover` with a two-column grid: size, changed pixels, threshold, reviewer, time. Why: no layout change, and no duplicate of the header.

   ```
   Size         600 × 400 → 600 × 400
   Changed      120 px (0.05%)   limit 0.05%
   Reviewed by  maintainer-1 · 2 min ago
   Run          #42 attempt 2 · aabbccd ⧉
   ```

2. Inspector with `Disclosure` sections. What changes: "Result", "Capture", "History", and "Debug" sections, closed by default except the first (layout B). Why: progressive disclosure, and operators still reach the IDs.
3. Inline drawer under the image. What changes: a row that expands below the canvas. Why: it keeps the image width.
4. Copy-only. What changes: no panel. A menu item "Copy debug info" writes the IDs and digests to the clipboard as text. Why: the IDs are for bug reports, not for reading.
5. History as a timeline. What changes: comparisons and decisions as a short list with states and links, using router links. Why: today the history is a row of plain links (WORK-25, WORK-28).

## Screenshots

All paths are under `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-workspace/screens/`. Fixture screenshots have an "Outside search" label above the workspace. That label belongs to the test harness, not to the product.

| File                                                                            | Caption                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `01-real-run-dark-1440.png`                                                     | Preview route on port 4310, dark, 1440 x 900. The read-only banner has no banner style.            |
| `02-fixture-default-dark-1440.png`                                              | Fixture default state, dark (first capture).                                                       |
| `10-default-dark-1440.png`                                                      | Fixture default state, dark, 1440 x 900. Seven rows above the image.                               |
| `11-default-light-1440.png`                                                     | Fixture default state, light. Selected chip and row are hard to see.                               |
| `12-default-dark-1440-fullpage.png`                                             | Full page. The footer with keyboard help is below the fold.                                        |
| `13-footer-scrolled-dark-1440.png`                                              | Page scrolled to the footer. The heading is gone and the sidebar header is under the app header.   |
| `14-many-items-dark-1440.png`                                                   | 24 items with realistic names and `labelParts`. Chips are about 390 px wide.                       |
| `15-many-items-light-1440.png`                                                  | The same state in the light scheme.                                                                |
| `16-many-items-accepted-open-dark-1440.png`                                     | "Accepted (8)" open. 16 px toggle, indented rows, "0 of N need review".                            |
| `17-filter-popover-open-dark-1440.png`                                          | Status menu open over the list.                                                                    |
| `18-filter-needs-review-dark-1440.png`                                          | Filter "Needs review". About 100 px are left for search text.                                      |
| `19-filter-rejected-dark-1440.png`                                              | Filter "Rejected". The header still says "24 items".                                               |
| `20-search-results-dark-1440.png`                                               | Typed "menu". The status menu covers the three results.                                            |
| `21-search-popover-closed-dark-1440.png`                                        | The same search after Escape. Results are visible.                                                 |
| `22-search-no-results-dark-1440.png`                                            | Search with no match.                                                                              |
| `23-item-row-hover-focus-dark-1440.png`                                         | Sidebar crop with hover and focus rows. The focus ring is cut at the sides.                        |
| `24-variants-many-labelparts-dark-1440.png`                                     | 12 variants with `labelParts`. Two and a half chips fit.                                           |
| `25b-variant-7-selected-offscreen-dark-1440.png`                                | Variant 7 selected with the Right key. No chip looks selected.                                     |
| `26-details-open-dark-1440.png`                                                 | Details panel open, dark.                                                                          |
| `27-details-open-light-1440.png`                                                | Details panel open, light.                                                                         |
| `28-details-open-with-history-dark-1440.png`                                    | Details with reviewer and three historical comparisons. Links look like text.                      |
| `29-read-only-archived-dark-1440.png`                                           | Closed run. Plain-text notice and a bright disabled Approve.                                       |
| `30-read-only-archived-footer-dark-1440.png`                                    | Full page of a closed run. The footer reason is 16 px text.                                        |
| `31-saving-one-queued-dark-1440.png`                                            | One decision queued: "1 queued on server. You can close this window."                              |
| `32-saving-queued-three-dark-1440.png`                                          | Three decisions queued. No verdict marks on chips. The selected chip is clipped.                   |
| `33-saved-undo-enabled-dark-1440.png`                                           | After one saved decision. Undo is enabled and the bar is 81 px high.                               |
| `34-undo-saved-dark-1440.png`                                                   | After Undo: "Undo saved. The original selection and verdicts were restored."                       |
| `35-conflict-dark-1440.png`                                                     | Conflict message in small gray text.                                                               |
| `36-offline-error-dark-1440.png`                                                | "Not saved. Connection lost." Reject is dimmed and Approve is bright.                              |
| `37-offline-error-light-1440.png`                                               | The same error in the light scheme.                                                                |
| `38-queued-unconfirmed-dark-1440.png`                                           | "Could not confirm the queued decisions..." with two text-like buttons.                            |
| `39-whole-item-dialog-dark-1440.png`                                            | Whole-item confirmation modal, dark.                                                               |
| `40-whole-item-dialog-light-1440.png`                                           | Whole-item confirmation modal, light.                                                              |
| `41-new-item-added-dark-1440.png`                                               | New item. No "New" mark, "All 1 changed views...", extra note row.                                 |
| `42-removed-item-dark-1440.png`                                                 | Removed item in the "Accepted" group with a "Removed" badge.                                       |
| `43-error-variant-dark-1440.png`                                                | Variant with a comparison error. The error strip is gray.                                          |
| `44-pending-variant-dark-1440.png`                                              | Variant still comparing. A "Comparison is still running..." row pushes the panes down.             |
| `45-run-passed-dark-1440.png`                                                   | Run passed, dark. No completion state.                                                             |
| `46-run-passed-light-1440.png`                                                  | Run passed, light.                                                                                 |
| `47-run-rejected-dark-1440.png`                                                 | Run rejected. "0 of 11 need review" and a full green bar.                                          |
| `48-sidebar-collapsed-dark-1440.png`                                            | Sidebar collapsed.                                                                                 |
| `49-sidebar-collapsed-details-open-dark-1440.png`                               | Sidebar collapsed and Details open.                                                                |
| `50-keyboard-help-dark-1440.png`                                                | Keyboard help dialog. Plain text keys and no title style.                                          |
| `51-long-names-dark-1440.png`                                                   | Long item name, long labels, long run title.                                                       |
| `52-closed-summary-dark-1440.png`                                               | Closed summary without images. The decision bar floats mid-page.                                   |
| `53-terminal-superseded-dark-1440.png`                                          | Superseded comparison.                                                                             |
| `54-terminal-failed-with-error-dark-1440.png`                                   | Failed comparison. Three failure messages, and the badge still says "Needs review".                |
| `55-not-ready-dark-1440.png`                                                    | Run not sealed: "Review is unavailable until..." as plain text.                                    |
| `56-recompare-pending-dark-1440.png`                                            | Recompare requested (fixture only). Two messages for one state.                                    |
| `57-protected-reason-dark-1440.png`                                             | Protected decision note as a gray row.                                                             |
| `58-empty-run-dark-1440.png`                                                    | Empty run. Decision bar with "All 0 changed views..." under the empty card.                        |
| `59-local-comparison-dark-1440.png`                                             | Locally matched capture.                                                                           |
| `60-difference-mode-dark-1440.png`                                              | Difference view mode.                                                                              |
| `61-shortcuts-off-footer-dark-1440.png`                                         | Shortcuts off. Key hints are still on the buttons.                                                 |
| `62-chip-focused-shortcuts-ignored-dark-1440.png`                               | After a click on chip 2 and the keys `A`, `D`, Down. Nothing changed.                              |
| `63-advance-leaves-filtered-list-dark-1440.png`                                 | Search "Open menu". After two approvals the page shows "Success dialog", which is not in the list. |
| `64-after-six-approvals-selected-chip-hidden-dark-1440.png`                     | After six approvals. Variant 7 is selected and off-screen.                                         |
| `65-thousand-items-dark-1440.png`                                               | 1,000 items, list scrolled to the end.                                                             |
| `67-keys-ignored-while-images-load-dark-1440.png`                               | Loading strip above the panes. `A`, `A`, `X` were ignored.                                         |
| `68-real-route-chip-click-then-d-key-dark-1440.png`                             | Preview route after a chip click and the `D` key test.                                             |
| `70-default-dark-1024.png`                                                      | 1024 x 768.                                                                                        |
| `71-default-dark-1280.png`                                                      | 1280 x 720. The image is cut by the decision bar.                                                  |
| `72-default-dark-768.png`                                                       | 768 x 1024. No sidebar. Large empty checkerboard areas.                                            |
| `73-details-open-dark-1280.png`                                                 | 1280 x 720 with Details open.                                                                      |
| `80-mobile-default-dark-390.png`                                                | Phone, dark. Eleven control rows before the image.                                                 |
| `81-mobile-default-light-390.png`                                               | Phone, light.                                                                                      |
| `82-mobile-default-dark-390-fullpage.png`                                       | Phone full page. The panes stack and the page is 1,648 px high.                                    |
| `83-mobile-screenshots-dialog-dark-390.png`                                     | Phone item list dialog with 24 items.                                                              |
| `84-mobile-details-dialog-dark-390.png`                                         | Phone details dialog.                                                                              |
| `85-mobile-offline-error-dark-390.png`                                          | Phone save error. The bar is four rows high.                                                       |
| `86-mobile-whole-item-dialog-dark-390.png`                                      | Phone whole-item confirmation.                                                                     |
| `87-mobile-many-variants-dark-390.png`                                          | Phone with `labelParts` chips. One clipped chip is visible.                                        |
| `88-mobile-read-only-dark-390.png`                                              | Phone closed run.                                                                                  |
| `89-mobile-filter-popover-dark-390.png`                                         | Phone list dialog. A tap on search opens the status menu over the list.                            |
| `crop-sidebar-top-dark.png`, `crop-sidebar-top-light.png`                       | 2x crop of the sidebar header, filter, and rows.                                                   |
| `crop-main-header-meta-dark.png`, `crop-main-header-meta-light.png`             | 2x crop of the main header and metadata strip. The progress fill is green.                         |
| `crop-heading-variants-dark.png`, `crop-heading-variants-light.png`             | 2x crop of the heading and chips. In light, the selected chip has no outline.                      |
| `crop-decision-bar-dark.png`, `crop-decision-bar-light.png`                     | 2x crop of the decision bar at rest.                                                               |
| `crop-decision-bar-saved-dark.png`, `crop-decision-bar-saved-light.png`         | 2x crop of the decision bar after one saved decision.                                              |
| `crop-variants-after-approve-dark.png`, `crop-variants-after-approve-light.png` | 2x crop of the chips after one approval. Chip 1 has no approved mark.                              |
| `crop-accepted-toggle-dark.png`, `crop-accepted-toggle-light.png`               | 2x crop of the "Accepted (1)" toggle at 16 px.                                                     |

## Measurements (command, raw result, limits)

All scripts are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-workspace/`. They use Chrome through Playwright (`channel: "chrome"`, headless), dark scheme unless noted.

1. `node measure-chrome.mjs`. Chrome budget at five viewports, fixture and preview route. Raw lines (fixture, offsets normalized by the 24 px harness label):
   - `fixture 1920x1080 {..."chromeAboveFirstImagePixel":408,"chromeShareOfViewport":0.378,"imageHeight":400,"imageVisibleHeight":400,"decisionBarHeight":61,"documentScrollHeight":1095,"viewportHeight":1080}`
   - `fixture 1440x900 {..."appHeader":[0,48],"mainHeader":[48,96],"meta":[96,122],"heading":[154,213],"variants":[233,271],"viewControls":[286,341],"paneLabel":[342,390],"imageViewport":[390,894],"image":[408,778],"chromeAboveFirstImagePixel":408,"chromeShareOfViewport":0.453,"decisionBarHeight":61,"documentScrollHeight":994}`
   - `fixture 1280x720 {..."chromeAboveFirstImagePixel":408,"chromeShareOfViewport":0.567,"imageHeight":317,"imageVisibleHeight":229,"imageFullyVisibleWithoutScroll":false,"documentScrollHeight":893}`
   - `fixture 1024x768 {..."chromeAboveFirstImagePixel":402,"chromeShareOfViewport":0.523,"imageHeight":231,"documentScrollHeight":913}`
   - `fixture 390x844 {..."chromeAboveFirstImagePixel":518,"chromeShareOfViewport":0.614,"imageHeight":235,"imageVisibleHeight":213,"decisionBarHeight":91,"documentScrollHeight":1624}`
   - `real-preview 1440x900 {..."chromeAboveFirstImagePixel":449,"chromeShareOfViewport":0.499,...}` and `real-preview 390x844 {..."chromeAboveFirstImagePixel":579,"chromeShareOfViewport":0.686,"imageVisibleHeight":176,...}`
   - Limits: fixture images are 600 x 400. Real screenshots have other sizes, so the visible image heights will differ. The chrome heights do not depend on the image.
2. `node probe-variants.mjs`. `initial {"navOverflowX":"auto","navScrollLeft":0,"navClientWidth":1120,"navScrollWidth":2079,..."chipWidths":[295,287,285,307,297,299,265]}`. `after ArrowRight x4 {"navScrollLeft":0,"selectedLabel":"5. Firefox ...","selectedLeft":1486,"selectedRight":1787,"navRight":1408,"selectedFullyVisible":false}`. `after key 7 "1. React ..."` (the key `7` is not a shortcut). Limits: the `windowScrollY: 24` in the output comes from the Playwright `focus()` call in the harness, not from the product.
3. `node probe-interaction.mjs`.
   - `filter: popover visible after clicking the search input: true`
   - `filter: popover visible after typing one character: true`
   - `filter: popover geometry while typing: {"popover":{"top":168,"bottom":333,"height":165},"rows":[{"top":178,"bottom":222},{"top":222,"bottom":266},{"top":266,"bottom":310},{"top":837,"bottom":904}],"rowsCovered":3}`
   - Tab order: 30 entries from "Visonaut review queue" to "Approve & nextA" (full list in the script output).
   - `shortcut scope: after clicking variant chip 2, focus on chip=true; pressing A saved 0 command(s)`
   - `shortcut scope: pressing D with focus on chip left viewer mode = side`
   - `shortcut scope: pressing ArrowDown with focus on chip left heading = Success dialog`
   - `shortcut scope: after clicking sidebar row 2, pressing A saved 1 command(s)`
   - `hit targets under 24px: [["Queue","68x23"]]` (desktop). Other sizes: `"Review status: All":"44x25"`, `"Compare S":"99x25"`, `"Fit":"46x25"`, `"Undo":"66x26"`, `"Keyboard help":"26x26"`, `"Previous screenshot":"29x29"`, `"Reject viewX":"134x35"`, `"Approve & nextA":"156x35"`, chips `295x30`.
   - `text volume above the fold: 145 words in 95 text nodes; "need(s) review" occurrences: 6`
   - `thumbnail: rendered 26x26, slot 26x26, row 215x44`
   - `banners: [{"text":"A stored image could not be read.","role":"alert","background":"rgba(0, 0, 0, 0)",...,"className":"text-sm p-3 ak-layer-warning"},{"text":"This closed run is read-only. ...","role":"status","background":"rgba(0, 0, 0, 0)",...}]`
4. `node probe-styles.mjs`. Dark and light give the same structure. Dark: `enabled {"approve":{"disabled":false,"background":"oklch(0.515341 0.1546 248.516)","color":"oklch(1 0 0)"},...}`, `archived {"approve":{"disabled":true,"ariaDisabled":"true","background":"oklch(0.515341 0.1546 248.516)","color":"oklch(1 0 0 / 0.733357)","cursor":"not-allowed"},"reject":{"disabled":true,...,"color":"oklch(1 0 0 / 0.449234)"}}`, `"fontSizes":{"16px":3,"13px":13,"10px":16,"11px":3,"12px":53,"28px":1,"14px":1}`, `"acceptedToggle":{"fontSize":"16px"}`, `"footerReason":{"fontSize":"16px"}`.
5. `node probe-flow.mjs`.
   - `filter+advance: rows visible with search 'Open menu': ["review-item-menu%2Fopen"]`
   - `filter+advance: after approving both 'Open menu' variants: {"heading":"Success dialog","rows":["review-item-menu%2Fopen"],"currentRowVisible":false}`
   - `approve x6: selected chip visibility: [{"selected":"2. Solid ","fullyVisible":true,"scrollLeft":0},{"selected":"3. Dark ","fullyVisible":true,"scrollLeft":0},{"selected":"4. Contrast ","fullyVisible":false,"scrollLeft":0},{"selected":"5. Firefox ","fullyVisible":false,"scrollLeft":0},{"selected":"6. WebKit ","fullyVisible":false,"scrollLeft":0},{"selected":"7. Wide ","fullyVisible":false,"scrollLeft":0}]`
   - `virtual list 1000 items: before scroll {"scrollHeight":44000,"clientHeight":733,"mountedRows":20,"rowHeight":44}`. The list virtualizes correctly. `estimatedItemSize={76}` (`item-list.tsx:348`) differs from the real 44 px but caused no visible error.
   - `queue link: document load events after click=1; requests by type={"document":1,"stylesheet":1,"script":221,"other":1,"fetch":2}; total=226`. Limits: Vite dev server. The script count is not a production number. Only the document reload is the finding.
6. `node probe-dropped-key.mjs`. `after first A: {"calls":1,"evidence":"loading","selected":"2. Solid ...","approveDisabled":true,"announcement":""}`, `after A, A, X while the candidate image loads: {"calls":1,"evidence":"loading",...,"announcement":"","saveState":"1 variant approved. Saved."}`, `after images load: {"calls":1,...}`. Limits: the image delay is simulated with a held route.
7. `node probe-layout-shift.mjs`. `ready: {"viewerTop":342,"imageViewportTop":390,"actionsTop":817,"actionsHeight":61}`, `loading next variant: {"evidence":"loading","viewerTop":383,"imageViewportTop":431,"actionsTop":841,"actionsHeight":61}`, `ready again: {"viewerTop":342,...}`, `after one saved decision: {"actionsTop":821,"actionsHeight":81}`, `after a failed save: {"actionsTop":804,"actionsHeight":97}`.
8. `node probe-button-shift.mjs`. `1440x900: approve button y before=854-888, after first approval=834-868, shift=-20px; element at the original pointer position={"tag":"DIV","text":"Reject viewXApprove & nextA","isApprove":false}; second click at same position saved 0 command(s)`. The same shift and the same miss at `1280x720` (674-708 to 654-688) and `390x844` (798-832 to 778-812). Limits: the pointer was at the center of the button. A pointer in the top 14 px of the button would still hit.
9. Phone targets and overflow, with `shot.mjs --width 390 --height 844 --mobile --steps '[{"eval": ...}]'`: `{"Visonaut review queue":"19x23","Review queue":"33x33","Queue":"68x23","Screenshots":"122x35","Previous screenshot":"29x29","Details":"87x35","Compare S":"99x25","Fit":"46x25","Undo":"66x26","All 7 changed views…":"166x26","Reject viewX":"134x35","Approve & nextA":"156x35","Keyboard help":"26x26"}` and `{"variantsScrollWidth":2079,"variantsClientWidth":358,"viewGroupScrollWidth":401,"viewGroupClientWidth":366,"kbdHintsVisible":["X:13","A:13"]}`.
10. Real route shortcut check, with `shot.mjs` steps on port 4310: after a click on chip 2, `{"focusInVariants":true,"url":"?item=dialog%2Fopen&variant=Dark"}`, then `D` gives `"side"`. After a click on the `h1`, `D` gives `"diff"`.
11. Scroll containers on the real route, with `shot.mjs` and `eval`: `{"docScroll":1035,"inner":900,"scrollingElement":"HTML","shellHeight":1035,"sidebarPosition":"sticky","mainHeaderPosition":"sticky","introPosition":"static","headerPosition":"sticky","footerPosition":"static"}`.
12. Source counts with `rg` in `apps/web/src`: primitive imports (`button` 12, `text` 9, `frame` 6, `shell` 5, `badge` 3, `nav` 3, `layer` 2, `popover` 1, `table` 1), `className=` per file (`review-workspace.tsx` 90, `item-list.tsx` 17, `variant-summary.tsx` 14, `screenshot-filter.tsx` 8, `review-status.tsx` 1), text size utilities, dimming utilities, `!` utilities, raw elements, and 9 `title=` attributes. Exact outputs are in the finding evidence.
13. `node capture.mjs` and `node crops.mjs`. They produce the screenshots in the list above. One screenshot was renamed after review of its content (`31-saving-one-queued-...`), because the fixture marks a delayed save as queued at once.

General limits: every number comes from a local dev server on macOS with headless Chrome. No timing number is reported, because local timings do not represent the Workers deployment. Network cost in the decision flow is counted from the code, not measured.

## Open questions and items not verified

1. Two narrow-layout tests may disagree. The sidebars use a container query on the shell (`$show="5xl"`), and the dialogs use `matchMedia("(max-width: 1023px)")` on the viewport. With a classic 15 px scrollbar (Windows or Linux defaults) and a viewport of 1024 to 1039 px, the shell container could be below 64 rem while `narrow` is false. Then the sidebar and its toggle would be hidden and the "Screenshots" button would not render, so the item list would be unreachable. I could not reproduce this on macOS: headless Chrome kept overlay scrollbars (`scrollbarWidth 0`) even with `--hide-scrollbars` removed and with `::-webkit-scrollbar` styles. Status: not verified. A test on Windows would settle it.
2. WORK-14 says that a large run starts with an almost full progress bar. This follows from `api/review-inventory.ts:95-168` and `review-workspace.tsx:317-326`. I did not load a real large run. Status: derived from code.
3. WORK-08 and the decision sequence state request counts (`review/client.ts:305-338`). I did not measure them against the real API. The fixture replaces `commands`. Status: counted from code.
4. WORK-18 depends on the server sending `recompareAllowed: false` in every model (`api/review.ts:592`). I found no other writer of this field. I did not load a production model. Status: verified by code search only.
5. WORK-32 (row click against remembered variant) is from code reading of the route path. The fixture has no route, and I did not drive the route fixture for it. Status: not measured.
6. The disabled look of a `$layer="brand"` button (WORK-06) may be the intended upstream design. I did not check the upstream button sandbox for a disabled layered example. The measurement shows only what the vendored recipe does here.
7. The browser tab title is "Visonaut" on every route (`routes/__root.tsx:10`). A run page does not put the pull request or item name in the title. This is outside this lane (route level), so it is not a finding here.
8. I did not test with a screen reader, forced colors, or 200% zoom. The existing browser tests cover reflow at 200% zoom (`review.browser.test.ts:1797-1841`). The accessibility findings here (WORK-11, WORK-26, WORK-29) come from DOM roles, sizes, and Tab order only.
9. The upstream primitives named in the redesign ideas (`Progress`, `Tooltip`, `Dialog`, `Separator`, `Input`, `Combobox`, `List`, `Link`, `Code`, `Heading`) exist in `/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components`. I read their export names and the sandbox examples, but I did not build with them.
10. Layout D needs diff thumbnails of useful size, and layouts D and E need a product decision on cross-item bulk approval and on the "decide only on loaded pixels" rule (`docs/review-guide.md:41`). I did not check what thumbnail sizes the service can produce.
