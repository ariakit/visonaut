# CSS lane: working record

Question of the lane: what is in the style sheet of the lab, who puts it there, and how much of it does a page use?

Date: 2026-10-07, 04:17 to 05:15 local time (07:17 to 08:15 UTC). Machine: macOS, Node 24.18.0, Chrome channel through Playwright 1.63.0. The machine was very busy for the whole session: the 1-minute load average was between 14 and 88. Each timing below has the load average beside it. Counts (bytes, rules, classes, requests) do not depend on the load.

Labels: **measured** (a timer or a browser counter), **counted** (bytes, rules, files: exact for the fixed source), **documented** (read in source code), **estimate**, **assumption**.

## 1. Rules of the work

- The repository was read only. Each file of this lane is in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/perf/css/`.
- The shared lab server (port 4320) got 4 light requests in total: 1 HTML request and the 2 style links of that HTML (one of them is the empty TanStack link) from `dev-form.mjs`, and 1 style sheet request from `fetch-css.mjs`. No trace and no load test ran on it. It was not stopped.
- Servers of this lane: 4331 (production preview), 4332, 4333, 4334 (development). Section 9 says how each one was stopped.
- No request went to `https://visonaut.com`.
- Skills: `ariakit-general-workflow` was loaded (the remote is `github.com/ariakit/visonaut`). No installed skill is specific to this repository.

## 2. The fixed source

Other agents changed `apps/lab/src` during this session (round 3 removes the options that were not picked). So the lab is a moving target.

| Copy                                   | Taken (local) | State                                                                                                                      | Use                                                                      |
| -------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `base/apps/lab`                        | 04:19         | Does NOT build: `settledLabel` and `getPageChoices` were missing exports at that moment (a copy in the middle of an edit). | First CSS-only numbers. Not used in the report, except where it says so. |
| `base/apps/web`                        | 04:19         | Tracked by git, not changed.                                                                                               | All numbers of the real app.                                             |
| `snap2/apps/lab`                       | 04:27         | Builds (`vite build` status 0).                                                                                            | **The fixed source of every lab number in this record.**                 |
| `devfresh`, `devnofresh`, `devsrconly` | 04:46         | Copies of `snap2` for the three development servers.                                                                       | Section 6.                                                               |

How a copy is made (`snapshot.mjs`, `setup-copy.mjs`, `make-dev-copy.mjs`):

- `rsync -a --exclude node_modules --exclude dist --exclude .wrangler --exclude .tanstack`.
- The root `.gitignore`, `tsconfig.json`, and `package.json` are copied to the copy root, so that Tailwind ignores the same files and `tsconfig.json` extends the same file.
- `apps/lab/node_modules` of the copy is a real folder with one symbolic link for each package of the real `apps/lab/node_modules`. A real folder keeps `.vite`, `.vite-temp`, and `.mf` in the lane folder.
- A development copy has one change in `vite.config.ts`: `server.fs.allow` has the repository root, because the packages and the font files are outside the copy. `devnofresh` also has no `freshStyles()`. `devsrconly` also has `@import "tailwindcss" source("./");` in `src/styles.css`.

Check that the copy scans the same files as the real lab (`scan-files.mjs`): real lab at 04:21: 767 files, 18,417,321 bytes, 25,988 candidates. `snap2`: 767 files, 25,975 candidates. So `.gitignore` works the same way in the copy.

The CSS pipeline of this lane (`lib.mjs`, `build-css.mjs`) does what the class `Root` of `@tailwindcss/vite` 4.3.3 does (documented: `node_modules/@tailwindcss/vite/dist/index.mjs`): `compile` of `@tailwindcss/node`, `Scanner` of `@tailwindcss/oxide` with the Vite root and the pattern `**/*`, `build`, then `optimize({ minify: true })`. Check against real builds:

| Source      | This pipeline        | `vite build`                                                        | Difference                                                                                                                                                         |
| ----------- | -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `snap2` lab | 465,780 B            | 474,725 B (`snap2/apps/lab/dist/client/assets/styles-CYWRAXNn.css`) | +8,945 B (1.9%): the second Lightning CSS pass of Vite adds fallbacks for its browser targets (51 more rules, 105 more declarations).                              |
| web         | 332,367 B (one copy) | 464,666 B (existing `apps/web/dist`)                                | The build has the style sheet two times in part: 581 exact duplicate rules, 114,948 B (`repeats.mjs` on the existing file). The audit finding FE-09 has the cause. |

So the two apps do NOT have the same CSS. The real app has 332 KB of different rules and a duplicate. The lab has 466 KB of different rules and no duplicate.

## 3. A. Anatomy

Commands:

```sh
node build-css.mjs snap2/apps/lab snap2/apps/lab/src/styles.css results/snap2   # results/snap2.json, .min.css, .dev.css
node build-css.mjs base/apps/web  base/apps/web/src/styles.css  results/web     # results/web.json
node anatomy-file.mjs snap2/apps/lab/dist/client/assets/styles-CYWRAXNn.css results/snap2.vite-build.anatomy.json
node anatomy-file.mjs <repo>/apps/web/dist/client/assets/index-CXm4JU5N.css results/web.vite-build.anatomy.json
node repeats.mjs results/snap2.min.css results/snap2.repeats.json
node repeats.mjs <repo>/apps/web/dist/client/assets/index-CXm4JU5N.css results/web.vite-build.repeats.json
node attribute.mjs lab snap2/apps/lab results/snap2.attribute.json
node attribute.mjs web base/apps/web  results/web.attribute.json
```

