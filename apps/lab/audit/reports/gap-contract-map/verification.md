# Verification: gap-contract-map (binding UI contract, keyboard map, limits for the redesign)

Date: 2026-10-05. Read-only. I did not write the audited report.

- ROOT = `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`
- LANE = `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-contract-map`
- V = `LANE/verify` (my scratch directory: scripts, raw output, screenshots)

Short file names are the same as in the report: `issue-1` (`docs/simplification-audit/contract-issue-1.md`), `contract` (`docs/current-contract.md`), `guide` (`docs/review-guide.md`), `ws` (`apps/web/src/review/review-workspace.tsx`), `list` (`item-list.tsx`), `nav` (`navigation.ts`), `viewer` (`apps/web/src/components/screenshot-viewer.tsx`), `session` (`use-review-session.ts`), `tests` (`apps/web/src/review/__tests__/review.browser.test.ts`).

## Which report I verified

`LANE/report.md` does not exist. The harness refused the auditor's `Write` call ("Subagents should return findings as text, not write report files"). I recovered the text of that call from the auditor's transcript (`V/extract-report.mjs` writes `V/auditor-report-write-0.md`, 947 lines). `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/_normalized/gap-contract-map/report.md` has the same content (`diff` prints nothing, both 113,958 bytes). All line numbers of the report below refer to that text.

## Method

1. I opened each cited file and compared each quote and line range.
2. I ran my own browser probes (Chrome through Playwright, 1440 × 900, dark, unless stated):
   - `node V/verify-probe.mjs` → `V/verify-probe-output.json` (11 probes: chip focus in the fixture and in the routed preview app, memory, decisions, filter, toggle, refusal, viewer, narrow, layout, synthetic keys, help).
   - `node V/verify-probe-2.mjs` → `V/verify-probe-2-output.json` (Playwright visibility of the live region, selected chip position, layout at scroll 0, chip verdict, completion, recompare control).
   - `node V/verify-probe-3.mjs` → `V/verify-probe-3-output.json` (order of the `keydown` listeners on `document`, read with the Chrome DevTools Protocol).
3. I ran the auditor's `count-pins.mjs` again and counted the main numbers with plain `grep -c`.
4. `node V/check-quotes.mjs` checks that 30 quoted lane proposals exist in the other lane reports.
5. Platform facts come from the official pages. The URLs are in the sections that use them.
6. I opened all 21 screenshots of the auditor and all 16 of mine.

## Summary

No finding is refuted. 18 are confirmed. 10 are partly confirmed: the main fact holds, and one part of the text or of the recommendation is wrong.

| ID      | Verdict          | Auditor severity | My severity |
| ------- | ---------------- | ---------------- | ----------- |
| RULE-01 | confirmed        | medium           | low         |
| RULE-02 | confirmed        | medium           | medium      |
| RULE-03 | confirmed        | low              | low         |
| RULE-04 | partly-confirmed | high             | high        |
| RULE-05 | confirmed        | low              | low         |
| RULE-06 | partly-confirmed | medium           | medium      |
| RULE-07 | confirmed        | medium           | low         |
| RULE-08 | partly-confirmed | low              | low         |
| RULE-09 | partly-confirmed | medium           | medium      |
| RULE-10 | partly-confirmed | medium           | medium      |
| RULE-11 | confirmed        | medium           | medium      |
| RULE-12 | confirmed        | medium           | medium      |
| RULE-13 | confirmed        | medium           | medium      |
| RULE-14 | partly-confirmed | low              | low         |
| RULE-15 | confirmed        | medium           | medium      |
| RULE-16 | partly-confirmed | medium           | low         |
| RULE-17 | confirmed        | medium           | low         |
| RULE-18 | confirmed        | low              | low         |
| RULE-19 | confirmed        | medium           | low         |
| RULE-20 | confirmed        | medium           | low         |
| RULE-21 | confirmed        | low              | low         |
| RULE-22 | partly-confirmed | medium           | low         |
| RULE-23 | confirmed        | medium           | low         |
| RULE-24 | confirmed        | low              | low         |
| RULE-25 | partly-confirmed | medium           | low         |
| RULE-26 | confirmed        | medium           | medium      |
| RULE-27 | confirmed        | high             | medium      |
| RULE-28 | partly-confirmed | low              | low         |

Three corrections change what the maintainer reads:

1. RULE-09 and idea G use a wrong number. The image viewport starts at y = 390 in the product, not at 366. The auditor subtracted the 24 px fixture label two times.
2. RULE-10 says that the full variant label is not on screen. In the fixture each chip shows all label parts as text. The real defects are different and stronger: a chip shows no verdict, and a key can select a chip that is outside the visible strip (measured).
3. RULE-04 says that no document names the exclusion. The in-app help names it ("tabs … keep their own keys"). The defect itself is confirmed, also in the routed app, and I measured that the recommended fix is safe there.

One context fact applies to RULE-01, RULE-05, and RULE-06: commit `f83fef6` is the maintainer's own commit of the same day (`Haz`, 2026-10-05 15:40, `git show --stat --format='%an %ad' f83fef6`). These three items are documents that did not follow a deliberate, tested UI change. They are not accidental UI defects.

One scope fact applies to RULE-20 to RULE-27: the request for this audit says that the current patterns do not need to be preserved. The earlier decisions are context for the design app. They are not a prohibition.

---

## RULE-01 · Narrow layout: the item list is in a dialog, not above the viewer

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof:
  - `issue-1:267` and `guide:94`: quotes exact.
  - `ws:211-213` (`max-width: 1023px`), `ws:625-632` (button), `ws:1206-1222` (`ak.Dialog open={itemsOpen && narrow}`), `ws:559` (`{!narrow && itemNavigation}`): as cited.
  - `tests:1914-1953` and `tests:167-210` open the list through the "Screenshots" button at 390 px.
  - `git show f83fef6 -- apps/web/src/review/review-workspace.tsx` adds `+ open={itemsOpen && narrow}` and `+ {narrow && (` for the button.
  - My measurement at 390 × 844 (`verify-probe.mjs narrow`): `"screenshotsButton":{"y":162,"h":35}`, `"panes":[{"y":476,"h":521},{"y":998,"h":521}]`, `"firstImageViewport":{"y":524}`, `"scrollWidth":390`. Equal to the auditor's numbers. Screens S13, S14, S15, and my `v05`, `v06` show it.
