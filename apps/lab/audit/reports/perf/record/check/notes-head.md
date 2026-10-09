# Record lane: the gliders of the list, the cause of the document recalculation, and the typed properties

This file has two parts. The first part is the record of the independent checker (2026-10-07, 08:08 to @@END). The part of the record (`part.html`), the findings, and the proposed decisions use the numbers of the first part. The second part is the record of the research agent (06:41 to 08:06), as the agent wrote it. Where the two parts differ, the first part is right, and the table "Corrections" says why.

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

`check/results/L3-large-1x.log` and `L4-large-4x.log` (load average @@L3LOAD): the forms that are tests.

@@L3TABLE

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

@@A2TABLE

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

@@C4TEXT

Reading: the result of the research agent holds. The type is not the cost: with no type, a color or a length costs 6 to 15 times more. `inherits: false` is not the cost. Only untyped numbers keep the picture, and they are not faster. No faster form with an equal picture was found.

## Checker D: the gallery of the lab

@@GALLERYNOTES

## Checker: corrections of the research draft

@@CORRECTIONS

## Checker E: the draft of the record

@@DRAFTNOTES

## Servers at the end

@@SERVERS