Counted, production form:

|                              | Lab (`snap2`), built by Vite | Lab, pipeline | Web, pipeline (one copy) | Web, existing build |
| ---------------------------- | ---------------------------: | ------------: | -----------------------: | ------------------: |
| Bytes raw                    |                      474,725 |       465,780 |                  332,367 |             464,666 |
| Bytes gzip -9                |                       66,264 |        63,217 |                   45,688 |              59,500 |
| Bytes brotli 11              |                       45,506 |        43,225 |                   31,901 |              32,868 |
| Style rules                  |                        3,022 |         2,971 |                    1,909 |               2,506 |
| Selectors                    |                        3,268 |         3,268 |                    2,148 |               2,804 |
| Declarations                 |                        5,763 |         5,658 |                    4,095 |               5,267 |
| Custom property declarations |                        2,622 |         2,551 |                    2,088 |               2,941 |
| Different custom properties  |                          609 |           607 |                      555 |                 557 |
| `var()` references           |                        4,726 |         4,564 |                    3,135 |               4,006 |
| `@property` rules            |                          247 |           247 |                      245 |                 245 |
| `@layer` blocks              |                            4 |             4 |                        4 |                   4 |
| `@container` rules           |                          364 |           364 |                      290 |                 580 |
| of these, size queries       |                          139 |           139 |                      105 |                 210 |
| of these, style queries      |                          225 |           225 |                      185 |                 370 |
| Rules inside a style query   |                          303 |           301 |                      222 |                 444 |
| `@media` / `@supports`       |                      50 / 50 |       50 / 50 |                  33 / 35 |             68 / 69 |
| `@font-face`                 |                           13 |            13 |                        0 |                   0 |
| Selectors with `:has()`      |                          423 |           423 |                      313 |                 550 |
| Selectors with `:where()`    |                          166 |           166 |                       57 |                  68 |
| Selectors with `:is()`       |                          397 |           389 |                      240 |                 351 |
| Selectors with `:not()`      |                          548 |           546 |                      450 |                 670 |
| Longest selector             |                    531 chars |           531 |                      531 |                 531 |
| Longest declaration value    |                  2,758 chars |         1,633 |                    1,633 |               1,633 |
| Exact duplicate rules        |                            0 |             0 |                        0 |     581 (114,948 B) |

Bytes by layer, lab pipeline: `@layer utilities` 419,657 (90.1%), top-level `@property` 17,961, top-level rules 7,059, `@layer properties` 6,897, `@font-face` 6,169, `@layer base` 3,657, `@layer theme` 3,298, the rest 1,082.

Bytes by condition, lab pipeline (`snap2.repeats.json`): no condition 272,951 B in 2,175 rules; inside a style query 80,012 B in 301 rules; inside `@media` or `@supports` 43,180 B in 209 rules; inside a size container query 25,696 B in 286 rules.

Bytes by selector shape: a plain class 177,652 B in 1,865 rules; with `:has()` 92,262 B in 385 rules; with `:where()`, `:is()`, or `:not()` and no `:has()` 93,942 B in 380 rules; other 57,983 B in 341 rules.

### Share by source (counted, differential builds, `snap2.attribute.json`)

The entry with no class at all is 36,325 B (6,103 gzip):

| Part of the empty entry                                                             |  Bytes |
| ----------------------------------------------------------------------------------- | -----: |
| `tailwindcss` (preflight, base theme)                                               |  4,165 |
| the two `@fontsource-variable` imports (13 `@font-face`)                            |  6,169 |
| `@ariakit/tailwind` static part (its `@property` rules, `:root`, the disabled rule) | 15,224 |
| `ui.css` static part (its 30 `@property` rules, theme, `body` rules)                |  8,749 |
| `knobs.css`                                                                         |  1,980 |
| the rest of `styles.css`                                                            |     38 |

Classes, in the order in which an app grows (each line adds the classes of one group to the lines above it):

| Step                                                     | Files | Valid classes | Sheet after the step |    Adds raw | Adds gzip |
| -------------------------------------------------------- | ----: | ------------: | -------------------: | ----------: | --------: |
| The entry, no class                                      |       |             0 |               36,325 |             |           |
| + primitive recipes `src/components/ariakit/styles/*.ts` |    36 |         1,601 |              391,890 | **355,565** |    45,059 |
| + primitive components and utils                         |    35 |            29 |              392,284 |         394 |        93 |
| + lab explorations                                       |   107 |           438 |              411,089 |      18,805 |     3,820 |
| + lab fixtures                                           |    60 |            22 |              411,290 |         201 |        17 |
| + lab chrome and routes                                  |    52 |           338 |              423,050 |      11,760 |     2,132 |
| + `apps/lab/audit` (reports, JSON, HTML: not source)     |   414 |           379 |              455,713 |  **32,663** |     4,469 |
| + `apps/lab/docs` (Markdown: not source)                 |    57 |           502 |              467,804 |  **12,091** |     1,735 |
| + other files of the app root                            |     6 |             1 |              467,804 |           0 |         0 |

(The last line is 467,804 and not 465,780, because this script scans each file alone and also reads the three CSS files as content. The plugin does not scan CSS files. The difference is 2,024 B.)

