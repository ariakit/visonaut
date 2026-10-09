# Lane "dev-loop": the development server and the load path of the lab

Working record. Date: 2026-10-07, 04:17 to 05:15 local time. Machine: the maintainer's Mac, with other agent sessions on it.

Each fact has a kind: **measured** (a timing of this session), **counted** (a number that does not depend on the machine load), **documented** (read in source code), **estimate**, or **assumption**.

## 1. Rules that I followed

- No file was written below the worktree. `git status --short` at the end shows the same two lines as at the start (`M pnpm-lock.yaml`, `?? apps/lab/`).
- All experiments ran on copies in this folder: `lab-copy/` and `web-copy/`.
- Servers of this lane used ports 4351 to 4354. All are stopped. `lsof -nP -iTCP:4351-4359 -sTCP:LISTEN` returns nothing. The shared server on port 4320 still runs. I did not stop it.
- The shared server got only light requests: one idle page for 5 minutes, three more idle pages (20 s, 150 s, 100 s), and 20 document requests.
- No request went to `visonaut.com`.

## 2. The copies

| Copy        | Made with                                                                         | Differences from the repository |
| ----------- | --------------------------------------------------------------------------------- | ------------------------------- |
| `lab-copy/` | `zsh make-copy.sh lab lab-copy` at 04:18:45, then `zsh git-init-copy.sh lab-copy` | See below                       |
| `web-copy/` | `zsh make-copy.sh web web-copy` at 04:25:59, then `zsh git-init-copy.sh web-copy` | See below                       |

Differences, all in the copies only:

1. `node_modules` is a real folder with one absolute symbolic link for each entry of the app's `node_modules`. So Vite writes `.vite`, `.vite-temp`, and `.mf` into the copy.
2. `tsconfig.json` extends the root `tsconfig.json` by an absolute path.
3. The copy is its own git repository (`git init`) with the ignore rules of the repository root plus the rules of the app. So the Tailwind scanner skips the same folders (`dist`, `.wrangler`, `public/audit`).
4. `vite.config.ts` has `server.fs.allow` with the copy and the worktree. Without it, Vite refused the font files of `@fontsource-variable` (they are in the pnpm store, outside the copy). In the repository, Vite finds the pnpm workspace root and allows it.
5. `lab-copy/src/lab/record.ts` has one more line: `export const settledLabel = getSettledLabel(1);`. Reason: another agent changed `record.ts` at 04:18:39, 6 seconds before the copy. The other files of the copy are from before that change and import `settledLabel`. Without the line, the client failed with `SyntaxError: The requested module '/src/lab/record.ts' does not provide an export named 'settledLabel'`.
6. `web-copy/.dev.vars` has `VISONAUT_ORIGIN=http://127.0.0.1:4354`. The file had only this variable. The preview mode of `src/server.ts` answers 403 when the request origin is not `VISONAUT_ORIGIN`.
7. `lab-copy/vite.nofresh.config.ts` is new: the lab configuration without the plugin `freshStyles`, with its own `cacheDir`.
8. `lab-copy/src/styles.css` now has `@import "tailwindcss" source(".");`. This is the last experiment (section 9.4). All earlier results used the original line `@import "tailwindcss";`.

The copy of the lab is the lab of round 2: 15 gallery cards (5 open choices, 6 pages, 4 reference surfaces). The build of the copy gives `dist/client/assets/styles-_WVGwkaQ.css` with 475,107 bytes. This is the same file name and size as the build in the repository (**counted**). So the copy has the same CSS as the lab that the maintainer used.

After 04:19 the other agents removed the open choices from `apps/lab/src` (round 3). The shared server now shows that smaller lab.

## 3. Scripts