- Corrections:
  - New measurement: the same branch is active at 1023 px, where the two images are still side by side (`"at1023":{"screenshotsButton":true,"sideBySide":true}`). So "narrow" is not only a phone case. A half-width desktop window also loses the list.
  - "The rule, the guide, and the tests say three different things" is two things. The rule and the guide agree (list above, images stacked). The code and the tests agree with each other.
  - The commit is the maintainer's own, with tests. So this is document drift after a deliberate change. That is why my severity is low.
  - Idea D (a `Disclosure` above the viewer): `Disclosure` and `DisclosureButton description` exist in the vendored copy (`components/ariakit/components/disclosure.ariakit.react.tsx:651-656`). The open state needs a fixed maximum height, because the virtual list needs its own scroll box (`list:343`, `review-item-scroll … overflow-auto`).

## RULE-02 · Thumbnails: no current writer, and the selection rule is not the contract rule

- Verdict: **confirmed**. Severity: **medium**.
- Proof:
  - `nav:177-179` is quoted exactly. `apps/web/src/api/review.ts:505-507` sets `thumbnail` only from `result.thumbnailImageId`.
  - `grep -rn thumbnail` over `apps/web/src/api/local-comparison.ts`, `apps/web/src/api/workflow-materialize.ts`, `packages/service/src/service.ts`, `packages/cli/src`, `apps/web/src/review/preview-fixtures.ts`: no line.
  - `apps/compare/src/index.ts` imports only `./codecs.ts` and `./validate.ts`. `processComparisonTask` has importers only in `apps/compare/test/process.test.ts`.
  - `apps/web/src/review/__tests__/fixture-model.ts:27` injects a thumbnail in each fixture variant.
  - My measurement on port 4310: `"rows":[{"text":"— Dialog 2 of 2 need review","thumbnail":"empty"}]`. Screens S17 and my `v09` show the dash tile.
- Corrections:
  - There are two writer files, not one. `apps/compare/container/transport.ts:207` also writes `thumbnailImageId`. Its only importer is `apps/compare/test/container.test.ts`. The conclusion does not change: no production path writes a thumbnail.
  - The sentence "If a thumbnail existed on the second variant only, the code would show it" is true from the code. Nobody observed it, because no current run has a thumbnail.
  - I did not see a production row. The claim for production comes from the code and from the preview app.

## RULE-03 · First visit by keyboard opens the first pending variant, and auto-advance does not update the remembered variant

- Verdict: **confirmed**. Severity: **low**.
- Proof:
  - `issue-1:271`, `guide:82`: quotes exact. `ws:359-362` is quoted exactly. `tests:399-416` pins it.
  - D04 context in `docs/simplification-audit/prior-r9.json` (read with `node`): "First visit starts at its first variant. Auto-advance selects the next pending variant and updates that item’s memory."
  - My measurement (`verify-probe.mjs memory`): first visit with an approved first variant → `"2. Menu-dark … Needs review"`. `3`, `A`, Down, Up → `"3. Dark … Approved"`.