So, of 465,780 B: the primitives are 76% (355,565 B of recipes plus about 24,000 B of static CSS of `@ariakit/tailwind` and `ui.css`), the lab's own classes are 7% (30,766 B), documents that are not source are 10% (44,754 B), Tailwind base and fonts are 2%.

Split of the same sheet by the kind of utility (removal saves / alone adds):

| Kind                                                                                                          | Classes | Bytes that go when the classes go |   gzip |
| ------------------------------------------------------------------------------------------------------------- | ------: | --------------------------------: | -----: |
| `ak-*` utilities of `@ariakit/tailwind`                                                                       |     341 |                           177,424 | 18,943 |
| utilities that `ui.css` defines (`shell-slot-state`, `ui-bevel`, `ui-bevel-button`, `ui-folder`, `ui-tabs-*`) |       7 |                            32,345 |  2,945 |
| Tailwind core utilities (most of them with a variant, written in a recipe)                                    |   2,114 |                           220,098 | 37,457 |
| Classes that use a variant that `ui.css` defines (`ui-hover:`, `ui-selected:`, ...)                           |     315 |                           139,612 | 13,538 |
| Classes that use an `ak-*` variant                                                                            |      23 |                             4,766 |    683 |

Cost of one class, development bytes, top roots (`snap2.attribute.json`, `topRoots`): `ak-text` 1,149 B a class (36 classes, 41,366 B), `shadow` 1,503 (14), `ak-layer` 525 (40), `shell-slot-state` 20,074 (1), `ring` 837 (21), `ak-ink` 426 (39), `ak-state` 1,136 (10), `ui-bevel-button` 5,137 (2), `ak-frame-cover` 4,323 (2), `ak-layer-offset` 1,227 (6), `ak-frame-bordering` 2,920 (2), `ak-frame-join-item` 5,247 (1). A plain Tailwind class such as `w-*` is 86 B.

### What repeats (counted, `snap2.repeats.json`)

- Exact duplicate rules: 0.
- The same declaration block under more than one selector: 357 blocks have 868 extra copies, 72,313 B (15.5% of the sheet). Example: the block of `ak-ink-0` occurs 11 times, once for each variant (`ak-ink-0`, `group-ui-disabled/control:ak-ink-0`, ...).
- The same declaration (property and value) in more than one rule: 105,915 extra bytes. The largest: `--ak-text: oklch(from var(--ak-layer) ...)` (259 B) occurs 38 times = 9,583 extra bytes.
- Values of 200 characters or more: 51 different values, 140 occurrences, 66,643 B (14.3% of the sheet); 38,284 B of that are repeats.
- The contrast tables of `ak-text`: four `if(style(--_ak-ltlc-even|odd: lch(...)): ...)` tables of about 1,450 to 1,633 B each, for even and for odd, in two rules (`.ak-text` and `.ui-text:ak-text ...`): 2 x 12,310 B = 24,620 B (5.3%).

## 4. B. Growth

Command: `node growth.mjs snap2/apps/lab results/snap2.growth.json` and `node used-by-design.mjs snap2/apps/lab results/snap2.used-by-design.json`. Each step is the same entry compiled with the classes of one set of files (counted, minified).

| Step                                                                           | Files |     Raw |   gzip | brotli | Rules | `@property` | `@container` | `:has()` selectors |
| ------------------------------------------------------------------------------ | ----: | ------: | -----: | -----: | ----: | ----------: | -----------: | -----------------: |
| 1. Tailwind only, a small page (31 classes)                                    |     1 |   6,714 |  2,199 |  1,889 |    83 |           3 |            0 |                  0 |
| 2. + `ui.css` imported, no primitive file                                      |     1 |  30,517 |  5,688 |  4,980 |    97 |         172 |            5 |                  0 |
| 3. + Button: only the 14 files that `button.ariakit.react.tsx` reaches         |    14 | 149,337 | 21,758 | 16,791 |   737 |         224 |          117 |                 56 |
| 4. + Frame, Layer, Text, Button, Nav, Shell: only the 28 files that they reach |    28 | 246,811 | 33,687 | 24,550 | 1,388 |         238 |          240 |                281 |
| 4b. The whole primitives folder, as the apps copy it                           |    70 | 383,167 | 50,130 | 35,285 | 2,045 |         245 |          280 |                421 |
| 5. The lab without its chrome, source only                                     |   259 | 410,014 | 55,003 | 38,803 | 2,402 |         244 |          307 |                422 |
| 6. The lab without the explorations, source only                               |   180 | 406,026 | 54,084 | 38,109 | 2,305 |         245 |          284 |                422 |
| 7. The lab, source only (`src`)                                                |   287 | 421,033 | 56,963 | 40,138 | 2,560 |         245 |          312 |                423 |
| 8. The lab as built today (`src` + `audit` + `docs`)                           |   763 | 465,780 | 63,217 | 43,225 | 2,971 |         247 |          364 |                423 |

Answers:

