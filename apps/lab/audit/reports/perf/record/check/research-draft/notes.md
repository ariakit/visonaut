# Record lane: the gliders of the list, the unknown cause, and the typed properties

Working record. Date: 2026-10-07, 06:41 to 08:06. Machine: Apple M4 Pro, 14 cores, shared with other agent sessions. Browser: Google Chrome 154 through Playwright (channel `chrome`, headless), viewport 1440 by 900. Node 24.18.0.

Folder of this lane: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/perf/record`. Each path below is in this folder. Nothing was written below the worktree. The lab server at port 4320 was not used.

## Load of the machine

| Time           | Load average (1 minute) | What ran                                                                 |
| -------------- | ----------------------- | ------------------------------------------------------------------------ |
| 06:41 to 06:46 | 48 to 58, then 20       | Copy and builds                                                          |
| 06:50 to 07:05 | 4 to 14                 | B1, B2, B3, pictures, A for 41 rows with no throttle                     |
| 07:05 to 07:18 | 24 to 78                | A for 41 rows with the CPU slowed 4 times, B4, B5, glider parts          |
| 07:18 to 07:25 | 90 to 223               | A for 585 rows with no throttle (the start), counts of the glider builds |
| 07:25 to 07:45 | 40 to 98                | A for 585 rows, C, the two more forms of A (A2)                          |

No time of this record is the time of a quiet machine. Each comparison ran in one script with the forms in turns. Each result file has the load average of each run. The counts (recalculated elements, layouts, changed nodes, pixels) do not depend on the load.

## Copies of the lab

`make-copy.sh` makes a copy of the current `apps/lab` (source of 06:41, style sheet `styles-DdB1bnNp.css`, 429,987 bytes): no `node_modules`, `dist`, `.wrangler`, `.tanstack`, `audit`, `docs`, `public/audit`. The copy has its own `node_modules` folder with one symbolic link for each package, so the Vite cache stays in this folder. It has a `.gitignore` with `dist/`. `tsconfig.json` and `wrangler.jsonc` have absolute paths. `make-variant.sh <name> <change...>` copies `lab-base`, applies changes of `patch.py`, and builds with `build.sh` (`vite build`).

| Copy                                                                   | Changes of `patch.py`                                                                                | Sheet, bytes            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- |
| `lab-base`                                                             | none: four gliders                                                                                   | 429,987                 |
| `lab-bar`                                                              | `bar`: `gliders = [{ $kind: "bar", $side: "end", $barOffset: "frame" }]`                             | 429,987 (the same file) |
| `lab-rowbar`                                                           | `rowbar`: no `glider` prop. The selected row has one `Frame` with the variants of the bar glider.    | 430,086                 |
| `lab-norules`                                                          | `norules`: 10 class names of `choice.ts`, `control.ts`, `input.ts` removed (the `:has()` rule shape) | 417,788                 |
| `lab-both`                                                             | `noglider norules`                                                                                   | 417,788                 |
| `lab-g-nohover`, `lab-g-hover-bar`, `lab-g-sel-bar`, `lab-g-focus-bar` | `gl-<kinds>`: a part of the four gliders                                                             | 429,987                 |
| `lab-fixhover`                                                         | `fixhover`: two class names of `styles/nav.ts` (lines 381 and 385)                                   | not noted               |
| `lab-fixsib`                                                           | `fixsib`: two custom variants of `styles/ui.css` (lines 1063 and 1256)                               | 436,633                 |
| `lab-fix2`                                                             | `fixhover fixsib`                                                                                    | not noted               |
| `lab-bar-pagerkey`                                                     | `bar pagerkey`: `variants/pager.tsx:61`, `<Hint key={index}>`                                        | 429,987                 |
| `lab-bar-fixsib`                                                       | `bar fixsib` (built, not served)                                                                     | 436,633                 |

Servers: `serve.sh <copy> <port>` (`vite preview --host 127.0.0.1 --port <port> --strictPort`), ports 4361 to 4364 only. `stop.sh` stops them. Two servers that start in the same second fail with `EADDRINUSE 127.0.0.1:9232` (the inspector port of the Worker runtime): start them one after the other.

| Port | Copy                                                                                                                | Time             |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 4361 | `lab-base`                                                                                                          | 06:44 to the end |
| 4362 | `lab-bar`                                                                                                           | 06:55 to the end |
| 4363 | `lab-rowbar`, then `lab-bar-pagerkey` from 07:19                                                                    |                  |
| 4364 | `lab-both` (B), `lab-norules` (A, 41 rows), then one copy after the other (`rotate.sh`, `run-fix2.sh`, `run-A2.sh`) |                  |

## Method

- Page: `/preview/page/review/ariakit?scenario=large`. View `large`: 41 rows with a change, 1,734 elements. View `all`: status "Unchanged" and each of the 24 folders open, 585 rows, 2,589 to 2,592 elements (`openReview` in `lib.mjs`).
- Next frame: from the start of the `EventDispatch` of the key to the end of the first `Commit` on the main thread after it (`measureWindow` in `lib.mjs`).
- Style and layout: the sum of the `UpdateLayoutTree` and `Layout` events of the window.
- Recalculated elements: the sum of `elementCount` of the `UpdateLayoutTree` events of one key press, with `container-type: normal` on each element (`noContainers`). With size containers, Chrome recalculates the style of the content of a container during layout, and the trace has no count for that work. The page has 7 size containers. The largest holds 1,516 of the elements.
- CPU slowed 4 times: `Emulation.setCPUThrottlingRate` 4, set after the load, for the time part only.
- Trace categories: `devtools.timeline`, `disabled-by-default-devtools.timeline`, `disabled-by-default-devtools.timeline.frame`, `blink.user_timing`, and `disabled-by-default-devtools.timeline.invalidationTracking` for B.
- Changes in the browser (`mods.mjs`): `rm3` deletes the three sibling rules from the sheet. `cv` adds `content-visibility: auto; contain-intrinsic-block-size: auto 62px` (20 px for a row in a folder) and `overflow-clip-margin: 8px` to each row. A condition with a fourth field gets the built sheet of another copy (`parseCondition`), which is valid only when the two copies differ in the sheet alone.

## A. The forms of the list

Scripts: `options.mjs` (times and counts, forms in turns, 5 runs, one new page for each run), `run-A.sh`, `run-A-all.sh`, `run-A2.sh`, `run-A2-chain.sh`, `summary.mjs`. Results: `results/A-large-1x.*`, `A-large-4x.*`, `A-all-1x.*`, `A-all-4x.*`, `A2-large-g-nohover-1x.*`, `A2-large-g-nohover-4x.*`, `A2-large-fix2-1x.*`, `A2-large-fix2-4x.*`, and all of them in `results/SUMMARY.txt`.

Commands:

```sh
zsh run-A.sh large 5        # conditions base, bar, rowbar, norules, norules-rm3, base-cv, bar-cv, rowbar-cv
zsh run-A-all.sh 5          # conditions base, bar, bar-pagerkey, bar-rm3, bar-cv, bar-rm3-cv
zsh run-A2-chain.sh         # lab-g-nohover and lab-fix2, each with base and bar in turns, then pictures
node summary.mjs
```

A first run of `run-A.sh large` was stopped: the selector of the `cv` change matched no row (`.nav > li > a[data-row]`; the rows are in `ul.nav-list`). A first run for the view `all` with 11 conditions was stopped after 3 runs, because it needed more than one hour.

41 rows, median of 5 runs. "1x" is no throttle (load 4 to 14 for `A-large-1x`). "4x" is the CPU slowed 4 times (load 50 to 78 for `A-large-4x`).

| Form               | Elements for one arrow key | Arrow key, next frame, 1x | 4x              | Approve, 1x | 4x  | Pointer over 6 rows, style and layout, 1x | 10 wheel steps, style and layout, 1x |
| ------------------ | -------------------------- | ------------------------- | --------------- | ----------- | --- | ----------------------------------------- | ------------------------------------ |
| base: four gliders | 1,245                      | 96 [87-112]               | 515 [475-1,194] | 100         | 555 | 429                                       | 879                                  |
| bar                | 87                         | 48 [46-54]                | 276 [225-367]   | 51          | 305 | 20                                        | 64                                   |
| rowbar             | 79                         | 41 [38-45]                | 234 [171-284]   | 49          | 313 | 18                                        | 45                                   |
| norules            | 180                        | 52                        | 246             | 58          | 324 | 192                                       | 318                                  |
| norules-rm3        | 181                        | 42                        | 230             | 54          | 290 | 195                                       | 301                                  |
| base-cv            | 892                        | 72                        | 474             | 88          | 563 | 363                                       | 1,110                                |
| bar-cv             | 86                         | 35                        | 214             | 52          | 300 | 18                                        | 210                                  |
| rowbar-cv          | 79                         | 32                        | 202             | 48          | 261 | 18                                        | 58                                   |

Two more sessions with base and bar in turns (`A2-*`):

| Session              | Load                         | base, arrow key 1x / 4x | bar      | third form                                                                                                                                 |
| -------------------- | ---------------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `A2-large-g-nohover` | 47 to 91 (1x), 41 to 61 (4x) | 97 / 438                | 46 / 188 | g-nohover (selected, focus, bar): 49 / 200. Approve 53 / 263. 97 elements. Pointer 17 ms. Wheel 90 ms.                                     |
| `A2-large-fix2`      | 39 to 59 (1x), 22 to 43 (4x) | 98 / 457                | 46 / 198 | fix2 (four gliders, two rewrites): 48.5 / 204. Approve 57 / 270 (base 103 / 480, bar 55 / 230). 97 elements. Pointer 236 ms. Wheel 306 ms. |

So the arrow key of the bar form with the CPU slowed 4 times was 276 ms, 188 ms, and 198 ms in three sessions, and Approve 305, 225, and 230 ms. The 200 ms line is not settled on this machine.

The form rowbar at 585 rows: `node counts.mjs --name A3-all-rowbar --view all --rounds 5 --conds base:4361:none,bar:4362:none,rowbar:4363:none` -> `results/A3-all-rowbar.log` (session 4, load 15 to 28, 5 rounds of 4 keys): base 2,485 elements and 346 ms, bar 2,478 and 326 ms, rowbar 2,478 and 309 ms.

585 rows (`A-all-1x`, load 40 to 221; `A-all-4x`, load 40 to 98):

| Form         | Elements for one arrow key | First arrow key, 1x | Second arrow key, 1x | First, 4x | Second, 4x | Pointer, style and layout, 1x | Wheel, style and layout, 1x |
| ------------ | -------------------------- | ------------------- | -------------------- | --------- | ---------- | ----------------------------- | --------------------------- |
| base         | 2,483                      | 386                 | 343                  | 1,918     | 1,680      | 1,774                         | 3,592                       |
| bar          | 2,481                      | 355                 | 341                  | 1,683     | 1,775      | 177                           | 359                         |
| bar-pagerkey | 45                         | 338                 | 108                  | 1,622     | 462        | 180                           | 364                         |
| bar-rm3      | 127                        | 149                 | 133                  | 655       | 601        | 178                           | 362                         |
| bar-cv       | 1,958                      | 285                 | 245                  | 1,614     | 1,483      | 28                            | 512                         |
| bar-rm3-cv   | 137                        | 74                  | 55                   | 394       | 307        | 28                            | 490                         |

`bar-pagerkey`: the first arrow key goes to a screenshot with another number of variants, so tooltips mount and the document is recalculated. The second does not.

Pictures: `shots.mjs` (the list, three areas: bar, selected row, whole list) and `page-shots.mjs` (the whole page in 6 states: selected, keyboard focus on the selected row, 3 states after Tab presses, pointer on a row). A pixel differs when a channel differs by more than 2.

- `node shots.mjs --view large --conds base:4361:none,bar:4362:none,rowbar:4363:none,base-cv:4361:cv,bar-cv:4362:cv,rowbar-cv:4363:cv` -> `results/shots-large.log`, `shots/list-large-*.png` (41 rows): bar and rowbar against base: 0 pixels differ in each area. base-cv and bar-cv: 0 in the bar and in the selected row, 3,126 of 172,640 pixels in the list. rowbar-cv: 24 pixels more, in the bar (the clip margin of 8 px is 0.75 px too small).
- The same with `--view all` -> `results/shots-all.log`, `shots/list-all-*.png` (585 rows): bar 0. rowbar: 68 pixels in the bar area: the bar does not show, because the content of the folder clips an element that the row draws outside its box (`shots/compare-list-all-cv.png`). base-cv and bar-cv: 9,901 of 172,640 pixels: the text of each row moves by a part of a pixel.
- An inference, not tested: the rows are at half-pixel offsets (the gap is 3.5 px). With `content-visibility`, a row has paint containment, and its content snaps to another pixel. `shots/compare-list-large-cv.png` shows it in the crop of a thumbnail.
- `results/B5-pictures-large.json` (41 rows): fixsib 0, bar 0, rowbar 0 in each state, but 8 pixels in the tooltip of the toolbar for rowbar in the pointer state.
- `results/B6-pictures-large.log`, `B6-pictures-all.log`: fix2 against base, 0 pixels in each of the 6 states in both views. bar against base at 585 rows: 0 in the selected state, 2,190 to 2,792 pixels in the states with a focus ring in the list. `shots/compare-all-rowfocus.png` shows it: with the focus glider, the ring of a row in a folder is outside the row; with no focus glider it is 3 px inside (`[&_li>.control]:-outline-offset-2` in `nav.ts`).
- `results/A2-pictures-large-g-nohover.log`: 0 pixels in 5 states, 48 pixels in the tooltip of the toolbar in the pointer state (not in the list). `results/A2-pictures-all-g-nohover.log` (585 rows): 0 pixels in each of the 6 states. `results/A2-pictures-large-fix2.log`: 0 in each state.
- Motion is not in a picture. With the bar form, only the bar travels between rows. With rowbar, nothing travels.

Keyboard, focus, and anchor with rows in parts: `check-nav.mjs` -> `results/check-nav-large.log`, `check-nav-all.log`. 20 steps for each form (focus, 14 times ArrowDown, a scroll to the end of the list, 4 times ArrowUp). Each step tests: the focus is on the selected row, the row is in view, the selected glider and the focus glider have the box of the row, the bar is beside the row and at the edge of the list. Result: no problem in base, base-cv, bar, bar-cv, in both views (rowbar and rowbar-cv at 41 rows in an earlier run). 13 of 41 rows skip their content at 41 rows, 530 of 585 at 585 rows. The scroll height stays 3,267 px and 22,845 px.

Which glider costs: `rotate.sh large 1 no lab-g-hover-bar lab-g-sel-bar lab-g-focus-bar lab-g-nohover lab-fixhover lab-fix2` (`counts.mjs`, one round of 4 keys) -> `results/R-large-*.log`. Largest recalculation of one key: hover + bar 1,215; selected + bar 69; focus + bar 69; selected + focus + bar 70; four gliders with `fixhover` 71; with `fixhover fixsib` 71. `glider-parts.mjs` removed glider elements from the DOM of `lab-base`: it does not show the gain (1,552 to 1,702 elements in each case), because Chrome keeps its `:has()` flags on the nav after the first style. Use the builds.

## B. The unknown cause

1. `node invalidation.mjs --port 4364 --view all --name B-invalidation-both-all` (copy `lab-both`) -> `results/B-invalidation-both-all.log`. One ArrowDown recalculates 2,432 of 2,536 elements. The trace has 25 events "Invalidation set invalidates subtree" on `BODY`, with one set that has `allDescendantsMightBeInvalid`. `show-selectors.mjs` prints the selectors that Chrome names for that set (`results/B-body-selectors.txt`): `.not-ui-sibling-selected\:hidden:not(...)`, `.not-peer-ui-focus-visible\:invisible:not(...)`, `.not-peer-ui-focus-visible\:outline-none:not(...)`. `show-node.mjs` prints the script stack: the cleanup of `usePortal` of Ariakit (`t.remove()` of a portal node).
2. `node body-children.mjs --port 4364 --view all` -> `results/B-body-children-all.log`: one ArrowDown removes 3 `div#portal/...` from `<body>` and adds 3. They belong to the 3 marks of the variant control (`variants/pager.tsx:61`, `<Hint key={variant.key}>`). At 41 rows no child of the body changes (`B-body-children-large.log`).
3. `node sheet-variants.mjs --port 4364 --view all --spec spec-B1.json --name B1-three-rules` -> `results/B1-three-rules.log` (load 5): 2,477 elements for each key with the sheet as built, 2,475 to 2,477 with one of the three rules removed, 138 with the three removed. Style and layout 282 ms against 87 ms.
4. The shape (`spec-B2.json`, `shapes-B3.json`, `shapes-B4.json` with `make-spec.mjs`; results `B2-synthetic.log`, `B3-synthetic.log`, `B4-synthetic.log`): one rule that matches no element, added to the sheet without the three rules. Slow (2,475 elements): `.z:not(:focus-visible ~ *)`, `.z:not(:is(:focus-visible, [data-zz]) ~ *)`, `.z:not(:is(:checked, [aria-zz]) ~ *)`, `.z:is(:where(.q):is(:focus-visible, [data-zz]) ~ *)`, `.z:not(:is(input:checked, [aria-zz]) ~ *)`, `:is(:checked, [aria-zz]) ~ *`, `.z:not(:is(:focus-visible, [data-zz]) + *)`. Fast (138 elements): each form where each alternative at the left has a class or an attribute (`:where(.q):focus-visible ~ *`, `:is(.q:checked, [a]) ~ *`, `:is(:where(.q):focus-visible, :where(.q)[d]) ~ *`), each form with a class at the right (`:is(:checked, [a]) ~ .z`), and `:has(~ ...)`.
5. The rewrite: `patch.py fixsib`. `node counts.mjs --name B5-fixsib-all --view all --rounds 2 --conds base:4361:none,base-rm3:4361:rm3,base-fixsib:4361:none:lab-fixsib,bar:4362:none,bar-rm3:4362:rm3,bar-fixsib:4362:none:lab-fixsib` -> `results/B5-fixsib-all.log`: bar 2,480 elements, bar-rm3 127, bar-fixsib 129. With four gliders: 2,484, 2,206, 2,208 (the nav is still recalculated: cause 1).
6. Both rewrites: `zsh run-fix2.sh` -> `results/R-large-fix2.log`, `R-all-fix2.log` (5 rounds of 4 keys, in turns, load 41 to 90). 41 rows: base 82 ms and a largest recalculation of 1,217, bar 33 ms and 68, fix2 35 ms and 71. 585 rows: base 342 ms and 2,485 elements, bar 332 ms and 2,478, fix2 139 ms and 133.

