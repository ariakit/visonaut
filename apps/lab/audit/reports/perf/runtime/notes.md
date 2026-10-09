# Runtime lane: where the time goes in the browser

Working record. Date: 2026-10-07, 04:17 to 05:45. Machine: Apple M4 Pro, 14 cores, shared with many other agent sessions. Browser: Google Chrome 154 through Playwright (channel `chrome`, headless), viewport 1440 by 900.

## Load of the machine

The load average was never below 16. It rose during the work: 16 to 38 (04:20 to 04:50), 45 to 115 (04:50 to 05:17), 170 to 850 (05:17 to 05:40). So no absolute time of this record is the time on a free machine. Each comparison was made in one script with the conditions interleaved. Each result file has the load average of each run.

## What is in this folder

| Path                    | Content                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lab-copy/`             | Copy of `apps/lab` of 04:18 (no `node_modules`, `dist`, `.wrangler`, `public/audit`). Own `node_modules` folder with one symbolic link for each package. |
| `web-copy/`             | Copy of `apps/web`, with the preview fixtures changed to 41 screenshots with 6 variants each.                                                            |
| `results/`              | One JSON file for each experiment: each run, the load average of each run, and the summary.                                                              |
| `results-*.log`         | The printed table of each experiment.                                                                                                                    |
| `shots/`                | Pictures of the pages that the scripts used.                                                                                                             |
| `*.mjs`, `*.py`, `*.sh` | The scripts.                                                                                                                                             |

Changes in the copies (lane only, nothing in the repository):

- `lab-copy/tsconfig.json`: `extends` is an absolute path.
- `lab-copy/vite.config.ts` and `web-copy/vite.config.ts`: `server.fs.allow` has the worktree, because the packages are there.
- `lab-copy/src/lab/record.ts`: one line `export const settledLabel = getSettledLabel(1);`. The copy was made while another agent renamed this export, and the build failed without it.
- `web-copy/.dev.vars`: `VISONAUT_ORIGIN=http://127.0.0.1:4343`. `web-copy/dist/server/wrangler.json`: the same variable with port 4344.
- `web-copy/src/review/preview-fixtures.ts`: `patch-web-fixtures.py 41`.

Check that the copy is the lab: `vite build` of the copy made `styles-_WVGwkaQ.css` with 475,095 characters, the same file name as the build in `apps/lab/dist`.

## Servers of this lane

| Port | Command                                                                                                       | State            |
| ---- | ------------------------------------------------------------------------------------------------------------- | ---------------- |
| 4341 | `run-vite.sh lab-copy --host 127.0.0.1 --port 4341 --strictPort`                                              | stopped at 05:41 |
| 4342 | `run-vite.sh lab-copy preview --host 127.0.0.1 --port 4342 --strictPort` (after `run-vite.sh lab-copy build`) | stopped at 05:41 |
| 4343 | `run-vite.sh web-copy --host 127.0.0.1 --port 4343 --strictPort`                                              | stopped at 05:41 |
| 4344 | `run-vite.sh web-copy preview --host 127.0.0.1 --port 4344 --strictPort` (after `run-vite.sh web-copy build`) | stopped at 05:41 |

The shared server at port 4320 got: 2 `curl` requests, and 4 page sessions of `interact.mjs` (2 bare, 2 framed, 6 interactions each). It was not stopped. It answered 200 after this lane stopped its own servers.

## Scripts