- Which step adds the bytes? The first primitive. One Button adds 118,820 B (16,070 gzip) to an app that has none, because `button.ts` extends `control`, `glider`, `hover`, `focus`, and `active`, and they reach 11 recipe files. The whole folder adds 352,650 B over step 2. The lab chrome adds 11,019 B (7 - 5). The explorations add 15,007 B (7 - 6). The documents add 44,747 B (8 - 7).
- Does the size depend on the prop values that the source uses? No (documented and counted). A recipe is text: `cv({ class, variants })` of `clava` with class strings. Tailwind scans the recipe file and compiles each class string of each variant, used or not. A numeric prop is one class plus a custom property in the `style` attribute (`layer.ts`: `class: "ak-layer-offset-(--layer-lightness-offset)"`, `style: { "--layer-lightness-offset": value }`), so a new value costs 0 bytes of CSS. The lab source imports all 27 component files (the route `/primitives` shows each one), and step 4b is the same number with them or without them.
- What does one more primitive cost? Between 2,691 B (Prose) and 163,071 B (List) alone on top of step 2 (`perComponent` in `snap2.growth.json`). They share most of it. The marginal cost of one recipe file inside the whole folder (the classes that only it has): `shell.ts` 54,488 B, `tabs.ts` 36,726, `choice.ts` 30,629, `text.ts` 29,765, `control.ts` 21,455, `disclosure.ts` 20,700, `table.ts` 16,755, `nav.ts` 14,032, `input.ts` 13,632, `frame.ts` 13,454, `glider.ts` 10,705, `list.ts` 10,225, `progress.ts` 9,567, `layer.ts` 7,656, `button.ts` 5,027; each other file is below 4,000 B.
- What does one more variant cost? One class. A plain Tailwind class is about 60 to 220 B. A class with a `ui-*` variant is 443 B on average (139,612 B / 315). An `ak-*` class is 520 B on average (177,424 B / 341) and up to 5,247 B.

### The six pages of the settled design (`snap2.used-by-design.json`, counted)

The six page modules reach 215 files: 158 design files and 57 primitive files. They reach 22 of the 27 component files and 30 of the 35 recipe files. Not reached: `checkbox`, `radio`, `table`, `tabs`, `prose` (components) and `checkbox.ts`, `choice.ts`, `radio.ts`, `table.ts`, `tabs.ts` (recipes).

Entry `tailwindcss` + `ui.css`, no fonts, no `knobs.css` (the shape of the real app):

| Source of the app                                   |     Raw |   gzip | brotli | Rules |
| --------------------------------------------------- | ------: | -----: | -----: | ----: |
| The design files alone, no primitive file           |  59,381 | 11,320 |  9,718 |   493 |
| The design files + the whole primitives folder      | 400,242 | 53,551 | 37,675 | 2,345 |
| The design files + only the reached primitive files | 316,888 | 44,554 | 32,182 | 2,024 |

## 5. C. Use

Command: `node coverage.mjs http://127.0.0.1:4331 results/snap2.coverage.prod.json 2500` (production preview of `snap2`, viewport 1440 by 900, decided data, dark theme; load average 15 to 16 during the run). Log: `results/snap2.coverage.prod.log`.

Method (measured in Chrome):

- "Engine used": `CSS.startRuleUsageTracking` of the DevTools protocol, the count of rules that the style engine used during the load and 2.5 s after it.
- "Selector matches": a walk of the CSS object model. A rule counts when its selector matches an element of the document now. The relaxed form also ignores `:hover`, `:focus`, `:focus-visible`, `:focus-within`, and `:active`. Conditions (`@container`, `@media`) are not evaluated. 32 rules could not be tested.
- The byte ranges of the protocol were not usable: for 113 of the 274 used rules of the sign-in page, Chrome reported the range of the whole `@layer utilities` block (`coverage-debug.mjs`). So the bytes come from the walk (selector text plus declaration text).
- `CSS.getMatchedStylesForNode` was tried and dropped: 99 elements took 10,065 ms (about 100 ms a call, load 27).

The sheet has 3,013 style rules with declarations and 445,552 B of rule text in the object model.

| Page                   | Elements | Engine used rules | Selector matches, relaxed | Share of rules | Bytes of those rules | Share of rule bytes |
| ---------------------- | -------: | ----------------: | ------------------------: | -------------: | -------------------: | ------------------: |
| sign-in                |       99 |               274 |                       237 |           7.9% |               66,652 |               15.0% |
| inbox                  |      300 |               775 |                       536 |          17.8% |              102,958 |               23.1% |
| history                |    1,116 |               795 |                       547 |          18.2% |              101,678 |               22.8% |
| status                 |      157 |               697 |                       486 |          16.1% |               96,039 |               21.6% |
| pull                   |      156 |               699 |                       474 |          15.7% |               93,867 |               21.1% |
| review                 |      641 |             1,086 |                       714 |          23.7% |              124,597 |               28.0% |
| gallery, main document |      312 |               782 |                       520 |          17.3% |               99,092 |               22.2% |

So a page uses 8% to 24% of the rules (15% to 28% of the bytes). 72% to 85% of the sheet is for other pages, other primitives, and other states.

Class attributes (measured in the document after hydration):

| Page                   | HTML chars | Elements with a class | Class chars | Share of the HTML | Average for each such element | Different classes | Longest attribute | `style` attributes | `style` chars |
| ---------------------- | ---------: | --------------------: | ----------: | ----------------: | ----------------------------: | ----------------: | ----------------: | -----------------: | ------------: |
| sign-in                |     13,201 |                    16 |       4,337 |             32.9% |                           271 |               145 |             1,717 |                  5 |           571 |
| inbox                  |     93,511 |                   165 |      65,046 |             69.6% |                           394 |               501 |             3,007 |                 50 |         7,433 |
| history                |    354,513 |                   807 |     255,132 |             72.0% |                           316 |               549 |             3,007 |                201 |        30,222 |
| status                 |     49,948 |                    59 |      32,689 |             65.4% |                           554 |               459 |             3,007 |                 28 |         4,260 |
| pull                   |     51,308 |                    57 |      34,565 |             67.4% |                           606 |               435 |             3,007 |                 26 |         3,910 |
| review                 |    250,174 |                   377 |     173,433 |             69.3% |                           460 |               727 |             3,007 |                228 |        28,128 |
| gallery, main document |     98,824 |                   202 |      66,354 |             67.1% |                           328 |               513 |             3,007 |                 95 |         9,888 |