The mechanism in Chrome is an inference from the trace and from these experiments. The source of Blink was not read in this lane.

## C. Typed registered properties

- `node list-properties.mjs lab-base/dist/client/assets/styles-DdB1bnNp.css results/C-properties.json`: 139 `@property` rules in `@ariakit/tailwind/src/output.css`, 51 typed: 14 `<color>`, 26 `<number>`, 11 `<length>`; 32 with `inherits: false`.
- `node properties-recalc.mjs --port 4361 --name C-recalc-large --rounds 5` -> `results/C-recalc-large.log` (load 70 to 77). One page, 4 theme switches for each variant in each round, size containers off. Full sheet: 57.2 µs for each element [56.3-61.1], 92 ms for one recalculation of 1,610 elements.

| Variant                                 | µs for each element | Against the full sheet | Pixels that differ after a load |
| --------------------------------------- | ------------------- | ---------------------- | ------------------------------- |
| The 51 typed rules removed              | 17.9                | 69% less               | 83.3%                           |
| 10 layer colors removed                 | 705                 | 12 times more          | 2.5%                            |
| 8 text and ink rules removed            | 56.9                | 1% less                | 0.26%                           |
| 18 frame rules removed                  | 56.3                | 2% less                | 59%                             |
| 15 other numbers removed                | 28.9                | 49% less               | 82.7%                           |
| 32 rules with `inherits: false` removed | 34.9                | 39% less               | 84.2%                           |
| 19 rules with `inherits: true` removed  | 275                 | 4.8 times more         | 81.5%                           |
| `syntax: "*"` on the 51                 | 1,286               | 22 times more          | 3.0%                            |
| `syntax: "*"` on the 14 colors          | 819                 | 14 times more          | 2.8%                            |
| `syntax: "*"` on the 26 numbers         | 61.6                | 8% more                | 0                               |
| `syntax: "*"` on the 11 lengths         | 382                 | 6.7 times more         | 0.46%                           |