| Script                                                          | Purpose                                                                                                                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.mjs`                                                       | Browser launch, tracing, trace analysis (self time by group on the renderer main thread, counts, selector statistics).                                                                                |
| `make-copy.sh`, `run-vite.sh`                                   | Make a copy of an app, run its Vite.                                                                                                                                                                  |
| `probe.mjs`, `snapshot.mjs`, `controls.mjs`, `filter-probe.mjs` | Discovery: DOM counts, requests, controls.                                                                                                                                                            |
| `trace-check.mjs`                                               | Shape of a trace.                                                                                                                                                                                     |
| `interact.mjs`                                                  | One trace for each run of an interaction set (`review`, `chrome`, `web`), one window for each interaction. Conditions `<server>:<bare or framed>:<cpu rate>[:<scenario>[:<list size>]]`, interleaved. |
| `inp-only.mjs`                                                  | Key press to next paint from the Event Timing API, with no trace. Control for the observer effect.                                                                                                    |
| `layout-why.mjs`, `layout-inside.mjs`                           | Why layout is slow after a key press.                                                                                                                                                                 |
| `selectors-report.mjs`, `css-features.mjs`                      | Owner and kind of the costly selectors. Counts of CSS features.                                                                                                                                       |
| `ab-style.mjs`                                                  | The same DOM with the style sheet changed (6 variants).                                                                                                                                               |
| `bisect-rule.mjs`, `show-causes.mjs`                            | Finds the rules that make a selection change recalculate the whole list.                                                                                                                              |
| `frames.mjs`, `load-all.mjs`                                    | Load, idle, theme switch with 0, 1, 3, and 15 frames.                                                                                                                                                 |
| `profile-only.mjs`, `profile-groups.mjs`                        | CPU profile by owner of the code.                                                                                                                                                                     |
| `patch-*.py`                                                    | Changes that this lane made to its own scripts and to the copy of `apps/web`.                                                                                                                         |

Method of each number of a trace:

- Categories: `devtools.timeline`, `disabled-by-default-devtools.timeline`, `disabled-by-default-devtools.timeline.frame`, `blink.user_timing`, `v8.execute`, `loading`. Selector statistics add `disabled-by-default-blink.debug`, in separate runs, because that category makes style recalculation slower.
- Time to the next frame (`firstCommit`): from the start of the `EventDispatch` of the input to the end of the first `Commit` on the main thread after the dispatch. `inp`: the `duration` of the Event Timing entry (8 ms steps).
- Script, style, layout, paint: self time of the events of each group on the renderer main thread in the window of the interaction. `recalcs` and `elements`: count of `UpdateLayoutTree` events and the sum of their `elementCount`.
- CPU throttling: `Emulation.setCPUThrottlingRate` 4, set after the load.
- Important: the group "layout" holds style recalculation. The page has 7 `inline-size` containers. The container `shell` holds 1,514 of the 1,742 elements. A style change inside a container is recalculated during layout. Proof 1: with selector statistics on, the largest layout of an ArrowDown is 190 ms, without them 57 to 60 ms, and layout alone matches no selector. Proof 2: with `container-type: normal` on every element, the same key press has 66 ms of style recalculation for 1,668 elements and 20 ms of layout, in place of 14 ms and 76 ms.

## A. The slowness, named

Review page, scenario `large`: 41 rows in the list, 1,742 elements (production build). Median of 5 runs. Range and every other step: `results-A-review.log`, `results/A-review.json`. Load average 16 to 37.

Time from the key press to the next frame, in ms (the Event Timing value is within 8 ms of each):

| Interaction                 | dev, 1x | production, 1x | dev, 4x CPU | production, 4x CPU |
| --------------------------- | ------- | -------------- | ----------- | ------------------ |
| S (side by side)            | 195     | 55             | 934         | 225                |
| O (overlay)                 | 49      | 22             | 515         | 100                |
| ArrowDown (next screenshot) | 202     | 84             | 1,090       | 418                |
| ArrowRight (next variant)   | 87      | 38             | 698         | 193                |
| A (approve)                 | 203     | 101            | 1,140       | 464                |
| X (reject)                  | 146     | 107            | 1,154       | 489                |
| Open the More menu          | 98      | 44             | 547         | 221                |
| Open Details                | 71      | 54             | 572         | 288                |

Split of the main-thread work, in ms (script / style / layout / paint), with the count of recalculations and of recalculated elements:

| Interaction                      | dev, 1x                           | production, 1x                   | dev, 4x                   | production, 4x            |
| -------------------------------- | --------------------------------- | -------------------------------- | ------------------------- | ------------------------- |
| S                                | 174 / 12 / 23 / 10 (15, 426)      | 34 / 14 / 24 / 10 (18, 522)      | 834 / 34 / 88 / 35        | 173 / 40 / 91 / 37        |
| ArrowDown                        | 172 / 11 / 74 / 9 (14, 358)       | 36 / 13 / 72 / 10 (18, 482)      | 1,179 / 37 / 381 / 32     | 179 / 17 / 309 / 24       |
| A                                | 142 / 12 / 80 / 9 (15, 475)       | 38 / 9 / 137 / 11 (18, 502)      | 1,242 / 9 / 458 / 27      | 198 / 33 / 378 / 39       |
| More menu                        | 78 / 22 / 3 / 3 (19, 579)         | 29 / 22 / 4 / 4 (20, 613)        | 882 / 133 / 20 / 23       | 138 / 101 / 18 / 18       |
| Scroll, 10 wheel steps of 300 px | 135 / 445 / 466 / 35 (48, 13,537) | 54 / 443 / 511 / 36 (49, 13,625) | 336 / 2,082 / 2,042 / 163 | 144 / 2,053 / 2,095 / 175 |
| Hover of 6 rows                  | 32 / 1 / 1 / 1 (4, 124)           | 12 / 1 / 1 / 2 (6, 187)          | 1 / 4 / 2 / 2             | 3 / 2 / 1 / 1             |

Readings:

- Development against production: the script time is 4 to 5 times larger (ArrowDown 172 against 36 ms). Style and layout are the same.
- The scroll of the list is the worst interaction in production: 1 second of style and layout for 10 wheel steps, 4.1 seconds at 4x CPU. Each wheel step recalculates the style of about 1,360 elements.
- A hover costs nothing at 41 rows.
- No trace: `inp-only.mjs` gives the same values (dev S 192, ArrowDown 192, A 208; production 64, 96, 112), so the trace does not make development mode look worse. `results/A-inp-no-trace.json`.
- Shared server at port 4320 (2 runs): S 112 to 244, ArrowDown 180 to 308, A 176 to 272. The copy at 4341 in the same session: 172, 196, 200. So the copy behaves like the lab that the maintainer uses. `results-A-shared-4320.log`.

The lab chrome, page explorer with one frame (`results-A-chrome.log`, load average 98 to 850, so only the ratios are safe). Main-thread work in ms (script + style + layout), and the longest task:

| Interaction                     | dev, 1x                   | production, 1x           | dev, 4x                           | production, 4x              |
| ------------------------------- | ------------------------- | ------------------------ | --------------------------------- | --------------------------- |
| Scenario tab "Wide change"      | 357 + 169 + 181, task 562 | 108 + 85 + 180, task 259 | 2,313 + 1,007 + 1,074, task 3,508 | 617 + 435 + 987, task 1,559 |
| Theme switch                    | 320 + 110 + 57            | 70 + 109 + 58            | 2,048 + 623 + 333                 | 392 + 572 + 292             |
| Open the Look menu (next frame) | 260                       | 145                      | 1,379                             | 852                         |
| Look: radius                    | 243 + 150 + 17            | 72 + 156 + 19            | 1,590 + 1,013 + 104               | 476 + 986 + 109             |
| Look: density                   | 396 + 91 + 226            | 95 + 92 + 222            | 2,362 + 454 + 1,224               | 734 + 552 + 1,325           |

Loads until every frame has rendered and the network is quiet (`results-C2-load-all.log`, 3 runs, load average 170 to 850):

| View                   | dev: requests     | dev: main thread, ms    | production: requests | production: main thread, ms |
| ---------------------- | ----------------- | ----------------------- | -------------------- | --------------------------- |
| Bare preview           | 417 (348 scripts) | 5,131 cold, 4,257 warm  | 159 (90 scripts)     | 1,924 cold, 1,541 warm      |
| Page explorer, 1 frame | 640               | 5,023 cold, 4,511 warm  | 231                  | 2,042 cold, 1,837 warm      |
| Gallery, 15 frames     | 4,895             | 8,959 cold, 11,195 warm | 1,385                | 5,991 cold, 8,646 warm      |

- Gallery in development: 14 to 19 seconds of wall time until the 15 frames are ready (this machine, now). A warm reload sends the same 4,889 requests: the development server marks source modules `no-cache`.
- Parsing the style sheet costs 2.4 to 6 ms for each document (`ParseAuthorStyleSheet`). The gallery in development: 43 ms for all documents.
- Bare preview in production: style 318 ms (7,666 recalculated elements in 40 recalculations) and layout 679 ms of the 1,924 ms.

Theme switch against the number of frames (`results-C2-frames.log`, production, main-thread ms): bare 165, 1 frame 270, compare view with 3 frames 800, gallery with 15 frames 5,111 (1,609 recalculations, 28,711 elements, 189 frames). In development: 560, 1,730, 5,477.

## B. Who owns the style cost

`results-B-stats-review.log`, `results/selectors-report-*.json`. Whole review interaction set, production, bare.

- 834 selectors took time. 4,119,808 match attempts, 423,546 matches.
- 91.3% of the selector time is in selectors whose class is in `src/components/ariakit` (primitives). 5.8% have no class (preflight, universal). 1.0% design code. 0.0% lab chrome.
- 59% of the selector time is in selectors that never matched.
- The costliest selectors are tried for every element, because their subject is `*`:

```css
/* 15.2 ms, 32,329 attempts, 0 matches */
:is(:is(.ui-field-disabled\:\*\*\:ak-ink-0:is(:disabled, [aria-disabled="true"]), .ui-field-disabled\:\*\*\:ak-ink-0:has(…)) *)
/* 14.2 ms, 32,329 attempts, 0 matches */
:is(:is(.ui-disabled-within\:\*\*\:ak-ink-0:is(:disabled, [aria-disabled="true"]), .ui-disabled-within\:\*\*\:ak-ink-0:has(:is(:disabled, [aria-disabled="true"]))) *)
/* 10.3 ms, 32,329 attempts, 0 matches */
:is(.\*\*\:ui-disabled\:cursor-not-allowed *):is(:disabled, [aria-disabled="true"])
/* 8.6 ms, 268 attempts: 32 µs for each attempt, a scan of all later siblings */
.not-ui-nav-glider-selected\:hidden:not(:has(~ .control:is(:checked, .selected, …)))
```

- Counts in the built sheet (`css-features.mjs`): 518 `:has(`, 225 `@container … style(`, 141 size container queries, 247 `@property`, 4,731 `var(`, 25 `anchor(`.
- Selector matching is 253 ms of about 1.8 s of style time in that run (with statistics on). The rest of a recalculation is the cascade and the computed values.
- A full recalculation (theme attribute on the root element) costs 65 to 92 ms for 1,591 elements: 41 to 58 µs for each element.

## C. Experiments

### C1. Bare preview against the lab frame

Same page, same keys (`results-A-review.log`): dev S 195 bare, 205 framed. Production ArrowDown 84 bare, 84 framed. A 101 and 103. The frame of the lab adds less than 10% to an interaction inside the frame. It adds 5 to 7 ms of paint.

### C2. One frame against several frames

See the two tables of loads and of the theme switch in A. The cost grows with the number of frames, because each frame is a whole document with its own modules, its own React tree, and its own style sheet.

### C3. The same DOM with the style sheet changed

`results-C3-ab-style-prod.log` (run 1) and `results-C3-ab-style-prod-v2.log` (run 2). Production, 1x, 5 runs, interleaved. Style plus layout in ms.

| Variant                                               | Rules                             | Theme switch             | S      | ArrowDown | A       | Scroll, 10 steps |
| ----------------------------------------------------- | --------------------------------- | ------------------------ | ------ | --------- | ------- | ---------------- |
| base                                                  | 3,027 style rules, 513 KB as text | 119 (run 1), 107 (run 2) | 33, 38 | 89, 85    | 107     | 489              |
| used: only the rules that can match this page         | 767 to 801 rules, 191 to 200 KB   | 123, 104                 | 31, 32 | 39, 54    | 53      | 289              |
| nocause: without 21 rules                             | 3,006 rules                       | 111                      | 35     | 65        | 60      | 322              |
| noglider: nav glider hidden                           | all                               | 91, 68                   | 10, 9  | 57, 34    | 72      | 266              |
| nohas: without 410 rules with `:has()` (look changes) | 2,617                             | 122                      | 6      | 43        | not run | not run          |
| nocq: no container (look changes)                     | all                               | 127                      | 35     | 87        | not run | not run          |

- 74% fewer rules: a full recalculation is not faster (119 and 123, 107 and 104). So the size of the sheet is not a cost of a recalculation.
- The gain of "used" on ArrowDown, A, and scroll is almost the gain of "nocause": 21 rules.

The 21 rules (`results/bisect-has-star.json`, `show-causes.mjs`). The bisection put groups of the 94 rules with `:has()` and a `*` subject back into a sheet without them. With all rules, the largest layout of an ArrowDown is 55.6 ms. Without the 94 rules: 8.8 ms. Without only the 21 rules: 12.6 ms. Each of the 21 rules alone makes it 52 to 61 ms. Shapes:

```css
/* 12 rules: not-ui-choice-disabled:ui-choice-on:… */
.not-ui-choice-disabled\:ui-choice-on\:ak-layer-contrast:not(:is(:disabled, [aria-disabled="true"]), :where(label:has(:disabled, [aria-disabled="true"]), [aria-disabled="true"]) *):is(:checked, …)
/* 4 rules: group-ui-disabled-within/choice:… */
.group-ui-disabled-within\/choice\:ak-ink-0:is(:is(:where(.group\/choice):is(:disabled, …), :where(.group\/choice):has(:is(:disabled, [aria-disabled="true"]))) *)
/* 1 rule each: ui-disabled-within:**:ak-ink-0, ui-field-disabled:**:ak-ink-0, not-ui-choice-on:invisible, not-ui-choice-on:*:hidden!, not-ui-choice-disabled:group-hover/choice-field:… */
```

No element of the review page has one of these classes. They come from the recipes of the choice, field, and control primitives, which Tailwind finds in `src/components/ariakit/styles`. With one of them in the sheet, a change of the selected row makes Chrome recalculate the style of the whole list container during layout. The variant `nocq` shows the size of that work: one style recalculation of 1,234 elements, 53 ms. The trace does not count the elements of a recalculation that runs inside layout, so the count comes from that variant only.

The glider: `noglider` hides the highlight of the nav that moves with CSS anchor positioning. With it, a key press has 13 to 15 recalculations and 10 to 12 layouts (one for each frame of the transition). Without it: 3 to 5 layouts. In the scroll, layout goes from 181 ms (62 layouts) to 11 ms (11 layouts).

### C4. Fewer and more elements

`results-C4-scale.log`. Production, 1x, 5 runs. Load average 69 to 115, so compare the rows, not the values with A.

| List                                                   | Elements | S, next frame | ArrowDown, next frame         | First hover          | Scroll, style + layout |
| ------------------------------------------------------ | -------- | ------------- | ----------------------------- | -------------------- | ---------------------- |
| Scenario `changes`: 3 rows                             | 649      | 68            | 53                            | 0                    | 2                      |
| Scenario `large`: 41 rows                              | 1,742    | 59            | 94                            | 1                    | 1,007                  |
| Unchanged, folder `button` open: 23 folders + 106 rows | 1,140    | 72            | 215 (145 on the second press) | 60 (616 elements)    | 874                    |
| Unchanged, all 24 folders open: 585 rows               | 2,600    | 115           | 403                           | 275 (2,089 elements) | 3,662                  |

The list is not windowed. A changed row has 29 elements. An unchanged row has about 3. A folder row has 11 elements and 5,883 characters of class names.

### C5. Development against production, and script by owner

- Same interaction: see A. Script 4 to 5 times larger in development, style and layout equal.
- Modules: 348 script requests for one bare preview in development, 90 in production.
- CPU profile in development with no trace (`results/C5-profile-only-dev.cpuprofile`, 39 key presses, load average 600). Script time without the forced layout: 4,439 ms. React 68% (of it: element creation of the development build, `jsx` and `jsxDEV`, about 1,320 ms; performance track logging, about 455 ms). clava 13%. `@ariakit/react` 12%. Design code 2.7%. Copied primitives (`src/components/ariakit`) 1.8%. Router 0.4%. Lab chrome 0.1%.
- The first profile (`C5-profile-dev_bare_1.cpuprofile`) was recorded together with a trace. It has negative time deltas. Do not use it.
- Production: the chunks mix React, clava, and the primitives (`frame.ariakit.react-*.js` holds the React package), so the profile by chunk does not separate the owners.

## D. The real app

`results-D-web-41.log`. `apps/web` public preview, with the fixtures changed to 41 screenshots with 6 variants (698 elements, 5.4 elements for each row). Load average 30 to 40.

| Interaction                               | dev, 1x      | production, 1x | dev, 4x          | production, 4x |
| ----------------------------------------- | ------------ | -------------- | ---------------- | -------------- |
| D (difference), next frame                | 68           | 19             | 354              | 89             |
| ArrowDown, next frame                     | 108          | 34             | 556              | 159            |
| ArrowDown: script / style / layout        | 155 / 1 / 14 | 31 / 5 / 20    | 811 / 3 / 70     | 151 / 3 / 62   |
| Scroll, 10 steps: script / style / layout | 232 / 46 / 9 | 52 / 44 / 8    | 1,482 / 211 / 38 | 224 / 229 / 38 |

- The real app has the same development cost: 3.2 times slower than its production build for ArrowDown.
- In production, the real app is 2.5 times faster than the design for ArrowDown (34 against 84 ms) and 10 times cheaper for the scroll (104 against 1,009 ms of main-thread work). It has 698 elements against 1,742, and its list has no glider and no folder rows.
- Development CSS of the real app: 1,626,110 bytes for one request. Production: 464.78 kB.

## E. Conclusion

- The size of the generated CSS is not the cause. 74% fewer rules: no change of a full recalculation, 3 ms for the parse of each document. The CSS matters through 21 rules of one shape and through the nav glider, not through its size.
- The largest cause of what the maintainer feels is development mode with several live frames: 4,895 requests and 9 to 11 seconds of main-thread work for the gallery, and a script cost of each interaction that is 4 to 5 times the production cost.
- The settled review page in production at the size of a real run: see the returned answer.

## What I could not measure

- A free machine. Every time is from a machine with a load average of 16 to 850.
- Safari and Firefox. Only Chrome 154, headless. No GPU or compositor measurement.
- The fix itself. No source of the primitives or of `@ariakit/tailwind` was changed. The gain is from rules removed in the browser.
- The reason inside Blink why these 21 rules invalidate the whole container. It is shown by experiment only.
- The owners of script in production (the chunks mix them).
- The scale table at 4x CPU, and the real app at 626 rows.
- `frames.mjs`: the split of cold load, warm load, and idle is wrong for the views with lazy frames, because its ready rule ended before the frames had loaded. Only its theme switch numbers are used. `load-all.mjs` replaced it for loads, with 3 runs and not 5.
- The shared server: 2 runs only, by the rule of this lane.
- Real screenshots in the real app: the preview fixtures use small SVG images.