By primitive, server HTML of the history page (`class-weight.mjs`, `results/class-weight.history.json`): 353,898 B of HTML, 18,153 B gzip. A Text element has 528 class characters on average (277 elements, 19 classes each); a control slot 843 (73 elements, 29 classes); a glider 1,230 and up to 3,314 (65 classes); the shell root 1,914 (49 classes).

The gallery has 11 documents (10 frames). Each frame document has its own instance of the same sheet: 11 x 3,013 rules. In production the 10 frames made 848 requests and 3,704,936 B on the wire in total.

### Does the unused part cost time in the browser? (`prune-ab.mjs`, measured)

A/B on the production preview, CPU slowed 4 times, runs alternated, 6 runs of each, one warm run of each before. "Full" is the built sheet (474,725 B). "Page" is the same entry compiled with only the classes that the page has (the smallest sheet that the same primitives can make for the page). Both go through the same request interception. Load average during the runs: 39 to 88 (median 65). Read the ratio, not the milliseconds.

| Page                                           | Metric                     |      Full: median (range) | Page sheet: median (range) | Ratio |
| ---------------------------------------------- | -------------------------- | ------------------------: | -------------------------: | ----: |
| history (1,116 elements; page sheet 169,817 B) | Parse the style sheet      |    13.2 ms (11.4 to 33.4) |        4.7 ms (4.2 to 5.7) |  2.81 |
|                                                | Style recalculation, total |   1,002 ms (773 to 1,976) |        749 ms (631 to 977) |  1.34 |
|                                                | First contentful paint     |     964 ms (684 to 1,292) |      806 ms (640 to 1,092) |  1.20 |
|                                                | Main thread tasks, total   | 1,795 ms (1,437 to 3,328) |  1,543 ms (1,316 to 1,891) |  1.16 |
|                                                | Script                     |       352 ms (318 to 437) |        359 ms (317 to 403) |  0.98 |
| inbox (300 elements; page sheet 159,280 B)     | Parse the style sheet      |    11.8 ms (11.1 to 13.5) |        4.5 ms (3.7 to 5.0) |  2.62 |
|                                                | Style recalculation, total |       238 ms (225 to 403) |        216 ms (189 to 262) |  1.10 |
|                                                | First contentful paint     |       338 ms (276 to 408) |        292 ms (252 to 508) |  1.16 |
|                                                | Main thread tasks, total   |       702 ms (667 to 935) |        675 ms (585 to 724) |  1.04 |

Gallery, 11 documents, 1,038 different classes in the 11 documents, page sheet 230,402 B, 5 runs of each, load average 58.5 to 66.4 (`results/prune-ab.gallery.json`):

| Metric                                                               |      Full: median (range) | Page sheet: median (range) | Ratio |
| -------------------------------------------------------------------- | ------------------------: | -------------------------: | ----: |
| Parse the style sheet (count: 9 to 11 parses, one for each document) |       122 ms (108 to 135) |           62 ms (55 to 65) |  1.98 |
| Style recalculation, total                                           | 2,378 ms (2,108 to 3,473) |  2,429 ms (2,261 to 2,875) |  0.98 |
| Layout, total                                                        | 1,860 ms (1,636 to 2,034) |  1,864 ms (1,325 to 2,190) |  1.00 |
| Script                                                               |       338 ms (321 to 389) |        357 ms (307 to 438) |  0.95 |
| Main thread tasks, total                                             | 3,867 ms (3,475 to 5,369) |  4,025 ms (3,744 to 4,792) |  0.96 |

Reading: the parse of 475 KB of CSS is small (about 12 ms for one document with the CPU slowed 4 times, 122 ms for the 11 documents of the gallery). On one page, the unused two thirds of the sheet add 10% to 34% to the style recalculation, and 75% to 90% of the style recalculation stays when the sheet has only the classes of the page. On the gallery, a sheet of half the size changes nothing that this test can see (ratio 0.96 to 1.00 for style, layout, and tasks). So the larger cost is in the rules that the page does use, in the number of elements, and in the number of documents, not in the size of the file.

Limit of this test: the request interception serves the sheet to each document, so the 11 parses can be more than a browser does with its own cache. The recording stops 3 s after the load event.

## 6. D. The development form

Commands: `node dev-form.mjs http://127.0.0.1:4332 /preview/page/inbox/ariakit results/dev-form.4332.inbox.json`, the same for the shared server 4320, `node fetch-css.mjs`, `node diff-rules.mjs`, `node regen-timing.mjs results/regen-timing.json 7`, `node tailwind-log.mjs`, `node hmr-observe.mjs`.

What the browser gets for one document (counted):