- `--set inherit` -> `results/C-recalc-inherit.log`: `inherits: true` on the 32 rules that have `false`, with the same type: 62.6 against 58.5 µs (7% more). `syntax: "*"` on the numbers again: 65.0 (11% more).
- `--set single` -> `results/C-recalc-single.log` (load 40 to 90, the full sheet had 56 to 121 µs in this run): no single rule is outside that range on the fast side. Two are far on the slow side: without `--ak-frame-radius` 493 µs, without `--ak-layer` 131 µs.
- Pictures after a page load with the changed sheet: `properties.mjs` (its first pass only: the timed part was stopped, because one load with the CPU slowed 4 times needed about one minute at a load of 100 to 220) and `diff-pictures.mjs` -> `results/C-pictures-load.log`.
- `node eval.mjs --port 4362 --js ...`: 522 of 1,731 elements have the class `ak-layer`; 304 of them have `ak-layer-transparent` and no other layer class; 245 of those are the variant marks of the rows.

- `node layer-strip.mjs --port 4362 --name C-layer-strip-large --rounds 6` -> `results/C-layer-strip-large.log` (load 20 to 23): the classes `ak-layer ak-layer-transparent` removed in the DOM from the 304 elements that have no other layer, state, or edge class. One full recalculation: 89.6 ms [88.9-93.0] as built, 80.7 ms [79.4-83.6] without: 10% less. The picture changes: 37,980 of 1,296,000 pixels in the dark theme (2.9%) and 60,356 in the light theme (4.7%).