| Script                                                                | Purpose                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make-copy.sh`, `git-init-copy.sh`                                    | Make a copy of an app.                                                                                                                                                                                                                      |
| `launch.mjs`, `stop.mjs`                                              | Start a Vite command in a copy with a time-stamped log in `logs/`, and stop it.                                                                                                                                                             |
| `measure-load.mjs`                                                    | Load routes in Chrome (Playwright, channel `chrome`, CDP). Records each request, the marks of each frame, and the renderer counters. Each run: a new context (empty browser cache), then a reload. Several origins or `--pairs` take turns. |
| `summarize.mjs`, `table.mjs`, `analyze-run.mjs`, `group-requests.mjs` | Read the results of `measure-load.mjs`.                                                                                                                                                                                                     |
| `cold-cycle.mjs`                                                      | Start a server, load one route one time, stop the server.                                                                                                                                                                                   |
| `trace-load.mjs`                                                      | Chrome trace of a load. Sums the self time of each kind of event on the renderer main thread.                                                                                                                                               |
| `measure-hmr.mjs`, `hmr-table.mjs`                                    | Change one file of a copy and measure the way of the change to the browser.                                                                                                                                                                 |
| `check-switch.mjs`                                                    | Scenario switch and theme toggle: reload or message?                                                                                                                                                                                        |
| `watch-shared.mjs`                                                    | One idle page on the shared server. Records the messages of the Vite socket, the document loads, the requests of the style sheet, and the file changes below `apps/lab` (`fs.watch`, read-only).                                            |
| `time-docs.mjs`                                                       | A few timed document requests without a browser.                                                                                                                                                                                            |
| `count-scan.mjs`                                                      | Counts the files that the Tailwind scanner reads (`@tailwindcss/oxide`, the scanner of the Vite plugin).                                                                                                                                    |
| `tailwind-times.mjs`                                                  | Reads the Tailwind timing lines (`DEBUG=tailwindcss`) of a server log.                                                                                                                                                                      |

Meaning of the marks of `measure-load.mjs`:

- **document wait**: from the end of the request to the response headers of the document. This is the server rendering in workerd.
- **top hydrated**: React has marked the last element of the top document (`__reactFiber$` key). 10 ms resolution.
- **usable**: the later of "top hydrated" and "the last frame hydrated". For a frame whose last element React never marks, the load event of the frame is used.
- **main thread task ms**, **script ms**, **style ms**, **layout ms**: `Performance.getMetrics` of CDP after the load (`TaskDuration`, `ScriptDuration`, `RecalcStyleDuration`, `LayoutDuration`). All same-origin frames are on the same main thread.
- **body**: decoded bytes. **transfer**: bytes on the wire.

## 4. Commands and raw result files

All results are in `results/`. All logs are in `logs/`.

| #   | Time                | Command (all with `node <script>`)                                                                                                                                                                                  | Result file                                                 | Load averages (start; end)           |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| 1   | 04:19               | `watch-shared.mjs 300 /feedback watch-shared-1`                                                                                                                                                                     | `watch-shared-1.json`                                       | 8.48 11.82 10.56; 12.62 16.14 13.28  |
| 2   | 04:22               | `measure-load.mjs --label=lab-dev-cold-nodeps --runs=1 --paths=/,/pages/review,/preview/page/review/ariakit` (server started with no `node_modules/.vite`)                                                          | `lab-dev-cold-nodeps.json`                                  | 14 to 30                             |
| 3   | 04:24               | `measure-load.mjs --label=lab-dev-warm --runs=5 --paths=<same>`                                                                                                                                                     | `lab-dev-warm.json`                                         | 19.28 17.67 13.59; 67.21 28.88 18.23 |
| 4   | 04:27               | `measure-load.mjs --label=lab-dev-warm-more --runs=3 --paths=/pages/review-variants?compare=1,/directions,/components/row-picture,/components/status-mark,/feedback,/pages/inbox`                                   | `lab-dev-warm-more.json`                                    | 42.85 27.40 18.18; 24.11 25.88 18.65 |
| 5   | 04:29               | `launch.mjs lab-build <copy> build`, then `launch.mjs lab-preview <copy> preview --port 4353`                                                                                                                       | `logs/lab-build.log`                                        | -                                    |
| 6   | 04:29               | `measure-load.mjs --origin=<dev 4351>,<production 4353> --label=lab-dev-vs-prod --runs=5 --paths=/,/pages/review,/preview/page/review/ariakit,/pages/review-variants?compare=1,/directions,/components/row-picture` | `lab-dev-vs-prod.json`                                      | 47.60 30.92 20.78; 22.66 23.79 21.23 |
| 7   | 04:26, 04:31, 04:35 | `watch-shared.mjs 20 /feedback wait-a`, `watch-shared.mjs 150 /feedback watch-shared-2`, `watch-shared.mjs 100 /feedback watch-shared-3`                                                                            | `wait-a.json`, `watch-shared-2.json`, `watch-shared-3.json` | about 22 to 67                       |
| 8   | 04:38               | `trace-load.mjs --origin=<4351>,<4353> --label=trace-dev-vs-prod --runs=3 --paths=/preview/page/review/ariakit,/components/row-picture,/`                                                                           | `trace-dev-vs-prod.json`                                    | 16.66 to 24.33                       |
| 9   | 04:41               | `cold-cycle.mjs --port=4352 --label=lab-dev-cold --cycles=5 --paths=/,/pages/review,/preview/page/review/ariakit`                                                                                                   | `lab-dev-cold.json`                                         | 29.48 25.52 22.37; 16.16 22.18 21.93 |
| 10  | 04:45               | `measure-hmr.mjs --origin=<4351 default>,<4352 without freshStyles> --passes=2 --label=hmr-fresh-vs-nofresh-preview --runs=3 --pages=/preview/page/review/ariakit --files=<3 files>`                                | `hmr-fresh-vs-nofresh-preview.json`                         | 16 to 50                             |
| 11  | 04:47               | `measure-hmr.mjs --label=hmr-kinds --runs=3 --pages=/preview/page/review/ariakit,/ --files=<5 files>`                                                                                                               | `hmr-kinds.json`                                            | 31 to 73                             |
| 12  | 04:55               | `check-switch.mjs --origin=<4351>,<4353> --label=switch-dev-vs-prod --runs=3`                                                                                                                                       | `switch-dev-vs-prod.json`                                   | 30 to 60                             |
| 13  | 05:01               | `measure-load.mjs --origin=<web dev 4354> --label=web-dev-first --runs=1 --paths=/,/runs/<id>`                                                                                                                      | `web-dev-first.json`                                        | 54.38 52.01 41.25                    |
| 14  | 05:02               | `measure-load.mjs --label=web-vs-lab-dev --runs=5 --pairs=<web /runs/id>,<lab /preview/page/review/ariakit>,<web />,<lab /preview/page/inbox/ariakit>`                                                              | `web-vs-lab-dev.json`                                       | 62.21 54.38 42.68; 55.26 54.97 44.63 |
| 15  | 05:04               | `measure-hmr.mjs --origin=<4354> --dir=<web-copy> --label=hmr-web --runs=5 --pages=/runs/<id> --files=src/review/review-workspace.tsx,src/review/model.ts,CHANGELOG.md`                                             | `hmr-web.json`                                              | 49 to 69                             |
| 16  | 05:06               | `count-scan.mjs lab-copy`                                                                                                                                                                                           | printed, see 9.4                                            | -                                    |
| 17  | 05:06               | `measure-hmr.mjs --label=hmr-src-only --runs=5 --pages=/preview/page/review/ariakit --files=<tsx>,README.md,audit/content/findings.json` (server with `source(".")`)                                                | `hmr-src-only.json`                                         | 38 to 52                             |
| 18  | 05:07               | `time-docs.mjs docs-shared-vs-copy 5 <4320> <4351> <4353>`                                                                                                                                                          | `docs-shared-vs-copy.json`                                  | 64.57 56.47 47.49                    |
| 19  | 05:08               | `measure-load.mjs --origin=<4353> --label=gallery-height-300 --runs=3 --paths=/ --height=300 --reload=0` and the same with 600                                                                                      | `gallery-height-300.json`, `gallery-height-600.json`        | 60 to 100                            |

The load average was never below 8 and went up to 100. So an absolute time of one run means little. Compare A and B inside one result file. The counts do not depend on the load.

Known fault of the raw data: in `lab-dev-warm.json`, the renderer numbers of the mode `reload` are negative. The script took the difference of two counters, and the counters start again at a navigation. The script is repaired. All later files have the value after the load.

## 5. A. The path of one load

### 5.1 Warm, development against production form, in turns (`lab-dev-vs-prod.json`, n=5, new browser context)

Median (range). Port 4351 is `vite` (development). Port 4353 is `vite build` + `vite preview` (production form, workerd, no compression).

| Route                                                | Form       | Documents | Requests | Body MB | Document wait ms | FCP ms          | Top hydrated ms   | Usable ms          | Main thread ms    | Script ms         | Style ms          |
| ---------------------------------------------------- | ---------- | --------- | -------- | ------- | ---------------- | --------------- | ----------------- | ------------------ | ----------------- | ----------------- | ----------------- |
| `/preview/page/review/ariakit`                       | dev        | 1         | 363      | 19.0    | 151 (59..2189)   | 380 (184..2724) | 1507 (1185..3840) | 1507 (1185..3840)  | 974 (927..1043)   | 653 (599..739)    | 170 (161..181)    |
| same                                                 | production | 1         | 104      | 1.9     | 29 (18..34)      | 140 (124..144)  | 397 (360..407)    | 397 (360..407)     | 412 (408..422)    | 195 (192..199)    | 135 (131..142)    |
| `/pages/review` (page explorer)                      | dev        | 2         | 586      | 35.5    | 92 (68..177)     | 264 (188..368)  | 606 (432..792)    | 1795 (1592..2308)  | 1442 (1378..1636) | 854 (830..991)    | 372 (354..379)    |
| same                                                 | production | 2         | 175      | 3.3     | 26 (18..77)      | 140 (112..208)  | 279 (215..454)    | 848 (561..1045)    | 681 (615..713)    | 260 (248..273)    | 271 (245..282)    |
| `/pages/review-variants?compare=1`                   | dev        | 4         | 1315     | 73.5    | 56 (49..71)      | 180 (160..312)  | 492 (429..644)    | 3824 (3387..4526)  | 3471 (3139..4233) | 2234 (2029..2877) | 730 (708..841)    |
| same                                                 | production | 4         | 387      | 7.5     | 31 (18..92)      | 148 (124..232)  | 292 (222..423)    | 1586 (1360..1948)  | 1520 (1436..1550) | 574 (524..576)    | 609 (583..616)    |
| `/directions`                                        | dev        | 7         | 2036     | 123.6   | 74 (30..90)      | 196 (112..272)  | 483 (366..635)    | 2510 (2313..3492)  | 2011 (1960..2199) | 1189 (1109..1210) | 404 (382..458)    |
| same                                                 | production | 7         | 550      | 11.2    | 17 (8..36)       | 96 (72..316)    | 173 (149..1407)   | 1223 (1061..2408)  | 1113 (1049..1222) | 343 (326..344)    | 453 (426..499)    |
| `/` (gallery)                                        | dev        | 16        | 4814     | 286.8   | 55 (30..70)      | 148 (116..216)  | 440 (360..577)    | 9322 (7808..13248) | 3932 (3823..8282) | 1446 (1365..4427) | 1238 (1180..2338) |
| same                                                 | production | 16        | 1364     | 28.3    | 29 (15..240)     | 100 (96..316)   | 203 (153..499)    | 3712 (3429..6889)  | 3635 (3435..5775) | 1204 (1138..1859) | 1507 (1463..2505) |
| `/components/row-picture` (3,539 elements, no frame) | dev        | 1         | 364      | 19.2    | 236 (148..351)   | 568 (424..680)  | 1053 (856..1357)  | 1053 (856..1357)   | 2022 (1953..2567) | 771 (658..810)    | 921 (872..1153)   |
| same                                                 | production | 1         | 159      | 2.9     | 68 (52..243)     | 372 (324..548)  | 699 (585..891)    | 699 (585..891)     | 1645 (1471..1660) | 236 (225..254)    | 962 (869..1020)   |

The reload in the same context (warm browser cache) has the same request counts. Almost all requests are answered from the cache or with 304. Examples (median usable): gallery dev 7599 (7032..11217), gallery production 4052 (3286..7216), preview dev 944 (852..1595), preview production 320 (282..508). Full table: `node table.mjs lab-dev-vs-prod`.

Other lab pages in development (`lab-dev-warm-more.json`, n=3, new context, load 24 to 43): `/feedback` 1 document, 221 requests, usable 505 (469..765). `/pages/inbox` 2 documents, 516 requests, usable 934 (922..1281). `/components/status-mark` 1 document, 291 requests, usable 585 (528..672).

### 5.2 What a document is made of (**counted**, `lab-dev-warm.json`, `lab-dev-vs-prod.json`)

One bare preview (`/preview/page/review/ariakit`) in development: 363 requests, 19.9 MB of body.

| Part                                                                                                      | Requests | Body bytes | Owner           |
| --------------------------------------------------------------------------------------------------------- | -------- | ---------- | --------------- |
| `lucide-react.js` (pre-bundled, the complete icon library, with inline source map)                        | 1        | 5,735,660  | tool stack      |
| `react-dom_client.js` (pre-bundled, development build, inline source map)                                 | 1        | 3,133,504  | tool stack      |
| `@ariakit_react.js` (pre-bundled, inline source map)                                                      | 1        | 2,186,181  | tool stack      |
| TanStack Router and Start, `seroval`, `cookie-es` (not pre-bundled, one request for each file)            | 104      | 2,306,207  | tool stack      |
| `src/fixtures` (one file is `real/census.ts`, 432,581 bytes)                                              | 62       | 1,513,920  | lab             |
| `src/explorations` (kit and page)                                                                         | 70       | 1,407,907  | lab             |
| `src/components/ariakit`                                                                                  | 57       | 975,552    | primitives      |
| `src/styles.css`                                                                                          | 1        | 517,488    | primitives, lab |
| `src/lab`                                                                                                 | 23       | 419,406    | lab             |
| `src/routes` (all 12 route modules of the lab, also `dev.hooks.tsx` 98,008 and `dev.fixtures.tsx` 80,491) | 12       | 409,322    | lab             |
| The document (server HTML)                                                                                | 1        | 182,891    | primitives, lab |
| Fonts                                                                                                     | 2        | 88,660     | lab             |
| Fixture images                                                                                            | 8        | 29,598     | lab             |

The same preview in production form: 104 requests, 1.94 MB: 90 JavaScript chunks (1,160,678 bytes), 1 style sheet (475,107 bytes), the document (186,673 bytes), 2 fonts, 8 images.

The style sheet is parsed in 2 to 3 ms for each document (`ParseAuthorStyleSheet` self time, `trace-dev-vs-prod.json`, **measured**). The parse of the large CSS is not a cost.

The size of the server HTML (**counted**): `/preview/page/sign-in/ariakit` 9,351 bytes for 39 elements. `/preview/page/review/ariakit` 184,079 bytes for 559 elements (329 bytes for each element). `/preview/component/row-picture/picture?all=1` 460,864 bytes for 1,645 elements. `/pages/review` 229,314 bytes. This is the class-name weight of the primitives that the audit already describes.

### 5.3 Cold: the first request after a server start (`lab-dev-cold.json`, n=5 for each route, dependency cache present)

|                                                | Median (range)                                           |
| ---------------------------------------------- | -------------------------------------------------------- |
| Server start, from the spawn to "ready"        | 2763 ms (2009..5686), n=15                               |
| First document, `/preview/page/review/ariakit` | wait 2794 ms (2215..4731), usable 4805 ms (4383..8819)   |
| First document, `/pages/review`                | wait 1696 ms (1555..4232), usable 5121 ms (4836..17043)  |
| First document, `/`                            | wait 2075 ms (1629..3225), usable 15180 ms (9355..24122) |

With no dependency cache at all (`lab-dev-cold-nodeps.json`, n=1): first document of the gallery 1554 ms wait, usable 9659 ms. Vite pre-bundled the dependencies at the server start. The start took 2.1 to 2.8 s.

The real app (`web-copy`): the first server start with no dependency cache took 24.3 s to "ready" (`logs/web-dev.log`, n=1, load about 50). The second start answered `/health` after 11.4 s. The first document `/` then took 13.1 s (n=1, load 56).

## 6. B. What the lab adds

### 6.1 Frames (**counted** and **documented**)

- The gallery shows 15 cards. Each card is a live `iframe` (`Thumbnail` in `src/lab/ui/surface-card.tsx`, `PreviewFrame` in `src/lab/ui/preview-frame.tsx`). At 1440 by 900, all 15 frames load: 16 documents.
- Each frame is a full app: its own document from the server, the style sheet, the fonts, React, the router, and the module graph. In development, a frame asks for 282 to 359 files and gets 18.3 to 19.9 MB of body (`node analyze-run.mjs lab-dev-warm /`). The frames share the HTTP cache of the top document, so the transfer of a frame is small (83 KB to 3.2 MB). But each request still goes to the server for a check, and each document runs the modules again.
- The gallery in development: 4,814 requests and 287 MB of body for one load. The top document is ready early: top hydrated at 440 ms. The 15 frames start at about 400 ms, get their documents between 493 and 800 ms, and start to hydrate between 3.4 and 3.9 s. The last one is ready at 7.8 to 13.2 s.
- The frames load lazily, with a margin of one viewport above and below (`rootMargin: "100% 0px"`). Counted on the production form: window height 300 gives 5 frames (557 requests), 600 gives 11 frames (1,043 requests), 900 gives 15 frames (1,364 requests).
- The frames are not kept alive. `useNearViewport` removes the `iframe` element when the card is more than one viewport away, and a new `iframe` loads the document again when the card comes back (**documented**, not measured).
- A scenario switch and a look control do not reload a frame. They send a message, and the frame navigates on the client. Counted (`switch-dev-vs-prod.json`, n=3 for each): 0 document requests for the scenario tab, for the theme toggle with 1 frame, and for the theme toggle with 15 frames.

Cost of these actions, median (range), load 30 to 60:

| Action                                                                  | Form       | Done ms           | Main thread ms    | Script ms         | Style ms          |
| ----------------------------------------------------------------------- | ---------- | ----------------- | ----------------- | ----------------- | ----------------- |
| Second scenario tab of `/pages/review` (63 new requests, 62 are images) | dev        | 3722 (3325..4597) | 3683 (3299..4570) | 2116 (1920..2486) | 1404 (1230..1794) |
| same                                                                    | production | 863 (524..1169)   | 1567 (1498..1719) | 736 (660..778)    | 705 (704..761)    |
| Theme toggle, page explorer (1 frame)                                   | dev        | 490 (457..531)    | 457 (423..497)    | 311 (292..321)    | 95 (89..108)      |
| same                                                                    | production | 300 (283..654)    | 276 (257..360)    | 92 (73..154)      | 114 (107..115)    |
| Theme toggle, gallery (15 frames)                                       | dev        | 3324 (3181..3621) | 3303 (3154..3437) | 2052 (2006..2056) | 862 (750..979)    |
| same                                                                    | production | 1535 (1391..2103) | 1487 (1382..1973) | 456 (431..584)    | 701 (679..976)    |

### 6.2 Cost of one frame (**estimate** from the measured medians of 5.1)

`(usable - top hydrated) / frames`:

| Page                               | Frames | Development           | Production form |
| ---------------------------------- | ------ | --------------------- | --------------- |
| `/directions`                      | 6      | 340 ms for each frame | 175 ms          |
| `/pages/review-variants?compare=1` | 3      | 1110 ms               | 430 ms          |
| `/`                                | 15     | 590 ms                | 235 ms          |

The frames do not load one after the other. They share one main thread and, in development, one server and 6 connections. So the number is the added wait for each frame, not the time of one frame alone. One frame alone is the bare preview of 5.1: 1.5 s in development and 0.4 s in production form.

### 6.3 Loaded and not needed (**counted**)

- **Fixture images**: not a cause. `public/fixtures` has 29 MB, but the gallery asks for 23 images with 255,620 bytes (12 different URLs), and the review preview asks for 8 images with 29,598 bytes. The second scenario of the review page asks for 62 images (bytes not recorded). In development the images have `Cache-Control: no-cache` and an ETag, so each load checks each image again. 3 of 73 image elements are drawn at less than half of their natural width.
- **The audit page**: no lab page asks for `/audit/index.html` (1.6 MB).
- **Every route module in every document** (development only): each document gets all 12 route files, 409 KB, with `dev.hooks.tsx` and `dev.fixtures.tsx`. In the production form these are separate chunks, and a preview does not load them.
- **Every variant module at once**: no. A preview loads its own variant. The registry uses `import.meta.glob` with one chunk for each variant.
- **Large data in the entry**: `src/fixtures/real/census.ts` has 138,332 bytes of source and 432,581 bytes as a development module. Each preview that shows fixture data loads it.
- **The Tailwind scan of `audit/` and `docs/`**: see 9.4. This is the one clear thing that the lab does and does not need.

## 7. What the main thread does (`trace-dev-vs-prod.json`, n=3, self time in ms, median)

The trace itself makes script time longer, most of all in development. Use the table for the shares, not for the totals.

| Load                      | Form       | Main thread | Script run | Layout | Style recalc | Paint | CSS parse | Script compile |
| ------------------------- | ---------- | ----------- | ---------- | ------ | ------------ | ----- | --------- | -------------- |
| Bare preview              | dev        | 956         | 601        | 142    | 71           | 8     | 3         | 2              |
| Bare preview              | production | 413         | 187        | 124    | 39           | 6     | 3         | 1              |
| `/components/row-picture` | dev        | 2113        | 637        | 653    | 407          | 225   | 3         | 2              |
| `/components/row-picture` | production | 1536        | 217        | 583    | 412          | 151   | 2         | 1              |
| Gallery                   | dev        | 9589        | 5543       | 1197   | 930          | 547   | 39        | 278            |
| Gallery                   | production | 4229        | 1230       | 1216   | 780          | 496   | 35        | 19             |

The trace puts a part of the style work below "Layout" (**assumption**: style work for container queries runs inside layout). `Performance.getMetrics` counts all of it as `RecalcStyleDuration`: 135 ms for the production preview, where the trace has 39 ms of style and 124 ms of layout. I use `RecalcStyleDuration` as the style number.

Share of style in the main thread time, production form (**measured**, 5.1): bare preview 135 of 412 ms (33%). Page explorer 271 of 681 ms (40%). Gallery 1507 of 3635 ms (41%). Component explorer with 3,539 elements 962 of 1645 ms (58%).

In development the share is smaller, because the script time is larger: bare preview 170 of 974 ms (17%), gallery 1238 of 3932 ms (31%).

Why the gallery takes 9.3 s in development when the main thread is busy for only 3.9 s (**assumption**, from the counts): the 16 documents wait for 4,814 requests. The development server is one Node process, and Chrome opens 6 connections to one HTTP/1.1 origin.

## 8. C. The development tools

### 8.1 A change in one source file (`hmr-fresh-vs-nofresh-preview.json`, `hmr-kinds.json`)

Each edit appends a comment with a new Tailwind class (`pt-[<n>px]`). "Applied" is the time from the write of the file until an element with that class has the new padding in every document of the page.

One document (`/preview/page/review/ariakit`), median (range):

| Edited file                                                      | Server                | n      | Socket messages | CSS update | Page reload | Requests | Body KB | Style sheet server wait ms | Applied ms      | Main thread ms | Style ms       |
| ---------------------------------------------------------------- | --------------------- | ------ | --------------- | ---------- | ----------- | -------- | ------- | -------------------------- | --------------- | -------------- | -------------- |
| `src/explorations/pages/review/ariakit/review-page.tsx`          | with `freshStyles`    | 6      | 1               | yes        | no          | 4        | 603     | 290 (83..820)              | 381 (289..967)  | 213 (190..260) | 79 (67..112)   |
| same                                                             | without `freshStyles` | 6      | 1               | yes        | no          | 4        | 603     | 101 (81..694)              | 260 (175..1346) | 203 (197..270) | 70 (64..94)    |
| `src/routes/dev.hooks.tsx` (a route that the page does not show) | with                  | 6      | 1               | yes        | no          | 4        | 688     | 190 (174..2445)            | 391 (281..2681) | 125 (97..524)  | 86 (72..371)   |
| same                                                             | without               | 6      | 1               | yes        | no          | 4        | 689     | 229 (197..419)             | 361 (270..686)  | 99 (92..187)   | 73 (68..127)   |
| `src/lab/catalog-pages.ts`                                       | with                  | 6      | 3               | yes        | no          | 32       | 1343    | 224 (137..563)             | 354 (278..911)  | 506 (425..692) | 174 (149..255) |
| same                                                             | without               | 6      | 3               | yes        | no          | 32       | 1344    | 124 (90..1551)             | 346 (194..1733) | 439 (419..706) | 166 (147..224) |
| `README.md`, `docs/primitives.md`, `audit/content/findings.json` | with                  | 3 each | 1               | no         | **yes**     | 363      | 19448   | -                          | 1072 to 1352    | -              | -              |

Answers:

- A change of a source file is a hot update, not a page reload.
- Each change of a source file also sends a CSS update. The browser then gets the complete style sheet again (517 KB) and calculates the style of the whole document again: about 80 ms of style and about 200 ms of main thread for one small document.
- The plugin `freshStyles` does not cause this. The messages, the requests, and the bytes are the same with and without it. The cause is the Tailwind plugin: it registers each file that it scans as a dependency of the style sheet (`addWatchFile` in `@tailwindcss/vite/dist/index.mjs`, **documented**). The times with and without the plugin overlap. I found no cost of `freshStyles`.
- A change of a file that Tailwind scans and that is not JavaScript or CSS (`README.md`, a file in `docs/`, a file in `audit/`) is a **full reload** of each open document. The `hotUpdate` hook of the Tailwind plugin sends `full-reload` for such a file (**documented** and **measured**).

16 documents (the gallery, `hmr-kinds.json`, n=3, load 41 to 73):

| Edited file                         | Socket messages | Style sheet requests | Body KB | Page reload                                        | Applied in all documents ms   | Main thread ms    | Style ms          |
| ----------------------------------- | --------------- | -------------------- | ------- | -------------------------------------------------- | ----------------------------- | ----------------- | ----------------- |
| `review-page.tsx`                   | 16              | 16                   | 9417    | no                                                 | 4329 (1462..4722)             | 4798 (2221..6192) | 3265 (1794..4864) |
| `src/lab/catalog-pages.ts`          | 64 (32..64)     | 16                   | 18525   | no                                                 | 2432 (2067..4908)             | 6482 (5173..7455) | 2613 (2116..4957) |
| `README.md` (runs 1 and 2)          | 16              | 48 to 50             | 294000  | yes: 31 document requests, 4,903 to 4,906 requests | settled after 10.7 and 20.1 s | -                 | -                 |
| `docs/primitives.md` (runs 1 and 2) | 16              | 54 to 58             | 294500  | yes: 31 document requests                          | settled after 19.4 and 14.1 s | -                 | -                 |

Run 3 of the three files that are not JavaScript is not valid for the gallery: the page was still in the reload of the edit before it.

One saved source file blocks an open gallery tab for 2.2 to 6.2 s. One saved Markdown or JSON file below `apps/lab` reloads the gallery: 31 document requests, because the top document reloads and each of the 15 frames also reloads itself.

### 8.2 How long Tailwind takes (`DEBUG=tailwindcss`, `logs/lab-dev-debug.log`, `logs/web-dev.log`)

| Server                           | n   | Generate CSS, median (p90, range) | Scan  | Register dependencies | Build CSS |
| -------------------------------- | --- | --------------------------------- | ----- | --------------------- | --------- |
| Lab, scan of the Vite root (now) | 50  | 146 ms (574, 45..1725)            | 38 ms | 42 ms                 | 22 ms     |
| Lab, scan of `src` only          | 6   | 56 ms (205, 33..249)              | 29 ms | 4.5 ms                | 27 ms     |
| Web                              | 118 | 60 ms (279, 3..2665)              | 22 ms | 5.4 ms                | 12 ms     |

The first generation after a server start of the lab took 478 ms (compiler 69, scan 113, register 180, build 112).

The style sheet of a development server only grows (**documented**: the plugin keeps `candidates` in a set and never removes one). Measured on the copy: 517,488 bytes at the start, 519,936 bytes after about 95 probe classes. The shared server, started long ago, served 614,175 bytes at 04:19 and 614,316 bytes at 05:07. A new server on the snapshot of 04:18 served 517,488 bytes. So the shared server sends about 19% more CSS than a new server (**assumption**: the difference is classes of code that was removed in earlier rounds. I did not compare the two sheets rule by rule).

### 8.3 The real app in development (`web-vs-lab-dev.json`, `hmr-web.json`, load 49 to 69)

One document, new context, n=5, in turns with the lab:

| Document                           | Requests | Body MB | Usable ms         | Main thread ms  | Script ms      | Style ms       | Elements |
| ---------------------------------- | -------- | ------- | ----------------- | --------------- | -------------- | -------------- | -------- |
| Web `/`                            | 226      | 16.9    | 1897 (681..2776)  | 246 (212..296)  | 119 (115..152) | 36 (35..61)    | 143      |
| Web `/runs/<id>`                   | 246      | 18.0    | 1675 (677..2503)  | 491 (466..811)  | 280 (268..580) | 132 (122..145) | 429      |
| Lab `/preview/page/inbox/ariakit`  | 292      | 17.7    | 1467 (1003..2284) | 307 (281..519)  | 147 (141..357) | 49 (46..53)    | 232      |
| Lab `/preview/page/review/ariakit` | 363      | 19.0    | 1621 (1558..3254) | 960 (919..1034) | 662 (616..737) | 167 (164..173) | 559      |

The same path is as slow in the real app. One document of the real app costs the same as one document of the lab.

A change in the real app (`/runs/<id>`, n=5):

| Edited file                       | Messages | Page reload | Requests | Body KB | Applied ms        | Main thread ms | Style ms       |
| --------------------------------- | -------- | ----------- | -------- | ------- | ----------------- | -------------- | -------------- |
| `src/review/review-workspace.tsx` | 1        | no          | 3        | 945     | 660 (257..1236)   | 168 (163..183) | 69 (65..80)    |
| `src/review/model.ts`             | 1        | no          | 10       | 1119    | 412 (169..1081)   | 616 (388..685) | 186 (138..253) |
| `CHANGELOG.md`                    | 1        | **yes**     | 246      | 18445   | 4949 (2848..6080) | -              | -              |

The real app imports its style sheet as a module, so the complete CSS comes again as a JavaScript module (945 KB) with each source change. `apps/web/CHANGELOG.md`, `apps/web/migrations`, and `apps/web/tooling` are in the Vite root of the real app, so Tailwind scans them too, and a change of one of them reloads the page.

## 9. E. Things that only happen on this machine now

### 9.1 The idle page on the shared server (`watch-shared-1.json`, 300 s, 04:19:58 to 04:24:58)

**Counted**, with no action of mine:

- 94 file changes below `apps/lab` in 86 files (59 in `src/explorations`, 8 in `src/fixtures`, 7 in `src/lab`, 5 in `src/routes`).
- 72 update messages on the Vite socket. 63 of them had a CSS update.
- 51 complete downloads of the style sheet by this one page: 30,709,077 bytes. Each took 43 to 613 ms.
- 7 `full-reload` messages (5 for removed `.svg` files, 2 with no path) and several error messages ("Failed to resolve import ..."), because the files of a refactor changed in an order that did not build.
- 4 reloads of the document, at 61 s, 77 s, 106 s, and 137 s. The Vite client reloads the page at the first update after an error.

Three more idle pages (20 s, 150 s, 100 s, between 04:26 and 04:37): 0 messages, 0 file changes. So the edits come in bursts.

### 9.2 What this does to the maintainer's browser (**estimate** from 8.1 and 9.1)

Each open lab tab and each frame in it is its own client of the Vite socket. With the gallery open, one update message means 16 clients. In the burst of 9.1, a gallery tab would have got about 63 CSS updates for each of 16 documents (about 1,000 style sheet downloads of 614 KB) and 4 or more full reloads of 16 documents. One update alone blocked the gallery for 2.2 to 6.2 s in my copy. So in such a burst the tab is busy without a break.

### 9.3 CPU

The load average was 8 to 100 during this hour. The same page in the same form took about 1.7 times longer at a load average of 53 to 63 than at 12 to 19 (compare `lab-dev-warm.json` and `web-vs-lab-dev.json` for `/preview/page/review/ariakit`: usable 947 ms and 1621 ms).

Yes: the slowness that the maintainer feels can come from 9.1 and 9.3 to a large part. It is not all of it: on a quiet server, the gallery still needs 7.5 to 9.3 s in development.

### 9.4 The Tailwind scan of `audit/` and `docs/` (**counted**, `node count-scan.mjs lab-copy`)

The Tailwind plugin scans the Vite root (`base: e.root`, pattern `**/*`, **documented**). The Vite root of the lab is `apps/lab`.

| Scope               | Files | Bytes      | Candidate strings | Full scan       |
| ------------------- | ----- | ---------- | ----------------- | --------------- |
| The Vite root (now) | 799   | 18,534,173 | 26,106            | 93 ms (64..113) |
| `src` only          | 321   | 2,311,632  | 8,249             | 22 ms (18..32)  |

`audit/` has 414 files and 13,949,452 bytes. `docs/` has 57 files and 2,251,314 bytes. Together: 59% of the files and 87% of the bytes that Tailwind reads are not app source.

Experiment in the copy, one line in `src/styles.css`:

```css
@import "tailwindcss" source(".");
```

Results:

- The development style sheet goes from 517,488 to 465,745 bytes (-51,743 bytes, -10.0%, **counted**). The removed rules come from class names in the Markdown and JSON files. No page uses them.
- A change of `README.md` or `audit/content/findings.json` sends no message and reloads nothing (5 of 5 runs each, `hmr-src-only.json`). Before: a full reload in 3 of 3 runs.
- The step "Register dependency messages" goes from 42 ms to 4.5 ms for each rebuild.
- A change of a source file is the same as before: one CSS update.

## 10. What I could not measure

- The browser of the maintainer: its extensions, its open DevTools, and its number of open lab tabs. I used headless Chrome (channel `chrome`) on the same machine.
- A quiet machine. The lowest load average of the session was 8. I did not use CPU throttling: the load changed by a factor of 10 during the hour, so I compared A and B in turns in one session.
- The lab of round 1 (109 component variants). It is not in the repository.
- The cost of the 5.7 MB `lucide-react` file alone. I have only its bytes.
- The bytes of the 62 images of the second review scenario.
- The real app with a backend, and a load from Cloudflare (compression, network). `vite preview` sends the files without compression.
- If a new shared server would send 517 KB or less. I did not restart the shared server.
- Memory: I recorded the JavaScript heap only (gallery in development: 197 MB median in `lab-dev-warm.json`).
- The last measurements (after 05:00: web against lab, `source(".")`, window heights) ran at a load average of 38 to 100. Their counts are valid. Their times have wide ranges.