- Two `<link rel="stylesheet">` and no `<style>` tag. `/src/styles.css` is 516,982 B (12,639 lines, not minified, no `Content-Encoding`, `Cache-Control: no-cache` with an ETag). `/@tanstack-start/styles.css?routes=...` is 0 B with `Cache-Control: no-store`: one more request for each document, each time.
- The sheet has 1 copy of the Tailwind preflight, 1 copy of `ui.css`, 1 `.ak-layer` rule. So the lab does NOT have the 2 and 4 copies that the audit found in the real app (SHELL-05). The link with `?url` in `src/routes/__root.tsx` is the reason.
- One bare preview page in development makes 289 to 291 requests and 18.6 to 18.9 MB on the wire, of which the style sheet is 0.52 MB (2.8%). The gallery makes 3,188 requests and 22.3 MB (`results/snap2.coverage.dev.log`, load 31 to 36). The same pages in the production preview: 77 to 98 requests and 1.6 to 1.9 MB; the gallery 848 requests and 3.7 MB.

### The sheet of a long session grows (counted)

The shared server (port 4320, "started long ago") sent 614,316 B and 3,884 rules at 04:47. A new server on almost the same source sent 516,982 B and 2,713 rules. `results/shared-vs-fresh.diff.json`: 1,171 rules (88,556 B) are only in the old server. 1,087 of them (83,964 B) are for classes that are in no file of `apps/lab` now, for example `@container/bar`, `inset-x-5`, `-top-[1.5rem]`.

Cause (documented, `@tailwindcss/vite/dist/index.mjs`, class with `candidates = new Set`): `for (let i of this.scanner.scan()) this.candidates.add(i)`. The set only grows. When the plugin makes a new compiler (`requiresBuild()`), it does not clear the set. Only a restart of the server clears it. The README of the lab says that round 1 had 109 component variants and 4 directions, and that most of them are gone (documented). Their classes are still in the sheet of that server: +19% bytes, +43% rules. That the removed files are the source of these classes is an inference: the classes are in no file now, and the plugin never removes a class.

### Time for Tailwind to generate the sheet after a change (measured)

Three servers on three copies of `snap2`, the same change in each, order rotated, 7 rounds, 700 ms wait for the watcher, then the request of the link. Load average (1 min) during the run: median 47.8, range 40.5 to 56.6.

| Change                                        | Server                           | Request after the change: median (range) | Second request (cached): median |                               Sheet changed | Has the new class |
| --------------------------------------------- | -------------------------------- | ---------------------------------------: | ------------------------------: | ------------------------------------------: | ----------------: |
| Comment added to a source file                | lab config (with `freshStyles`)  |                     137.8 ms (84 to 250) |                          6.0 ms |                                      0 of 7 |                   |
|                                               | without `freshStyles`            |                     120.3 ms (83 to 170) |                          4.0 ms |                                      0 of 7 |                   |
|                                               | `source("./")` (scan `src` only) |                      68.1 ms (63 to 630) |                          4.3 ms |                                      0 of 7 |                   |
| New class added to a source file              | lab config                       |                      301 ms (123 to 708) |                         42.5 ms |                                      7 of 7 |            7 of 7 |
|                                               | without `freshStyles`            |                    350 ms (114 to 1,010) |                         12.4 ms |                                      7 of 7 |            7 of 7 |
|                                               | scan `src` only                  |                      228 ms (134 to 745) |                          8.1 ms |                                      7 of 7 |            7 of 7 |
| New source file with a new class              | lab config                       |                    390 ms (168 to 1,836) |                         11.9 ms |                                      7 of 7 |            7 of 7 |
|                                               | without `freshStyles`            |                      6.1 ms (3.9 to 354) |                          5.8 ms |                                      0 of 7 |        **0 of 7** |
|                                               | scan `src` only                  |                      157 ms (116 to 754) |                         11.6 ms |                                      7 of 7 |            7 of 7 |
| Line added to `docs/fixtures.md` (not source) | lab config                       |                    443 ms (114 to 2,579) |                         52.4 ms |                                      0 of 7 |                   |
|                                               | without `freshStyles`            |                    765 ms (353 to 1,667) |                         16.6 ms | 1 of 7 (the classes of the new files above) |                   |
|                                               | scan `src` only                  |                     15.3 ms (4.7 to 313) |                         14.9 ms |                                      0 of 7 |                   |

The timers of Tailwind itself (`DEBUG=tailwindcss`, `results/tailwind-log.json`), for each generation: lab config 82 ms median (45 generations, range 32 to 593; scan 36 ms, "register dependency messages" 23 ms, build 6 ms); without `freshStyles` 84 ms (22 generations); scan `src` only 39 ms (26 generations; scan 14 ms, register 6 ms). The first generation after the start of a server: 196 ms (compile 33, scan 74, register 17, build 70).

Answers:

- Is `freshStyles` necessary? Yes, for a new file, as long as the sheet is a link. Without it, a new file with a new class had no CSS in 7 of 7 rounds. Its handler for `change` is not necessary: without the plugin, a changed file still made a new sheet in 7 of 7 rounds, because the Tailwind plugin registers each scanned file with `addWatchFile`.
- What does it cost on each change? Nothing that this lane can measure: 138 ms against 120 ms at a load of 48 is inside the range of both. The plugin only drops a cache entry. The cost of a change is the generation (about 0.1 s) and what the browser does next.

### What an open page does after a change (measured, `hmr-observe.mjs`)

One page open on the lane server with the lab configuration (4332), one change, 6 s of recording, 2 rounds. Load average 27 to 59.

