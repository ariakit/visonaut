# Record lane: the gliders of the list, the cause of the document recalculation, and the typed properties

This file has two parts. The first part is the record of the independent checker (2026-10-07, 08:08 to 09:20). The part of the record (`part.html`), the findings, and the proposed decisions use the numbers of the first part. The second part is the record of the research agent (06:41 to 08:06), as the agent wrote it. Where the two parts differ, the first part is right, and the table "Corrections" says why.

Machine: Apple M4 Pro, 14 cores, shared with other agent sessions. Browser: Google Chrome 154.0.8037.98 through Playwright (channel `chrome`, headless), viewport 1440 by 900. Folder of the checker: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/perf/record/check` (paths that start with `check/` below). Nothing was written below the worktree. The lab server at port 4320 was not used and not stopped.

## Checker: load of the machine

The load average (1 minute) was 2.7 to 28 for each run of the checker. Each result file has the load average of each run. For the two runs that give the times of `part.html` (`L1-large-1x`, `L2-large-4x`) it was 2.8 to 11.8. This is lower than the load of the research runs (4 to 223), and it is not a quiet machine: no time is the time of a quiet machine.

## Checker: copies and servers

- `check/setup.sh base`: a new copy of the current `apps/lab` (08:08; `diff -rq` of `src` against the copy of the research agent: no difference), `vite build`, sheet `styles-DdB1bnNp.css` with 429,987 bytes: the same file as the research build.
- `check/setup-all.sh`: 10 variants with the changes of `patch.py` (read by the checker before use): `lab-bar`, `lab-nohover` (`gl-selected_focus_bar`), `lab-hoverbar` (`gl-hover_bar`), `lab-rowbar`, `lab-fixhover`, `lab-fixsib`, `lab-fix2` (`fixhover fixsib`), `lab-bar-pagerkey`, `lab-norules`, `lab-nosibling`.
- Servers: `check/start.mjs` with `check/serve.sh` (`vite preview --host 127.0.0.1 --port <port> --strictPort`), ports 4365 to 4369 only. `check/stop.sh` stops them.

| Port | Copy                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 4365 | `lab-base`                                                                                                            |
| 4366 | `lab-bar`                                                                                                             |
| 4367 | `lab-nohover`, then `lab-norules`                                                                                     |
| 4368 | `lab-rowbar`, then `lab-bar-pagerkey`                                                                                 |
| 4369 | `lab-fix2`, then `lab-hoverbar`, then `lab-base` as a development server (`check/serve-dev.sh`, for the gallery only) |

## Checker: method

- The scripts of the checker are new (`check/clib.mjs`, `check/measure.mjs`, `check/body.mjs`, `check/direct.mjs`, `check/why.mjs`, `check/pics.mjs`, `check/cv-check.mjs`, `check/props.mjs`, `check/props-pics.mjs`, `check/util-cost.mjs`, `check/css-diff.mjs`, `check/gallery.mjs`). They use the same page (`/preview/page/review/ariakit?scenario=large`), the same two views (41 rows; 585 rows with status "Unchanged" and each of the 24 folders open), and the same definition of the next frame as the research scripts.
- Count: the largest number of elements in one `UpdateLayoutTree` event of a key press, with `container-type: normal` on each element. This number was the same in each run (1,216 or 1,217 as built, 69 or 70 with the bar glider only). The sum of all recalculations of a key press is not stable: it changes with the place of the pointer (90 with the pointer at the top of the page, 430 to 775 with the pointer on the heading of the main panel: `check/results/B2-large-bar.log`). The research agent reported the sum (1,245 and 87).
- With size containers as built, the trace of Chrome has no count for this work: the largest recalculation is 37 elements in each form, and the cost shows as layout time (66 to 75 ms as built against 15 to 18 ms with the bar glider only: `check/results/L1-large-1x.json`).
- Second time source: the `Performance.getMetrics` call of the DevTools protocol gives the script time, the style time, and the layout time of each step. The Event Timing entry of the page gives the time of the key to the next paint in steps of 8 ms.
- Pictures: a pixel differs when one channel differs by more than 2.

## Checker A: the forms of the list at 41 rows

Commands: `zsh check/run-large.sh` (`check/measure.mjs`, 5 conditions in turns, 5 runs, one new page for each run), then `node check/summarize.mjs L1-large-1x L2-large-4x`. Results: `check/results/L1-large-1x.log`, `L2-large-4x.log`, `SUMMARY-large.txt`. Load average 2.8 to 6.9 (no throttle) and 3.1 to 11.8 (CPU slowed 4 times). The time of the arrow key is the median of 10 key presses (2 for each run).

| Form                                     | Largest recalculation, arrow key | Sum, arrow key      | Largest, Approve | Arrow key, next frame | Arrow key, CPU 4x | Approve | Approve, CPU 4x  | Script of one arrow key (CPU 4x) | Style and layout of one arrow key | Pointer over 6 rows (layouts) | 10 wheel steps (layouts) |
| ---------------------------------------- | -------------------------------- | ------------------- | ---------------- | --------------------- | ----------------- | ------- | ---------------- | -------------------------------- | --------------------------------- | ----------------------------- | ------------------------ |
| base: four gliders                       | 1,217                            | 1,247 [1,242-1,250] | 1,345            | 80 ms [76-83]         | 344 ms [315-415]  | 96 ms   | 425 ms [372-496] | 31 ms (137)                      | 82 ms                             | 483 ms (46)                   | 817 ms (46)              |
| bar                                      | 70                               | 90 [89-96]          | 156              | 36 ms [29-45]         | 134 ms [119-166]  | 54 ms   | 218 ms [213-245] | 33 ms (129)                      | 24 ms                             | 24 ms (2)                     | 60 ms (19)               |
| nohover: selected, focus, bar            | 72                               | 102 [97-105]        | 158              | 36 ms [32-47]         | 151 ms [132-201]  | 54 ms   | 215 ms [189-326] | 33 ms (142)                      | 37 ms                             | 26 ms (2)                     | 76 ms (19)               |
| rowbar: no glider, the row draws the bar | 70                               | 82 [82-85]          | 154              | 35 ms [30-40]         | 126 ms [103-154]  | 54 ms   | 196 ms [176-232] | 36 ms (126)                      | 9 ms                              | 27 ms (2)                     | 47 ms (19)               |
| fix2: four gliders with rewrites 1 and 3 | 72                               | 101 [98-108]        | 153              | 37 ms [33-47]         | 160 ms [133-196]  | 53 ms   | 209 ms [203-268] | 31 ms (146)                      | 36 ms                             | 265 ms (59)                   | 277 ms (65)              |

The research agent had, at a load average of 4 to 78: 96 ms and 438 to 515 ms as built, 48 ms and 188 to 276 ms for bar. So the direction and the rough size are the same, and the times of the checker are lower with the lower load.

`check/results/L3-large-1x.log` and `L4-large-4x.log` (load average 6.8 to 24 for `L3`; 33 to 44 for `L4`, which the checker stopped after 7 of 25 runs): the forms that are tests.

| Form                                                                    | Largest recalculation, arrow key | Arrow key, next frame | Pointer over 6 rows (layouts) | 10 wheel steps (layouts) | Arrow key, CPU 4x, at a load average of 33 to 44 |
| ----------------------------------------------------------------------- | -------------------------------- | --------------------- | ----------------------------- | ------------------------ | ------------------------------------------------ |
| base                                                                    | 1,217                            | 83 ms [79-97]         | 487 ms (47)                   | 790 ms (46)              | 459 ms [450-481], 2 runs                         |
| bar                                                                     | 70                               | 32 ms [29-47]         | 21 ms (2)                     | 57 ms (19)               | 209 ms [184-232], 2 runs                         |
| hoverbar: hover and bar gliders                                         | 1,215                            | 78 ms [75-89]         | 457 ms (47)                   | 777 ms (46)              | not run                                          |
| norules: four gliders, the 10 class names of the `:has()` shape removed | 155                              | 35 ms [32-47]         | 224 ms (59)                   | 294 ms (69)              | 212 ms, 1 run                                    |
| basecv: four gliders, rows in parts                                     | 866                              | 64 ms [62-70]         | 414 ms (52)                   | 1,015 ms (113)           | 384 ms, 1 run                                    |
| barcv: bar glider, rows in parts                                        | 70                               | 34 ms [30-47]         | 22 ms (2)                     | 199 ms (101)             | 191 ms, 1 run                                    |

The two runs of `L4` at the high load give the load effect with the builds of the checker: 209 ms for bar, against 134 ms at a load average of 3 to 12.

## Checker A: the forms of the list at 585 rows

Command: `zsh check/run-chain4.sh` -> `check/results/A1-all-1x.log`, `SUMMARY-all.txt` (7 conditions in turns, 5 runs, load average 2.7 to 27.8). `barfix` is the page of `lab-bar` with the built sheet of `lab-fixsib`. `barrm3` is the page of `lab-bar` with the three sibling rules deleted in the browser.

| Form    | Largest recalculation, arrow key | Arrow key, next frame | Pointer over 6 rows (layouts) | 10 wheel steps (layouts) |
| ------- | -------------------------------- | --------------------- | ----------------------------- | ------------------------ |
| base    | 2,438 of 2,592                   | 325 ms [316-393]      | 2,028 ms (20)                 | 3,177 ms (34)            |
| bar     | 2,435 of 2,589                   | 318 ms [308-356]      | 207 ms (7)                    | 336 ms (10)              |
| nohover | 2,437                            | 325 ms [310-353]      | 233 ms (7)                    | 369 ms (10)              |
| rowbar  | 2,435                            | 300 ms [285-337]      | 54 ms (1)                     | 88 ms (1)                |
| fix2    | 88                               | 138 ms [129-145]      | 1,179 ms (27)                 | 1,499 ms (40)            |
| barfix  | 85                               | 125 ms [115-135]      | 208 ms (7)                    | 320 ms (10)              |
| barrm3  | 85                               | 128 ms [116-135]      | 264 ms (7)                    | 339 ms (10)              |

New against the research record: at 585 rows the bar glider has a cost for the pointer and the wheel (207 and 336 ms against 54 and 88 ms with no glider), and four gliders with both rewrites still cost 1,179 and 1,499 ms.

`check/results/A2-all-1x.log` (4 conditions in turns, 5 runs, load average 7.4 to 43.6):

| Form                                                      | Largest recalculation, arrow key | Arrow key, next frame | Pointer over 6 rows (layouts) | 10 wheel steps (layouts) |
| --------------------------------------------------------- | -------------------------------- | --------------------- | ----------------------------- | ------------------------ |
| bar                                                       | 2,435                            | 338 ms [303-629]      | 209 ms (7)                    | 338 ms (10)              |
| pagerkey: bar, and marks with the key of their place      | 31                               | 105 ms [101-184]      | 214 ms (7)                    | 336 ms (10)              |
| barcv: bar, rows in parts                                 | 1,905                            | 261 ms [243-372]      | 33 ms (7)                     | 514 ms (137)             |
| barrm3cv: bar, three sibling rules removed, rows in parts | 85                               | 55 ms [53-63]         | 33 ms (7)                     | 515 ms (129)             |

Which keys cost (new against the research record): `node check/pager-walk.mjs` presses ArrowDown 60 times with each folder open. Results: `check/results/K1-pager-walk-pagerkey.log`, `K2-pager-walk-bar.log` (counts, size containers off), `K3-pager-walk-bar-timed.log`, `K4-pager-walk-barfix-timed.log`, `K5-pager-walk-pagerkey-timed.log` (times, one walk for each form, load average about 38).

| Form                               | Keys that change the children of `<body>` | Largest recalculation of these keys | Next frame of these keys | Largest recalculation of the other keys | Next frame of the other keys |
| ---------------------------------- | ----------------------------------------- | ----------------------------------- | ------------------------ | --------------------------------------- | ---------------------------- |
| bar, as built                      | 8 of 60 (3 to 6 added, 3 to 4 removed)    | 2,433 to 2,457                      | 335 ms [328-358]         | 15 to 67                                | 110 ms [101-163]             |
| bar with the sheet of `lab-fixsib` | 8 of 60                                   | not counted                         | 136 ms [130-171]         | not counted                             | 105 ms [99-134]              |
| pagerkey                           | 2 of 60 (1 and 2 added, 0 removed)        | 121 and 321                         | 145 ms [130-160]         | 15 to 67                                | 106 ms [100-114]             |

Correction of the research record: with each folder open, an arrow key recalculates the document only when the variant control gets new tooltips. In this fixture that is 8 of the first 60 keys. The research agent and the first runs of the checker pressed the keys between rows 2 and 4, where each key does it.

## Checker A: pictures

Command: `zsh check/run-chain3.sh` (`check/pics.mjs`) -> `check/results/P1-large-dark.log`, `P2-large-light.log`, `P3-all-dark.log`, `P4-all-light.log`, and `P5-large-dark-again.log`; pictures in `check/shots/P*`. Each picture is the list with 24 px around it (322,000 pixels). States: selected, keyboard focus on the selected row, pointer on a row, pointer between two rows (after 750 ms), pointer on the selected row, pointer out of the list, and with each folder open also pointer on a folder button and keyboard focus on a folder button.

| Form against base                   | 41 rows, dark and light                                                      | 585 rows, dark and light                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| bar                                 | 0 pixels in 5 states. Pointer on the selected row: 56 (dark) and 64 (light). | 0 in the state "selected". 2,584 with the focus on a row in a folder (the ring is 3 px inside the row). 2,792 with the focus on a folder button. |
| nohover                             | As bar.                                                                      | 0 in 7 states. Pointer on the selected row: 48.                                                                                                  |
| rowbar                              | As bar.                                                                      | As bar, and 68 more: no bar in a folder.                                                                                                         |
| fix2                                | 0 in each state.                                                             | 0 in each state.                                                                                                                                 |
| base with the sheet of `lab-fixsib` | 0 in each state.                                                             | 0 in each state.                                                                                                                                 |

The first run for 41 rows in the dark theme had 8 pixels more in one state for each form, also for the two forms with a rewrite. A second run with the reference form two times (`P5`) had 0 pixels between the two reference pictures and 0 for the rewrites, so the 8 pixels were in the first reference picture.

Motion is not in a picture. With the bar form, only the bar travels between rows.

## Checker A: rows in parts, tried to break

Command: `node check/cv-check.mjs --view all` and `--view large` -> `check/results/V1-cv-all.log`, `V2-cv-large.log`. CSS added in the browser: `content-visibility: auto` and `contain-intrinsic-block-size` on each row.

| Case                                                                                 | 41 rows                                          | 585 rows                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Rows that skip their content                                                         | 13 of 41                                         | 530 of 585                                                                                                                                 |
| Links in the accessibility tree of Chrome, as built and with the CSS                 | 49 and 49                                        | 593 and 593                                                                                                                                |
| 30 times ArrowDown: focus on the selected row, row in the scroll box, bar on the row | 0 problems of 30                                 | 0 problems of 30                                                                                                                           |
| List scrolled away from the selected row with the wheel                              | The row keeps the focus, and the bar stays on it | The same                                                                                                                                   |
| One more ArrowDown                                                                   | The row comes back into the box                  | The same                                                                                                                                   |
| `innerText` of the last row                                                          | Equal                                            | Empty with the CSS ("Component" as built): code that reads `innerText` of a row that is not rendered gets no text. `textContent` is equal. |

A window of visible rows (rows removed from the DOM) was not built. From the code: the bar and the selected glider need the selected row in the DOM (`ui-nav-glider-selected`, `styles/ui.css:1230`), so they go when the selected row leaves the window, and a screen reader then gets only the rows of the window. Not measured.

## Checker B: the cause of the document recalculation

1. The rules removed and put back in one page: `node check/body.mjs --name B1-all-bar --port 4366 --view all --rounds 5` -> `check/results/B1-all-bar.log` (585 rows, `lab-bar`, size containers off). Largest recalculation of one arrow key, in the order of the run: as built 2,435; one of the three rules removed 2,435 (each of the three); as built again 2,435; two of the three removed 2,435 (each pair); the three removed 83; the three put back 2,435; removed again 83. Each key press removes 3 children of `<body>` and adds 3. At 41 rows no child of `<body>` changes (`B2-large-bar.log`). So the count follows the three rules, and one rule is enough.
2. The rewrite: `--sheet lab-fixsib` -> `B3-all-bar-fixsib.log`: 83 in each state.
3. No React and no tooltip: `node check/direct.mjs` -> `check/results/B5-direct-large-bar.log` (41 rows), `B6-direct-all-bar.log` (585 rows), `B7-direct-large-bar-fixsib.log` (the rewrite), `B8-direct-large-norules.log`. One empty hidden `<div>` is added to a parent, and removed after two frames.

| Parent and place                                        | 41 rows, as built     | 41 rows, three rules removed | 41 rows, rewrite | 585 rows, as built | 585 rows, three rules removed |
| ------------------------------------------------------- | --------------------- | ---------------------------- | ---------------- | ------------------ | ----------------------------- |
| `<body>`, as the last child                             | 94                    | 94                           | 94               | 32                 | 32                            |
| `<body>`, before its last child                         | 1,637 of 1,636 inside | 96                           | 96               | 2,488 of 2,494     | 34                            |
| `<body>`, as the first child                            | 1,637                 | 69                           | 67               | 2,488              | 5                             |
| Main panel, as the last or the first child (246 inside) | 1,546                 | 1,547                        | 1,546            | 2,398              | 2,397                         |
| Scroll box of the list, as the last child               | 64                    | 66                           | 64               | 2                  | 2                             |
| First row, as the last child                            | 69                    | 69                           | 69               | 12                 | 12                            |

Correction of the research record: an element that is added as the last child costs nothing. The cost is for an element that is added before a sibling, or removed from before a sibling. A portal node of Ariakit is added as the last child of `<body>`, and it is removed from the middle of the children.

4. The main panel is a second effect, of the `:has()` rule shape and not of the sibling shape: `node check/why.mjs --parent main` -> `check/results/W1-why-main.log`. DevTools names "Invalidation set invalidates subtree" on the Shell root (`div.shell`), with one set that has `allDescendantsMightBeInvalid` and 11 selectors: the selectors of the 10 class names of `choice.ts`, `control.ts`, and `input.ts`. With `lab-norules` (the 10 class names removed): 124 elements for the same change, and no subtree event (`B8-direct-large-norules.log`, `W2-why-main-norules.log`).
5. The sheets: `node check/css-diff.mjs lab-base lab-fixsib` -> `check/results/D1-css-diff-fixsib.log`. 2,878 rules in both sheets. 63 rules have another selector, and no rule has other declarations. 429,987 and 436,633 bytes.
6. The app: `apps/web/dist/client/assets/index-CXm4JU5N.css` (a build of 2026-10-06, 464,666 bytes) has the three rules (`grep`). `apps/web/src/components/ariakit/components/nav.ariakit.react.tsx:299` and `:303` have the two hover rules of rewrite 1. Not measured in the app.
7. Tailwind CSS 4.3.3, `node_modules/tailwindcss/dist/lib.mjs`: the `peer` variant writes ``v.selector = `&:is(${k} ~ *)` ``, with `:is()` around a selector list.

Not run again by the checker: the 26 synthetic rules of the research agent (`results/B2-synthetic.log`, `B3-synthetic.log`, `B4-synthetic.log`) and the DevTools event on `BODY` (`results/B-body-selectors.txt`). The checker read the logs. The mechanism inside Chrome stays an assumption.

Which glider costs (`check/results/L3-large-1x.log`): hover + bar 1,215; selected + focus + bar 72; bar 70.

## Checker C: the typed registered properties

- `node check/props.mjs --name C1-props --port 4366 --rounds 5` -> `check/results/C1-props.log` (load average 5.9 to 9.3; 5 rounds of 4 theme switches in turns; 1,607 elements in each recalculation).
- `node check/props-pics.mjs` -> `check/results/C3-props-pictures.log`: a picture of the full sheet before each variant, in both themes. The noise of the method is 0 to 10 pixels of 1,296,000.

| Variant                                 | µs for each element | Against the full sheet | Pixels that differ: dark, light       |
| --------------------------------------- | ------------------- | ---------------------- | ------------------------------------- |
| Full sheet                              | 52 [50-65]          | -                      | 0 to 10 (noise)                       |
| Full sheet again, at the end            | 52.5 [45-68]        | 1.01 times             |                                       |
| The 51 removed                          | 18 [15-26]          | 0.35 times (65% less)  | 1,080,060 and 1,010,896 (83% and 78%) |
| `syntax: "*"` on the 26 numbers         | 54.6 [51-65]        | 1.05 times             | 0 and 8                               |
| `syntax: "*"` on the 14 colors          | 786 [739-846]       | 15 times               | 35,357 and 22,821                     |
| `syntax: "*"` on the 11 lengths         | 309 [284-387]       | 5.9 times              | 5,969 and 5,916                       |
| `inherits: true` on the 32 with `false` | 53.4 [48-61]        | 1.03 times             | 42,493 and 43,908 (3.3%)              |

- What reads the 51 properties (counted in `node_modules/@ariakit/tailwind/src/output.css`, version 0.2.8): 371 style queries, of which 330 read a typed property: `--_ak-ltlc-even` 132, `--_ak-ltlc-odd` 132, `--_ak-ltl` 34, `--_ak-ll` 19, `--_ak-lbd` 4, `--_ak-ls` 2 (6 colors), `--_ak-frame-row` 4 (number), `--ak-frame-padding` 3 (length). A style query compares the computed value, so these 8 need their type. No transition and no animation is in the package. The transitions of the primitives (`disclosure.ts:223`, `progress.ts:123`, `shell.ts:527`, `tabs.ts:391`, `ui.css:1486`) read other properties.
- The 51 typed rules are at lines 1547 to 2251, and `ak-layer` is at lines 118 to 166.

- The cost of one element by its class set: `node check/util-cost.mjs --unique 1` -> `check/results/C4-util-cost-unique.log` (load average about 40). The script adds 1,000 elements to the loaded page, each alone in a parent `<div>` and with its own inline custom property, and switches the theme 4 times, 5 rounds in turns. The page with an empty box: 88 ms for 1,608 elements.

| Class set of the added element                                                                                                                            | µs for one added pair (the parent and the element) |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| No class                                                                                                                                                  | 4.6                                                |
| `ak-layer`                                                                                                                                                | 176                                                |
| `ak-layer`, in a parent with `ak-layer`                                                                                                                   | 179                                                |
| `ak-text`                                                                                                                                                 | 8                                                  |
| The most frequent class set of the page (245 uses): `ak-layer ak-layer-transparent ak-frame ak-frame-force ak-frame-sm ak-frame-p-(--frame-padding) flex` | 191                                                |
| The class set of a row link (`text control ak-frame-join-item ...`, 41 uses)                                                                              | 298                                                |
| The class set of a thumbnail (`ak-layer ak-layer-transparent ak-layer-darken-... ak-frame ...`, 41 uses)                                                  | 208                                                |
| Three text class sets with `ak-ink-70` or `ak-ink-100` (41 uses each)                                                                                     | 22 to 30                                           |

So one element with `ak-layer` costs about 170 µs (176 minus 4.6), and an element with no class about 2 µs. 522 elements with `ak-layer` at 170 µs are 89 ms, which is the size of one full recalculation of the page (84 ms): an estimate.

- The first form of this run (`check/results/C2-util-cost.log`) had 1,000 equal siblings: 1.6 µs for one element with `ak-layer` and 1.4 µs with no class. Chrome reuses one computed style for equal siblings, so that run does not show the cost of the formulas. It shows that equal siblings are almost free. The class set of a row link cost 199 µs there, because its sibling rules test 1,000 siblings: not a number of the real page.

Reading: the result of the research agent holds. The type is not the cost: with no type, a color or a length costs 6 to 15 times more. `inherits: false` is not the cost. Only untyped numbers keep the picture, and they are not faster. No faster form with an equal picture was found.

## Checker D: the gallery of the lab

`node check/gallery.mjs` loads the gallery of the current lab 5 times with live frames and 5 times with each request for a frame document aborted, in turns. "Quiet" is the end of the last task above 50 ms before 1.5 s with no such task, after the network is quiet.

| Run                                                        | Form           | Frames   | Requests | Network quiet after | Last long task ends at | Load average |
| ---------------------------------------------------------- | -------------- | -------- | -------- | ------------------- | ---------------------- | ------------ |
| `G1-gallery` (`/`), production form                        | live frames    | 10       | 845      | 2.1 to 2.2 s        | not measured           | 4 to 5       |
|                                                            | frames blocked | 10 boxes | 71       | 0.7 s               |                        |              |
| `G2-directions` (`/directions`), production form           | live frames    | 6        | 532      | 1.5 s               | not measured           | 5            |
|                                                            | frames blocked | 6 boxes  | 69       | 0.7 s               |                        |              |
| `G8-gallery-prod-quiet`, production form                   | live frames    | 10       | 846      | 2.2 s [2.0-3.9]     | 1.6 s [1.5-3.4]        | 43 to 65     |
|                                                            | frames blocked |          | 71       | 0.7 s [0.7-1.3]     | no long task           |              |
| `G7-gallery-dev-long`, development server of the copy      | live frames    | 10       | 3,185    | 2.2 s [2.1-2.3]     | 3.8 s in 3 of 5 loads  | 28 to 35     |
|                                                            | frames blocked |          | 223      | 0.9 s               | no long task           |              |
| `G9-gallery-dev-warm`, the first load after a server start | live frames    | 10       | 3,183    | 8.5 s               | 9.2 s                  | 24 to 36     |
| `G10-gallery-dev-quiet`, development server                | live frames    | 10       | 3,185    | 4.1 s               | 5.1 s                  | 44 to 58     |
|                                                            | frames blocked |          | 223      | 1.1 s               | no long task           |              |

- `G7` had a mistake in its quiet test: the wait ended at once when no long task had come yet. So 2 of its 5 loads with live frames have no long task time. `G8` and `G10` have the corrected test.
- `G10` stopped at its second load with live frames: the network was not quiet after 30 s (`page.waitForLoadState: Timeout 30000ms exceeded`), at a load average of about 58.
- The earlier lanes measured 9 to 19 s against about 1 s on the development server, with 15 frames and at a load average of 12 to 850. The checker did not use the lab server at port 4320.

## Checker: corrections of the research draft

| Claim of the research draft                                                                                                                               | Problem                                                                                                                                                                       | Correction                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "Each insertion or removal of an element makes Chrome recalculate the subtree of the parent."                                                             | An element that is added as the last child costs nothing (94 of 1,636 elements for `<body>`).                                                                                 | The cost is for an element that is added or removed before a sibling. A portal node of Ariakit pays when it is removed.          |
| "With each folder open, one arrow key recalculates 2,481 of 2,589 elements" (341 ms).                                                                     | True only for a key that gives the variant control new tooltips: 8 of the first 60 keys. The other 52 keys recalculate 15 to 67 elements and need 110 ms.                     | The part, PERF-05, and PERF-06 say "8 of the first 60 arrow keys".                                                               |
| "One arrow key recalculates 1,245 elements; 87 with the bar glider only. The count is the same in each run."                                              | This is the sum of each recalculation of a key press. It changes with the place of the pointer (430 to 775 for the bar form with the pointer on the main panel).              | The count of the record is the largest single recalculation: 1,217 and 70.                                                       |
| "The lab did four gliders without need: your note asked for one."                                                                                         | The direction document has hover and focus gliders in each list (`docs/design/directions/ariakit.md:135` and `:641`), and the plan of round 2 kept them beside the bar.       | The part and D-PERF-01 say that the bar glider only removes two gliders of the direction document.                               |
| Arrow key with the CPU slowed 4 times: "276, 188, 198 ms" for bar, "at the line".                                                                         | Times at a load average of 22 to 78.                                                                                                                                          | At 3 to 12: 134 ms for the arrow key and 218 ms for Approve. At 33 to 44: 209 ms. Approve is the key at the line.                |
| "With the bar glider only, style and layout are 88 ms of 276 ms. The rest is script."                                                                     | The key handler forces style and layout, so "the rest" is not script only.                                                                                                    | The DevTools metrics give 31 to 36 ms of script for each arrow key in each form, and 24 ms of style and layout for bar.          |
| "The bar glider is not the cost" (at each size).                                                                                                          | True at 41 rows. At 585 rows the bar glider costs 207 ms for the pointer and 336 ms for the wheel, against 54 and 88 ms with no glider.                                       | Notes, section A. The table of the part is for 41 rows.                                                                          |
| "Form 8 (four gliders with both rewrites): pointer 236 ms, wheel 306 ms."                                                                                 | No number for 585 rows.                                                                                                                                                       | At 585 rows: 1,179 ms and 1,499 ms. D-PERF-01 has it in the option.                                                              |
| "57 µs for each element": the formulas of the layer utilities cost each element.                                                                          | The cost is on the elements with `ak-layer`: about 170 µs each when Chrome cannot reuse a style, and 2 µs for an element with no class.                                       | New row of the cause table and item 4 of the part; PERF-07.                                                                      |
| "`inherits: true` on the 32 rules: 7% more time" (no picture).                                                                                            | The picture is not equal: 3.3% of the pixels differ.                                                                                                                          | PERF-07.                                                                                                                         |
| "Rows in parts: 35 ms against 48 ms at 41 rows."                                                                                                          | Not reproduced: 34 ms against 32 ms.                                                                                                                                          | "Rows in parts give nothing at 41 rows."                                                                                         |
| D-PERF-01 option "No glider: the selected row draws the bar".                                                                                             | It does not show in a folder, and it is hand-placed code beside a stock primitive, against the standing rule and the note of round 1. It is dominated by the bar glider only. | Removed from the options. It stays in the table as a measured form.                                                              |
| D-PERF-01: "wrong if Safari or Firefox behave in another way".                                                                                            | D-RES-04 settles Chrome Desktop as the scope.                                                                                                                                 | The rationale names D-RES-04.                                                                                                    |
| D-PERF-02 asked two things: the gate, and who acts first. Its option "Ariakit UI acts first" is the option "four gliders after the rewrite" of D-PERF-01. | Not one clear question.                                                                                                                                                       | D-PERF-02 asks only for the test: none, by count, or by time. The count test names its cost: it turns the size containers off.   |
| D-PERF-03: "9 to 19 s in development", "about 94% of the wait".                                                                                           | Numbers of the lab of round 2 (15 frames) at a load average of 12 to 850.                                                                                                     | The lab of today: 10 frames, 3.8 to 5.1 s against 0.9 to 1.1 s on a development server.                                          |
| The three decision panels at the end of the part.                                                                                                         | AUTHORING.md: "Do not collect the panels at the end."                                                                                                                         | Each panel is after its evidence. `draft.mjs` no longer adds the panels.                                                         |
| The lines of the primitives with no source.                                                                                                               | Not exact enough for Ariakit.                                                                                                                                                 | The part names ariakit/ariakit commit 643a23af, `packages/ariakit-ui/src`. The same hover form is at `glider.ts:113` and `:117`. |
| Count statements: 8 listed.                                                                                                                               | 6 more exist: the numbers of findings, of high, of medium and low, of confirmed, of decisions, and "55 / 55 answered".                                                        | `prose.patch.json` lists 14.                                                                                                     |

## Checker E: the draft of the record

- `part.html`: the part for `sections/50-ui-system.html`. Place: the end of the section. Anchor text: after `<a href="#design-lab">lab guide</a>.` and the `</p>` that follows it, before `</section>`. The part holds the three decision panels.
- `zsh build-draft.sh` (the last run: 09:18): `pnpm exec oxfmt` on the five files, `node draft.mjs` (a new copy of `apps/lab/audit/content`, the part, the 3 proposed decisions after `D-UI-03`, 10 new findings, 1 change of `PRIM-17`, 2 terms, 2 prose patches, 14 count statements checked), then `node apps/lab/audit/build.mjs --strict --content .../record/content --out .../record/out`: 16 sections, 58 decisions, 568 findings, 290 terms, 78 demos, 1.58 MB. Then `node apps/lab/audit/check.mjs --dir .../record/out`: "All checks passed", 148 passed lines, no failed line, for the two outputs at 1440 px and at 400 px. Logs: `check/logs/build-draft.log`, `logs/draft-build.log`, `logs/draft-check.log`.
- `node count-words.mjs`: 826 words of prose outside the tables, and 43 words in the two code blocks.
- `node check/view-part.mjs` -> `check/results/view-part.log`, pictures `check/shots/part-*.png`: in both outputs at 1440 px and at 400 px the page does not scroll sideways, no box is wider than the page, the console has no error, the demo changes when its 3 sliders move and Reset restores the start, and each of the 3 panels takes a selection and clears it. At 400 px the second table scrolls in its own box, and its foot is one long line in that box.
- The path `apps/lab/audit/reports/perf/record` in the part is an assumption: the coordinator copies this folder there.

## Servers at the end

`zsh check/stop.sh` at 09:04: ports 4365 to 4368 stopped, and 4369 had no listener (its development server was stopped after each gallery run). Port 4320 still has its listener.

---

# Record of the research agent (06:41 to 08:06)

The text below is the record of the research agent, not changed. Its numbers are from a load average of 4 to 223. Where it differs from the record of the checker above, the checker is right.

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
