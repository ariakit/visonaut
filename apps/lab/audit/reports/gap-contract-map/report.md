# Binding UI contract and earlier design decisions: conformance table, keyboard map, and limits for the redesign

Lane `gap-contract-map`. Date: 2026-10-05. Read-only audit. Repository root (ROOT): `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. Scratch: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-contract-map/`.

Short names used below:

| Short         | File                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-1`     | `docs/simplification-audit/contract-issue-1.md`                                                                                                                                         |
| `contract`    | `docs/current-contract.md`                                                                                                                                                              |
| `guide`       | `docs/review-guide.md`                                                                                                                                                                  |
| `audit-data`  | `docs/simplification-audit/audit-data.json` (the data that `docs/simplification-audit/index.html` embeds; decision records are on `index.html` lines 47 to 226, selections on line 246) |
| `ws`          | `apps/web/src/review/review-workspace.tsx`                                                                                                                                              |
| `list`        | `apps/web/src/review/item-list.tsx`                                                                                                                                                     |
| `nav`         | `apps/web/src/review/navigation.ts`                                                                                                                                                     |
| `viewer`      | `apps/web/src/components/screenshot-viewer.tsx`                                                                                                                                         |
| `session`     | `apps/web/src/review/use-review-session.ts`                                                                                                                                             |
| `tests`       | `apps/web/src/review/__tests__/review.browser.test.ts`                                                                                                                                  |
| `S01` … `S21` | my screenshots, see "Screenshots"                                                                                                                                                       |

Lane report IDs (PRIM, SHELL, PULL, COPY, A11Y, DASH, WORK, VIEW, BENCH) point to the reports under `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-*/`.

## How it works (map)

### 1. Which document decides

1. `contract:7`: "Every saved issue #1 requirement remains binding unless an explicit approved rule below supersedes it."
2. The saved requirements for the UI are `issue-1:245-280` ("Review UI and keyboard behavior").
3. The audit selections U01 to U06, P02 to P04, and O11 are one-line rows in `contract:142-151` and `contract:174`. The full text (question, selected option, alternatives, migration, tests) is only in `audit-data` and `index.html`.
4. `contract:54` (D10) and `contract:190-200` ("Later approved review changes") are the newest rules.
5. `guide:3` says: "The current system guide owns the requirements and selected changes." The guide is a user document, not a rule source.
6. Commit `f83fef6` ("Implement the Inbox review interface (#252)", 2026-10-05) changed 21 UI files (`ws` +1,273 lines) and no file in `docs/`. So the documents describe the UI before that commit.

```
$ git show --stat --format= f83fef6 -- docs
(no output)
```

### 2. Key handling today (numbered walk-through)

1. One `keydown` listener on the document, bubble phase (`ws:443-448`).
2. Return if `defaultPrevented`, if `event.repeat`, or if shortcuts are off (`ws:396`).
3. Return if the target is inside `input, textarea, select, [contenteditable], [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"], .review-variants, [data-screenshot-search]` (`ws:88-97`).
4. Return if Alt is down (`ws:398`).
5. With Cmd or Ctrl: only `Z` without Shift calls `undo()`. All other chords stay native (`ws:400-406`).
6. `[` toggles the sidebar when the window is 1024 px or wider, then focuses the toggle (`ws:407-411`, `ws:216-219`).
7. Arrows, `1` to `6`, `A`, `X`, `S`, `D`, `F`, `G` (`ws:416-437`). Shift is read only for `A` and `X` (`ws:427`, `ws:429`). The handler compares `event.key.toLowerCase()` (`ws:399`).
8. `A` or `X` calls `review()`. It returns if the evidence is not ready (`ws:385-389`). The session builds one command with frozen targets (`session:402-441`), shows the verdict, selects the next pending variant, and focuses the workspace root (`session:306-317`). Only the server answer writes "Saved." and the Undo entry (`session:336-365`).

Two local handlers exist: a focused list row handles Up, Down, Home, End (`list:316-339`); a focused variant chip handles Left, Right, Home, End (`ws:99-121`).

### 3. Table A and B: binding rules and their status

Status words: **conforms**, **differs**, **not delivered**, **replaced** (by a later approved rule), **not verifiable** (in this lane).

#### Design principle (`issue-1:247-256`)

| ID  | Rule (exact quote)                                                                                            | Source                           | Status                             | Code evidence                                                                                                                                                                                                                      | Screen |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A01 | "Use compact, mostly flat neutral controls."                                                                  | `issue-1:247`; D17 `issue-1:425` | conforms (flat); differs (compact) | Flat buttons: `ws:834-847`. First image pixel row at y = 366 of 900 (390 in the fixture minus its 24 px label). `viewer:134` `h-[min(56vh,650px)]`.                                                                                | S01    |
| A02 | "Copy Ariakit UI recipes and components; keep attention on screenshot pixels."                                | `issue-1:247`                    | differs (attention)                | Image viewport 591 × 504 px, bottom 53 px under the action bar (bar at y = 841).                                                                                                                                                   | S01    |
| A03 | "Build additional pieces from `frame`, `layer`, `text`, `edge`, `text-frame`, and related copied primitives." | `issue-1:247`                    | differs (in part)                  | `ws:599-604` native `<progress>`; `ws:165-182` plain `<dl>` keys while `kbd.ariakit.react.tsx` has no importer; `ws:1041` `<div className="h-5 w-px bg-current/10" />`; `ws:690` `<p … className="text-sm p-3 ak-layer-warning">`. | S21    |
| A04 | "Group the recipe and React component in the same file when appropriate."                                     | `issue-1:247-254`                | conforms                           | `components/ariakit/components/button.ariakit.react.tsx:138` `export const button = cv({`; `styles/button.ts` has 1 line.                                                                                                          | —      |
| A05 | "Preserve the complete copied recipe and component behavior, including disabled-state handling."              | `issue-1:256`                    | not verifiable                     | No diff against upstream was run here. See PRIM-06 and PRIM-15.                                                                                                                                                                    | S11    |

#### Layout and information order (`issue-1:260-267`)

| ID  | Rule (exact quote)                                                                                                                                         | Source                    | Status                                                | Code evidence                                                                                                                                                                                                                                                         | Screen        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| A06 | "Item list on the left; selected images in the center; review actions next to the result; commit/run identity above."                                      | `issue-1:260`             | conforms at 1024 px and wider                         | Sidebar `ws:536-561`; identity strip `ws:609-622` ("aabbccd · Attempt 2 · Baseline revision 4"); action bar `ws:1017-1029`. The run ID is only in Details (`ws:468-472`).                                                                                             | S01           |
| A07 | "Prioritize run identity, item name, full variant label, review state, image evidence, then secondary metadata."                                           | `issue-1:261`; `guide:23` | differs (full variant label)                          | The full label is only in `variant-summary.tsx:134` (`sr-only`) and in the closed Details panel (`ws:463-466`). The chip cuts the key part: `variant-summary.tsx:117` `max-w-48 truncate`. Measured: 2 nodes hold the full label, one is 1 × 1 px, one is 0 × 0 px.   | S01           |
| A08 | "Show counts such as “2 of 6 need review,” not only “changed.”"                                                                                            | `issue-1:261`             | conforms                                              | `list:256`, `ws:597`. Limit: the row shows one state only (`list:250-256`); "1 rejected variant" hides the pending count.                                                                                                                                             | S01           |
| A09 | "Counts and text must accompany color."                                                                                                                    | `issue-1:261`             | differs (3 places)                                    | (1) Item dot: `list:270-274`, `aria-hidden`, color only. (2) Variant chips: the verdict is only in `title` and `aria-label` (`ws:747`, `ws:776`). (3) Progress: `ws:602` `value={total - pending}` counts rejected as done.                                           | S01, S20      |
| A10 | "One sidebar item groups all variants."                                                                                                                    | `issue-1:262`             | conforms                                              | `list:178-277`                                                                                                                                                                                                                                                        | S01           |
| A11 | "Thumbnail always uses the item’s first declared candidate variant, not the selected variant. A wholly removed item uses its first reference variant."     | `issue-1:262`; `guide:27` | not delivered on current runs; rule differs           | `nav:177-179` `item.variants.find((variant) => variant.thumbnail)?.thumbnail` (first variant that has one). Only writer of `thumbnailImageId`: `apps/compare/src/process.ts:191,206,228`; its function has no importer. Reader: `apps/web/src/api/review.ts:505-507`. | S17           |
| A12 | "Build the list from the union of reference and candidate identities: candidate order first, then reference-only entries in reference order."              | `issue-1:262`; D29        | replaced in part                                      | `contract:194` adds the "Accepted" group. `nav:34-47` keeps the model order inside each group. Server order not checked here.                                                                                                                                         | S10           |
| A13 | "Automatically accepted additions/removals remain visible, marked “Accepted automatically,” and are skipped by next-pending navigation."                   | `issue-1:263`             | conforms (header badge, skip); differs (list row)     | `nav:170-172`, `nav:10-15`. The list row says "0 of 1 need review" with a green dot and no mark (`list:250-256`). A removed item is inside the closed "Accepted (N)" group.                                                                                           | S09, S10      |
| A14 | "A saved rejection is reviewed but still fails the check."                                                                                                 | `issue-1:263`             | conforms (count); the bar color differs               | `ws:602` (see A09). WORK-14.                                                                                                                                                                                                                                          | —             |
| A15 | "Side-by-side shows reference and candidate."                                                                                                              | `issue-1:264`             | conforms                                              | `viewer:216-241`                                                                                                                                                                                                                                                      | S01           |
| A16 | "Pixel diff paints differences red."                                                                                                                       | `issue-1:264`             | conforms from code; not measured on a production mask | `packages/cli/src/png-comparison.ts:68-75` `pixelmatch(…, { threshold, includeAA: false, diffMask: true })`; label `viewer:245`. Assumption: the default diff color of pixelmatch is red.                                                                             | —             |
| A17 | "New-only shows the full candidate, not browser fullscreen."                                                                                               | `issue-1:264`             | conforms                                              | `viewer:236`, `ws:434-435`                                                                                                                                                                                                                                            | S10           |
| A18 | "Preserve zoom and image position when possible."                                                                                                          | `issue-1:264`             | differs (position)                                    | Zoom state is kept (`ws:198`). Position is per pane (`viewer:35`) and is reset on each variant (`viewer:39-41`). Measured: Baseline `{300,200}`, Current `{0,0}`, then Difference `{0,0}`.                                                                            | S08           |
| A19 | "Provide fit/100%/200% inspection without changing stored reference pixels."                                                                               | `issue-1:264`             | conforms                                              | `ws:901-920`, `viewer:152-153`                                                                                                                                                                                                                                        | S08           |
| A20 | "For a new image, distinguish an intentionally absent reference from a reference-load error."                                                              | `issue-1:265`             | conforms                                              | `viewer:219` "New image, no reference"; `use-evidence.ts:83`                                                                                                                                                                                                          | S09           |
| A21 | "For a removal, F shows “Removed, no new image”; S shows the old image and a labeled empty pane."                                                          | `issue-1:265`             | conforms                                              | `viewer:233`. Measured: `["Current Removed, no new image"]` and `["Baseline 600 × 400","Current Removed, no new image"]`.                                                                                                                                             | S10           |
| A22 | "D is unavailable when either paired image is absent; keep the current view and explain why."                                                              | `issue-1:265`; D30        | conforms                                              | `ws:376-382`, `ws:854`, `ws:924-930`; `tests:1155-1179`                                                                                                                                                                                                               | S09           |
| A23 | "A load failure is an error with Retry, not an unchanged/new/removed result."                                                                              | `issue-1:265`             | conforms                                              | `ws:950-978`. Measured: "Image evidence unavailable … Retry images", both decision buttons disabled.                                                                                                                                                                  | S12           |
| A24 | "On selection, clear or cover stale pixels immediately. Show loading/error for the current comparison."                                                    | `issue-1:266`             | conforms                                              | `viewer:148` `key={identity}`, `viewer:162`, `viewer:173-180`. Measured 120 ms after the key: image `visibility: hidden`, overlay "Loading image…".                                                                                                                   | S11           |
| A25 | "Enable variant verdict actions only when its required evidence is ready."                                                                                 | `issue-1:266`             | conforms                                              | `ws:302-307`, `ws:385-389`. Measured: `A` during loading saved 0 commands.                                                                                                                                                                                            | S11           |
| A26 | "Whole-item review need not open every variant, but the displayed current item/comparison must be ready and command targets must be frozen."               | `issue-1:266`             | conforms                                              | `session:430-441`, `ws:309-316`; `tests:714-732`                                                                                                                                                                                                                      | S04           |
| A27 | "Keep a usable narrow layout with the list above the viewer and stacked comparison images. This is not a promise of certified mobile workflows at launch." | `issue-1:267`; `guide:94` | differs (list); conforms (stacked images)             | `ws:211-213` (`max-width: 1023px`), `ws:625-632` button, `ws:1206-1222` dialog, `viewer:211`. Measured at 390 × 844: button y = 162, panes y = 476 and y = 998.                                                                                                       | S13, S14, S15 |

#### Keyboard table (`issue-1:269-278`) and shortcut scope (`issue-1:280`)

| ID  | Rule (exact quote)                                                                                                                                      | Source                    | Status                                                    | Code evidence                                                                                                                                                                    | Screen   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| K1  | Up / Down: "Previous/next visible item; stop at ends."                                                                                                  | `issue-1:271`             | conforms                                                  | `ws:416-419`, `list:91-104`. Measured: Up on the first item and Down on the last item change nothing.                                                                            | S01      |
| K2  | "Remember the last variant per item."                                                                                                                   | `issue-1:271`; D04        | conforms for a chosen variant; differs after auto-advance | `ws:369-375`, `ws:770`. Auto-advance does not write the memory (`session:313-316`, `ws:249-252`). Measured: `3`, `A`, Down, Up selects "3. Dark · Approved".                     | —        |
| K3  | "First visit uses its first variant;"                                                                                                                   | `issue-1:271`; `guide:82` | differs                                                   | `ws:359-362` `find(previous) ?? find(needsReview) ?? variants[0]`. Measured: first visit selects "2. Menu-dark". `tests:399-416` pins the code.                                  | —        |
| K4  | "if remembered key is absent, use first and announce fallback."                                                                                         | `issue-1:271`             | conforms (announce); differs (first pending, not first)   | `ws:361`, `ws:365-367`; `tests:418-432`                                                                                                                                          | —        |
| K5  | Left / Right: "Move through declared variant order; visible controls reach all variants."                                                               | `issue-1:272`             | conforms                                                  | `ws:420-423`, chips `ws:732-780`. Shift is not checked: Shift+Arrow acts as Arrow (measured).                                                                                    | S01      |
| K6  | 1–6: "Select that position among the first six variants; absent positions do nothing."                                                                  | `issue-1:273`             | conforms                                                  | `ws:424-425`. Measured: `7` changes nothing.                                                                                                                                     | —        |
| K7  | A / X: "Approve/reject the current variant. Ignore repeat keydown."                                                                                     | `issue-1:274`             | conforms                                                  | `ws:396`, `ws:426-429`. Repeat is ignored for all keys (3 held Up events moved 1 item).                                                                                          | —        |
| K8  | "After successful save, select next pending variant in visible order, wrapping once."                                                                   | `issue-1:274`; D03, D28   | replaced (timing); differs (visible order with a filter)  | Timing: `contract:192`. Order: `nav:144-163` walks all items. Measured with the filter "menu": after two approvals the heading is "Success dialog" and 0 list rows are selected. | S16      |
| K9  | "If none remain, stay and announce completion."                                                                                                         | `issue-1:274`             | conforms for a screen reader; no visible state            | `session:366-368`, `ws:1202-1204` (`sr-only`)                                                                                                                                    | —        |
| K10 | "A refused action does not advance."                                                                                                                    | `issue-1:274`             | conforms                                                  | `session:372`, `session:417-429`                                                                                                                                                 | S06      |
| K11 | Shift+A / Shift+X: "Approve/reject the whole sealed item as one command, with the per-target guards above."                                             | `issue-1:275`; D21        | conforms (key path); the two paths differ                 | Key: 1 command, 7 targets, no dialog (measured). Button: `ws:1042-1059` opens the dialog `ws:1242-1296`.                                                                         | S03, S04 |
| K12 | "If any target is protected or stale, refuse the entire command, keep selection, and offer an eligible individual action; never silently skip targets." | `issue-1:229`; `guide:49` | conforms (refusal); differs (the offer is not visible)    | `session:417-429` calls `onAnnounce` only. Measured: the text is in `p.sr-only`, 1 × 1 px, `clip-path: inset(50%)`.                                                              | S06, S07 |
| K13 | S / D / F: "Side-by-side / red pixel diff / full new image only. D is unavailable for additions/removals."                                              | `issue-1:276`             | conforms; a fourth mode exists                            | `ws:430-437` adds `G` ("original"). `guide:34` and `guide:77` have `G`; the contract has no row.                                                                                 | S01      |
| K14 | Cmd/Ctrl+Z: "Undo the last eligible saved command in this review session; restore original selection. Leave native text-field Undo alone."              | `issue-1:277`; D31        | conforms                                                  | `ws:400-405`, `session:443-470`. Ignored while a variant chip has focus (measured).                                                                                              | —        |
| K15 | Tab / Escape: "Reach controls through normal keyboard focus; close help/menus with Escape, never reject an image."                                      | `issue-1:278`             | conforms                                                  | `tests:1273-1281`. Measured: `X` in the help dialog saved 0 commands.                                                                                                            | S21      |
| X1  | "Scope letter shortcuts to the focused review workspace."                                                                                               | `issue-1:280`             | replaced by U04                                           | `docs/simplification-audit/handoff-draft.md:25`; `ws:443-448`                                                                                                                    | —        |
| X2  | "Ignore events in editable content, inputs, menus, and dialogs."                                                                                        | `issue-1:280`; `guide:84` | conforms; 3 more exclusions exist                         | `ws:95`: `[role="tablist"], .review-variants, [data-screenshot-search]`.                                                                                                         | —        |
| X3  | "Preserve native Cmd/Ctrl+A Select All and Cmd/Ctrl+X Cut."                                                                                             | `issue-1:280`             | conforms                                                  | `ws:400-406`; `tests:1202-1203`                                                                                                                                                  | —        |
| X4  | "Provide visible buttons and a shortcut toggle."                                                                                                        | `issue-1:280`; `guide:67` | conforms in the letter                                    | Toggle `ws:1179-1185` at y = 982 in a 900 px viewport. `ws:199` `useState(true)`, not stored.                                                                                    | S05      |
| X5  | "Use suitable Ariakit composite/tab semantics; do not add grid semantics unless the interaction is actually a grid."                                    | `issue-1:280`             | replaced by U03, then by `contract:192`                   | Items: `nav` + links, `list:191-194`. Variants: `nav` + links + a hand-written handler `ws:99-121`; 7 links with `tabIndex` 0. No grid role (measured 0).                        | S01      |

#### Audit selections, D10, O11, and later approved changes

| ID  | Rule (exact quote)                                                                                                                                                                                                                                                                                          | Source                                          | Status                                                           | Code evidence                                                                                                                                                                                                        | Screen   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| U01 | "Use the copied components throughout"                                                                                                                                                                                                                                                                      | `contract:142`; `audit-data` U01 `compose`      | differs (in part)                                                | `apps/web/src/review.css` has 2 lines now. Hand-built parts remain (A03). `tabs.ariakit.react.tsx` and `kbd.ariakit.react.tsx` have no importer.                                                                     | S21      |
| U02 | "Use one review shell" — selected text: "One compact ShellHeader for project/run context; sidebar for items; ShellMainHeader for selected variant, Approve/Reject, save state and Undo. Image evidence takes the remaining main area. Move run IDs, policy and comparison history to a Details disclosure." | `contract:143`; `audit-data` U02 `single-shell` | differs (3 of 5 parts)                                           | One `Shell`: `ws:528`. `ShellMainHeader` holds toggle, Queue, title, progress (`ws:563-608`). Actions are a bottom bar (`ws:1017-1139`). Image height is fixed (`viewer:134`). Details: `ws:1142-1171`.              | S01      |
| U03 | "Use item links and variant tabs"                                                                                                                                                                                                                                                                           | `contract:144`                                  | item links conform; tabs replaced by `contract:192`              | `list:196-215`; item links target the first pending variant (`ws:457`) as the selected text says.                                                                                                                    | S01      |
| U06 | "Open the focused variant immediately"                                                                                                                                                                                                                                                                      | `contract:145`                                  | conforms                                                         | `ws:99-121`; `route.browser.test.ts:472`                                                                                                                                                                             | —        |
| U04 | "Page-wide review arrows with pan buttons"                                                                                                                                                                                                                                                                  | `contract:146`                                  | conforms from body, buttons, image; differs on the variant strip | `ws:443-448`; pan buttons `viewer:108-130` (8 buttons for 2 panes, only when zoom is not Fit). See X2.                                                                                                               | S08      |
| U05 | "List review work first with a history view" (note: "include the pull request title if possible")                                                                                                                                                                                                           | `contract:147`                                  | layout conforms; title source differs from the recorded plan     | Queue default, `?view=history` (`apps/web/src/routes/index.tsx:40`). Title: `apps/web/src/api/dashboard.ts:57-62` reads `delivery.payload_json`; `apps/web/src/api/webhooks.ts:150,172,332` set `payload_json='{}'`. | S18, S19 |
| P02 | "Load diff when selected"                                                                                                                                                                                                                                                                                   | `contract:149`                                  | conforms                                                         | `viewer:205-208`, `viewer:242`. Measured: 2 images, 3 after `D`, 3 after `S`.                                                                                                                                        | —        |
| P03 | "Use the existing router loaders" (note: "We should do things the idiomatic way.")                                                                                                                                                                                                                          | `contract:150`                                  | conforms for the selected scope ("the complete review model")    | `apps/web/src/routes/runs.$runId.tsx:34-47`. `/` and `/pulls/$pullNumber` read in effects (`routes/index.tsx:176-200`, `routes/pulls.$pullNumber.tsx:47-56`).                                                        | —        |
| P04 | "Add a virtual scrolling list"                                                                                                                                                                                                                                                                              | `contract:151`                                  | conforms                                                         | `list:2`, `list:344-354`; `apps/web/package.json:17`                                                                                                                                                                 | —        |
| D10 | "Keep the component set, keyboard behavior, license, and source notice. No pruning or replacement is selected."                                                                                                                                                                                             | `contract:54`                                   | conforms (set, license, notice); keyboard behavior grew          | 13 component files, `LICENSE`, `NOTICE` (pin `fc85b809`). `f83fef6` added `[` (`ws:407`).                                                                                                                            | —        |
| O11 | "Use preview fixtures without GitHub login"                                                                                                                                                                                                                                                                 | `contract:174`, `contract:186`                  | conforms                                                         | Measured on port 4310: 0 sign-in controls. `route.browser.test.ts:552`. PULL-08 reports one operations request on `/?view=service`.                                                                                  | S17, S18 |
| L1  | "Run views and variants use navigation links with a bar glider; variant links replace the original U03 tabs."                                                                                                                                                                                               | `contract:192`                                  | differs (variant glider)                                         | `ws:719-727` `$kind: "flat" … $border: true`. `f83fef6` removed `glider={{ $kind: "bar", $barOffset: "frame" }}`. Main nav: `apps/web/src/components/app-shell.tsx:49` (bar).                                        | S01, S18 |
| L2  | "The UI can show the requested verdict and advance while saving."                                                                                                                                                                                                                                           | `contract:192`                                  | conforms                                                         | `session:312-317`; `tests:434-469`                                                                                                                                                                                   | S03      |
| L3  | "Only server-confirmed decisions count as saved, and failed writes restore prior local state."                                                                                                                                                                                                              | `contract:192`                                  | conforms                                                         | `session:336-365`, `session:371-372`                                                                                                                                                                                 | —        |
| L4  | "items with a new variant stay in the main sidebar list for manual inspection, including after approval. … Ordinary accepted and unchanged items stay under **Accepted**."                                                                                                                                  | `contract:194`                                  | conforms                                                         | `nav:38-39`; `tests:168`, `tests:212`                                                                                                                                                                                | S09      |
| L5  | "The client distinguishes sending, queued, and saved decisions; a queue receipt is not a saved verdict."                                                                                                                                                                                                    | `contract:196`                                  | conforms                                                         | `session:139-142`, `ws:1112-1114`                                                                                                                                                                                    | —        |
| L6  | "The UI must preserve multiple rapid decisions, pending overlays, newer route-model handling, Retry, Undo, focus, and navigation."                                                                                                                                                                          | `contract:196`                                  | conforms                                                         | `tests:434`, `:471`, `:508`, `:565`, `:619`. Focus goes to the page root (`ws:248`), see A11Y-02.                                                                                                                    | —        |
| L7  | "The review client shows the reference beside its retry error"                                                                                                                                                                                                                                              | `contract:83`                                   | conforms                                                         | `session:386`; `route.browser.test.ts:10`                                                                                                                                                                            | —        |

### 4. Table C: earlier decisions

| Decision                                                       | Question                                                                                           | Selected answer                                                                                                                                                                                                                                                                                                                      | Rejected alternatives                                                                                                                                                                                                 | Reason on record                                                                                                                                                                                                                                                                                             | Code matches the selection?                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| U01 (`index.html:47`)                                          | "How should we finish the move to Ariakit UI without adding another design system?"                | `compose` "Use the copied components throughout"                                                                                                                                                                                                                                                                                     | `tokens` "First remove only duplicate style values"                                                                                                                                                                   | "Complete the existing approach instead of introducing another component wrapper layer." Risk text: "do not grow a new recipe or wrapper to meet a one-page need."                                                                                                                                           | In part (A03)                                    |
| U02 (`index.html:49`)                                          | "Which review layout should replace the stacked headers and distant recovery controls?"            | `single-shell`                                                                                                                                                                                                                                                                                                                       | `compact-existing` "Compact the current screen"                                                                                                                                                                       | Before number: image at y = 385, Undo below y = 1059 at 1440 × 1000 (`evidence/visonaut-audit-ui.json:110`). Risk text: "Keep an explicit Details control and a visible read-only/historical label".                                                                                                         | In part (RULE-09)                                |
| U03 (`index.html:56`)                                          | "Should item navigation behave as links and variants as tabs, or should both remain option lists?" | `nav-tabs`, note "Tabs should render links as well (with the render prop)"                                                                                                                                                                                                                                                           | `keep-option-lists`                                                                                                                                                                                                   | "Item links target the first pending variant; remembered keyboard selection remains separate."                                                                                                                                                                                                               | Items yes. Tabs were replaced by `contract:192`. |
| U06 (`index.html:65`)                                          | "Should arrow focus immediately open a linked variant tab?"                                        | `automatic`                                                                                                                                                                                                                                                                                                                          | `manual` (this was the research recommendation)                                                                                                                                                                       | `evidence/feedback-r3-tabs.md:9`: a route change through `setSelectedId` breaks modified clicks.                                                                                                                                                                                                             | Yes                                              |
| U04 (`index.html:78`)                                          | "What should arrow keys do when the image viewport has focus?"                                     | `global` "Page-wide review arrows with pan buttons", note "it should work globally"                                                                                                                                                                                                                                                  | `focus-owned` "Let image focus scroll the image" (research recommendation, `evidence/visonaut-audit-ui.json:402`); `pan-mode` "Enter image inspection to use arrows for panning; Escape returns to review navigation" | `evidence/feedback-ui.md:115`: "This is the user's selected tradeoff. It must not be described as a new accessibility failure". `feedback-ui.md:96`: "do not add a hotkey registry". `feedback-ui.md:73`: "Keep browser modifier shortcuts; Cmd/Ctrl+Z remains the explicit existing review Undo exception". | Yes, except the variant strip (RULE-04)          |
| U05 (`index.html:84`)                                          | "What should the home page help a maintainer find first?"                                          | `task-first`, note "include the pull request title if possible"                                                                                                                                                                                                                                                                      | `recent-clear` "Keep the recent-run table and improve labels"; `github-entry` "Treat GitHub as the main work queue"                                                                                                   | `feedback-ui.md:125`: "Accept the title as part of `task-first`. Show `PR #123 · Fix dialog focus` before run ID, attempt, or SHA." `feedback-ui.md:134`: "Processed webhook JSON is cleared. Therefore reading old webhook payloads is not a viable title source."                                          | Layout yes. Title source no (RULE-12).           |
| P02 (`index.html:95`)                                          | "When should the pixel diff image load?"                                                           | `on-demand`                                                                                                                                                                                                                                                                                                                          | `eager` "Keep all three eager"; `idle` "Load diff after required evidence"                                                                                                                                            | "Do not mistake hiding an image for not loading it."                                                                                                                                                                                                                                                         | Yes                                              |
| P03 (`index.html:96`)                                          | "Who should cancel and own page reads?"                                                            | `router-loaders`, note "Is this the idiomatic TanStack approach? We should do things the idiomatic way."                                                                                                                                                                                                                             | `forward-signal`; `query-layer` "Add a query cache layer … no measured need in this three-page app"                                                                                                                   | "Use TanStack Router’s existing route loader for the complete review model."                                                                                                                                                                                                                                 | Run route yes. The two other routes use effects. |
| P04 (`index.html:106`)                                         | "Should the item list keep simple pages or add a virtual list?"                                    | `virtualize`, note "We can use CompositeRenderer from ariakit right?"                                                                                                                                                                                                                                                                | `keep-pages`; `smaller-pages`                                                                                                                                                                                         | `feedback-ui.md:184`: "With Nav links, do not copy `role="option"` back into the list". The text filter is the way to reach rows that are not mounted.                                                                                                                                                       | Yes                                              |
| O11 (`index.html:226`)                                         | "How should preview authenticate after production owns the GitHub App webhook?"                    | `fixtures-only`                                                                                                                                                                                                                                                                                                                      | `test-app`                                                                                                                                                                                                            | "Fewest resources and credentials."                                                                                                                                                                                                                                                                          | Yes                                              |
| D02 (`issue-1:410`)                                            | "What does A or X change?"                                                                         | `variant` "Current variant; separate whole-item actions"                                                                                                                                                                                                                                                                             | `item` "Every changed variant in the item": "Fewer actions, but easier to accept a variant that has not been inspected."                                                                                              | Maintainer note asked for `F` and for the Shift keys.                                                                                                                                                                                                                                                        | Yes                                              |
| D03 (`issue-1:411`)                                            | "What should happen after approval or rejection?"                                                  | `next`                                                                                                                                                                                                                                                                                                                               | `stay` "Stay on this variant"                                                                                                                                                                                         | —                                                                                                                                                                                                                                                                                                            | Yes                                              |
| D04 (`issue-1:412`)                                            | "Which variant should open when up/down changes the item?"                                         | `remember`                                                                                                                                                                                                                                                                                                                           | `matching` "Keep the matching variant key"; `first` "Always open the first variant"                                                                                                                                   | Context: "First visit starts at its first variant. Auto-advance selects the next pending variant and updates that item’s memory."                                                                                                                                                                            | No (RULE-03)                                     |
| D17 (`issue-1:425`)                                            | "Which default visual direction fits review work?"                                                 | `compact` "Compact, mostly flat controls"                                                                                                                                                                                                                                                                                            | `comfortable` "More spacing and subtle bevels"                                                                                                                                                                        | "Keep more images and variants on screen."                                                                                                                                                                                                                                                                   | In part (A01)                                    |
| D21 (`issue-1:429`)                                            | "Which shortcuts should change the whole item?"                                                    | `shift`                                                                                                                                                                                                                                                                                                                              | `mod` (Cmd/Ctrl+A/X); `buttons` "Buttons only for whole-item actions"                                                                                                                                                 | "as one undoable command"                                                                                                                                                                                                                                                                                    | Yes                                              |
| D28 (`issue-1:436`)                                            | "When the next-pending search reaches the end, should it wrap?"                                    | `wrap`                                                                                                                                                                                                                                                                                                                               | `stop` "Stop at the end and offer a jump"                                                                                                                                                                             | —                                                                                                                                                                                                                                                                                                            | Yes                                              |
| D29 (`issue-1:437`)                                            | "Where should removed items appear in the review list?"                                            | `candidate` "Candidate order, then removed items"                                                                                                                                                                                                                                                                                    | `reference`                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                            | Inside each group                                |
| D30 (`issue-1:438`)                                            | "What should D show for a new or removed image?"                                                   | `empty` "Make pixel diff unavailable for this case"                                                                                                                                                                                                                                                                                  | `mask` "Show a labeled full-image change mask"                                                                                                                                                                        | "Avoid implying measured pair differences."                                                                                                                                                                                                                                                                  | Yes                                              |
| D31 (`issue-1:439`)                                            | "Should my Undo history survive a page reload?"                                                    | `session`                                                                                                                                                                                                                                                                                                                            | `restore`                                                                                                                                                                                                             | —                                                                                                                                                                                                                                                                                                            | Yes (`tests:1393`)                               |
| D53 (`issue-1:461`)                                            | "Which review-browser and accessibility paths must pass at launch?"                                | `chrome` "Chrome Desktop and keyboard-only review"                                                                                                                                                                                                                                                                                   | `desktop` (three browsers, two screen readers); `mobile`                                                                                                                                                              | Note: "This will be used internally at first so we only need Chrome Desktop for now and keyboard-only use."                                                                                                                                                                                                  | Scope statement                                  |
| Revision 9 design (`docs/design-r9.html:19`, section `review`) | "A focused review workspace"                                                                       | "The item list stays on the left. Its thumbnail always uses that item’s first declared variant." "Do not install page-wide letter shortcuts." "A wipe slider and overlay can follow later if needed." "On narrow screens, put the item list above the viewer. Stack the two images. Keep large tap targets and all actions visible." | —                                                                                                                                                                                                                     | The wipe slider and the overlay were deferred, not rejected. The page-wide rule was later replaced by U04.                                                                                                                                                                                                   | Thumbnail no (A11). Narrow no (A27).             |

### 5. Table D: invariants and the redesign idea map

#### Invariants (each redesign must keep these)

| ID  | Invariant                                                                                                        | Source                                                                                                                             | Code today                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| I1  | A decision is possible only when the evidence of the shown comparison is ready.                                  | `issue-1:223` "A command must use the evidence currently displayed, not an earlier selection’s pixels."; `issue-1:266`; `guide:41` | `ws:302-307`, `ws:385-389`; decode and size check on the displayed element `viewer:49-63` |
| I2  | Command targets are frozen (IDs and expected revisions).                                                         | `issue-1:229`, `issue-1:266`                                                                                                       | `session:430-441`, `ws:309-316`                                                           |
| I3  | Only a server-confirmed decision counts as saved.                                                                | `contract:192`; `issue-1:227`                                                                                                      | `session:336-365`                                                                         |
| I4  | Queued is not saved. Sending, queued, and saved are three states.                                                | `contract:196`; `guide:45`                                                                                                         | `session:139-142`, `ws:1112-1114`                                                         |
| I5  | Undo is bound to the saved command of this session.                                                              | `issue-1:231`; `contract:53`                                                                                                       | `session:354-357`, `session:443-454`                                                      |
| I6  | Promoted history, closed runs, and superseded attempts are read-only.                                            | `contract:184` (C01), `contract:50` (D05); `guide:17`, `guide:63`                                                                  | `ws:302-307`, `session:280`, `session:444`                                                |
| I7  | The UI cannot relax the gate. No AI verdict, no automatic approval of flakiness, no comment system.              | `issue-1:290`; `contract:24`; `contract:196`; `issue-1:57`                                                                         | —                                                                                         |
| I8  | The scope of a decision is one variant, or one whole sealed item as one command that saves every target or none. | `issue-1:229`; D02 `issue-1:410`; D21 `issue-1:429`; `guide:49`                                                                    | `session:413-416`; `packages/service/src/review-commands.ts:166-170`                      |
| I9  | Review starts only on a sealed, complete run.                                                                    | D12 `issue-1:420`; `guide:19`                                                                                                      | `ws:700-704`                                                                              |

#### Idea groups

| Group                                                     | Lane ideas                                                                                  | Keeps                                                                                           | Replaces                                                                                                                          | Reopens (Table C)                                                                                                                                              | Must not break                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 Fixed-height workspace, one header row                 | VIEW-R1, A11Y-R1, BENCH idea 1, WORK layout A, PRIM-R4, COPY-R3, SHELL-R1, SHELL-C4         | A10, A15, A24, A25; it delivers the U02 sentence "Image evidence takes the remaining main area" | A06 "commit/run identity above" and `guide:17` when commit and attempt move to a popover; A07 order; X4 when the footer goes away | U02 (the selected text already moves run IDs to Details; the prototype plan also lists "Attempt" under `moveToDetails`, `evidence/visonaut-audit-ui.json:562`) | I1 (Fit must show the whole image), I6 (a visible read-only label)                                                                              |
| G2 Filmstrip in place of the left list                    | SHELL-R6, WORK layout C                                                                     | A11 gains meaning (diff thumbnails)                                                             | A06 "Item list on the left"; K1 and K5 if the arrow axes swap (SHELL-R6)                                                          | U02; D17                                                                                                                                                       | P04 (bounded rows), K1                                                                                                                          |
| G3 More compare modes; overlay diff on by default         | VIEW-R2 to R8, VIEW-T1 to T5, VIEW-C7, A11Y-R7, BENCH ideas 2 and 3                         | A15, A19; A18 becomes true with one linked view                                                 | A16 (other mask colors); K13 (new modes; `D` as a toggle)                                                                         | P02 `eager` when the mask loads by default; D30 `mask` when additions get a mask or crops                                                                      | I1: the mask becomes shown evidence, so it must be in the required set (`use-evidence.ts:95-102`; `tests:1069`, `tests:1086`)                   |
| G4 Variant control: differing parts, matrix, select, tabs | PRIM-R5, COPY-R2, WORK switcher 1 to 6, A11Y-R2, BENCH idea 4                               | K5, U06                                                                                         | A07 (full label); L1 (links with a bar glider); K6 when keys go to 9 (A11Y-R2 sketch)                                             | U03 (tabs were replaced by links in `contract:192`); the `setSelectedId` problem in `feedback-r3-tabs.md:9`                                                    | A09 (a mark needs text or shape)                                                                                                                |
| G5 Item as the unit; decisions wider than one item        | WORK layouts D and F, VIEW-R9, WORK item row 5, BENCH-08                                    | —                                                                                               | K11; I8 scope                                                                                                                     | D02 `item` (rejected); D21                                                                                                                                     | I1, I2, I5, I8. Not measured: 4 D1 statements for each target in one batch (`review-commands.ts:227-271`)                                       |
| G6 Queue and history in one table                         | DASH idea 5, SHELL-R7, PRIM-R3, COPY-R7, DASH ideas 6 and 7                                 | U05 "review work first" if the default view is the work                                         | U05 "with a history view"                                                                                                         | U05 `recent-clear` (rejected)                                                                                                                                  | The U05 test: "Actionable work older than the newest 100 history rows remains discoverable." No GitHub call for each row (`feedback-ui.md:143`) |
| G7 Split inbox, three panes                               | SHELL-R3, DASH idea 3, PRIM-R3, WORK layout B, PULL-S3                                      | A06                                                                                             | The meaning of `[`; the end of the review listener on the dashboard (`feedback-ui.md:117`)                                        | P01 `summary-detail`; P03 `query-layer`                                                                                                                        | I6; the external links `/runs/<id>` and `/pulls/N?check=`; shortcut scope (X2)                                                                  |
| G8 Keys on the dashboard                                  | DASH idea 1, DASH-C12, DASH-C9, A11Y-R11, BENCH-07                                          | All workspace rows                                                                              | Nothing (the contract has no dashboard key)                                                                                       | `feedback-ui.md:96` if a registry is added                                                                                                                     | X4: a single-character key needs the off switch (WCAG 2.1.4)                                                                                    |
| G9 Arrow keys that pan                                    | VIEW-06, A11Y-05, A11Y-R7                                                                   | Pan buttons can stay                                                                            | K1 and K5 on the focused stage; U04                                                                                               | U04 `focus-owned` and `pan-mode` (both rejected)                                                                                                               | `tests:1675-1693`; the U04 test "Shortcuts work from body, outer route header, review buttons and focused image"                                |
| G10 Shortcut help, registry, command palette              | SHELL-R4, SHELL-C7, A11Y-R3, WORK filter 4, WORK-19, BENCH-12, PRIM-R10, COPY-R11, A11Y-R12 | X4 if the toggle stays reachable with shortcuts off                                             | The footer place of the toggle                                                                                                    | `feedback-ui.md:96` "do not add a hotkey registry"; `feedback-ui.md:73` (Cmd/Ctrl+K is a second modifier exception)                                            | K15                                                                                                                                             |
| G11 Decision bar and save state                           | PRIM-R6, COPY-R4, WORK bar 1 to 6, VIEW-T5, SHELL-C7                                        | A06 "review actions next to the result"                                                         | The U02 text "ShellMainHeader for … Approve/Reject, save state and Undo" (PRIM-R6 option c delivers it)                           | U02                                                                                                                                                            | I4 (one word "Saving…" merges sending and queued); I5 (a toast must not offer Undo before the server answer)                                    |
| G12 Status language, counts, item rows                    | PRIM-R7, COPY-R1, COPY-R14, WORK rows 1 to 5, WORK status 1 to 5, SHELL-C8, DASH-C2         | A08 when a count stays                                                                          | A09 (dot-only forms); the contract strings "Accepted automatically", "Accepted", "need review"                                    | —                                                                                                                                                              | L4                                                                                                                                              |
| G13 List filter, sort, groups                             | PRIM-R9, SHELL-C10, WORK filter 1 to 5, BENCH-09                                            | P04                                                                                             | A12 (D29 order) with a sort; L4 when the "Accepted" group goes away                                                               | D29                                                                                                                                                            | K8 (define "visible order" with a filter)                                                                                                       |
| G14 Preload and skeletons                                 | WORK-08, VIEW-11, VIEW-C4, SHELL-C5, PRIM-R12                                               | A24, A25                                                                                        | Nothing                                                                                                                           | P02 `idle` only if the mask is preloaded                                                                                                                       | I1: WORK-08 option (d) "Buffer one key press" breaks `issue-1:223`                                                                              |
| G15 Narrow and phone flow                                 | WORK layout G, VIEW-R10, A11Y-R6                                                            | —                                                                                               | A27 (list above, stacked images)                                                                                                  | D53 `mobile`                                                                                                                                                   | I1                                                                                                                                              |
| G16 More vendored primitives, refresh, app kit, pruning   | PRIM-08, PRIM-10, PRIM-15, PRIM-R1, DASH-20, PULL-20, WORK-27                               | U01                                                                                             | D10 ("No pruning or replacement is selected."); A04 (PRIM-15 file layout)                                                         | U01 (the wrapper-layer warning, for PRIM-R1)                                                                                                                   | A05; `NOTICE` and `LICENSE`                                                                                                                     |
| G17 Sign-in: one gate, automatic redirect                 | DASH-15 option 2, SHELL-C6, PULL-P6, COPY-R8, DASH-C7                                       | `issue-1:302`                                                                                   | `docs/review-evidence-plan.md:49` ("Confirm that it offers GitHub sign-in and reveals no run list.")                              | D25 (`issue-1:433`, "a sign-in review link")                                                                                                                   | O11 (no redirect in preview); return-path tests `route.browser.test.ts:405`, `:427`, `pulls.browser.test.ts:116`                                |
| G18 Reject note                                           | BENCH-13                                                                                    | —                                                                                               | —                                                                                                                                 | `issue-1:57` "comment system at launch"                                                                                                                        | I7                                                                                                                                              |
| G19 Noise verdict                                         | BENCH-14                                                                                    | —                                                                                               | The verdict type                                                                                                                  | `issue-1:57` "automatic approval of visual flakiness"                                                                                                          | I7; exact approval reuse (`contract:184`)                                                                                                       |
| G20 Completion state, next run                            | A11Y-R9, WORK status 5                                                                      | K9                                                                                              | Nothing                                                                                                                           | D28 stays                                                                                                                                                      | I6                                                                                                                                              |
| G21 Pull request hub and service status designs           | SHELL-R5, PULL-P1 to P5, PULL-S1 to S5, PULL-T1 to T4, PRIM-R15, COPY-R9                    | `guide:5-11`                                                                                    | Strings that `operations.browser.test.ts` pins                                                                                    | `feedback-ui.md:176` ("a title feature does not need another operational dashboard")                                                                           | D56 (`issue-1:464`)                                                                                                                             |

### 6. Table E: keyboard map

Column "Guide" is `guide:69-80`. "Layout" notes come from `ws:399` (`event.key`).

| Key or chord          | Today (line)                                                                                                                         | Contract | Guide  | Lane proposals                                                                                                                                  | Conflicts                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Up / Down             | Previous or next item in the visible order, stop at ends (`ws:416-419`); on a list row also moves focus (`list:324-327`). No repeat. | K1       | yes    | Pan when the stage has focus (VIEW-06, A11Y-05, A11Y-R7). Variants on Up/Down (SHELL-R6). `J`/`K` as other keys (A11Y-05).                      | Pan reopens U04. SHELL-R6 swaps the axes of K1 and K5.                                                      |
| Left / Right          | Previous or next variant, stop at ends (`ws:420-423`); in the strip: focus and click (`ws:99-121`).                                  | K5       | yes    | Pan (same lanes). Items on Left/Right (SHELL-R6). Argos-style blink on Left/Right (BENCH-02 note).                                              | Same as above.                                                                                              |
| Shift+Arrow           | Same as Arrow (measured; no Shift check).                                                                                            | —        | —      | Pan all panes (VIEW-06 a, A11Y-05 b).                                                                                                           | Not free today. Needs a Shift branch. Shift is also the whole-item key.                                     |
| Home / End            | Only on a list row (`list:328-331`) and in the strip (`ws:109-112`). Else native scroll.                                             | —        | —      | —                                                                                                                                               | Native scroll in a pane.                                                                                    |
| `1`–`6`               | Variant by position (`ws:424-425`).                                                                                                  | K6       | yes    | `1`–`9` (A11Y-R2 sketch). Number key zooms a matrix cell (WORK layout F).                                                                       | Zoom keys `1`, `2` are not free (VIEW-06). AZERTY: digits need Shift.                                       |
| `0`, `+`, `-`, `=`    | Nothing (measured).                                                                                                                  | —        | —      | Zoom (VIEW-06, A11Y-R7).                                                                                                                        | Cmd/Ctrl with these keys is browser zoom; keep it native. `+` is Shift+`=` on a US layout.                  |
| `A` / `X`             | Approve or reject, advance (`ws:426-429`).                                                                                           | K7       | yes    | Act on the card at the top of the viewport (WORK layout E). In a lightbox (WORK layout D).                                                      | Layout E has no selected target: I1 and I2. Non-Latin layouts: no match.                                    |
| Shift+`A` / Shift+`X` | Whole item, no confirmation (`ws:427`, `ws:429`).                                                                                    | K11      | yes    | Split buttons that show `⇧A` (WORK bar 2). Same confirmation on both paths (A11Y-04, WORK-17).                                                  | "Divider follows the pointer while Shift is down" (VIEW-R2): Shift held plus `A` approves the whole item.   |
| `S` / `D` / `F`       | Compare, Difference, Current (`ws:430-435`).                                                                                         | K13      | yes    | `D` toggles an overlay (BENCH idea 3). New modes Swipe, Onion (VIEW-R2, R3, T2) have no key.                                                    | `D` as a toggle changes K13 and A22.                                                                        |
| `G`                   | Baseline only (`ws:436-437`).                                                                                                        | no row   | yes    | `g i` / `g h` sequences on the dashboard (DASH-C12).                                                                                            | Conflict in a split inbox (G7) where both scopes are on one page.                                           |
| Cmd/Ctrl+`Z`          | Undo (`ws:400-405`).                                                                                                                 | K14      | yes    | Toast "Undo (⌘Z)" (WORK bar 6).                                                                                                                 | Dead while a chip has focus (measured).                                                                     |
| `Z`                   | Nothing.                                                                                                                             | —        | —      | "Zoom to next change" (VIEW-06).                                                                                                                | One key from Undo.                                                                                          |
| `[`                   | Toggle the item sidebar, 1024 px and wider (`ws:407-411`).                                                                           | no row   | no row | Keep (WORK layout A, COPY rewrite). Collapse the run-list column (SHELL-R3). Move the swipe divider left (VIEW-R2). Replace with `B` (A11Y-24). | Three meanings. AltGr layouts: the handler returns on Alt (`ws:398`).                                       |
| `]`                   | Nothing (measured).                                                                                                                  | —        | —      | Move the swipe divider right (VIEW-R2).                                                                                                         | Same layout problem.                                                                                        |
| `B`                   | Nothing.                                                                                                                             | —        | —      | Sidebar toggle (A11Y-24).                                                                                                                       | None today.                                                                                                 |
| `J` / `K`             | Nothing (measured).                                                                                                                  | —        | —      | Item or row navigation (A11Y-05, A11Y-R11, DASH idea 1, DASH-C12, WORK layout E). Pan (VIEW-06 b, with `H` and `L`).                            | Navigation against pan.                                                                                     |
| `N` / `P`             | Nothing.                                                                                                                             | —        | —      | Item navigation (A11Y-05). Next and previous change region (VIEW-R4).                                                                           | Two meanings.                                                                                               |
| `H` / `L`             | Nothing.                                                                                                                             | —        | —      | Pan (VIEW-06 b).                                                                                                                                | —                                                                                                           |
| `I`                   | Nothing.                                                                                                                             | —        | —      | Pixel inspector (VIEW-R7). Prior art for "ignore flaky" (BENCH-14).                                                                             | Two meanings if G19 is opened.                                                                              |
| `V`, `.`              | Nothing.                                                                                                                             | —        | —      | View popover (VIEW-T4); focus mode (VIEW-04 b).                                                                                                 | `.` needs Shift on AZERTY.                                                                                  |
| `R`                   | Nothing.                                                                                                                             | —        | —      | Refresh on the dashboard (DASH idea 1, DASH-C12).                                                                                               | `apps/lab/docs/primitives.md:2345-2347` shows `R` as "Reject"; the contract key is `X`.                     |
| `?`                   | Nothing (measured).                                                                                                                  | —        | —      | Open the shortcut list (SHELL-17, SHELL-C7, WORK-19, A11Y-07, A11Y-R3, BENCH-12, DASH-C12).                                                     | No conflict among proposals. Must work when shortcuts are off, or the help needs a button.                  |
| `/`                   | Nothing (measured).                                                                                                                  | —        | —      | Focus search (DASH-20, DASH-C12, A11Y-07 notes the gap).                                                                                        | Firefox quick find (`/`, and `'` for links). D53 names Chrome Desktop only.                                 |
| Space                 | Native: page scroll (measured, 155 to 206 px) or press the focused control.                                                          | —        | —      | Hold to show the baseline (VIEW-05 a, VIEW-R3, A11Y-R7).                                                                                        | Native scroll and control activation. Needs `keyup`.                                                        |
| Enter                 | Native activation.                                                                                                                   | —        | —      | Open a row (DASH idea 1, A11Y-R11). Open a lightbox (WORK layout D).                                                                            | None.                                                                                                       |
| Escape                | Closes help, popovers, dialogs. Nothing else (measured).                                                                             | K15      | yes    | Leave pan mode (VIEW-06).                                                                                                                       | Pan mode is the rejected U04 option `pan-mode`.                                                             |
| Tab                   | Native. 7 stops in the variant strip.                                                                                                | K15      | yes    | One stop for variants (A11Y-R2). Skip link (A11Y-R4).                                                                                           | None.                                                                                                       |
| `F6`                  | Native.                                                                                                                              | —        | —      | Move between four regions (A11Y-R4).                                                                                                            | Browser key: moves focus between browser panes.                                                             |
| Cmd/Ctrl+`K`          | Native (`ws:400-406`).                                                                                                               | —        | —      | Command field or palette (SHELL-R4, A11Y-R3, A11Y-07 b, WORK filter 4).                                                                         | Chrome on Windows and Linux: search in the address bar. Firefox: search bar. `feedback-ui.md:73` and `:96`. |
| Ctrl+wheel, pinch     | Browser zoom.                                                                                                                        | —        | —      | Zoom at the pointer (A11Y-R7, VIEW-06).                                                                                                         | Takes browser zoom away over the stage.                                                                     |
| Touch: swipe          | Native scroll.                                                                                                                       | —        | —      | Next or previous variant (A11Y-R6). Flip baseline and current (WORK layout G).                                                                  | Two meanings. Drag also pans (VIEW-R10).                                                                    |
| Touch: press and hold | Native image menu.                                                                                                                   | —        | —      | Show the baseline (VIEW-R10, A11Y-R6).                                                                                                          | The system long-press menu on images.                                                                       |

Layout facts (synthetic events, see Measurements): `key: "ф", code: "KeyA"` saved 0 commands. `key: "é", code: "Digit2"` did not select variant 2. `key: "["` with `altKey` did not toggle the sidebar. `key: "a", code: "KeyQ"` (the A key on AZERTY) approved, which is correct for a letter shortcut.

### 7. Table F: test pins

Counts from `count-pins.mjs` (method and limits in Measurements). One assertion can have more than one kind.

| File                         | Tests | `expect` statements | Accessible name or role | State (visible, enabled, focused, count, attribute) | Visible text | Class hook `review-*` or `data-*` | Request or call order      | Geometry |
| ---------------------------- | ----- | ------------------- | ----------------------- | --------------------------------------------------- | ------------ | --------------------------------- | -------------------------- | -------- |
| `review.browser.test.ts`     | 73    | 389                 | 240                     | 237                                                 | 152          | 68                                | 23 (+40 `callCount` calls) | 14       |
| `route.browser.test.ts`      | 17    | 114                 | 73                      | 46                                                  | 25           | 2                                 | 22                         | 7        |
| `pulls.browser.test.ts`      | 5     | 17                  | 8                       | 5                                                   | 3            | 0                                 | 11                         | 0        |
| `operations.browser.test.ts` | 8     | 39                  | 31                      | 25                                                  | 22           | 0                                 | 0                          | 0        |
| `scale.browser.test.ts`      | 9     | 51                  | 16                      | 31                                                  | 4            | 8                                 | 0                          | 6        |
| Total                        | 112   | 610                 | 368                     | 344                                                 | 206          | 78                                | 56                         | 27       |

Key behavior: 158 key presses (`a` 33, ArrowDown 30, ArrowRight 15, Control+z 13, `x` 12, ArrowUp 11, End 7, `d` 6, Home 5, `2` 4, Escape 4, ArrowLeft 3, `f` 3, `6` 2, Shift+A 2, `s` 2, Enter 2, Shift+X 1, `g` 1, Control+a 1, Control+x 1).

The 20 pins that a redesign breaks first:

| #   | Pin                                                                                                                                                                                                                                                                | Uses    | What breaks it                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------- |
| 1   | Helper `selected()`: `getByRole("navigation", { name: "Variants" }).locator('a[aria-current="page"]')` (`tests:17-19`)                                                                                                                                             | 65      | Any variant control that is not `nav` + link (tabs, select, matrix) |
| 2   | `getByRole("button", { name: "Approve & next A", exact: true })`                                                                                                                                                                                                   | 33      | A rename, or a shortcut hint outside the accessible name            |
| 3   | Helper `ready()`: `[data-evidence="ready"]` (`tests:9-11`)                                                                                                                                                                                                         | 40      | A new evidence container                                            |
| 4   | `.review-item` and `[id="review-item-<key>"]`                                                                                                                                                                                                                      | 13 + 22 | A new row component or id rule                                      |
| 5   | `getByRole("img", { name: "New image" })`, `{ name: "Reference" }`                                                                                                                                                                                                 | 12 + 8  | The `alt` texts (the captions already say Current and Baseline)     |
| 6   | `getByRole("button", { name: /Undo/ })`                                                                                                                                                                                                                            | 12      | An Undo toast in place of the button                                |
| 7   | `getByRole("button", { name: "Recompare stored run" })`                                                                                                                                                                                                            | 12      | Removal of the retired control (`guide:88`)                         |
| 8   | `getByLabel("Review workspace", { exact: true }).focus()`                                                                                                                                                                                                          | 12 + 5  | `tabIndex` removed from the root (SHELL-12, A11Y-R4)                |
| 9   | `.review-run-progress` with "N of M need review"                                                                                                                                                                                                                   | 8       | A ring, a segmented bar, or "9 left"                                |
| 10  | "Retry images" (7), "Image evidence unavailable" (6)                                                                                                                                                                                                               | 13      | New error copy                                                      |
| 11  | "Difference D" (6), "Current F" (3), "Baseline G"                                                                                                                                                                                                                  | 10      | Mode names or modes                                                 |
| 12  | Link names `/React.*Approved/`, `/Solid.*Needs review/`, `/Dark.*Rejected/`                                                                                                                                                                                        | 5 each  | A chip name without the verdict, or a mark with its own name        |
| 13  | "Screenshots" button and dialog (6), "Close screenshots" (3)                                                                                                                                                                                                       | 9       | A narrow layout with the list above the viewer (the contract rule)  |
| 14  | "Details" (6), "Capture details" (3)                                                                                                                                                                                                                               | 9       | A popover or an inspector                                           |
| 15  | "Keyboard help" (5), "Shortcuts on" (2)                                                                                                                                                                                                                            | 7       | A `?` overlay, a switch in the help dialog                          |
| 16  | "Retry same command" (5), "1 variant approved. Saved." (5)                                                                                                                                                                                                         | 10      | One-word save states                                                |
| 17  | "Accepted (1)", "Accepted (2)"                                                                                                                                                                                                                                     | 6       | Status tabs in place of the disclosure                              |
| 18  | `/^All \d+ changed views/` (3), "Review all changed views" (2), `/Reject whole item/` (1)                                                                                                                                                                          | 6       | Any new whole-item control                                          |
| 19  | `.review-variant-icons` (6), `.review-variant-title` (4), `.review-run-identity` (4)                                                                                                                                                                               | 14      | Chip internals, Details internals                                   |
| 20  | Geometry: `.review-pane` stacking at 390 px (`tests:1297-1302`), `toHaveCSS("width", "600px" / "1200px")` (`tests:1286-1295`), pan button name "Pan New image right", pane label "New image. Use pan controls or scroll to inspect the image." (`tests:1373-1377`) | 8       | One linked stage, a zoom stepper, no pan buttons                    |

Behaviors that only a test defines (no contract row and no guide row):

1. First visit by keyboard opens the first variant that needs review (`tests:399-416`). This contradicts `issue-1:271` and `guide:82`.
2. Arrow keys follow the filtered order, and the previous and next buttons are disabled at the ends of it (`tests:1885-1912`).
3. Keyboard navigation goes from attention items into the closed "Accepted" group and opens it (`tests:339-372`).
4. Home and End on a list row (`tests:359`, `tests:369`; `scale.browser.test.ts:63`).
5. The whole-item button opens a confirmation dialog, and the dialog closes when the comparison, the targets, or the selection change (`tests:1843-1883`).
6. Narrow layout: the list is in a dialog, and its filter persists while the dialog is closed (`tests:1914-1953`).
7. Save, Retry, and Undo message texts ("1 variant approved. Saved.", "2 queued on server. You can close this window.", "This acceptance is already saved.").
8. A pending comparison polls only `/state`, every 2 s, and stops while the page is hidden (`tests:1449-1480`).
9. Chip rendering: brand icons, the position number on the first six chips, no browser mark for a framework name (`tests:68-166`).
10. The diff pane stays mounted after first use and keeps its pan until the variant changes (`tests:1695-1761`).
11. `G` switches to the reference image (`tests:1181-1195`). The guide has it; the contract has not.

## Findings

### RULE-01 · Narrow layout: the item list is in a dialog, not above the viewer

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: `issue-1:267` "Keep a usable narrow layout with the list above the viewer and stacked comparison images." `guide:94` "The layout stacks the list and images on narrow screens." Code: `ws:625-632` renders a "Screenshots" button when `narrow` is true; `ws:1206-1222` renders the list in `ak.Dialog`. Measured at 390 × 844: `"screenshotsButton":{"y":162,"h":35}`, `"panes":[{"y":476,"h":521},{"y":998,"h":521}]`, `"firstImageViewport":{"y":524}`. Screens S13, S14, S15. `tests:1914-1953` pins the dialog.
- What happens: Below 1024 px the reviewer sees no item list. One button opens a modal list. The two images are stacked, as the rule says. `f83fef6` introduced the dialog (`+ open={itemsOpen && narrow}`).
- Impact: The rule, the guide, and the tests say three different things. A designer of the phone flow cannot know which one is current.
- Recommendation: Decide the rule first, then align code, guide, and tests. A layout that makes the rule true with a small change is in "Redesign ideas", idea D.
- Alternatives: (a) Minimal: change the rule text and the guide to "the list opens from a button". (b) Put a collapsed list (one row for the selected item) above the viewer. (c) A new phone flow (group G15), which also replaces "stacked comparison images".
- Maintainer decision needed: yes. Is "the list above the viewer" still the rule for narrow windows?

### RULE-02 · Thumbnails: no current writer, and the selection rule is not the contract rule

- Kind: dead-code
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: `issue-1:262` "Thumbnail always uses the item’s first declared candidate variant". `nav:177-179`:

  ```ts
  export function itemThumbnail(item: ReviewItem) {
    return item.variants.find((variant) => variant.thumbnail)?.thumbnail;
  }
  ```

  `apps/web/src/api/review.ts:505-507` sets `thumbnail` only from `result.thumbnailImageId`. `rg thumbnailImageId` in non-test source finds one writer, `apps/compare/src/process.ts:191,206,228`, and `processComparisonTask` has no importer. `rg -i thumbnail` finds nothing in `apps/web/src/api/local-comparison.ts`, `apps/web/src/api/workflow-materialize.ts`, `packages/service/src/service.ts`, `packages/cli/src`, or `apps/web/src/review/preview-fixtures.ts`. Measured on port 4310: `"thumbnail":"empty"` (S17). The fixture shows thumbnails only because `fixture-model.ts:27` injects one.

- What happens: A run from trusted local Submit (the only admitted path, `contract:77`) has no thumbnail. The row shows "—" in a 26 px tile. If a thumbnail existed on the second variant only, the code would show it, which is not "first declared candidate variant".
- Impact: 26 px of each row hold a dash. The guide (`guide:27`) describes a feature that current runs do not have. The browser tests cannot see this, because their fixture has thumbnails.
- Recommendation: Choose one of the alternatives, then make `itemThumbnail` and the rule agree.
- Alternatives: (a) Minimal: remove the tile and the rule. (b) Use the first candidate image of the first variant at a small size (`loading="lazy"`; full-size bytes for each mounted row, not measured). (c) Produce a thumbnail or a diff crop in the CLI and import it. (d) Use diff thumbnails in larger rows (WORK item row 3).
- Maintainer decision needed: yes. Keep the thumbnail rule, change it, or remove it?

### RULE-03 · First visit by keyboard opens the first pending variant, and auto-advance does not update the remembered variant

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: `issue-1:271` "First visit uses its first variant; if remembered key is absent, use first and announce fallback." `guide:82` "A first visit uses the first variant." D04 context (`docs/simplification-audit/prior-r9.json`, D04): "Auto-advance selects the next pending variant and updates that item’s memory." Code `ws:359-362`:

  ```ts
  const selected =
    next.variants.find((entry) => entry.key === previous) ??
    next.variants.find(needsReview) ??
    next.variants[0];
  ```

  Measured: with the first variant of "Open menu" approved, Down selects `"2. Menu-dark … Needs review"`. Measured: `3`, `A`, Down, Up selects `"3. Dark … Approved"`. `tests:399-416` ("item navigation picks the first variant needing review unless one was chosen") pins the code.

- What happens: The contract and the guide say "first variant". The code and one test say "first pending variant". A variant that was left by auto-advance is not remembered; a variant that was chosen with a key is, also after it was approved.
- Impact: Small for the reviewer. Large for the redesign: three sources give three rules for "which variant opens".
- Recommendation: Write one rule for each entry path (key, row link, auto-advance) in the contract, then align the test and the guide.
- Alternatives: (a) Minimal: change `issue-1` and the guide to "first variant that needs review". (b) Change the code and the test to the contract. (c) One rule for all paths: remembered, else first pending (WORK-32 proposes this for row links; it reopens the U03 text "Item links target the first pending variant; remembered keyboard selection remains separate").
- Maintainer decision needed: yes. Which variant opens on a first visit, and does a row click use the memory?

### RULE-04 · The variant strip blocks every shortcut, and no document names this exclusion

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence: `ws:95` ends with `[role="tablist"], .review-variants, [data-screenshot-search]`. `issue-1:280` lists "editable content, inputs, menus, and dialogs". `guide:84` lists "Text fields, editable content, menus, and dialogs". U04 selected text: "Controls that consume arrow keys, such as tabs and menus, keep their own keyboard behavior." Measured after a click on chip 2: focus is `a.review-variant`; then `a`, `x`, `d`, ArrowDown, `2`, Control+z give `"calls":0`, `"mode":"side"`, `"heading":"Success dialog"`. After a click on the `h1`, `d` gives `"mode":"diff"`. A11Y-01 and WORK-01 report the same fact.
- What happens: The strip needs only Left, Right, Home, and End. The selector removes all keys, also `A`, `X`, and Cmd/Ctrl+Z. A mouse click on a chip leaves focus on the chip.
- Impact: The most common mixed flow (click a variant, look, press `A`) does nothing and shows nothing. Undo by key is also dead in that state.
- Recommendation: Let the strip handler consume its four keys (it already calls `preventDefault`, `ws:115`) and remove `.review-variants` from the selector.

  ```ts
  // ws:95 — the handler at ws:396 already returns on event.defaultPrevented
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"], [data-screenshot-search]';
  ```

- Alternatives: (a) Move focus to the workspace root after a chip click. (b) Keep the exclusion and add it to the contract and the help text.
- Maintainer decision needed: no, unless alternative (b) is wanted.

### RULE-05 · The variant glider is flat with a border; the later approved rule says "bar glider"

- Kind: visual
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: `contract:192` "Run views and variants use navigation links with a bar glider". `ws:719-727` `glider={{ $kind: "flat", $rounded: "full", … $border: true }}`. Measured: the variant glider is 295 × 30 px with `border-top: 1px solid` and a full radius; the item list glider is 2 × 44 px with the class `glider-bar-end`. `git show f83fef6` removes `glider={{ $kind: "bar", $barOffset: "frame" }}`. S01 (dark), S20 (light: the selected chip has no visible outline; see PRIM-03, A11Y-10).
- What happens: The newest commit replaced the approved glider kind and did not change the contract.
- Impact: The contract sentence is false for variants. Ideas in group G4 replace the same sentence again.
- Recommendation: Decide the variant control in the design phase and then rewrite `contract:192`.
- Alternatives: (a) Restore the bar glider. (b) Change the contract text to "a glider". (c) Replace the strip (group G4).
- Maintainer decision needed: yes. Is "links with a bar glider" still a rule for variants?

### RULE-06 · The whole-item command has two paths with different safety

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `issue-1:229` "Show their target count and save as one undoable command." `guide:49` "**Approve whole item** and **Reject whole item** apply one command … The button shows the number of targets." Key path `ws:427`: `review("approved", event.shiftKey)`. Measured after Shift+A: `{"verdict":"approved","targets":7,"wholeItemKey":"dialog/open"}`, `"dialogs":[]`, text "7 variants approved. Saved." (S03). Button path `ws:1042-1059`: measured `"dialogs":["Review all changed views"]`, `"calls":0` (S04). `f83fef6` removed the visible hints `Shift A` and `Shift X` and the two direct buttons.
- What happens: The key saves 7 verdicts at once. The mouse needs a dialog and a second click. The buttons that the guide names exist only inside the dialog. No visible hint shows the Shift keys outside the help dialog.
- Impact: A slip of Shift approves variants that were not opened. The contract allows that ("need not open every variant"), but the two paths give different protection. A11Y-04 and WORK-17 report the same.
- Recommendation: Use one rule for both paths.
- Alternatives: (a) Minimal: show the target count and an Undo control in a visible status after the key path. (b) Confirmation on both paths. (c) No confirmation on both paths, with the count on the button. Option "buttons only" is the rejected D21 answer `buttons`.
- Maintainer decision needed: yes. Does a whole-item command need a confirmation?

### RULE-07 · "Next pending in visible order" ignores an active filter

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `issue-1:274` "select next pending variant in visible order, wrapping once". `nav:144-163` builds the order from `items.flatMap(…)`, all items in model order. `session:313` calls it with the full model. Measured with the search text "menu": rows `["Open menu\n2 of 2 need review"]`; after two approvals `"heading":"Success dialog"` and `"selectedRowVisible":0` (S16). The arrow keys do follow the filter (`tests:1885-1912`). WORK-12 reports the same.
- What happens: Arrow keys use the filtered order. Auto-advance uses the full order. The selection leaves the list that is on screen.
- Impact: A reviewer who filters to one family is thrown out of it after the last approval there.
- Recommendation: Pass the visible order (`order`, `ws:210`) to `nextPending`, and announce "No more variants match the filter" at the end.
- Alternatives: (a) Clear the filter when auto-advance leaves it, with a visible notice. (b) Change the rule text to "in list order".
- Maintainer decision needed: yes. Does a filter limit auto-advance?

### RULE-08 · The shortcut toggle is below the fold and not stored; `[` and `G` have no contract row

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence: `issue-1:280` "Provide visible buttons and a shortcut toggle." `ws:199` `const [shortcuts, setShortcuts] = useState(true);`. Measured: toggle at y = 982 in a 900 px viewport; after a click the label is "Shortcuts off"; `localStorage` holds only `{"visonaut.review.sidebar":"true"}`; after a reload the label is "Shortcuts on"; the letters stay on the buttons while off (S05). `ws:407-411` binds `[`; the contract table and `guide:69-80` have no `[` row. `ws:436-437` binds `G`; only the guide has it. D10 says "Keep the … keyboard behavior".
- What happens: The toggle exists, so the letter of the rule holds. It is not in the first screen and it is forgotten on each load. Two keys were added without a rule.
- Impact: The off switch is the WCAG 2.1.4 mechanism that `feedback-ui.md:115` relies on. A user who needs it must set it on each visit.
- Recommendation: Store the toggle next to the sidebar preference, put it where it is visible, hide the hints when it is off, and add `G` and the sidebar key to the contract table (or remove them).
- Alternatives: (a) Minimal: store the value only. (b) Move the toggle into the help dialog (COPY-R11); then the help needs a button that works with shortcuts off.
- Maintainer decision needed: yes. Are `[` and `G` contract keys?

### RULE-09 · The selected U02 layout is delivered in two of five parts

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence: U02 selected text (Table A). Code: one `Shell` (`ws:528`) and a Details panel (`ws:1142-1171`) match. `ws:563-608`: `ShellMainHeader` holds the sidebar toggle, "Queue", the run title, and the progress. `ws:1017-1139`: Approve, Reject, Undo, and the save state are in a sticky bar at the bottom. `viewer:134`: `h-[min(56vh,650px)]`. Measured at 1440 × 900 in the fixture: image viewport `{"y":390,"h":504}` (366 without the 24 px fixture label), action bar `{"y":841,"h":61}`, `scrollHeight` 1018. The "before" number in the decision record is y = 385 at 1440 × 1000 (`evidence/visonaut-audit-ui.json:110`).
- What happens: The image starts about as low as before U02. The page still scrolls. The bar covers the last 53 px of the image area. SHELL-06, WORK-05, VIEW-04, and BENCH-01 measure the same area with other numbers.
- Impact: The main complaint behind U02 ("stacked headers and distant recovery controls") is open again after `f83fef6`.
- Recommendation: Treat the layouts of group G1 as the delivery of U02, not as a new idea. Idea G in "Redesign ideas" shows U02 as selected.
- Alternatives: (a) Minimal: give the viewer the remaining height (`min-h-0 flex-1`) and keep the bottom bar. (b) Actions in `ShellMainHeader` as selected. (c) A dock or an inspector (group G11), which replaces the U02 sentence about the header.
- Maintainer decision needed: yes. Do the actions go in the main header (the selected text) or in a bottom bar?

### RULE-10 · The full variant label, the verdict on chips, and the list dot do not meet "text with color"

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: `issue-1:261` "Prioritize run identity, item name, full variant label, review state … Counts and text must accompany color." `guide:23` "The full variant label and result appear above the image controls." Measured: the string "React · Chromium · Light · 1280 × 720" exists in `span.sr-only` (1 × 1 px) and in a 0 × 0 px `p`. Chip verdict: only `title` and `aria-label` (`ws:747`, `ws:776`). Dot: `{"className":"ak-text ak-text-warning","hiddenFromAT":true,"title":null}` (`list:270-274`). Row text for an accepted addition: "New item 0 of 1 need review" (S09). `issue-1:263` wants the mark "Accepted automatically".
- What happens: The chip shows the label as icons and parts, and cuts the key part at 12 em. When the selected chip scrolls out of the strip (WORK-02), nothing on screen names the variant. A chip does not show approved or rejected. The dot has three colors and no text of its own; the row text names one state.
- Impact: The reviewer cannot see which variants of an item are done. BENCH-05, WORK-04, and A11Y-11 report the chip part.
- Recommendation: Print the full label of the selected variant once as text, add a verdict mark with a different shape for each state to each chip, and give the row a text for each state that the dot can show.
- Alternatives: (a) Minimal: a tooltip is not enough for the rule, because the rule says "text". (b) Idea E in "Redesign ideas". (c) Group G4 controls; each must keep the full label reachable as text.
- Maintainer decision needed: yes. May a chip show only the parts that differ, with the full label in one line elsewhere?

### RULE-11 · Image position is kept only inside one pane

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: `issue-1:264` "Preserve zoom and image position when possible." `viewer:35` `const position = useRef({ left: 0, top: 0 });` in each `ImagePane`; `viewer:39-41` resets it on a new identity. Measured at 200%: after a scroll of the Baseline pane to (300, 200), Current is at (0, 0) (S08); `D` shows Difference at (0, 0); `S` restores Baseline (300, 200); 100% gives (45, 0); the next variant gives (0, 0) with zoom 200% kept. `tests:1367-1391` pins "keeps position across F and S" for one pane.
- What happens: Zoom is kept. The place is lost between Compare and Difference, between the two panes, and between variants. VIEW-03, A11Y-06, and BENCH-03 report the same.
- Impact: A zoomed comparison shows two different regions. The reviewer must find the place again in each mode and variant.
- Recommendation: One pan and zoom state for all panes of a variant, kept as an image point, and kept across variants of one item when the sizes are equal.
- Alternatives: (a) Minimal: copy the scroll position to the other panes on scroll. (b) One stage (group G3).
- Maintainer decision needed: no.

### RULE-12 · The pull request title is read from a payload that the service clears

- Kind: bug
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence: Decision record `evidence/feedback-ui.md:134`: "Processed webhook JSON is cleared. Therefore reading old webhook payloads is not a viable title source." Plan `feedback-ui.md:139`: "Add one nullable display-title field to the existing run row." Code `apps/web/src/api/dashboard.ts:57-62`: `SELECT json_extract(delivery.payload_json,'$.pull_request.title') …`. `apps/web/src/api/review.ts:288` reads the same column. `apps/web/src/api/webhooks.ts:150`: `UPDATE github_webhook_delivery SET processed_at=?, payload_json='{}' …` (also `:172`, `:332`). DASH-05 measured the effect with sqlite3.
- What happens: The implementation took the title source that the earlier research excluded. After a delivery is processed, the title is gone, and the queue shows the kind label.
- Impact: The maintainer note on U05 ("include the pull request title if possible") is not delivered for processed deliveries.
- Recommendation: Follow the recorded plan: one nullable title column on the run row, filled at admission, outside the proof hash (`feedback-ui.md:140`).
- Alternatives: (a) Minimal: copy the title to the run row before the payload is cleared. (b) Keep the title field of the payload when the rest is cleared.
- Maintainer decision needed: no.

### RULE-13 · Refusal, completion, and fallback messages reach only the screen-reader live region

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `issue-1:229` "refuse the entire command, keep selection, and offer an eligible individual action". `guide:49` "the page keeps the selection and explains the refusal". `session:425-427` calls `onAnnounce(…)`; `ws:1202-1204` renders `<p className="sr-only" role="status" …>`. Measured after Shift+X with one protected target: `{"className":"sr-only","width":1,"height":1,"clipPath":"inset(50%)"}`, `"calls":0`; S06 is equal to the default screen. Dialog path: `"dialogRejectDisabled":false`; after the click the dialog closes and `"visibleAlertsAfterDialogReject":[]` (S07). The same channel carries "Review complete. No variants need review." (`session:367`), "The remembered variant is unavailable…" (`ws:347`, `ws:366`), and "Resolve the unsaved command…" (`session:410`).
- What happens: A sighted user presses Shift+X and nothing changes on screen. The dialog button is enabled, and after the click the dialog closes without a message.
- Impact: The refusal looks like a dead key. The test for it passes (`tests:784-786`), because `toBeVisible()` is true for a 1 × 1 px element.
- Recommendation: Show these messages in one visible status slot (idea F), and keep the live region for the announcement.
- Alternatives: (a) Minimal: reuse `.review-save-state` (`ws:1104-1114`) for refusal texts. (b) Disable the dialog button and print the reason beside the protected target.
- Maintainer decision needed: no.

### RULE-14 · Hand-built pieces stand where copied primitives exist

- Kind: inconsistency
- Severity: low. Confidence: medium. Measured: no. Effort: M
- Evidence: `issue-1:247` and U01 (Table A, rows A03 and U01). `ws:149-187` builds the help dialog from `ak.Dialog` with class strings; `ws:599-604` uses `<progress>`; `ws:165-182` prints keys as plain text while `components/ariakit/components/kbd.ariakit.react.tsx` has no importer. PRIM-08, PRIM-09, PRIM-10, WORK-27, and VIEW-19 hold the counts.
- What happens: The workspace follows U01 for layout (`Shell`, `Frame`, `Nav`). Dialogs, key caps, progress, banners, and separators are local markup.
- Impact: Each redesign variant would repeat this markup. The vendored set lacks Dialog, Tooltip, Progress, and Input, so U01 cannot be met for these parts without a change to D10.
- Recommendation: Decide D10 first (group G16): extend the copied set, or accept local markup for the missing parts.
- Alternatives: (a) Minimal: use the vendored `Kbd` and `Tabs` where they fit. (b) Vendor the newer upstream set and update `NOTICE`.
- Maintainer decision needed: yes. May the copied component set grow (D10 says no replacement is selected)?

### RULE-15 · The review guide describes the UI before commit f83fef6

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence (guide line, guide text, code today):

  | Guide         | Guide text                                                                                   | Code                                                                                   |
  | ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
  | `guide:31-34` | "Side by side", "Pixel diff", "New only", "Original only"                                    | "Compare", "Difference", "Current", "Baseline" (`ws:845`, `:860`, `:874`, `:888`)      |
  | `guide:45`    | "Choose **Approve** or **Reject**"                                                           | "Approve & next", "Reject view" (`ws:1095`, `ws:1077`)                                 |
  | `guide:49`    | "**Approve whole item** and **Reject whole item** … The button shows the number of targets." | "All N changed views…" opens a dialog (`ws:1055`)                                      |
  | `guide:27`    | "The thumbnail stays tied to the item’s first declared candidate variant."                   | RULE-02                                                                                |
  | `guide:82`    | "A first visit uses the first variant."                                                      | RULE-03                                                                                |
  | `guide:84`    | "Text fields, editable content, menus, and dialogs keep their own keys."                     | RULE-04                                                                                |
  | `guide:69-80` | no `[` row                                                                                   | `ws:407-411`                                                                           |
  | `guide:88`    | "**Recompare stored run** is retired."                                                       | The button is rendered for each non-preview run (`ws:1186-1197`)                       |
  | `guide:92`    | "Use **All runs** to return to the dashboard"                                                | "Queue" (`ws:584`)                                                                     |
  | `guide:94`    | "The layout stacks the list and images on narrow screens."                                   | RULE-01                                                                                |
  | `guide:15`    | "The Runs page shows the run type, tested commit, state, attempt, and creation time."        | "Review queue" cards and "Run history" (`apps/web/src/components/app-shell.tsx:15-19`) |

  `git show --stat f83fef6 -- docs` prints nothing.

- What happens: The guide uses the contract words. The UI uses new words. COPY-17, BENCH-11, A11Y-23, and SHELL-18 list more strings.
- Impact: The only user document names controls that do not exist. The guide is also the only place that gives the `G` key a rule.
- Recommendation: Choose the vocabulary in the design phase, then write the guide from the UI in one pass.
- Alternatives: (a) Change the button names back to the contract names. (b) Update the guide now and again after the redesign.
- Maintainer decision needed: yes. Which names are the rule: the contract names or the names in the UI?

### RULE-16 · The contract documents disagree with each other on six UI points

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  1. Shortcut scope. `issue-1:280` "Scope letter shortcuts to the focused review workspace." `docs/design-r9.html:19` "Do not install page-wide letter shortcuts." Selected U04: page-wide. The replacement is written only in `docs/simplification-audit/handoff-draft.md:25`. `contract:146` has the title only.
  2. Variant semantics. `issue-1:280` "composite/tab semantics". `contract:144` "Use item links and variant tabs". `contract:192` "variant links replace the original U03 tabs". `docs/simplification-implementation.md:89` still says "linked tabs".
  3. Advance timing. `issue-1:274` "After successful save". `contract:192` "advance while saving".
  4. Run identity. `issue-1:260` "commit/run identity above" and `guide:17` "Check the run identity above the images before you save a decision." U02 selected text: "Move run IDs, policy and comparison history to a Details disclosure." The prototype plan lists "Attempt" under `moveToDetails` (`evidence/visonaut-audit-ui.json:562`).
  5. Modes. `issue-1:276` has S, D, F. `guide:34` and `guide:77` add G.
  6. First variant. `issue-1:271` "First visit uses its first variant". U03 selected text: "Item links target the first pending variant; remembered keyboard selection remains separate."
- What happens: `contract:7` makes `issue-1` binding where no later rule replaces it. For these six points a reader must find the later rule in `audit-data`, in a draft, or in a commit.
- Impact: Six of the nine UI lanes worked without the contract. A lane that reads only `issue-1` gets the wrong rule for points 1, 2, and 3.
- Recommendation: Add a short "Review UI rules in force" table to `contract` (Table A of this report can be the start) with one row for each rule and its replacement.
- Alternatives: (a) Minimal: add six lines under "Later approved review changes". (b) Edit `issue-1` in place, which the file forbids ("frozen" history).
- Maintainer decision needed: no.

### RULE-17 · Tests pin behavior that contradicts the contract, and two tests prove less than their names say

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence: Table F. `tests:399-416` pins the first pending variant (against `issue-1:271`). `tests:784-786` and `tests:751-753` call `toBeVisible()` on texts that are `sr-only` (measured 1 × 1 px). `tests:1914-1953` pins the narrow dialog (against `issue-1:267`). 12 uses of the name "Recompare stored run" pin a control that `guide:88` calls retired. 368 of 610 assertions use an accessible name or role, 33 of them the exact name "Approve & next A".
- What happens: The suite protects the behavior of the current UI well. It also fixes strings, one retired control, and three behaviors that the contract does not have.
- Impact: A redesign breaks most of the 610 assertions for reasons that are not behavior. The 11 test-only behaviors in Table F will be lost without notice if the tests are rewritten from the new UI.
- Recommendation: Before the redesign, tag each test with the rule ID that it protects (Table A), move the 11 test-only behaviors into the contract or drop them on purpose, and replace `toBeVisible()` on live-region text with a check of the live region plus a check of a visible element.
- Alternatives: (a) Minimal: keep the tests and add `data-testid` hooks for the 20 pins in Table F. (b) Split the suite into "rule tests" (by role and behavior) and "copy tests".
- Maintainer decision needed: no.

### RULE-18 · The lab primitives guide shows `R` for Reject; the contract key is `X`

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence: `apps/lab/docs/primitives.md:2336-2353` ("Keyboard hint" recipe): `<Kbd>J</Kbd> <Kbd>K</Kbd> Navigate`, `<Kbd>A</Kbd> Approve`, `<Kbd>R</Kbd> Reject`, `<Kbd>⌘</Kbd> <Kbd>K</Kbd> Search`. `issue-1:274` "A / X". DASH-C12 proposes `r` for refresh.
- What happens: The recipe that design variants will copy shows a key map that the product does not have. `apps/lab` belongs to another task; I did not change it.
- Impact: Variants can ship three meanings of `R` (reject, refresh, nothing).
- Recommendation: Use one of the three key maps in "Redesign ideas" in the lab recipe.
- Alternatives: None needed.
- Maintainer decision needed: no.

### RULE-19 · `[` and `]` have three proposed meanings and fail on common keyboard layouts

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: Today `ws:407-411` (item sidebar). WORK layout A: "The sidebar stays, and `[` hides it." SHELL-R3: "Column 1 collapses with `[`" (column 1 is the run list there). VIEW-R2: "`[` and `]` move it with the keyboard" (the swipe divider). A11Y-24: replace `[` with `B`. `ws:398` `if (event.altKey) return;`. Measured (synthetic events): `{ key: "[", altKey: true }` leaves `"sidebar":"true"`; `{ key: "[" }` gives `"sidebar":"false"`.
- What happens: One key gets three jobs across the proposals. On layouts where `[` needs AltGr or Option (German, French, Spanish, Nordic), the key cannot fire today.
- Impact: Two lane designs cannot be combined as written.
- Recommendation: Do not bind bracket keys. The key maps in "Redesign ideas" use letters.
- Alternatives: (a) Keep `[` for the sidebar only and accept the layout limit (D53 names one browser, not one layout). (b) Match on `event.code` `BracketLeft`.
- Maintainer decision needed: yes (with RULE-08).

### RULE-20 · Proposals that let arrow keys pan return to two options that the maintainer rejected

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: U04 options in `audit-data`: `focus-owned` "Let image focus scroll the image", `pan-mode` "Enter image inspection to use arrows for panning; Escape returns to review navigation", `global` (selected). `evidence/visonaut-audit-ui.json:402` shows that the research recommended `focus-owned`. `feedback-ui.md:115`: "This is the user's selected tradeoff. It must not be described as a new accessibility failure merely because the earlier recommendation differed." VIEW-06 recommendation: "When the stage has focus … let the arrow keys pan and let `Escape` return to item and variant navigation." A11Y-05: "When focus is inside the image stage, arrows pan." SHELL-R6 moves items to Left/Right and variants to Up/Down. Measured: Shift+ArrowDown changes the item and Shift+ArrowRight changes the variant today.
- What happens: Two lanes present `focus-owned` and `pan-mode` as new. One lane swaps the arrow axes of the contract rows K1 and K5. The smaller option (Shift+Arrow) is not free today, because the handler does not read Shift for arrows.
- Impact: The maintainer can get a question that was answered on 2026-09-29, without the earlier answer beside it.
- Recommendation: Show the pan question with its history. Key map C in "Redesign ideas" pans with Shift+Arrow and keeps U04.
- Alternatives: (a) Keep pan on buttons only (the selected answer). (b) Pan with drag and wheel only. (c) Reopen U04.
- Maintainer decision needed: yes. Is U04 open again?

### RULE-21 · `J`/`K`, `N`/`P`, `G`, `I`, and `R` have more than one proposed meaning

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence: Table E. `J`/`K`: rows (A11Y-05, A11Y-R11, DASH idea 1, DASH-C12, WORK layout E) against pan (VIEW-06 alternative b). `N`/`P`: items (A11Y-05) against change regions (VIEW-R4). `G`: mode today (`ws:436`) against the `g i` / `g h` prefix (DASH-C12). `I`: inspector (VIEW-R7) against "ignore" (BENCH-14 prior art). `R`: refresh (DASH-C12) against Reject (RULE-18).
- What happens: Each lane chose keys for its own surface. A split inbox (group G7) puts the queue and the workspace on one page, so the scopes meet.
- Impact: Variants built from two lanes get dead or double keys.
- Recommendation: Use one map for all variants. See key maps B and C.
- Alternatives: Scope keys by focused region. This needs a visible focus model first (A11Y-R4).
- Maintainer decision needed: no.

### RULE-22 · Space, Escape, Cmd/Ctrl+K, F6, and Ctrl+wheel collide with the browser or with earlier instructions

- Kind: inconsistency
- Severity: medium. Confidence: medium. Measured: yes (Space, Escape); no (the others). Effort: S
- Evidence: Space: measured `"scrollY":[155,206]` on the workspace page; Space also presses a focused button. Proposals: "Hold `Space` to show only the baseline" (VIEW-R3, VIEW-05 a, A11Y-R7). Escape: measured no change; VIEW-06 uses it to leave pan mode (the rejected `pan-mode`). Cmd/Ctrl+K: SHELL-R4, A11Y-R3, WORK filter 4; `feedback-ui.md:73` "Keep browser modifier shortcuts; Cmd/Ctrl+Z remains the explicit existing review Undo exception"; `feedback-ui.md:96` and the U04 migration text "Do not add a hotkey registry." F6 (A11Y-R4) is a browser key for pane focus. Ctrl+wheel (A11Y-R7) is browser zoom.
- What happens: Hold-Space needs `preventDefault` on keydown, a keyup handler, and a rule for focused buttons. A fixed-height page removes the scroll conflict but not the button conflict. A command palette on Cmd/Ctrl+K is a second modifier exception and, in A11Y-R3, a registry.
- Impact: These keys work in a prototype and fail in parts of the real page.
- Recommendation: Use a letter for blink (key map C uses `T`), keep Escape for overlays only, and ask the maintainer about the registry sentence before a palette is designed.
- Alternatives: (a) Hold-Space only while the stage has focus. (b) A palette that opens from a visible field and from `/`, with no modifier chord.
- Maintainer decision needed: yes. Is "do not add a hotkey registry" still in force, and may Cmd/Ctrl+K be taken?

### RULE-23 · Shift gets three jobs: whole item, pan, and a pointer mode

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence: `ws:427` (Shift+A saves the whole item; measured 7 targets, no dialog). VIEW-R2: "the divider follows the pointer while `Shift` is down". VIEW-06 alternative a and A11Y-05 alternative b: Shift+Arrow pans.
- What happens: With VIEW-R2, a reviewer holds Shift to move the divider and presses `A` to approve what is on screen. The code saves the whole item.
- Impact: A wrong whole-item decision. Undo exists, but the only signal is one line of small text (S03).
- Recommendation: Do not use a held Shift as a mode. If Shift+Arrow pans, also settle RULE-06.
- Alternatives: The divider follows the pointer while a mouse button is down.
- Maintainer decision needed: no.

### RULE-24 · Phone gestures collide, and phone review is outside the selected support scope

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: M
- Evidence: A11Y-R6: "Swipe left or right moves to the next or previous variant." WORK layout G: "a tap or swipe to flip between baseline and current". VIEW-R10: "Press and hold shows the baseline. … Pinch zooms, drag pans." D53 selected `chrome`; rejected `mobile`; `issue-1:267` "This is not a promise of certified mobile workflows at launch."
- What happens: Swipe has two meanings and drag has a third. Press and hold on an image opens the system image menu on phones.
- Impact: The three phone designs cannot be merged. Each one also replaces A27.
- Recommendation: Decide A27 and D53 before phone variants are built. If phone variants are built for exploration, give each gesture one meaning in all of them.
- Alternatives: Buttons only on narrow windows (a two-state switch for baseline and current).
- Maintainer decision needed: yes. Is a phone review flow in scope?

### RULE-25 · Fifteen redesign ideas present a rejected or deferred option as new

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:

  | Idea                                                               | Earlier record                                                                                                           | State of the earlier record                       |
  | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
  | WORK layout F "One primary action approves the item"; VIEW-R9      | D02 option `item`: "easier to accept a variant that has not been inspected"                                              | rejected                                          |
  | VIEW-06, A11Y-05, A11Y-R7 (arrows pan; Escape leaves pan)          | U04 `focus-owned`, `pan-mode`                                                                                            | rejected                                          |
  | A11Y-R3 "one registry"; SHELL-R4, WORK filter 4 (Cmd/Ctrl+K)       | `feedback-ui.md:96` "do not add a hotkey registry"; `:73`                                                                | instruction                                       |
  | DASH idea 5, SHELL-R7, PRIM-R3 (one list for queue and history)    | U05 `recent-clear`                                                                                                       | rejected                                          |
  | A11Y-R2 option A (`TabProvider … setSelectedId`), VIEW-T2          | `contract:192` "variant links replace the original U03 tabs"; `feedback-r3-tabs.md:9`                                    | replaced; known defect of that pattern            |
  | A11Y-R2 sketch (`index < 9`)                                       | K6 "first six variants"                                                                                                  | rule                                              |
  | BENCH-13 reject note                                               | `issue-1:57` "comment system at launch"                                                                                  | non-goal                                          |
  | BENCH-14 noise verdict                                             | `issue-1:57` "automatic approval of visual flakiness"                                                                    | non-goal                                          |
  | PRIM-10 option "delete `tabs.ariakit.react.tsx`"; PRIM-08, PRIM-15 | D10 "No pruning or replacement is selected."                                                                             | rule                                              |
  | PRIM-R1 "A thin app kit"                                           | U01 summary "instead of introducing another component wrapper layer"                                                     | warning                                           |
  | WORK-32 (row link uses the memory; "decision needed: no")          | U03 selected text; `evidence/visonaut-audit-ui.json` research note "Preserve this outcome unless a decision reopens it." | rule                                              |
  | VIEW-R4 overlay as the default Difference view                     | P02 `eager`                                                                                                              | rejected, if the mask loads before it is selected |
  | WORK layout G, VIEW-R10, A11Y-R6                                   | D53 `mobile`                                                                                                             | rejected for launch                               |
  | BENCH-09, WORK layout D (sort by change size)                      | D29 `candidate` order                                                                                                    | rule                                              |
  | PRIM-R14 "`$kind="bevel"` for the one primary action"              | D17 `comfortable` "More spacing and subtle bevels"                                                                       | rejected                                          |

  Deferred, not rejected: swipe and overlay (`docs/design-r9.html:19`: "A wipe slider and overlay can follow later if needed.").

- What happens: The lanes worked from the screen and the code. The earlier answers were not in their input.
- Impact: The maintainer can be asked the same question again with no mark that it was answered.
- Recommendation: In the design app, mark each variant that needs one of these rows with the decision ID ("reopens U04") so that the choice is visible.
- Alternatives: Leave these ideas out of the first round.
- Maintainer decision needed: yes, one for each row; see "Questions for the maintainer".

### RULE-26 · Ideas that shorten copy remove strings and states that the contract names

- Kind: copy
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence: COPY-R4: save state "`Saving…`, `Saved`, or `Not saved`" against `contract:196` "The client distinguishes sending, queued, and saved decisions" and `guide:45` "**Queued on server** confirms durable admission". COPY-R14: "`Accepted (1)` becomes `Done · 1`" against `contract:194` "stay under **Accepted**". COPY-R12 and VIEW-C3: one pane for additions and removals against `issue-1:265` "S shows the old image and a labeled empty pane". COPY-R3: "`9 left`" against `issue-1:261` "Show counts such as “2 of 6 need review”". PRIM-R7 `dot`, WORK item row 2 ("without words"), WORK status 4 against `issue-1:261` "Counts and text must accompany color." PRIM-R4, COPY-R3, SHELL-C4, A11Y-R1 move commit and attempt out of the first screen against `issue-1:260` and `guide:17`. WORK bar 6 "Toast with Undo" at decision time against I5 (Undo exists only after the server answer; today `ws:1033` disables it while busy).
- What happens: The UI is text-heavy (the maintainer's complaint), so each lane cut text. Some of the cut text is rule text.
- Impact: A variant can look right and lose the difference between "queued" and "saved", which is invariant I4.
- Recommendation: Keep three save states with different marks (for example a spinner, a cloud mark with "Queued", a check with "Saved"), keep one count with each colored mark, and treat each contract string as a decision when it changes.
- Alternatives: None for I4 and I5. The other strings can change with an approved rule.
- Maintainer decision needed: yes. May "Accepted", "Accepted automatically", "Removed, no new image", and "N of M need review" change?

### RULE-27 · Ideas that widen the scope of a decision need rules that do not exist

- Kind: ux
- Severity: high. Confidence: medium. Measured: no. Effort: L
- Evidence: I1, I2, I5, I8 (Table D). WORK layout D: "Select many cards and approve them in one command." VIEW-R9: "Select several cards and approve them together." WORK layout E: "`A` and `X` act on the card at the top of the viewport." WORK item row 5: "a group approve action". WORK-08 option d: "Buffer one key press and apply it when the images become ready." `issue-1:266` covers one case only: "Whole-item review need not open every variant, but the displayed current item/comparison must be ready". `session:413-416` builds targets from one item. The server accepts targets from more than one item (`packages/service/src/review-commands.ts:166-170`, BENCH-08). Not measured: each target adds 4 statements to one D1 batch (`review-commands.ts:227-271`).
- What happens: Three designs let one action decide variants of several items from thumbnails. One design removes the selected variant, so "the evidence currently displayed" has no single meaning. One option replays a key press on pixels that the reviewer did not see at the time of the press.
- Impact: These are the places where a new UI can weaken the review gate without a server change.
- Recommendation: For each of these variants, state in the design app: which image must be decoded for each target, which IDs and revisions are frozen and when, what one Undo restores, and what happens when one target is refused. Without these four answers, build the variant as a read-only layout.
- Alternatives: (a) Keep the scope at variant and item, and use the grid only to open and to filter. (b) Multi-select inside one item only (the D21 scope).
- Maintainer decision needed: yes. May one command decide variants of more than one item?

### RULE-28 · Shortcuts compare `event.key`: letters fail on non-Latin layouts, and unshifted digits fail on AZERTY

- Kind: accessibility
- Severity: low. Confidence: medium. Measured: yes. Effort: S
- Evidence: `ws:399` `const key = event.key.toLowerCase();`, `ws:424` `/^[1-6]$/.test(key)`. Measured with synthetic events (no real layout was available): `{ key: "ф", code: "KeyA" }` gives `"calls":0`; `{ key: "é", code: "Digit2" }` leaves variant 2 unselected; `{ key: "a", code: "KeyQ" }` gives `"calls":1`; `{ key: "A" }` without Shift (Caps Lock) approves one variant. A11Y-24 has the same result for `ф` and `[`.
- What happens: Matching the printed letter is right for Latin layouts. It gives no match on Cyrillic, Greek, Hebrew, or Arabic layouts. Digits need Shift on AZERTY, which the code allows by accident (no Shift check for digits).
- Impact: Outside the D53 scope statement (it names a browser, not a layout). It becomes real with more keys.
- Recommendation: Match a Latin letter by `event.key`; fall back to `event.code` when `event.key` is not a Latin letter; match digits by `event.code` (`Digit1` to `Digit6`).

  ```ts
  const letter = /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : event.code.replace(/^Key/, "").toLowerCase();
  const digit = /^Digit[1-6]$/.test(event.code) ? Number(event.code.slice(5)) : undefined;
  ```

- Alternatives: (a) `event.code` only (breaks AZERTY and Dvorak letter positions). (b) No change, and a line in the guide.
- Maintainer decision needed: no.

### Questions for the maintainer

One line for each rule that at least one redesign idea would replace.

1. A27 (narrow): is "the list above the viewer and stacked comparison images" still the rule, or may a sheet, a dialog, or a single stage with a flip replace it?
2. A11 (thumbnail): keep "first declared candidate variant" (it needs a writer), use diff thumbnails, or remove thumbnails?
3. A06 and `guide:17` (identity above): may commit and attempt move to a popover or to Details?
4. A07 (full variant label): may chips show only the parts that differ, with the full label in one text line or a tooltip?
5. A08 and A09 (counts and text with color): may a dense row use a mark without words?
6. A12 and D29 (list order): may the list sort by change size or group by path?
7. A13 and L4 (wording and place of "Accepted automatically" and "Accepted"): may they change to tabs or to "Done"?
8. A16 (red diff): may the mask color change or become a setting?
9. A21 and D30 (one-image states): may an addition or a removal use one pane?
10. A18: is one linked pan and zoom for all panes wanted (it removes the eight pan buttons that U04 names)?
11. K1, K5, and U04 (arrows): may arrows pan on the focused stage, or pan with Shift, or stay as selected?
12. K2 and K3 (first visit and memory): first variant, or first pending variant; and what does a row click open?
13. K6 (keys `1` to `6`): extend to `9`?
14. K8 (next pending): does a filter limit auto-advance?
15. K11, D02, and D21 (whole item): confirmation on both paths or on none; may a command cover more than one item?
16. K13 (S, D, F, and G): which modes and keys are the rule; may `D` become a toggle?
17. X2 (exclusions): may the variant strip keep only its four keys?
18. X4 (toggle): where is it, is it stored, and may it move into the help dialog?
19. U02: actions in the main header (as selected), or a dock, a floating bar, or an inspector?
20. U03 and L1: links with a bar glider, or tabs, a select, or a matrix?
21. U05: one merged list, or a work list with a separate history view?
22. P02: may the mask load before the reviewer selects it?
23. D10 and A04: may the copied set be refreshed, extended, or pruned, and may its file layout change?
24. U04 instructions: may a shortcut registry exist, and may Cmd/Ctrl+K be taken?
25. D53: is a phone review flow in scope for the design phase?
26. `issue-1:57`: is a reject note or a noise verdict in scope?
27. L5: how short may the save state be while sending, queued, and saved stay different?
28. `[` and `G`: add both to the contract table, or remove them?
29. D17: may the one primary action use a bevel?

## Measurements (command, raw result, limits)

All scripts are in the scratch directory. All browser runs use Chrome through Playwright, dark scheme, 1440 × 900 unless stated.

1. `node probe.mjs` (12 probes; output in `probe-output.json` when run without an argument; I ran each probe by name). Fixture: `http://127.0.0.1:4311/src/review/__tests__/index.html`. The fixture adds a 24 px "Outside search" label above the workspace, so y values are 24 px higher than in the product.
   - `layout`: `"innerHeight":900,"scrollHeight":1018,"firstImageViewport":{"x":257,"y":390,"w":591,"h":504},"actions":{"y":841,"h":61},"help":{"y":961},"shortcutToggle":{"y":958}`; roles `{"tablist":0,"tab":0,"grid":0}`; variant glider `{"box":{"w":295,"h":30},"borderTop":"1px solid","radius":"3.35544e+07px"}`; item glider `{"className":"glider glider-bar-end glider-bar-frame …","box":{"w":2,"h":44}}`; 7 variant links with `"tabIndex":0`.
   - `keys`: `arrowUpAtFirstItem` and `arrowLeftAtFirstVariant` equal to `initial`; `shiftArrowDown` heading "Open menu"; `shiftArrowRight` variant "2. Menu-dark"; `firstVisitWithApprovedFirstVariant` variant "2. Menu-dark … Needs review"; `arrowDownPastLastItem` heading "Removed item"; `heldArrowUpThreeKeydowns` heading "New item"; "no change" for `? / ' ] j k n p e r i v z 0 + - = . Escape Enter`; Space `"scrollY":[155,206]`; `[` `"sidebarExpanded":["true","false"]`.
   - `decisions`: `"shiftACall":{"verdict":"approved","targets":7,"wholeItemKey":"dialog/open"}`, `"dialogs":[]`; button click `"dialogs":["Review all changed views"]`, `"calls":0`.
   - `chipFocus`: after a chip click `"activeElement":"a.review-variant[2. Solid …]"`; after `a x d ArrowDown 2 Control+z`: `"calls":0,"mode":"side","heading":"Success dialog"`; after a click on the heading and `d`: `"mode":"diff"`.
   - `toggle`: `"toggleBoxBeforeScroll":{"y":982.046875}`, `"labelAfterClick":"Shortcuts off"`, `"localStorageKeys":{"visonaut.review.sidebar":"true"}`, `"labelAfterReload":"Shortcuts on"`.
   - `refusal`: `"message":[{"className":"sr-only","role":"status","width":1,"height":1,"clipPath":"inset(50%)"}]`, `"dialogRejectDisabled":false`, `"visibleAlertsAfterDialogReject":[]`.
   - `viewer`: `"imagesBeforeDiff":2,"imagesAfterDiff":3,"imagesBackInSide":3`; Baseline `{"left":300,"top":200}`, Current `{"left":0,"top":0}`, Difference `{"left":0,"top":0}`; after 100%: Baseline `{"left":45,"top":0}`; after the next variant: all 0, `"zoomPressed":["Fit:false","100%:false","200%:true"]`.
   - `evidence` (one image delayed 2.5 s, one image aborted once, with `page.route`): at 120 ms `"imageVisibility":"hidden","overlay":"Loading image…","approveDisabled":true`; `"callsAfterAWhileLoading":0`; failure text "Image evidence unavailable The image could not be loaded. Check your connection and retry. Retry images"; after Retry `"evidence":"ready"`.
   - `narrow` (390 × 844, mobile emulation): see RULE-01.
   - `filteredNext`: see RULE-07.
   - `preview` (port 4310): run rows `[{"text":"— Dialog 2 of 2 need review","thumbnail":"empty"}]`, `"signIn":0` on both pages.
   - `lightAndHelp`: 8 help rows, one of them "[ = Collapse or expand the screenshot sidebar."; `"callsAfterXInDialog":0`.
2. `node probe-memory.mjs`: `afterDownThenUp` variant "3. Dark · Chromium · Light · 1280 × 720. Approved"; synthetic layout events as in RULE-28 and RULE-19. Limit: synthetic `KeyboardEvent` objects, not a real keyboard layout.
3. `node count-pins.mjs`: Table F. Method: each statement that starts with `expect(` or `expect.poll(` is one assertion; a statement is classified by regular expressions on its text; one level of `const name = <locator>` is expanded; the helpers `selected`, `ready`, and `callCount` are counted separately. Limits: the kinds overlap; a locator defined two levels away is not expanded; "tests" counts `test(` call sites (a loop with three cases is one site).
4. `node grep-keys.mjs` and `node extract-ideas.mjs`: 178 lines with key names and 146 idea headings from the nine lane files (`key-mentions.txt`, `lane-ideas.txt`).
5. `node dump-ui-decisions.mjs`, `node dump-prior.mjs`, `node inspect-ui-evidence-2.mjs`, `node extract-html.mjs`: decision records from `audit-data.json`, `prior-r9.json`, `evidence/visonaut-audit-ui.json`, and the `review` section of `design-r9.html` (`ui-decisions.txt`, `prior-decisions.txt`, `design-r9-review.txt`). `index.html` embeds the same records: `grep -n -o 'id:\`U04\`,category' index.html` gives line 78.
6. `git show --stat f83fef6`: 21 files, 2,815 insertions, 1,140 deletions, no file under `docs/`. `git show f83fef6 -- apps/web/src/review/review-workspace.tsx` contains `- glider={{ $kind: "bar", $barOffset: "frame" }}`, `+ $kind: "flat",`, `+ if (key === "[" && !narrow) {`, `+ open={itemsOpen && narrow}`.
7. `grep -rn thumbnailImageId` over `apps/web/src`, `packages/service/src`, `apps/compare/src`, `packages/cli/src` without tests: one writer file (`apps/compare/src/process.ts`), one reader (`apps/web/src/api/review.ts:505`), one SQL scope (`apps/web/src/operations/history.ts:169`), one type.

Not measured: production runs, a production diff mask, real keyboard layouts, Firefox, a phone, and the D1 statement count for a large command.

## Screenshots

All in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-contract-map/screens/`. I opened and read each image.

| File                                                                | Caption                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-fixture-workspace-dark-1440.png`                                | Default workspace. Five bands above the image. Selected chip is a bordered pill (flat glider). The list shows a bar at its right edge. The footer with help and the toggle is not in view. |
| `02-fixture-sidebar-collapsed-with-bracket-dark-1440x700.png`       | After `[`: the sidebar is closed and the toggle has focus.                                                                                                                                 |
| `03-fixture-after-shift-a-no-confirmation-dark-1440.png`            | After Shift+A: 7 variants approved, no dialog, one line "7 variants approved. Saved."                                                                                                      |
| `04-fixture-whole-item-button-opens-confirmation-dark-1440.png`     | The button path: dialog "Review all changed views" with 7 targets and two buttons.                                                                                                         |
| `05-fixture-shortcuts-off-footer-scrolled-dark-1440.png`            | Page scrolled to the footer. "Shortcuts off" is pressed. The letters S, D, F, G, X, A stay on the buttons.                                                                                 |
| `06-fixture-shift-x-refused-no-visible-message-dark-1440.png`       | After a refused Shift+X: the screen is equal to the default screen.                                                                                                                        |
| `07-fixture-dialog-reject-refused-no-visible-message-dark-1440.png` | After a refused "Reject whole item" in the dialog: the dialog is closed and no message is visible.                                                                                         |
| `08-fixture-zoom-200-panes-not-linked-dark-1440.png`                | 200%: Baseline is scrolled, Current is not. Eight pan buttons.                                                                                                                             |
| `09-fixture-addition-diff-unavailable-dark-1440.png`                | Addition: badge "Accepted automatically", Difference dimmed, hint text, "New image, no reference". The list row says "0 of 1 need review".                                                 |
| `10-fixture-removal-new-only-dark-1440.png`                         | Removal in Current mode: "Removed, no new image". The item is in the "Accepted (1)" group with a "Removed" badge.                                                                          |
| `11-fixture-selection-covers-stale-pixels-loading-dark-1440.png`    | 120 ms after a selection: Current shows "Loading image…", no old pixels. Approve keeps its brand fill while disabled.                                                                      |
| `12-fixture-load-failure-retry-dark-1440.png`                       | Load failure: "Image evidence unavailable … Retry images".                                                                                                                                 |
| `13-fixture-narrow-390-list-not-above-viewer-dark.png`              | 390 px: a "Screenshots" button, no list, the first image starts at 62% of the screen.                                                                                                      |
| `14-fixture-narrow-390-full-page-dark.png`                          | 390 px, full page: the two images are stacked. (The sticky bar is drawn in the middle by the full-page capture.)                                                                           |
| `15-fixture-narrow-390-list-in-dialog-dark.png`                     | 390 px: the list in a dialog.                                                                                                                                                              |
| `16-fixture-next-pending-leaves-filtered-list-dark-1440.png`        | Filter "menu": the list shows only "Open menu", the main area shows "Success dialog".                                                                                                      |
| `17-preview-run-no-thumbnails-dark-1440.png`                        | Preview run on port 4310: the row has a dash in place of a thumbnail.                                                                                                                      |
| `18-preview-queue-task-first-dark-1440.png`                         | Preview queue: work first, one 240 px card, "View history". Bar glider under "Review queue".                                                                                               |
| `19-preview-history-view-dark-1440.png`                             | Preview history view: a separate table.                                                                                                                                                    |
| `20-fixture-workspace-light-1440.png`                               | Light scheme: the selected chip has no visible outline and the selected row has no fill.                                                                                                   |
| `21-fixture-keyboard-help-dialog-dark-1440.png`                     | Help dialog: plain heading, key list with `[` and `S / D / F / G`.                                                                                                                         |

Earlier lanes hold more states (for example `ui-workspace/screens/62-chip-focused-shortcuts-ignored-dark-1440.png` for RULE-04 and `ui-viewer/screens/40-details-open-compare-dark-1440.png` for the Details panel).

## Redesign ideas

Each JSX sketch uses only props that `apps/lab/docs/primitives.md` documents (`Kbd`, `Text` with `ak-ink-*` classes, `Nav` with `$layout` and `glider`, `NavLink`, `NavSlot`, `NavLinkLabel`, `Frame` with `$layer`, `$mix`, `$rounded`, `$p`, `Button` with `$size`, `$border`, `$layer="brand"`, `Disclosure` with `button`, `DisclosureButton` with `description`).

### A · Key map "Contract only"

- What changes: The keys are the contract table plus `G` (the guide row) and `?` for help. No bracket key: the sidebar toggle is a button. Pan stays on buttons (U04). The variant strip consumes only Left, Right, Home, End (RULE-04). The toggle is stored.
- Why it is better: No rule changes. No conflict with a browser key or a layout. It is the base line for the design app.
- Sketch:

```
↑ ↓      item (stop at ends)          A   approve variant     ⇧A  approve whole item
← →      variant (stop at ends)       X   reject variant      ⇧X  reject whole item
1 … 6    variant by position          S D F G   compare · difference · current · baseline
⌘/Ctrl Z undo last saved command      ?   keyboard help       Tab · Esc  as the browser
not bound:  [ ]  J K H L N P  Space  /  0 + -  ⌘K  F6
```

```tsx
<Text className="ak-ink-60 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
  <span className="flex items-center gap-1.5">
    <Kbd>↑</Kbd>
    <Kbd>↓</Kbd>Item
  </span>
  <span className="flex items-center gap-1.5">
    <Kbd>←</Kbd>
    <Kbd>→</Kbd>Variant
  </span>
  <span className="flex items-center gap-1.5">
    <Kbd>A</Kbd>Approve
  </span>
  <span className="flex items-center gap-1.5">
    <Kbd>X</Kbd>Reject
  </span>
  <span className="flex items-center gap-1.5">
    <Kbd>?</Kbd>Keys
  </span>
</Text>
```

### B · Key map "List keys J and K"

- What changes: `J` and `K` move in each list (queue, history, item list) and are second keys for Down and Up in the workspace. Enter opens a row. `/` focuses the filter field. `?` opens help. `B` toggles the item sidebar. No `g` sequences, no `R`, no pan keys, no zoom keys. All workspace keys of map A stay.
- Why it is better: One list model for the dashboard and the workspace, so a split inbox (group G7) needs no scope switch. `J`/`K` have one meaning. `G` stays a mode key.
- Conflicts checked: `N`, `P`, `H`, `L`, `I`, `V` stay free. `/` is Firefox quick find; D53 names Chrome Desktop. The off switch must cover `J`, `K`, `B`, `/`, and `?`.
- Sketch:

```
J / ↓   next row          K / ↑   previous row        Enter   open (queue, history)
← →     variant           1 … 6   variant             /       filter field      ?   help
A  X  ⇧A  ⇧X  S  D  F  G  ⌘/Ctrl Z   as in map A       B       item sidebar
```

### C · Key map "Viewer first"

- What changes: For a fixed-height stage with one linked view. Arrows keep the contract meaning and never pan. Shift+Arrow pans the linked view by half a stage. `+` or `=` zooms in, `-` zooms out, `0` is Fit. `S`, `D`, `F`, `G` stay; `W` is swipe, `O` is onion skin; `Q` and `E` move the swipe divider. `T` swaps baseline and current while it is down (blink). `N` and `P` go to the next and previous change region. `?` opens help. No Space, no brackets, no Escape mode, no Cmd/Ctrl+K.
- Why it is better: It gives the viewer ideas of group G3 a complete map with one meaning for each key. U04 stays in force (arrows navigate from every focus). Shift has two jobs only, both with a second key: `A`/`X` (whole item) and arrows (pan).
- Needs: a Shift branch before `ws:416`; `keyup` for `T`; RULE-06 settled, because Shift is held more often.
- Sketch:

```
↑ ↓  item      ← →  variant      1 … 6  variant        ⇧ + arrows  pan (both images)
+ / =  zoom in     -  zoom out     0  fit              N  P  next · previous change
S  2-up    D  difference    F  current    G  baseline    W  swipe (Q E move the divider)    O  onion
T  hold: show the other image      A  X  ⇧A  ⇧X  ⌘/Ctrl Z  ?   as in map A
```

### D · Narrow layout that makes rule A27 true: the list is one collapsed row above the viewer

- What changes: Below 1024 px the item list is a `Disclosure` above the viewer. Closed, it is one row: the selected item name, its count, and previous and next buttons. Open, it shows the same virtual list in the page flow (no modal). The images stay stacked.
- Why it is better: The rule "list above the viewer and stacked comparison images" holds again. The reviewer keeps the item context on screen. No focus trap. About 44 px in place of the 35 px button.
- Sketch:

```tsx
<Disclosure
  $border
  $rounded="xl"
  $p={3}
  button={<DisclosureButton description="2 of 6 need review">Success dialog</DisclosureButton>}
>
  {itemNavigation}
</Disclosure>
```

```
┌ Success dialog · 2 of 6 need review        ‹ › ⌄ ┐   44
├ React · Chromium · Light  ●  (2 of 7)       ‹ ›  ┤   40
│ Baseline                                         │
│ [ image ]                                        │
│ Current                                          │
│ [ image ]                                        │
└ Undo                      Reject    Approve      ┘   56
```

### E · Variant strip that meets `contract:192`, A07, and A09: bar glider, verdict mark, one label line

- What changes: Variants stay `Nav` links (U03 as replaced, U06). The glider is the bar kind again. Each link has a verdict mark with its own shape (circle pending, check approved, cross rejected, alert error) and a short label of the parts that differ. The full label of the selected variant is one text line under the item name. The position key shows on the first six links.
- Why it is better: Three "differs" rows become "conforms" with no change to URLs, tests of link behavior, or keys. Seven short links fit in one row, so the selected link is on screen.
- Sketch:

```tsx
<Text render={<p />} className="ak-ink-70 text-sm">{variant.label} · {verdictLabel(variant)}</Text>
<Nav
  aria-label="Variants"
  $layout="horizontal"
  glider={{ $kind: "bar", $state: "selected", $side: "end" }}
>
  {item.variants.map((entry, index) => (
    <NavLink
      key={entry.id}
      aria-current={entry.id === variant.id ? "page" : undefined}
      render={<Link to="/runs/$runId" params={{ runId }} search={{ comparison, item: item.key, variant: entry.key }} />}
    >
      <NavSlot><VerdictMark variant={entry} /></NavSlot>
      <NavLinkLabel>{differingParts(entry, item)}</NavLinkLabel>
      {index < 6 && <NavSlot $kind="shortcut">{index + 1}</NavSlot>}
    </NavLink>
  ))}
</Nav>
```

`VerdictMark` and `differingParts` are new local helpers. The mark needs a text alternative (`aria-label` on the icon), because the link name must keep the verdict (pin 12 in Table F).

### F · One visible status slot for refusals, completion, and the three save states

- What changes: One slot of fixed height in the decision bar. It shows, in this order of priority: a refusal with its reason and one action, an error with Retry, "Sending 2…", "2 queued on server · safe to close", "Saved", and "Review complete" with a link to the queue. The live region stays and repeats the text.
- Why it is better: RULE-13 is fixed. Invariants I3 and I4 stay visible in two or three words. The bar does not change height (WORK-03).
- Sketch:

```tsx
<Frame
  role="status"
  $layer="warning"
  $mix={15}
  $rounded="lg"
  $p="1rem"
  className="flex items-center gap-3 text-sm"
>
  <Text className="flex-1">Not changed. “Solid · Chromium” is protected.</Text>
  <Button $size="sm" $border>
    Go to the next eligible variant
  </Button>
</Frame>
```

```
Undo │ ↑ Sending 1 …                                     Reject X   Approve A
Undo │ ☁ 2 queued on server · safe to close              Reject X   Approve A
Undo │ ✓ Saved                                           Reject X   Approve A
Undo │ ⚠ Not changed. “Solid” is protected.  [Next eligible]   Reject X   Approve A
```

### G · U02 as selected: decisions in the main header, the image takes the rest

- What changes: The layout that the maintainer selected on 2026-09-29, built as written. One `ShellMainHeader` row: item name, selected variant label, verdict, Undo, save state, Reject, Approve. One tool row: variants, modes, zoom. The stage is `min-h-0 flex-1`. Commit, attempt, and baseline are one short text in the app header (rule A06 keeps "identity above"). Run ID and history are in Details. No footer: help and the toggle are in the header.
- Why it is better: It is not a new idea; it closes RULE-09. Chrome above the image drops from about 366 px to about 136 px (48 + 44 + 44), and nothing covers the image.
- Sketch:

```
┌ ◎ visonaut  #7412 Dialog focus styles · aabbccd · attempt 2        ? ⌨on  DH ┐ 48
├ Success dialog · React · Chromium · Light ● Needs review   Undo  ✓Saved  Reject X  Approve A ┤ 44
├ [● React][● Solid][✓ Dark][✕ Contrast] …        Compare Difference Current Baseline │ Fit 100 200 ┤ 44
│ items │                                                                        │
│  ●    │                    stage (all remaining height)                        │
│  ●    │                                                                        │
│  ✓    │                                                                        │
└───────┴────────────────────────────────────────────────────────────────────────┘
```

### H · Thumbnail rule: three variants to compare

- What changes: Three row variants in the design app, each with a rule sentence that can replace `issue-1:262`: (1) no thumbnail, a verdict dot strip (one mark for each variant) with a count; (2) the first candidate image of the first declared variant at a small size, as the rule says; (3) a crop of the first change region at 96 px or more.
- Why it is better: The maintainer decides the rule with the three results side by side. Today the rule exists and the feature does not (RULE-02).
- Sketch:

```
(1)  combobox/open            ✓●●●●✕   4 of 6 need review
(2)  [img] combobox/open               4 of 6 need review
(3)  ┌──────────┐ combobox/open
     │ diff crop│ 4 of 6 need review
     └──────────┘
```

## Open questions and items not verified

1. Server order of items (A12, D29): I did not check that `apps/web/src/api/review.ts` returns candidate order first and reference-only entries after it.
2. A05 (copied behavior, disabled state): no diff of the vendored files against upstream commit `fc85b809` was run in this lane.
3. A16 (red mask): read from the pixelmatch call. I did not open a production mask. The fixture diff image is a full screenshot with a red fill (`fixture-model.ts:26`).
4. RULE-12: I read the code and the decision record. The effect on a real queue was measured by the dashboard lane (DASH-05), not by me.
5. Keyboard layouts: synthetic events only. No real AZERTY, QWERTZ, or Cyrillic layout was used.
6. Browser conflicts for Cmd/Ctrl+K, F6, Ctrl+wheel, and Firefox quick find are from known browser behavior, not from a run in each browser. D53 names Chrome Desktop only.
7. `docs/simplification-audit/prior-r9.json` holds D02 to D53 with their options; I cite the ledger lines of `issue-1:409-469` for the IDs, because the JSON has no stable line numbers.
8. The U05 note also asks for PR identity in each row. In the preview fixture the card shows "Pull request" and a title, with no number (S18). I did not check a row with a number on screen; `apps/web/src/routes/index.tsx:490` prints `#N` when the field exists.
9. `contract:192` says "Run views … use navigation links with a bar glider". I read "run views" as the queue, history, and status links in the app header (`app-shell.tsx:46-65`). If it means the image modes, then the mode switch (`ws:825-892`, a `ButtonGroup` with a glider) differs too.
10. The count in Table F is a text classification, not a run of the suite. I did not run the browser tests.
11. The lane report for `ui-benchmark` does not exist on disk; I used its `verification.md`.