| Change                                         | Preview page (1 document)                                                                                       | Gallery (11 documents)                                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nothing (control)                              | 0 requests                                                                                                      | 0 to 26 requests                                                                                                                                                                     |
| Comment added to one page module               | Vite sends `css-update /src/styles.css?direct` and 1 `js-update`. 1 style sheet request, 517,896 B. 4 requests. | 11 `css-update` messages. 11 style sheet requests (1 from the network, 519,166 B; 10 from the memory cache). Style recalculation 934 to 1,132 ms in the 6 s (control: 48 to 150 ms). |
| Comment added to `styles/button.ts`            | `css-update` and 13 `js-update`. 26 requests.                                                                   | 11 `css-update`. 300 to 302 requests. Style recalculation 1,050 to 1,311 ms, script 1,353 to 1,576 ms.                                                                               |
| Line added to `docs/fixtures.md`               | **`full-reload`**. The document loads again: 291 requests.                                                      | **11 `full-reload` messages**. 1 reload of the page and 7 to 20 frame loads in 6 s: 238 to 3,179 requests.                                                                           |
| Line added to `audit/reports/second-lens-1.md` | **`full-reload`**: 291 to 499 requests.                                                                         | **`full-reload`**: 15 to 21 frame loads, 2,652 to 3,176 requests in 6 s.                                                                                                             |

The same on the server that scans only `src` (4334): a line added to `docs/fixtures.md` or to `audit/reports/second-lens-1.md` makes 0 messages, 0 requests, 0 reloads (2 of 2 rounds each).

Cause (documented, `@tailwindcss/vite/dist/index.mjs`, hook `hotUpdate`): when a changed file is not a JavaScript or CSS module and a Tailwind root scanned it, the plugin sends `{ type: "full-reload" }`. The lab root has `audit` and `docs`, so each write of an agent to a report, to the audit content, or to a Markdown document reloads each open lab document and each of its frames.

How often that happened (counted, `results/doc-writes.json`, lower limit): of the 477 scanned files outside `src`, 462 were written in the last 24 hours, 338 in the last 12 hours, 80 in the last 3 hours, in at least 19 different minutes.

## 7. E. What the lab does that it does not need, in the CSS path

| Item                                                                                                      | Cost (counted or measured)                                                                                                                                                                      | Change that removes it                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind scans `apps/lab/audit` and `apps/lab/docs`: 477 of 767 scanned files, 16.2 of 18.4 MB            | 44,747 B of CSS (9.6%, 6,254 B gzip) for 326 classes that only documents name. Generation 82 ms against 39 ms. **A full reload of each open lab document on each write to one of these files.** | One line in `apps/lab/src/styles.css`: `@import "tailwindcss" source("./");`                                                                 |
| The development server is never restarted                                                                 | +97,334 B and +1,171 rules in the sheet of the shared server at 04:47 (+19% bytes, +43% rules), for classes of deleted files                                                                    | Restart the server after a large removal of files.                                                                                           |
| Recipes that no page of the design reaches: `tabs.ts`, `choice.ts`, `table.ts`, `checkbox.ts`, `radio.ts` | 83,354 B (20.8% of the sheet of the design). In the lab, only the route `/primitives` uses them.                                                                                                | For the real app: do not copy them, or `@source not "./components/ariakit/styles/tabs.ts";` and so on. The lab needs them for `/primitives`. |
| The handler `change` of `freshStyles`                                                                     | Not measurable. It repeats what the Tailwind plugin does.                                                                                                                                       | Optional: keep only `server.watcher.on("add", invalidate)`.                                                                                  |
| Fonts: 13 `@font-face` rules for 12 subsets                                                               | 6,169 B. The browser downloads only the subsets that the text needs.                                                                                                                            | None needed.                                                                                                                                 |
| `knobs.css`                                                                                               | 1,980 B, 26 rules                                                                                                                                                                               | None needed.                                                                                                                                 |
| Duplicate imports, safelists, `@source inline`                                                            | None found: 1 copy of each import, 0 exact duplicate rules.                                                                                                                                     |                                                                                                                                              |
| The empty link `/@tanstack-start/styles.css` (TanStack Start, not the lab)                                | 1 request with `no-store` for each document: 11 on the gallery                                                                                                                                  | Tool stack.                                                                                                                                  |

## 8. F. What an app can do, and what only the primitives can do

An app, with no change of the primitives:

1. Give Tailwind an explicit source: `@import "tailwindcss" source("./");`. Lab: -44,747 B and no reload from documents. Real app today: 0 B (its tooling and migrations add no valid class that the source does not have), but the same reload happens there when a scanned file that is not a module changes (`CHANGELOG.md`, `migrations/*.sql`, `tooling/**`).
2. Do not scan the recipes that the app does not use: -83,354 B for the six pages.
3. Compile the sheet one time (the audit finding FE-09 for the real app): -114,948 B of duplicate rules in the existing build.
4. Restart the development server after large removals.
5. Keep one style sheet link in development (as the lab does), not a module import that makes two style tags.

Only the primitives or `@ariakit/tailwind` can change these (each with the place in their source):

