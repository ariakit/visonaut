# Design lab, round 4: two speed answers of the audit

The maintainer asked on 2026-10-07 why the lab is slow. The audit measured it (`apps/lab/audit/reports/perf`) and asked three questions: D-PERF-01, D-PERF-02, and D-PERF-03. The maintainer answered them in feedback round 5 of the audit document, each with the recommended option and with no note. Two of the answers change the lab. This file says what changed, why, what was measured, and what left the lab. Round 3 is in [round-3.md](./round-3.md).

The record revision stays `r3`. `src/lab/record.ts` gets a new revision when an agent merges lab feedback into `INCORPORATED_FEEDBACK`. Round 4 merged no lab feedback. The two answers are decisions of the audit record, and they change no pick and no note of the 30 lab decisions. A new revision would start a feedback round in each browser with nothing new in it.

- [The three answers](#the-three-answers)
- [The list has the bar glider only](#the-list-has-the-bar-glider-only)
- [The other lists keep their gliders](#the-other-lists-keep-their-gliders)
- [The cards show pictures](#the-cards-show-pictures)
- [The capture command](#the-capture-command)
- [What left the lab](#what-left-the-lab)
- [Where the earlier versions are](#where-the-earlier-versions-are)
- [Checks](#checks)
- [What this round did not do](#what-this-round-did-not-do)

Each number below has a label: measured (a script ran, and its result file is named), counted (read from code or from a page), or assumption. The folder of the scripts and the results is `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round6/r4`. A name such as `M2` is a result file in its folder `results`. The machine was not quiet: other agent sessions ran. Each row has its load average on 14 cores. Read a time as a ratio between two forms that ran in turns. A count does not change with the load.

## The three answers

| Decision  | Question                                                                                     | Answer                                                      | In the lab                                                              |
| --------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| D-PERF-01 | Which gliders does the screenshot list of the review page have?                              | `bar-only`: The bar glider only                             | Built in this round                                                     |
| D-PERF-02 | Does `apps/web` get a test for the speed of the review page when the settled design goes in? | `count-test`: A test of the count                           | Not built. The test comes with the implementation, which is not started |
| D-PERF-03 | Does the gallery of the lab show pictures in place of live frames?                           | `pictures`: Pictures in the gallery and the directions page | Built in this round                                                     |

## The list has the bar glider only

The screenshot list of the review page had four gliders. It has one now. The file is `src/explorations/kits/ariakit/list/screenshot-list.tsx`, and the two `Nav` elements of the list (the rows with a change, and the folders of the unchanged screenshots) take the same prop.

```tsx
// Before
const gliders: NavGliderProps[] = [
  { $state: "hover" },
  {},
  { $state: "focus" },
  { $kind: "bar", $side: "end", $barOffset: "frame" },
];

// After
const barGlider: NavGliderProps = { $kind: "bar", $side: "end", $barOffset: "frame" };
```

- **What stays.** The bar of the selected row, on the edge of the main panel, as the note of round 1 asks. It still travels between rows.
- **What each row does now.** It draws its own hover surface, selected surface, and focus ring. These come from the stock `NavLink`. No file below `src/components/ariakit` changed.
- **Why.** With a hover glider in the list, one key makes Chrome compute the style of each row again. The cause is a rule shape of the stock nav recipe (`styles/nav.ts`, the hover rules of the glider). The bar glider does not have this cost.
- **What it gives up.** Only the bar travels between rows. In a folder, the focus ring of a row and of a folder button is 3 px inside the row. The list no longer has the hover glider and the focus glider of the direction document (`directions/ariakit.md`, sections 2.7 and "Regions and primitives"). Both places have a note now.
- **The catalog.** The review page has one more line in its tradeoffs, so the page explorer says it.

### Measured: the style work of one key

The largest style recalculation of one key press, as Chrome reports it (`UpdateLayoutTree`, `elementCount`), with the size containers of the page off. Production form (`vite build`, then `vite preview`): the lab before the change on port 4371 and the lab after it on port 4372, in turns. Script: `measure.mjs`.

| Page                                              | Key       | Before | After | Runs                               | Load average |
| ------------------------------------------------- | --------- | ------ | ----- | ---------------------------------- | ------------ |
| Scenario `changes`: 3 rows, 641 elements          | ArrowDown | 173    | 119   | 10 of 10 equal (`M1`, `M3`)        | 4.4 to 12.3  |
|                                                   | Approve   | 258    | 158   | 10 of 10 equal                     |              |
| Scenario `large`: 41 rows, 1,734 elements         | ArrowDown | 1,216  | 69    | 3 of 3 equal (`M5`)                | 4.3 to 5.9   |
| The keys in the order of the audit lane           | Approve   | 1,345  | 156   | 3 of 3 equal                       |              |
| Scenario `large`, each count on a page of its own | ArrowDown | 1,216  | 66    | 6 of 10 runs, 97 in 4 (`M2`, `M4`) | 4.2 to 10.9  |
|                                                   | Approve   | 1,350  | 189   | 10 of 10 equal                     |              |

- The address `?scenario=changes&data=decided&theme=dark` has 3 rows. The numbers of the audit record (1,217 and 1,345 before, 70 and 156 after) are for the scenario `large` with 41 rows. `M5` repeats them: 1,216 for ArrowDown and 1,217 for ArrowUp before, 69 and 70 after, and 1,345 and 156 for Approve.
- The count of Approve depends on what the page did before. The audit lane counted the second approval of a page (156). The first approval of a page also shows the first receipt and enables Undo (189).
- The count also depends on the row. The independent review pressed ArrowDown on each row of the list: 1,216 to 1,234 before, and 66 to 122 after. [Checks](#checks) has the numbers.
- The number is the largest single recalculation. The sum of the recalculations of one key changes with the place of the pointer, so it is not in the table.

The times of the same runs, as a median with the range in brackets. "Next frame" is the time from the key to the end of the next frame commit.

| Scenario `large`, 41 rows                 | Before           | After            | Result file | Load average |
| ----------------------------------------- | ---------------- | ---------------- | ----------- | ------------ |
| Arrow key, next frame                     | 85 ms [77-96]    | 34 ms [30-50]    | `M2`        | 4.2 to 7.4   |
| Approve, next frame                       | 109 ms [96-115]  | 59 ms [47-61]    |             |              |
| Pointer over 6 rows, style and layout     | 418 ms [408-435] | 27 ms [24-36]    |             |              |
| 10 wheel steps, style and layout          | 776 ms [757-802] | 61 ms [60-69]    |             |              |
| Arrow key, next frame, CPU slowed 4 times | 335 ms [314-372] | 132 ms [119-136] | `M4`        | 5.4 to 10.9  |
| Approve, next frame, CPU slowed 4 times   | 408 ms [393-468] | 201 ms [186-214] |             |              |

With 3 rows (`M1`, `M3`) the gain is small: 52 ms against 48 ms for an arrow key, and 214 ms against 189 ms with the CPU slowed 4 times. The cost of the hover glider grows with the number of rows.

### Measured: the pictures of the list

Script: `pics.mjs`. Each picture is the list with 24 px around it (322,000 pixels), in the production form, before and after. A pixel differs when one channel differs by more than 2. Each state was taken in the scenarios `changes` and `large`, in the dark and in the light theme: 48 pairs (`P1` to `P4`). The build session looked at each pair that differs.

| State                                             | Pixels that differ    | What differs                                                          |
| ------------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| Nothing focused, after the load                   | 0                     |                                                                       |
| A selected row                                    | 0                     |                                                                       |
| Pointer on a row                                  | 0                     |                                                                       |
| Pointer on the selected row                       | 56 (dark), 64 (light) | The four corners of the row: the edge of the round corner             |
| Pointer out of the list                           | 0                     |                                                                       |
| Keyboard focus on a row                           | 0                     |                                                                       |
| Keyboard focus on a row, pointer on another row   | 0                     |                                                                       |
| Keyboard focus on the selected row, pointer on it | 56 (dark), 64 (light) | The same corners                                                      |
| A folder open                                     | 0                     |                                                                       |
| A folder open, keyboard focus on a row in it      | 2,584                 | The focus ring is 3 px inside the row. Before, it was outside the row |
| The same, pointer on another row of the folder    | 2,584                 | The same ring. The hover surface is equal                             |
| Keyboard focus on a folder button                 | 2,792                 | The focus ring is 3 px inside the button                              |

The numbers are equal in both scenarios. A second set of the "before" pictures gives the noise of the method: 0 pixels in 47 of 48 pairs, and 8 pixels in one pair, in a row picture at the bottom of the list. Motion is not in a picture: before, the hover surface, the selected surface, and the focus ring traveled from row to row.

## The other lists keep their gliders

Round 4 changed the screenshot list only. These places of the lab still have a hover glider. The rows are counted in the built pages, in the data mode Decided API (scripts `hover-gliders.mjs` and `cover-count.mjs`, results `H1` and `H2`). Nobody measured the style work of these places.

| Place                                   | Code                                     | Gliders                  | Rows in the fixtures                                                          |
| --------------------------------------- | ---------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| Page nav of the header                  | `kits/ariakit/shell.tsx`, `MainNav`      | hover, bar               | 3, on the Queue, History, Status, and the pull request page                   |
| Run rows of the Queue                   | `kits/ariakit/run-row.tsx`, `RunRowList` | hover, focus             | 3, 2, and 2 in three groups (scenario `busy`)                                 |
| Run rows of History                     | The same                                 | hover, focus             | 13, 10, 7, 6, and 5 in five groups: 41 rows (scenario `full`)                 |
| Pager marks of the variant row          | `kits/ariakit/variants/pager.tsx`        | selected, hover, focus   | 3 to 6. A screenshot with more than 8 variants has one mark for each state    |
| Cover cells of the review page          | `pages/review/ariakit/cover.tsx`         | selected, hover, focus   | 1 to 6 for the first screenshot of each scenario. The cover shows after "All" |
| Reference surface Status mark, compact  | `components/status-mark/pill.tsx`        | hover, focus             | 5 run rows, and 6 marks with a selected glider                                |
| Reference surface Error state           | The run rows of the kit                  | hover, focus             | 3 (scenarios `stale-list` and `out-of-date`)                                  |
| Guide of the primitives, the index nav  | `lab/primitives/reference-index.tsx`     | hover, selected          | 41                                                                            |
| Guide of the primitives, three examples | `lab/primitives/*.tsx`                   | hover with other gliders | 3 each                                                                        |

The lab chrome of the gallery, the directions page, the feedback page, and the explorers has no hover glider.

## The cards show pictures

A card of the gallery (`/`) and of the directions pages (`/directions` and `/directions/$direction`) showed its surface in a live frame: one more complete app for each card. A card shows a picture file now. The page explorer keeps its live frame. The component explorer did not change: it renders each variant live in the page, with no frame. A card keeps its link, its name, its badge, and its place.

```tsx
// src/lab/ui/surface-card.tsx: one picture for each theme, and the theme of the page hides the other one
<img
  src="/cards/page/inbox/ariakit.dark.png"
  width={1280}
  height={800}
  alt=""
  loading="lazy"
  decoding="async"
  className="absolute inset-0 size-full not-dark:hidden"
/>
```

- **Theme.** A card follows the theme control. Each card has a dark and a light picture, and CSS shows the one of the current theme. The server does not know the saved theme, so it renders both elements.
- **Other look controls.** A card does not follow the brand, the canvas, the radius, the density, and the data mode. Its picture has the default look and the data mode Decided API. The Look menu says so in one line, only on the pages with cards: "The pictures of the cards follow the theme only." The gallery itself has no new text.
- **Lazy loading.** Each picture is lazy, also at the top of the page. The picture of the hidden theme is then not requested: Chrome does not load a lazy picture that has no box. The other theme loads when the theme changes.
- **No layout shift.** The box of a picture has its aspect ratio before the file loads, and the picture has its `width` and `height`.
- **Alt text.** The `alt` is empty, because the title of the card is beside the picture and the link of the card has that title as its name.
- **A missing file.** A picture that does not load leaves the box empty, in the canvas color. The card keeps its size, its name, and its link.
- **Size.** A page picture has 1,280 by 800 pixels. A reference picture has 1,440 by 900 pixels: its preview is smaller, so the capture has 2 or 3 pixels for each CSS pixel. The widest card is 560 px, on a screen with two device pixels for each CSS pixel, so a picture never scales up.

### Measured: the load of the gallery and of the directions page

Script: `gallery.mjs`. One load is one new browser context at 1440 by 900. "Network idle" is the time until the page and its frames had no request for 500 ms, and it includes those 500 ms. "Last long task" is the end of the last task above 50 ms on the main thread. Each cell is the median of 5 loads with the range in brackets.

| Page and form                                      | Requests            | Network idle    | Last long task ends          | Result | Load average |
| -------------------------------------------------- | ------------------- | --------------- | ---------------------------- | ------ | ------------ |
| Gallery, development server (4320), 10 live frames | 3,191 [3,187-3,194] | 2.2 s [2.2-3.3] | 4.3 s [3.8-5.0]              | `G1`   | 7.1 to 8.2   |
| The same with the frame documents blocked          | 223                 | 0.9 s [0.9-1.0] | No long task                 | `G1`   | 7.6 to 12.2  |
| Gallery, development server, pictures              | 222 [222-306]       | 0.8 s [0.7-1.7] | No long task                 | `G3`   | 15.2 to 18.2 |
| Directions, development server, 6 live frames      | 2,002 [2,002-2,004] | 1.6 s [1.5-1.7] | 1.8 s [1.7-2.0]              | `G2`   | 8.8 to 11.2  |
| Directions, development server, pictures           | 221                 | 0.8 s [0.7-0.8] | No long task                 | `G4`   | 13.9 to 15.2 |
| Gallery, production form, 10 live frames (4371)    | 847 [846-851]       | 2.3 s [2.1-2.9] | 1.7 s [1.4-2.3]              | `G5`   | 12.6 to 20.3 |
| Gallery, production form, pictures (4372)          | 69                  | 0.6 s [0.6-0.7] | No long task                 | `G5`   | 12.9 to 20.3 |
| Directions, production form, 6 live frames (4371)  | 532 [532-535]       | 1.5 s [1.5-1.7] | 0.9 s [0.9-1.0]              | `G6`   | 14.6 to 17.9 |
| Directions, production form, pictures (4372)       | 67                  | 0.6 s [0.6-0.7] | No long task in 4 of 5 loads | `G6`   | 14.2 to 17.9 |

- The "before" rows of the development server were measured before the first change. The two production servers ran in turns.
- The gallery requests 10 picture files, and the directions page 6: the pictures of one theme. In the production form the gallery transfers 1.8 MB with pictures, against 3.6 MB with live frames (`G5`).
- One of the five loads of `G3` had 306 requests and 20 picture requests. Six more loads had 222 requests, 10 dark pictures, and no light picture (`dev-probe.mjs`). The cause was not found. Assumption: the development server reloaded the page during that load.
- One load of `G6` with pictures had one long task of 59 ms.
- Each request of these scripts is a GET request.

## The capture command

```sh
pnpm --filter @visonaut/lab capture
pnpm --filter @visonaut/lab capture --origin http://127.0.0.1:4371
```

The command is `scripts/capture-cards.ts`. Node runs the TypeScript file directly.

- **One list.** The command reads the catalog of the lab (`src/lab/catalog.ts`). `src/lab/card-pictures.ts` gives the path, the size, and the preview address of a picture to the command and to the card. A new surface or variant gets its pictures with no second list.
- **What it reads.** A lab server that runs: `http://127.0.0.1:4320`, or the origin of `--origin`. It opens the bare preview of each variant in Chrome through the Playwright of the repository. It sends GET requests only, and it stops each other request.
- **What it writes.** `public/cards/<kind>/<surface id>/<variant id>.<theme>.png`. Now: 20 files for 10 surfaces, 1.1 MB together.
- **When a picture is taken.** A preview changes after its load: a fixture answers after 1.5 s at most, and the reference surface Error state counts down to a retry. The command holds the clock of the preview (the clock of Playwright). It stops the clock before the load, and it moves the clock by 2.5 seconds after the load. So a picture shows the same moment on a fast and on a slow machine. Then the picture is the first one that stays equal for 1 second. Animations are stopped for the picture.
- **How equal two captures are.** Measured (`C1`): of two captures in a row from the production form, 18 of 20 files are equal byte for byte. One file differs in 1 pixel, and one by 1 step of 255 in a color channel. A capture from the development server and a capture from the production form have 9 equal files, and the other 11 differ by 1 or 2 steps in a channel. So use one form of the server for each capture. One capture needs 70 to 80 seconds at a load average of 7 to 12.
- **Limits that the command keeps.** It removes a file of `public/cards` that no card uses. It ends with an error when a picture fails, or when the pictures together have 3 MB or more.
- **Dependencies.** The lab does not declare Playwright. The command finds the package of the repository root. A dependency of the lab changes `pnpm-lock.yaml`, which was outside this round.
- **Type check.** `tsconfig.json` of the lab includes `scripts`, so `pnpm --filter @visonaut/lab typecheck` reads the command.

Run the command after a change that a card must show: a new surface, a new variant, another first scenario, or a design change of a page.

## What left the lab

No file left the lab. These parts left their file:

- `src/lab/ui/surface-card.tsx`: the live frame of a thumbnail (`PreviewFrame` with `still` and `lazy`, and the preview address from `usePreviewHref`), and `getThumbnailSize`. The size is `getCardViewport` in `src/lab/card-pictures.ts` now.
- `src/explorations/kits/ariakit/list/screenshot-list.tsx`: the hover glider, the selected glider, and the focus glider of the list.

`PreviewFrame` stays with all its props: the page explorer uses it, also with `still` and `lazy` for the side by side view.

What a card no longer does: it does not show a change of the source at once, and it does not follow the look controls other than the theme.

## Where the earlier versions are

`apps/lab` is not tracked by git. The version before round 4 of each changed file has a copy in the scratch folder of the build session, with its path below `apps/lab`:

```text
/Users/diegohaz/.claude/jobs/f65a6229/tmp/design/parked-r4/
  changed/...    The version of round 3 of each file that round 4 changed.
```

The scratch folder is deleted with the job.

## Checks

- **Code.** The lint of the repository (`oxlint`), the type check of the lab, and the build of the lab are clean, and each file of this round passes the format check. `pnpm lint` as a whole failed at the time of the check: its format check named one file that another session was editing, `apps/lab/audit/content/decisions.json`. The smoke check of each surface in each scenario and data mode finds no problem (212 responses).
- **Pages.** The gallery, the directions page, one direction, and the bare review page were loaded at 1440 by 900 and at 400 by 800, in both themes, in the production form: 16 pictures (`S1`, script `page-shots.mjs`). No console error, no failed request, no page that scrolls sideways, no frame in a card, each picture of the current theme loaded, and no picture of the other theme loaded. The build session looked at the pictures.
- **Theme control.** On the gallery and on the directions page, the first press of the theme button shows the light pictures and requests them. The second press shows the dark pictures with no new request (`X2`).
- **A missing file.** With HTTP 404 for the two pictures of one card, that card has an empty box, no mark of a broken image, and each of the 10 cards has the same box as before (`X1`).
- **Layout shift.** The gallery has a layout shift of 0 to 0.0001 at its load, before and after the change. The directions pages have a shift of 0.008 to 0.048 in some loads, before and after the change: the text above the cards moves down by 20 px. It is older than this round, and no picture is a source of it (`S2`).
- **Look menu.** The line about the pictures shows on the gallery and on the two directions pages, at 1440 px and at 400 px. It does not show on an explorer page and on the feedback page (`X3`).
- **Development server.** A file that is added, changed, or removed below `public` does not reload an open page (`public-reload.mjs`: 0 navigations in 3 steps). So a capture does not disturb an open lab page.

An independent review then checked the round again, with its own scripts and its own builds. Its folder is `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round6/review`, and a name such as `R5` is a file in its folder `results`. Each number below is measured, unless it has another label. The "before" build is from the source copy of the audit lane (06:41 on 2026-10-07), on port 4376. The "after" build is on port 4375.

- **Source.** Counted: against that copy, 5 source files differ and 1 is new (`card-pictures.ts`). No file below `src/components/ariakit` differs, and `src/lab/record.ts` is equal. The page explorer and the component explorer did not change.
- **Count, in the order of the audit lane.** 1,216, 1,217, and 1,345 before, and 69, 70, and 156 after, for ArrowDown, ArrowUp, and Approve: 20 of 20 pages for each form (`R1`, `R4`, `R5`, `R6`, load average 3 to 103). One exception: Approve before the change is 1,348 on the 10 pages whose timed part ran with the CPU slowed 4 times.
- **The count depends on the row.** One ArrowDown for each of 39 rows of a page, 3 pages for each form (`R2`, load average 7 to 13): 1,216 to 1,234 before, and 66 to 122 after. After, the count grows by about 1 for each row down the list. The same key gave 66 on one page and 97 on another. The first approval of a page: 1,349 before. After: 156 at the end of a walk through the list, and 190 after three arrow keys (one page, `recalc-debug.mjs`). A later approval: 1,255 to 1,266 before, and 64 to 125 after. The largest count after the change is 190, and the smallest before is 1,216, so a limit of 300 separates the two forms on each row.
- **Times.** Median with the range in brackets, 5 pages for each form in turns, 41 rows.

  | Step                                      | Before, low load | After, low load  | Before, high load | After, high load |
  | ----------------------------------------- | ---------------- | ---------------- | ----------------- | ---------------- |
  | Arrow key, next frame                     | 90 ms [76-101]   | 35 ms [30-48]    | 82 ms [78-97]     | 36 ms [31-44]    |
  | Approve, next frame                       | 112 ms [98-119]  | 53 ms [47-63]    | 102 ms [95-113]   | 55 ms [50-69]    |
  | Pointer over 6 rows, style and layout     | 423 ms [416-445] | 22 ms [19-26]    | 428 ms [418-440]  | 22 ms [19-30]    |
  | 10 wheel steps, style and layout          | 817 ms [728-881] | 66 ms [56-72]    | 840 ms [732-926]  | 63 ms [58-80]    |
  | Arrow key, next frame, CPU slowed 4 times | 331 ms [314-395] | 131 ms [113-137] | 523 ms [431-671]  | 193 ms [153-221] |
  | Approve, next frame, CPU slowed 4 times   | 404 ms [379-468] | 189 ms [181-193] | 599 ms [552-656]  | 300 ms [274-336] |
  | Pointer over 6 rows, CPU slowed 4 times   | 1,484 ms         | 50 ms            | 2,100 ms          | 78 ms            |
  | 10 wheel steps, CPU slowed 4 times        | 3,080 ms         | 228 ms           | 4,570 ms          | 364 ms           |

  Low load: `R5` (load average 3 to 4.5) and `R6` (4.3 to 6.1). High load: `R1` (9.6 to 14.8) and `R4` (54 to 103). The ratio of the two forms stays at 0.37 to 0.44 for the arrow key and at 0.47 to 0.54 for Approve. With the CPU slowed 4 times, Approve is at 189 ms at a low load and at 300 ms at a load average of 54 to 103.

- **Pictures of the list.** 41 rows and each folder open (585 rows), dark and light, 8 and 10 states: 36 pairs (`P1` to `P4`, load average 54 to 99). The result is the table above: 0 pixels in each state without a keyboard focus in a folder and without the pointer on the selected row, 48 to 64 pixels with the pointer on the selected row (a channel differs by 3 to 5 of 255), 2,584 pixels with the keyboard focus on a row in a folder, and 2,792 on a folder button. A second "before" set: 0 pixels in 36 of 36 pairs. Against a new build of the form "bar" of the audit lane (`tmp/perf/record/lab-bar`): 0 pixels in 18 of 18 states (`P5`, `P6`).
- **Other gliders.** The glider elements of 17 routes, before and after (`H1`): only the list "Screenshots" of the review page differs, 4 before and 1 after. Each other group of gliders on these routes has the same number.
- **Load of the pages**, 5 loads for each form in turns after one load that is not counted (`L3`, `L4`, load average 4 to 6). "Network end" is the end of the last response before 1.5 seconds with no request, and no wait is in the number.

  | Page and form                                         | Requests            | Network end        | Last long task ends |
  | ----------------------------------------------------- | ------------------- | ------------------ | ------------------- |
  | Gallery, development server of port 4320, pictures    | 222                 | 0.23 s [0.22-0.28] | No long task        |
  | Gallery, development server of the "before" copy      | 3,187 [3,186-3,188] | 3.80 s [3.65-3.90] | 3.71 s [3.56-3.86]  |
  | Gallery, production form, pictures                    | 69                  | 0.11 s [0.10-0.12] | No long task        |
  | Gallery, production form, 10 live frames              | 848 [845-850]       | 3.09 s [3.04-3.12] | 1.48 s [1.36-1.68]  |
  | Directions, development server of port 4320, pictures | 221                 | 0.23 s [0.22-0.23] | No long task        |
  | Directions, development server of the "before" copy   | 2,000 [1,998-2,000] | 1.88 s [1.83-1.91] | 1.74 s [1.70-1.78]  |
  | Directions, production form, pictures                 | 67                  | 0.11 s [0.11-0.12] | No long task        |
  | Directions, production form, 6 live frames            | 532 [532-533]       | 1.01 s [0.91-1.02] | 0.93 s [0.83-0.94]  |

  The same runs at a load average of 49 to 87 (`L1`, `L2`): the request numbers are equal. The gallery needs 0.54 s against 6.07 s on a development server, and 0.27 s against 5.18 s in the production form. No load of port 4320 had more than 222 requests or more than 10 picture requests (12 loads of the gallery).

- **Cards.** The gallery, the directions page, and one direction at 1440 and 400 px in both themes, in the production form and on port 4320: 24 page states with no problem (`S1`). No console error, no failed request, no page that scrolls sideways, no frame, each picture of the shown theme loaded, no picture of the hidden theme requested, no picture with another aspect ratio than its file, and 3.6 to 4.3 picture pixels for each CSS pixel. The layout shift of the directions page (0.009 at 1440 px and 0.048 at 400 px) is equal in the "before" form (`S2`). The reviewer looked at the pictures of the pages before and after.
- **Card behavior** (`B1` production form, `B2` port 4320, equal results). The first press of the theme button requests the pictures of the other theme, and later presses request nothing. A picture that answers with HTTP 404, with a failed request, or with a document that is not a picture leaves an empty box of the same size, in both themes. Each card is one link with the title of its surface as its name, each of the 20 pictures has an empty `alt`, and the accessibility tree of the gallery has 10 links and no image. Tab from the filter moves to the first card with a focus ring of 2 px inside the card, and Enter opens its explorer. The page explorer has its live frame. The Look menu has its sentence on the three routes with cards only.
- **Capture.** The command of the round, run in scratch copies of the lab. Two runs in a row against port 4320: 19 of 20 files equal byte for byte, and one file with 2 pixels that differ by 1 of 255 (`C3`). Against the 20 files of `public/cards`: 18 equal, and 2 files with 2 such pixels (`C1`), so the pictures of the lab show the current design. Production form against port 4320: 9 of 20 equal, and no pixel differs by more than 2 of 255 (`C2`). Through a proxy that counts methods: 1,584 requests, each a GET request (`proxy-cap3.json`). One run needs 85 to 110 seconds at a load average of 27 to 62. With no server on the port, the command ends with exit code 1 and keeps the 20 pictures. It removes a file that no card uses (`logs/cap4.log`).
- **Commands.** `pnpm lint` passes as a whole now (exit 0, 1,466 files), and the type check, the build (sheet of 430,141 bytes), and the smoke check (212 responses, 0 problems) pass.
- **Repairs of the review.** Two, and neither changes a page. The capture command has braces around one `if` body that returns a call, as the code rules ask. This file and the README said that the component explorer keeps a live frame. It has no frame: it renders each variant in the page, before and after this round.
- **Not repaired, because each needs a choice.** The lab does not declare `@playwright/test`, which the capture command imports: a declaration changes `pnpm-lock.yaml`. Nothing warns when a picture is older than its page. The text of D-PERF-03 in the audit record says that a card does not follow the theme, and that the component explorer has a live frame.

## What this round did not do

- It did not build the test of D-PERF-02. That test belongs to `apps/web`.
- It did not change a primitive. The rule shape that makes a hover glider expensive is still in `src/components/ariakit/styles/nav.ts`.
- It did not change another list. The table above names them.
- It did not change the lab record: no pick, no note, no decision identifier, and no revision.
- It did not change the audit document or anything below `apps/lab/audit`.
- It did not make a card follow the brand, the canvas, the radius, the density, or the data mode. That needs one picture for each combination.
- It used Chrome only, on one machine that was not quiet.