- Additions:
  - `git log -S"next.variants.find(needsReview)"` → `859ad6f` (2026-09-27, #104, by the maintainer). The behavior is older than the frozen contract text. The U03 record names "PR #104 first-pending link targets" only for links. So the keyboard case was never written down.
  - New measurement: the fixture and the routed app differ for a row click. In the fixture a row is a button that calls `selectItem` (`list:229`), so it uses the memory (`"afterRowClickBackToFirstItem": "3. Dark …"`). In the routed app a row is a link to the first pending variant (`ws:457`). Only `route.browser.test.ts:359` covers the routed rule.

## RULE-04 · The variant strip blocks every shortcut, and no document names this exclusion

- Verdict: **partly-confirmed**. The defect is confirmed. The second half of the title is wrong. Severity: **high**.
- Proof of the defect:
  - `ws:95` ends with `[role="tablist"], .review-variants, [data-screenshot-search]`. `ws:729` puts `review-variants` on the variant `Nav`.
  - Fixture (`verify-probe.mjs chipFocus`): after a click on chip 2 the focus is `a.review-variant[2. Solid …]`. After `a x d ArrowDown 2 Control+z Shift+A`: `"calls":0`, `"mode":"side"`, `"heading":"Success dialog"`, variant still "2. Solid". After a click on the `h1`, `d` gives `"mode":"diff"`.
  - Routed app, port 4310 (`chipFocusRouted`): after a chip click, `d` and `g` leave `"mode":"side"`. After a click on the heading, `g` gives `"mode":"original"`.
  - No test pins the dead keys. The tests that click or focus a chip (`tests:29`, `route.browser.test.ts:344-347`, `:373`, `:489-490`) press only arrow keys after it, and the strip handles those itself.
- Correction to the title: three texts name the exclusion of tabs.
  - `ws:162-163`, the in-app help: "Text fields, tabs, menus, and dialogs keep their own keys." (screen S21)
  - `docs/simplification-audit/handoff-draft.md:25`: "The new design keeps native input and tablist key behavior."
  - The selected U04 text: "Controls that consume arrow keys, such as tabs and menus, keep their own keyboard behavior."
  - What no text says: letters, digits, and Cmd/Ctrl+Z also stop there. `guide:84` does not list tabs at all.
- The recommended fix is feasible, and it is the recorded design:
  - `docs/simplification-audit/evidence/feedback-ui.md:71`: "Controls that consume a key run first. Honor `defaultPrevented`".
  - The fix needs the React handler of the strip to run before the page listener. In the routed app both are on `document`, because `routes/__root.tsx` renders `<html>`. I measured the order (`verify-probe-3.mjs`): on `document` the bubble listeners for `keydown` are `{"order":101,"line":12489}` (the React root listener; the same line is on `#root` in the fixture) and then `{"order":102,"line":5073}` (the workspace listener). Listeners of one phase on one node run in registration order. So `followVariantLink` runs first.
  - In the fixture a late `document` listener saw `{"key":"ArrowRight","defaultPrevented":true}` for a key that the strip handled.
- Side effects of the fix that the report does not name:
  - `followVariantLink` returns on a modifier before `preventDefault` (`ws:100`). So Shift+Arrow on a chip goes to the page handler and acts as a plain arrow (`ws:416-423` does not read Shift).
  - A digit or Up/Down with focus on a chip changes the selection and leaves the focus on the old chip.
- Alternative (a), "move focus to the workspace root after a chip click", is against `feedback-ui.md:72`: "Do not synthesize clicks or force focus to the Shell to make global keys work."

## RULE-05 · The variant glider is flat with a border; the later approved rule says "bar glider"

- Verdict: **confirmed**. Severity: **low**.
- Proof:
  - `contract:192`: quote exact. `ws:719-727`: `$kind: "flat" … $border: true`.
  - `git show f83fef6` has `- glider={{ $kind: "bar", $barOffset: "frame" }}` and `+ $kind: "flat",`.
  - My measurement (`layout`): the variant glider box is `{"w":295,"h":30}` with `"borderTop":"1px solid"` and radius `3.35544e+07px`, and its class has no `glider-bar`. The item glider is `{"w":2,"h":44}` with `glider-bar-end`.
  - S20 and my `v08` (light): the selected chip has no visible outline.
- Additions:
  - Open question 9 of the report is settled. PR #184 (`git show 32c2029`) added a `Nav` with `aria-label="Run views"` in `routes/index.tsx`. So "run views" means the dashboard views. Today that is `apps/web/src/components/app-shell.tsx:49`, and it has the bar glider. The image mode switch is not in the scope of that sentence.
  - The maintainer replaced the glider in his own commit of the same day. This is document drift.

## RULE-06 · The whole-item command has two paths with different safety

- Verdict: **partly-confirmed**. All facts hold. One alternative describes behavior that exists today. Severity: **medium**.
- Proof:
  - `ws:427` and `ws:429` pass `event.shiftKey`. `ws:1042-1059` opens the dialog at `ws:1242-1296`.
  - My measurement (`decisions`): Shift+A → `{"verdict":"approved","targets":7,"wholeItemKey":"dialog/open"}`, `"dialogs":[]`. The button → `"dialogs":["Review all changed views"]`, `"calls":0`, buttons `["Cancel","Reject whole item (7)","Approve whole item (7)"]`.
  - `"visibleShiftHints":[]`: no visible Shift hint outside the help dialog.
  - `git show f83fef6` removes `<ButtonSlot $kind="shortcut">Shift A</ButtonSlot>` and `Shift X` from two direct buttons.
  - Both paths are pinned: `tests:714-732` (key, no dialog) and `tests:1843-1883` (dialog).
- Correction: alternative (a), "show the target count and an Undo control in a visible status after the key path", is the current behavior. After Shift+A the bar shows "7 variants approved. Saved." and Undo is enabled (`"saveStateText":"7 variants approved. Saved."`, `"undoEnabled":true`, screen S03). The real choice is between a confirmation on both paths and no confirmation on both paths, plus a visible hint for the Shift keys.
- Addition: the server checks the whole-item target list (`packages/service/src/review-commands.ts:194-203`, "The whole-item target list must include every changed variant."). So the key path cannot save a partial item.

## RULE-07 · "Next pending in visible order" ignores an active filter

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof:
  - `nav:144-163` walks `items.flatMap(…)`. `session:313` calls it with the full model.
  - My measurement (`filteredNext`): filter "menu" → rows `["Open menu\n2 of 2 need review"]`. After two approvals: `"heading":"Success dialog"`, `"selectedRowVisible":0`, `"searchValue":"menu"`. Screens S16 and my `v02`.
- Corrections:
  - The kind is an unclear rule, not a bug. The filter came with `f83fef6` (`apps/web/src/review/screenshot-filter.tsx`, 177 new lines). The rule text "visible order" is older than the filter.
  - Without a filter the code agrees with the rule. Pending variants exist only in the attention group, and `partitionItems` keeps the model order inside that group (`nav:34-47`).
  - The recommendation is feasible. `nextPending` is called inside the session hook, so the hook needs the visible order as an input. The case "the current item is not in the filtered order" needs a rule too.

## RULE-08 · The shortcut toggle is below the fold and not stored; `[` and `G` have no contract row

- Verdict: **partly-confirmed**. The facts hold. Two arguments in the text are wrong. Severity: **low**.
- Proof:
  - `ws:199` `useState(true)`. `ws:407-411` binds `[`. `ws:436-437` binds `g`. `issue-1:269-278` has no row for `[` or `G`. `guide:77` has `G`. `guide:69-80` has no `[`.
  - My measurement (`toggle`): toggle at `y: 982` in the fixture (958 without the 24 px fixture label), viewport height 900. After a click: "Shortcuts off". `localStorage` is `{"visonaut.review.sidebar":"true"}`. After a reload: "Shortcuts on". The hints stay: `"Compare S","Difference D","Current F","Baseline G", … "Reject view X","Approve & next A"`.
  - Preview app on port 4310: toggle at `y: 999` (with a 41 px preview notice above it). So the toggle is below the fold in the routed app too.
- Corrections:
  - D10 (`contract:54`) is the row "keep copied components". Its "keyboard behavior" is the behavior of the copied component set. It is not a rule about workspace shortcuts. So `[` does not conflict with D10.
  - WCAG 2.1.4 asks only that "A mechanism is available to turn the shortcut off" (https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html). The page has no rule that the setting must be stored or easy to find. The missing storage is a usability cost, not a conformance failure.
  - `G` is also in the in-app help (`ws:174`) and in the U04 option text ("Keep A/X/F/S/D/G"). `[` is only in the in-app help (`ws:178`).
  - One detail is right in the code: `aria-keyshortcuts` goes away when shortcuts are off (`ws:574`, measured `null`). Only the visible hints stay.

## RULE-09 · The selected U02 layout is delivered in two of five parts

- Verdict: **partly-confirmed**. The two central parts differ, as the finding says. One number, the count, and one impact sentence are wrong. Severity: **medium**.
- Proof:
  - `ws:563-608` (header content), `ws:1017-1139` (sticky bottom bar), `viewer:134` (`h-[min(56vh,650px)]`), `ws:1142-1171` (Details): as cited.
  - `docs/simplification-audit/evidence/visonaut-audit-ui.json:110-118`: `"imageViewportTop": 385`, `"undoTop": 1059.39` at 1440 × 1000.
- Correction of the number (`verify-probe-2.mjs layoutScroll`):

  ```text
  fixture, scrollY 0:   workspace y=24   pane y=366   image viewport y=414   first image row y=432
  fixture, scrollY 24:  workspace y=0    pane y=342   image viewport y=390   first image row y=408
  preview (4310):       41 px notice     image viewport y=431 (= 390 + 41)
  ```

  The auditor's probe focused the workspace first, and that scrolled the page by 24 px. So its `"y":390` was already without the label. The product value is 390 for the image viewport, 342 for the pane caption, and 408 for the first image row. The text "366 without the 24 px fixture label" and the "about 366 px" in idea G are 24 px too small.

- Correction of the count: three parts are delivered, not two. They are one `ShellHeader` (`app-shell.tsx:23`), the item sidebar (`ws:536-561`), and Details (`ws:1142-1171`). Two parts differ: the actions are not in `ShellMainHeader`, and the image area has a fixed height. Table A of the report says "3 of 5", and the title says "two of five".
- Correction of the impact: "distant recovery controls" is fixed. Undo is in the sticky bar at y = 841 (was 1059). Only "stacked headers" is open: 390 px now against 385 px before.
- The 53 px overlap is right (viewport bottom 894, bar top 841). In the fixture that area is the checker padding, because the fitted image ends at y = 778.

## RULE-10 · The full variant label, the verdict on chips, and the list dot do not meet "text with color"

- Verdict: **partly-confirmed**. Part 2 (the verdict on chips) is confirmed. Part 1 is too strong for the fixture and right for production data. Part 3 (the dot) is not a breach of the rule. Severity: **medium**.
- Part 1, the full label:
  - Fixture: each chip shows all label parts as visible text. `"firstChipText":"React Chromium Light 1280 × 720 1 …"`. The auditor's probe searched for the joined string "React · Chromium · Light · 1280 × 720". That string exists only in `span.sr-only` and in the closed Details panel. The parts are on screen (S01).
  - The key part is not cut in the fixture: `{"text":"1280 × 720","scrollWidth":65,"clientWidth":65,"maxWidth":"144px"}`.
  - Production: the orchestrator's record `audit/live-authenticated.md` says "Variant chips read `React · Chromium · Light · react-chrome-default-d…`". So the 144 px limit (`variant-summary.tsx:117`) cuts real keys.
  - New measurement, stronger than the finding (`chipInView`): after the key `6`, the selected chip is at x = 1789 to 2092. The strip viewport is x = 288 to 1408, and `scrollLeft` stays 0. After Right to variant 7, the chip is at x = 2094 to 2363. No visible element names the variant. My `v11` and `v12` show a strip with no selected chip.
- Part 2, the verdict: confirmed (`chipVerdict`). After an approval and a rejection, chips 1 and 2 have the same color, background, and border as an unselected pending chip. The verdict is only in `title` and `aria-label` (`ws:747`, `ws:776`). My `v13` shows it.
- Part 3, the dot: `list:250-256` and `list:270-274` use the same priority for the row text and for the dot color (errors, then running, then rejected, then pending). So each dot has a text beside it. This is not "color without text". The real limits are these two:
  - The row names one state only. Measured: "Success dialog 1 rejected variant" with a red dot, while 5 variants of that item still need review (`v14`).
  - The row of an automatically accepted addition reads "New item 0 of 1 need review" with no mark "Accepted automatically" (`issue-1:263`; screen S09).

## RULE-11 · Image position is kept only inside one pane

- Verdict: **confirmed**. Severity: **medium**.
- Proof:
  - `viewer:35` (one `position` ref for each pane), `viewer:39-41` (reset on a new identity).
  - My measurement (`viewer`): at 200%, Baseline `{"left":300,"top":200}` and Current `{"left":0,"top":0}`. `D` shows Difference at `{0,0}`. `S` restores Baseline `{300,200}`. The next variant gives all 0 with `200%:true`. Eight pan buttons. Screens S08 and my `v04`.
- Corrections to the recommendation:
  - The reset on a variant change is a tested behavior, not an accident: `tests:1695-1761`, "a diff loads on first use and keeps pan until the variant changes". The part "kept across variants of one item" needs a decision and a test change.
  - Alternative (a), scroll sync between panes, needs a guard against a feedback loop between the two `onScroll` handlers (`viewer:138-144`), and a rule for images of different sizes. A size change is a normal case (`contract:124`, "A dimension change requires review").

## RULE-12 · The pull request title is read from a payload that the service clears

- Verdict: **confirmed**. Severity: **medium**.
- Proof (the auditor marked this "Measured: no"; the code proof is complete):
  - Read: `apps/web/src/api/dashboard.ts:57-62` and `apps/web/src/api/review.ts:288` use `json_extract(payload_json,'$.pull_request.title')`.
  - Clear: `apps/web/src/api/webhooks.ts:330-335` runs for each processed delivery, also for `pull_request`: `SET processed_at = ?, payload_json = '{}'`. Also `:150`, `:172`, and `apps/web/src/operations/recovery.ts:73`.
  - Write: `packages/security/src/webhooks.ts:87` is the only `INSERT`. No other code writes a title.
  - Decision record: `docs/simplification-audit/evidence/feedback-ui.md:134` and `:139-140`: quotes exact.
  - Other evidence: the dashboard verifier ran the SQL again (`audit/ui-dashboard/verification.md:118-124`: "after processing, title IS NULL|1"). The orchestrator saw production: "History rows show `#7746 · Pull request` because no pull request title is available" (`audit/live-authenticated.md`).
- Additions:
  - The API test cannot see the defect. `apps/web/src/api/dashboard.test.ts:42-56` inserts deliveries with `processed_at` set and with the full payload. Production never has such a row.
  - `apps/web/migrations/0028_pr_title_index.sql` indexes the cleared column. With the recommended fix the index and its test (`dashboard.test.ts:265-275`) have no use.

## RULE-13 · Refusal, completion, and fallback messages reach only the screen-reader live region

- Verdict: **confirmed**. Severity: **medium**.
- Proof:
  - `session:417-429` calls only `onAnnounce`. `ws:1202-1204` is `<p className="sr-only" role="status" …>`.
  - My measurement (`refusal`): after Shift+X with one protected target, the only node with the text is `{"className":"sr-only","width":1,"height":1,"clipPath":"inset(50%)"}`, and `"calls":0`. Dialog path: `"dialogRejectDisabled":false`. After the click the dialog is closed and `"visibleStatusAfterDialogReject":[]`. My `v03` is equal to the default screen.
  - `srOnlyVisibility`: Playwright returns `isVisible: true` for this 1 × 1 px node. The Playwright rule: "Element is considered visible when it has non-empty bounding box and does not have `visibility:hidden` computed style." (https://playwright.dev/docs/actionability). So `tests:784-786` passes with no visible text.
- Limits of the finding:
  - When the protected variant is the selected one, the reason is visible and the button is disabled (`ws:799-804`; measured: the reason line is shown and `"rejectDisabled":true`). The gap is the whole-item command whose protected target is another variant.
  - Completion has indirect visible signs: "0 of 11 need review", a full bar, and "1 variant approved. Saved." (`completion`, `v15`). The sentence "Review complete. No variants need review." itself is only in the live region.
- Alternative (b) is cheap: the dialog already lists each target (`ws:1257-1264`), so the reason can stand beside the protected target, and the button can be disabled.

## RULE-14 · Hand-built pieces stand where copied primitives exist

- Verdict: **partly-confirmed**. The facts hold. The claim about D10 is an interpretation. Severity: **low**.
- Proof:
  - `ws:149-187` (help dialog from `ak.Dialog` and class strings), `ws:165` (`<dl>`), `ws:599` (`<progress>`), `ws:690-706` (four `<p … ak-layer-warning>`), `ws:1041` (`<div className="h-5 w-px bg-current/10" />`).
  - `grep -rn "kbd\.ariakit"` and `grep -rn "tabs\.ariakit"` under `apps/web/src`, without the two files themselves: no line.
  - The vendored folder has 13 components: badge, button, disclosure, frame, kbd, layer, nav, popover, shell, table, tabs, text-frame, text. It has no dialog, tooltip, progress, or input.
- Corrections:
  - "U01 cannot be met for these parts without a change to D10" is one reading. D10 says "Keep the component set … No pruning or replacement is selected." It does not forbid an addition. The U01 record allows local markup: "keep those few rules local; do not grow a new recipe or wrapper to meet a one-page need."
  - The design app already uses a newer copy: `apps/lab/src/components/ariakit/NOTICE` names commit `643a23af`, and `apps/web` pins `fc85b809`. See "Notes on the tables and the redesign ideas".

## RULE-15 · The review guide describes the UI before commit f83fef6

- Verdict: **confirmed**. Severity: **medium**.
- Proof: I checked all 11 rows of the table.
  - `guide:31-34` against `ws:845`, `:860`, `:874`, `:888` ("Compare", "Difference", "Current", "Baseline").
  - `guide:45` against `ws:1095` ("Approve & next") and `ws:1077` ("Reject view").
  - `guide:92` "All runs" against `ws:584` "Queue".
  - `guide:15` "The Runs page" against `app-shell.tsx:15-19` ("Review queue", "Run history", "Service status").
  - `git show --stat --format= f83fef6 -- docs` prints nothing.
- Corrections:
  - `guide:49` is half right. "Approve whole item (7)" and "Reject whole item (7)" exist, with the count, inside the dialog (`ws:1280`, `ws:1293`; screen S04).
  - `guide:88` needs a stronger statement. The control is not only "rendered". In production it is always disabled, with a sentence beside it. `apps/web/src/api/review.ts:592` sets `recompareAllowed: false` for each model, and `apps/web/src/review/client.ts:355` always defines `recompare`. So `ws:1186-1201` prints a dead button and a reason, for example "Run trusted Submit again from the complete CI bundle, or capture a new run. Unchanged candidate images were not uploaded." (`review.ts:597`). My `v16` shows this state in the fixture (`?localComparison`): `{"present":true,"disabled":true,"footerText":"Shortcuts on Recompare stored run Rerun trusted Submit to compare locally again."}`.

## RULE-16 · The contract documents disagree with each other on six UI points

- Verdict: **partly-confirmed**. Four points hold. One is partial. One is not a conflict. Severity: **low** (auditor: medium).
- Checks:
  1. Shortcut scope: confirmed. `issue-1:280`, `docs/design-r9.html`, and `handoff-draft.md:25` are as quoted.
  2. Variant semantics: confirmed. `docs/simplification-implementation.md:89` still links "linked tabs".
  3. Advance timing: confirmed (`issue-1:274` against `contract:192`).
  4. Run identity: partial. The U02 text keeps "One compact ShellHeader for project/run context" and moves only "run IDs" to Details. `visonaut-audit-ui.json:564-582` lists "Run/PR identity" under `keepVisible`, and "Run ID" and "Attempt" under `moveToDetails`. The only real conflict is the attempt number (`guide:17`).
  5. Modes: confirmed. `grep -n "Original only"` in `issue-1` finds nothing.
  6. First variant: not a conflict between documents. `issue-1:271` is the keyboard rule. The U03 sentence is the link rule. The U03 tests keep them apart on purpose: "First-pending item links and remembered keyboard variants stay distinct." The real conflict is code against `issue-1:271`, and that is RULE-03.
- Corrections:
  - The quotes of `docs/design-r9.html` are on lines 25, 26, and 27. Line 19 is the start of the section.
  - `contract:7` links the supersession map (`handoff-draft.md#rules-that-supersede-issue-1`). So the path to the later rule exists, though it is indirect.
  - "Six of the nine UI lanes worked without the contract" has no evidence in the report. I could not check it.

## RULE-17 · Tests pin behavior that contradicts the contract, and two tests prove less than their names say

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof:
  - `node LANE/count-pins.mjs` gives the same totals: `"statements":610,"accessibleName":368,"state":344,"visibleText":206,"classHook":78,"requestOrder":56,"geometry":27,"tests":112`.
  - Plain `grep -c`: 112 `test(` sites (73 + 17 + 5 + 8 + 9). 610 lines that start with `expect`. 33 uses of the exact name "Approve & next A" (29 + 3 + 1). 12 uses of "Recompare stored run" (11 + 1). 66 lines with `selected(page)` (65 uses and the helper).
  - `tests:399-416`, `tests:751-753`, `tests:784-786`, `tests:1914-1953`: as cited.
- Corrections:
  - Three tests, not two, call `toBeVisible()` on live-region text. The third is `tests:429-431` ("The remembered variant is unavailable…"). RULE-13 has the measured proof.
  - The script prints 160 key presses. Two are false matches (`Existing`, `Unchanged`). The report's 158 is the right number.
  - "A redesign breaks most of the 610 assertions" is an estimate. Nobody ran the suite against a variant.
  - My severity is low because pinned strings are normal for a browser suite. The real defect is small: three assertions that cannot fail on visibility.

## RULE-18 · The lab primitives guide shows `R` for Reject; the contract key is `X`

- Verdict: **confirmed**. Severity: **low**.
- Proof: `apps/lab/docs/primitives.md:2331-2353` has `<Kbd>J</Kbd> <Kbd>K</Kbd> Navigate`, `<Kbd>A</Kbd> Approve`, `<Kbd>R</Kbd> Reject`, `<Kbd>⌘</Kbd> <Kbd>K</Kbd> Search`. `issue-1:274` has "A / X".
- Note: `apps/lab/` is untracked work of this same run (`git status --short apps/lab` → `?? apps/lab/`). The file can change after this check.

## RULE-19 · `[` and `]` have three proposed meanings and fail on common keyboard layouts

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof:
  - Proposals (`check-quotes.mjs`): WORK:561 "The sidebar stays, and `[` hides it." SHELL:766 "Column 1 collapses with `[`." VIEW:514 "`[` and `]` move it with the keyboard."
  - `ws:398` `if (event.altKey) return;`. My synthetic events (`syntheticKeys`): `{key:"[", altKey:true}` leaves `"sidebar":"true"`. A plain `[` gives `"false"`, and a second one gives `"true"`.
  - Platform: MDN lists for `getModifierState("Alt")` on macOS "⌥ Option key pressed", and on Windows "Either Alt key or AltGr key pressed" (https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState). So a layout that types `[` with Option or AltGr has `altKey` true, and `ws:398` returns.
- Limit: synthetic events only. No real layout was used. A visible button does the same job (`ws:567-579`). That is why my severity is low.

## RULE-20 · Proposals that let arrow keys pan return to two options that the maintainer rejected

- Verdict: **confirmed** for the facts. What to do with it is a design decision. Severity: **low** (auditor: medium).
- Proof:
  - U04 options in `docs/simplification-audit/audit-data.json` (dump in `LANE/ui-decisions.txt:176-226`): `focus-owned`, `pan-mode`, `global` (selected, with the maintainer's note). The file has the date 2026-09-29.
  - `visonaut-audit-ui.json:402`: `"short": "Let focused controls own arrow keys"` (the research recommendation).
  - `feedback-ui.md:115`: quote exact.
  - VIEW:145 and A11Y:199: quotes exact. SHELL:833-836: "left and right for items, up and down or number keys for variants".
  - My measurement: Shift+ArrowDown changes the item, and Shift+ArrowRight changes the variant.
- Additions:
  - Key map C (pan with Shift+Arrow) is feasible with one branch. The strip and the list already ignore shifted arrows (`ws:100`, `list:321`), so only the page handler needs a Shift case.
  - The verifier of the accessibility lane marked A11Y-05 in the same way (`audit/ui-a11y/verification.md:23`).

## RULE-21 · `J`/`K`, `N`/`P`, `G`, `I`, and `R` have more than one proposed meaning

- Verdict: **confirmed**. Severity: **low**.
- Proof: the quotes exist. WORK:666 "`J` and `K` move between cards". VIEW:145 lists zoom and pan keys. `LANE/key-mentions.txt` has 178 key lines from the nine lane files. `ws:436` binds `g`. RULE-18 covers `R`.
- Note: this is an inventory of proposals. It is a fact about the proposals, not a defect of the product.

## RULE-22 · Space, Escape, Cmd/Ctrl+K, F6, and Ctrl+wheel collide with the browser or with earlier instructions

- Verdict: **partly-confirmed**. Space and Ctrl+wheel hold on each platform. Ctrl+K and F6 hold only on Windows and Linux. The "registry" sentence is weaker than the finding says. Severity: **low** (auditor: medium).
- Proof:
  - Space: measured `"scrollY":[24,206]` at 1440 × 700 (page height 906, so Space scrolls to the end). Escape: no change.
  - Chrome shortcut list (https://support.google.com/chrome/answer/157179): Windows and Linux have "Ctrl + k or Ctrl + e: Search from anywhere on the page" and "F6: Switch focus to unfocused dialog (if showing) and all toolbars". The Mac list has neither Cmd+K nor F6. Its key for the toolbars is "⌘ + Option + Up arrow or Down arrow". Each platform has "Space: Scroll down a webpage, a screen at a time".
- Corrections:
  - On macOS (this machine is `darwin`), Cmd+K and F6 do not collide with Chrome. Table E of the report says "Browser key" for F6 with no platform.
  - `feedback-ui.md:96` reads: "A stable callback is also valid if the project already has an appropriate event hook; do not add a hotkey registry." It is an implementation note about how to attach one listener. It is in the U04 record, so the citation is right. It is not a product rule against a command palette.
  - `feedback-ui.md:73` ("Keep browser modifier shortcuts; Cmd/Ctrl+Z remains the explicit existing review Undo exception") is the stronger text against Cmd/Ctrl+K.

## RULE-23 · Shift gets three jobs: whole item, pan, and a pointer mode

- Verdict: **confirmed**. Severity: **low** (auditor: medium).
- Proof: `ws:427` (`review("approved", event.shiftKey)`); measured 7 targets with no dialog (RULE-06). VIEW:514: "the divider follows the pointer while `Shift` is down". So a held Shift and then `A` saves the whole item. This follows from the code.
- Note: this is a conflict between one proposal and one current key. Nothing that is shipped has this problem. It becomes a medium risk only if the Shift pointer mode is built.

## RULE-24 · Phone gestures collide, and phone review is outside the selected support scope

- Verdict: **confirmed**. Severity: **low**.
- Proof: A11Y:724 ("Swipe left or right moves to the next or previous variant"), WORK:712 ("a tap or swipe to flip between baseline and current"), VIEW:696 ("Press and hold shows the baseline … Pinch zooms, drag pans"). D53 in `prior-r9.json`: selected `chrome`, with `desktop` and `mobile` not selected. `issue-1:267`: quote exact.

## RULE-25 · Fifteen redesign ideas present a rejected or deferred option as new

- Verdict: **partly-confirmed**. The table has 15 rows. 13 rows hold. 2 rows are weak. Severity: **low** (auditor: medium).
- Rows that I checked against both sides: D02 `item` ("Fewer actions, but easier to accept a variant that has not been inspected."), U04, `feedback-ui.md:96` and `:73`, `contract:192` with `feedback-r3-tabs.md:9`, K6, `issue-1:57` ("AI verdicts, automatic approval of visual flakiness, image editing, or comment system at launch"), D10, U01, U03, P02, D53, D29. The lane quotes exist (WORK:689, VIEW:681, A11Y:638-641 with `index < 9`, A11Y:657, PRIM:442 "Delete `tabs.ariakit.react.tsx` until a screen needs it", PRIM:769, PRIM:969).
- Weak row 1, "one list for queue and history" against U05 `recent-clear`: PRIM:807 says "History is a filter of the same list". SHELL:854 has tabs "To review", "In progress", "Needs attention", "History". Both keep the work first, with history as its own view. That is the selected `task-first` ("List review work first with a history view"), not `recent-clear` ("Keep the recent-run table and improve labels"). Today history is already a search parameter of the same route (`app-shell.tsx:17`).
- Weak row 2, PRIM-R14 against D17 `comfortable`: D17 selected "Compact, mostly flat controls". "Mostly" allows one raised control. PRIM:969 offers the bevel "as an option" for one action.
- Scope note: the alternative "Leave these ideas out of the first round" does not fit the request for this run (many options, no duty to keep the current patterns). The recommendation "mark each variant with the decision ID" does fit.

## RULE-26 · Ideas that shorten copy remove strings and states that the contract names

- Verdict: **confirmed**. Severity: **medium**.
- Proof:
  - `contract:196`: "The client distinguishes sending, queued, and saved decisions; a queue receipt is not a saved verdict." `contract:194`: "stay under **Accepted**". `issue-1:261` and `issue-1:265`: quotes exact.
  - Lane texts: COPY:661 ("`Saving…`, `Saved`, or `Not saved`"), COPY:802 ("`Accepted (1)` becomes `Done · 1`"), COPY:186 and WORK:283 ("9 left"), WORK:738 ("without words"), WORK:794 ("Toast with Undo").
  - Today: `ws:1112-1114` prints "Sending N decisions… N queued on server." `ws:1033` disables Undo while busy.
- Note: only the three save states come from a later approved rule (`contract:196`). The other strings are words of the frozen issue text. The maintainer's own commit `f83fef6` already changed words of that kind ("Side by side" to "Compare"). So the practice for those strings is already loose.

## RULE-27 · Ideas that widen the scope of a decision need rules that do not exist

- Verdict: **confirmed**. Severity: **medium** (auditor: high). Nothing that is shipped is wrong; this is a limit for the design.
- Proof:
  - `session:413-416` builds the targets from one item.
  - `packages/service/src/review-commands.ts:166-170`: without `wholeItemKey` the server takes any row IDs of the comparison (`id IN (SELECT value FROM json_each(?))`). It checks the item only for a whole-item command (`:194-203`).
  - `:222-266`: four statements for each target (one assertion, one `UPDATE visonaut_decisions`, one `INSERT`, one `UPDATE visonaut_comparison_rows`).
  - `issue-1:223`: "A command must use the evidence currently displayed, not an earlier selection’s pixels." Only the client enforces this (`ws:302-307`, `ws:385-389`). The server cannot know what was on screen. So the finding is right: a new UI can weaken this rule with no server change.
  - Lane quotes: WORK:642, VIEW:681, WORK:666, WORK:747, WORK:210.
- Platform note for the unmeasured part: the D1 limits page gives "Queries per Worker invocation: 1000 (Workers Paid) / 50 (Free)", and says that the limits for one query "apply to each individual statement contained within a batch statement" (https://developers.cloudflare.com/d1/platform/limits/). A real run has 626 items and 3,832 variants (`audit/live-authenticated.md`). A multi-item command with 250 targets is about 1,000 statements in one batch. The page does not say if each statement of a batch counts toward the 1,000. Unverified.

## RULE-28 · Shortcuts compare `event.key`: letters fail on non-Latin layouts, and unshifted digits fail on AZERTY

- Verdict: **partly-confirmed**. The facts hold. The code in the recommendation has gaps. Severity: **low**.
- Proof:
  - `ws:399` and `ws:424`: as cited.
  - My synthetic events (`syntheticKeys`): `{key:"ф", code:"KeyA"}` → `"calls":0`. `{key:"é", code:"Digit2"}` → variant 1 stays. `{key:"A"}` with no Shift → 1 call with `{"targets":1,"wholeItemKey":null}`.
  - MDN: `code` "returns a value that isn't altered by keyboard layout or the state of the modifier keys", and the same `KeyQ` is "the A key on AZERTY keyboards" (https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code).
- Corrections to the recommended code:

  ```ts
  const letter = /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : event.code.replace(/^Key/, "").toLowerCase();
  ```

  - This fallback fires for each `key` that is not one Latin letter. That includes `"Process"` (input method) and `"Dead"`. With `code: "KeyA"` it would approve. Add `if (event.isComposing) return;` and use the fallback only when `event.key.length === 1`. The U04 record asks to "ignore IME composition" (`feedback-ui.md:71`), and the code has no `isComposing` check today (`grep -rn isComposing apps/web/src`: no line outside the vendored folder).
  - For `[` the fallback gives `"bracketleft"`, so the compare at `ws:407` must run before it.
  - `Digit1` to `Digit6` by `code` also match Shift+1 on a US layout (`key: "!"`). Decide if that is wanted.

- Limit: no real layout was used, by the auditor or by me.

---

## Notes on the tables and the redesign ideas

- Table A, row K5 ("visible controls reach all variants" → conforms): add a limit. A key can select a chip outside the strip viewport, and the strip does not scroll (RULE-10, `v11`, `v12`). Only the strip's own handler calls `scrollIntoView` (`ws:119`).
- Table A, row K9 ("no visible state"): the count "0 of 11 need review" and the save state are visible (`v15`). Only the sentence is hidden.
- Table A, row D10 ("keyboard behavior grew"): wrong reading of D10. See RULE-08.
- Table E, rows F6 and Cmd/Ctrl+K: Windows and Linux only. See RULE-22.
- Table F: reproduced exactly. See RULE-17.
- Idea E (`NavSlot`, `NavLinkLabel`) and idea F (`$mix`): these exist in the lab copy of the primitives (`apps/lab/docs/primitives.md:1233`, `:200`; commit `643a23af`). They do not exist in the copy that `apps/web` vendors (`fc85b809`): `grep -n "^export function" apps/web/src/components/ariakit/components/nav.ariakit.react.tsx` has no `NavSlot` and no `NavLinkLabel`, and `grep -rn '\$mix'` in that folder finds nothing. The sketches work in the design app. A port to `apps/web` needs the newer copy first.
- Idea G: replace "about 366 px" with 390 px (RULE-09).

## Screenshots

The auditor's 21 files in `LANE/screens/`: I opened each one. Each caption matches the image. Two notes: S06 is byte-identical to S01 (`cmp` prints no difference), and S07 looks the same; that is the point of both. S14 draws the sticky bar in the middle, as its caption says.

Mine, in `V/screens/`:

| File                                                 | Caption                                                                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v01-chip-focused-keys-dead-dark-1440.png`           | Focus ring on chip 3 after ArrowRight in the strip. `A`, `X`, `D`, Down, `2`, Ctrl+Z, and Shift+A did nothing before it.                                         |
| `v02-filter-menu-after-two-approvals-dark-1440.png`  | Filter "menu": the list shows only "Open menu 0 of 2 need review" under Accepted. The main area shows "Success dialog".                                          |
| `v03-shift-x-refused-dark-1440.png`                  | After a refused Shift+X: no visible message.                                                                                                                     |
| `v04-zoom-200-panes-dark-1440.png`                   | 200%: Baseline is scrolled to (300, 200), Current is at (0, 0). Eight pan buttons.                                                                               |
| `v05-narrow-390-dark.png`                            | 390 px: "Screenshots" button, no list, first image at y = 524.                                                                                                   |
| `v06-narrow-390-dialog-dark.png`                     | 390 px: the list in a dialog.                                                                                                                                    |
| `v07-fixture-default-dark-1440.png`                  | Default workspace, page scrolled by 24 px: image viewport at y = 390.                                                                                            |
| `v08-fixture-default-light-1440.png`                 | Light scheme: the selected chip has no visible outline.                                                                                                          |
| `v09-preview-run-dark-1440.png`                      | Routed preview run: dash tile in the row, image viewport at y = 431 below a 41 px notice.                                                                        |
| `v10-help-dialog-dark-1440.png`                      | Help dialog: "Text fields, tabs, menus, and dialogs keep their own keys."                                                                                        |
| `v11-digit-6-selected-chip-position-dark-1440.png`   | After the key `6`: no chip in the visible strip is selected.                                                                                                     |
| `v12-variant-7-selected-chip-position-dark-1440.png` | Variant 7 selected: the same. Nothing on screen names the variant.                                                                                               |
| `v13-chips-after-approve-and-reject-dark.png`        | Strip crop: chip 1 (approved) and chip 2 (rejected) look like a pending chip.                                                                                    |
| `v14-after-approve-and-reject-dark-1440.png`         | Row "Success dialog 1 rejected variant" with a red dot, while 5 variants are pending. Header "7 of 11 need review".                                              |
| `v15-review-complete-dark-1440.png`                  | All reviewed: "0 of 11 need review", full bar, "1 variant approved. Saved." No completion sentence. The selected item is inside the closed "Accepted (3)" group. |
| `v16-recompare-disabled-footer-dark-1440.png`        | Footer with a disabled "Recompare stored run" and the sentence "Rerun trusted Submit to compare locally again."                                                  |

## Missed

1. A key selects a variant chip that is off screen, and the strip does not scroll. After `6` the chip is at x = 1789 and the strip ends at x = 1408 (`verify-probe-2.mjs chipInView`). Only `ws:119` scrolls, and only for the strip's own keys.
2. "Recompare stored run" is a dead control in production. `review.ts:592` always sends `recompareAllowed: false`, so `ws:1186-1201` shows a disabled button and a sentence on each run. `guide:88` says that the control is retired.
3. The item row hides the pending count when one variant is rejected. "1 rejected variant" replaces "5 of 7 need review" (`list:250-256`, `v14`), against `issue-1:261`. The report has this only as a table note.
4. The progress bar counts a rejection as progress (`ws:602`; measured value 4 of 11 with one rejection). `issue-1:263` says that a rejection "still fails the check". The report has this only as a table note.
5. After the last approval of an item, the selected item moves into the closed "Accepted" group, and no row is selected on screen (`list:127-133` opens the group only when the selection moves; `v15`).
6. The page handler has no `event.isComposing` check, though the U04 record asks to ignore IME composition (`feedback-ui.md:71`, and the U04 test line "IME input keep their normal handling").
7. The help dialog lists `[` in each layout (`ws:178`), but the key does nothing below 1024 px (`ws:407`, `!narrow`).
8. The row of an automatically accepted addition has no mark "Accepted automatically" ("New item 0 of 1 need review", S09), against `issue-1:263`. The report has this only as a table note.
9. The fixture and the routed app use different rules for a row click (memory against first pending). The 73 tests on the plain fixture do not cover the routed rule. See RULE-03.
10. `apps/web/src/api/dashboard.test.ts:42-56` tests the title with rows that production cannot have (processed, with the full payload). See RULE-12.
11. The sketches of ideas E and F do not compile against the primitives that `apps/web` vendors. See the notes above.