Reading: the type is not the cost. Without a type, a color or a length is a token list that each child must compute again, so the time grows 7 to 22 times. `inherits: false` is not the cost. The removal of a rule is faster only where it breaks the formulas, and then the page is broken. `ak-layer` writes the formulas (`output.css:118-162`): 7 relative colors in a chain (`--_ak-lib`, `--_ak-lio`, `--_ak-li`, `--_ak-lb`, `--_ak-lo`, `--ak-layer`, `--ak-edge`) and 4 more from `--ak-layer`. Which formula costs how much was not measured: a formula cannot be removed alone with an equal picture. No faster form with an equal picture was found.

## D. The draft of the record

- `part.html`: the new part for `sections/50-ui-system.html`. Place: the end of the section. Anchor text: after `<a href="#design-lab">lab guide</a>.` and the `</p>` that follows it, before `</section>`.
- `terms.patch.json`, `findings.patch.json`, `decisions.proposed.json`, `prose.patch.json`.
- `zsh build-draft.sh`: formats the five files with `pnpm exec oxfmt`, runs `draft.mjs` (copies `apps/lab/audit/content` to `content/`, puts the part and one panel for each proposed decision into section 50, adds the decisions after `D-UI-03`, applies the patches), formats the changed content files, then `node apps/lab/audit/build.mjs --strict --content .../record/content --out .../record/out` and `node apps/lab/audit/check.mjs --dir .../record/out --shots .../record/out/shots`. Logs: `logs/draft-build.log`, `logs/draft-check.log`.
- `count-words.mjs`: the reader words of the part outside the tables: 755 words of prose and 43 in the two code blocks.
- `table2.html` with `replace-table2.py`: the source of the second table. Its first form had 10 columns and did not fit the column of the page, so the time columns are joined ("96 / 515 ms") and a table foot explains each column.
- `shot-part.mjs` -> `out/part/part-1440-*.png` and `out/part/part-400-*.png`: the part at 1440 px and at 400 px. At both widths the page does not scroll sideways, no box is wider than the page, the demo has its controls, and the three panels render. At 400 px the second table scrolls in its own box.
- The words "trace" and "edge" are defined terms of the record with another meaning (a Worker trace, a Cloudflare location), so the part and the decisions do not use them.
- Result of the last run (08:03 to 08:06): the strict build wrote both outputs (16 sections, 58 decisions, 568 findings, 290 terms, 78 demos, 1.58 MB), and the check ended with "All checks passed": 148 passed lines, no failed line, for the two outputs at 1440 px and at 400 px (`logs/draft-build.log`, `logs/draft-check.log`). The check ran with no `--shots`: its pictures of the whole page are 74 MB each.
- The path `apps/lab/audit/reports/perf/record` in the part is an assumption: the coordinator copies this folder there, as it did for the other lanes.

## Servers at the end

`zsh stop.sh` at 08:03: ports 4361, 4362, and 4363 stopped, 4364 had no listener. Port 4320 still answers.

## Observation outside the task

In the view with the folders, no row has `tabindex="0"` before a row is selected: `tabStopKey` of `screenshot-list.tsx:161` reads `rows[0]`, and `rows` is empty in that view. `check-nav.mjs` selects a row with one arrow key first. Nobody checked what this means for a keyboard user.

## What this lane did not do

- A quiet machine, Safari, Firefox, a real device.
- The rewrites in `apps/web` and in the tests of Ariakit.
- A rewrite of the `:has()` rule shape (10 class names).
- A window of visible rows in the source. Rows in parts are CSS added in the browser.
- The form norules at 585 rows, and the forms g-nohover and rowbar at 585 rows with the CPU slowed 4 times.
- The page load for C: the times are of a full recalculation after a theme switch.