1. **A recipe file costs all its classes when one export is used.** Mechanism: Tailwind scans `styles/*.ts` as text; `cv({ extend: [...] })` pulls whole recipes. Example: `button` extends `control`, `gliderAnchor`, `hover`, `focusHighlight`, `active` and so reaches 11 recipe files and 118,820 B.
2. **An `ak-*` utility repeats its formula in each class and in each variant of the class.** `@ariakit/tailwind/src/output.css` line 816: `@utility ak-ink-*` sets `--_ak-text-alpha` and then repeats `--ak-text: oklch(from var(--ak-layer) ... var(--_ak-text-alpha))` (249 B) and `color`. The lab sheet has that declaration 38 times (9,462 B). `ak-layer-offset-*` (line 187) repeats four formulas (985 B a class, 5 copies of the block for offset 0 alone). `layer.ts` already uses the cheaper form for two props: `"ak-layer-contrast ak-layer-contrast-(--layer-contrast)"` and `"ak-layer-mix ak-layer-mix-amount-(--layer-mix)"`: one class has the formula, and the value class only sets the input. The same split for `ak-ink`, `ak-layer-offset`, `ak-layer-push`, `ak-state`, and `ak-frame-cover` removes most of the 72,313 B of repeated blocks.
3. **The contrast tables of `ak-text`** (line 578): 24,620 B for two copies, because `ui.css` line 1329 (`@custom-variant ui-text`) makes a second selector for the same block.
4. **The variants of `ui.css` have long selectors with `:has()`.** 315 classes use one: 139,612 B. `ui-hover` is `:hover:not(:is(:disabled,[aria-disabled=true])):not(:has(button:hover),:has(:hover>button))`. The sheet has 423 selectors with `:has()` and 225 style queries with 301 rules.
5. **247 registered custom properties** (`@property`): 139 in `@ariakit/tailwind`, 30 in `ui.css`, the rest from Tailwind. 17,961 B, and a cost for each element at style time that this lane did not measure.
6. **Class attributes.** A Text has 19 classes and 528 characters, a control slot 29 classes and 843 characters, a glider 65 classes and 3,314 characters. 65% to 72% of the HTML of a page is class attributes. A default variant adds classes even when it does nothing visible.

## 9. Servers of this lane

| Port | What                                            | Started                                                                                                 | Stopped                                                    |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 4331 | `vite preview` of `snap2`                       | 04:30                                                                                                   | 05:05, `node stop.mjs 4331` (SIGTERM to the process group) |
| 4332 | `vite` (dev) of `devfresh`, `DEBUG=tailwindcss` | 04:46                                                                                                   | 04:58, `node stop.mjs 4332` (SIGTERM to the process group) |
| 4333 | `vite` (dev) of `devnofresh`                    | 04:46 (first try failed: inspector port 9239 was taken by the server started at the same moment), 04:47 | 04:58, `node stop.mjs 4333`                                |
| 4334 | `vite` (dev) of `devsrconly`                    | 04:46                                                                                                   | 04:58, `node stop.mjs 4334`                                |

Check at 05:05: `lsof -nP -iTCP:4331-4339 -sTCP:LISTEN` lists nothing, `pgrep -fl "perf/css/"` lists nothing, and port 4320 still has its listener (process 92473, the shared server, not touched). `git status --short` of the worktree is the same as at the start (`M pnpm-lock.yaml`, `?? apps/lab/`).

Observation: the empty folder `apps/lab/node_modules/.vite-temp` of the real lab has the modification time 04:48:25. No Vite process of this lane started at that time, and each copy of this lane has its own `node_modules/.vite-temp`. So another process loaded the Vite configuration of the real lab then.

## 10. What this lane could not measure

- The state of the lab that the maintainer used (round 2, before the removals of round 3). The oldest copy that builds is from 04:27. The existing `apps/lab/dist` of 03:12 has 475,107 B, so the size did not change much.
- Exact used bytes from the DevTools protocol. Chrome gave wrong ranges for rules inside `@layer`. The bytes come from a selector test in the page, which does not evaluate `@container` and `@media` conditions.
- Absolute times. The load average was 14 to 88. Each timing is a comparison inside one run.
- The cost of the 247 registered properties, of the 225 style queries, and of the `:has()` selectors for each element. That is a question for the runtime lane.
- The real app in a browser. Its numbers here are from its source and from its existing build. The size of its sheet with the new design is an estimate from the lab files of the six pages.
- Why one bare preview page needs 18.6 MB in development. The style sheet is 0.52 MB of it. That is a question for the development server lane.
- Safari and Firefox. Only Chrome ran.

## 11. Files

Scripts: `lib.mjs`, `setup-copy.mjs`, `snapshot.mjs`, `make-dev-copy.mjs`, `run-in.mjs`, `serve.mjs`, `stop.mjs`, `scan-files.mjs`, `build-css.mjs`, `anatomy-file.mjs`, `repeats.mjs`, `attribute.mjs`, `growth.mjs`, `used-by-design.mjs`, `show.mjs`, `coverage.mjs`, `coverage-debug.mjs`, `class-weight.mjs`, `prune-ab.mjs`, `dev-form.mjs`, `fetch-css.mjs`, `diff-rules.mjs`, `regen-timing.mjs`, `tailwind-log.mjs`, `hmr-observe.mjs`, `doc-writes.mjs`.

Results in `results/`: each script writes one JSON file, named in the command of its section. Style sheets: `snap2.min.css`, `snap2.dev.css`, `web.min.css`, `web.dev.css`, `devsrconly.min.css`, `shared-4320.dev.css`, `devfresh-4332.dev.css`, `prune.*.page.css`. Server logs in `logs/`.
