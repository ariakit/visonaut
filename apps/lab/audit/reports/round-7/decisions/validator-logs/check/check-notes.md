# Independent check of the drafts for items 1 and 8

Date: 2026-10-07. The checker wrote none of the drafts. The author files, as they were before the check, are in `check/author-original`. The checker changed `decisions.json`, the three files in `fragments`, and `closed.md`. It added one section to the end of `notes.md`. It changed no file below the worktree, made no Git or GitHub write, sent no request to production, and started no server on a reserved port.

Skills that the checker loaded: `ariakit-general-workflow`, `ariakit-general-markdown`, `ariakit-ariakit-api-design`.

## Files of the check folder

| File                                                        | Content                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `author-original/`                                          | The author files before the check, with their SHA-256 in the output of `backup-author.sh` |
| `browser-bad-images.mjs`, `.json`                           | Experiment 1: 6 files in Chromium, Firefox, and WebKit                                    |
| `filter-byte.mjs`, `.json`                                  | Experiment 2: a PNG that the structure parse accepts and pngjs refuses                    |
| `gh-reads.sh`                                               | The read-only GitHub reads (all GET)                                                      |
| `show-lines.mjs`, `show-decisions.mjs`, `show-findings.mjs` | Readers of the code and of the stable record                                              |
| `make-draft.mjs`                                            | Makes `content` from the stable copy of revision r7 and checks the form of the drafts     |
| `content/`, `out/`                                          | The draft content folder and the built draft page                                         |
| `shots.mjs`, `shots/`                                       | Pictures of the three panels and the three demos at 1440 px and at 400 px                 |

## Two experiments

Experiment 1. Question: what do the three steps of the review page (load, `element.decode()`, compare `naturalWidth` and `naturalHeight` with the stored size: `apps/web/src/components/screenshot-viewer.tsx:49-71` and `155-161`) report for bad files? The script answers each request itself with the headers of `apps/web/src/api/images.ts:48-57`. It does not use the review page. Declared size: 640 by 360.

| File                                | Chromium 153.0.8010.12             | Firefox 155.0   | WebKit 26.6   |
| ----------------------------------- | ---------------------------------- | --------------- | ------------- |
| The committed screenshot            | Ready                              | Ready           | Ready         |
| Text with a script                  | Error at load                      | Error at load   | Error at load |
| Header of 30,000 by 30,000          | Error at load                      | Error at load   | Error at load |
| 200 changed bytes in the image data | Ready, 0 of 360 rows have pixels   | Error at decode | Ready         |
| Cut after 4,000 bytes               | Ready, 77 of 360 rows have pixels  | Ready           | Ready         |
| Cut at one half                     | Ready, 120 of 360 rows have pixels | Ready           | Ready         |

"Ready" means that the page shows the image and Approve is on. The text file, opened directly at an address with the same headers, ran no script in each of the three browsers. Limits: small files, one computer, and the row counts of Firefox and WebKit say only that each row has a pixel that is not transparent.

Experiment 2. A PNG of 64 by 64 pixels with correct chunks and a filter byte of 9. `validateImage` accepted it. `PNG.sync.read` of pngjs refused it ("Unrecognised filter type - 9"). So the structure parse does not prove that the CLI can decode a stored file.

## Corrections

1. The review page and damaged files. The author wrote in option 2 of D-PRE-01 that the review page refuses a damaged PNG and a cut PNG. Measured: it accepts a damaged PNG in Chromium and WebKit and a cut PNG in each of the 3 browsers. The decision, the fragment, and C1 and C3 of `closed.md` now state the measured result. The reasons of the recommendation changed with it.
2. The worst case and a byte check. The author wrote that a check of the bytes does not close the worst case because the job can send a valid PNG with wrong pixels. That mixes two results. A wrong picture in the baseline does not stop a later Submit. A file that the CLI cannot decode does. The texts now say: a byte check makes the case smaller and does not close it (experiment 2).
3. Who is stopped by a bad file in the baseline. The author wrote "each later Submit that changes that screenshot". From `packages/cli/src/local-comparison.ts:260-285`: the CLI decodes the baseline image when its own image has another digest, and a real capture never has the digest of a bad file. So the Submit of each pull request that has the screenshot fails.
4. The example of D-PRE-02. The author wrote that a GitHub answer of 502 for a check result makes the step "checks" fail. It does not. `deliverStatus` catches the error and returns "ambiguous" (`packages/service/src/work.ts:538-549`), and the creation of a check has its own catch (`apps/web/src/operations/checks.ts:171-191`). The step counts one failed item. The decision and the fragment now show two ways of failure: an item that fails inside a step (GitHub), and a step that stops (D1).
5. The text in D1 for a GitHub failure. The author wrote that D1 already holds "the full error text" for a failed check result. For a GitHub failure that text is the fixed sentence of the class (`String(error)` at `work.ts:546`, the sentence at `packages/security/src/github.ts:25`), with no status number. So no place holds the status today.
6. Contract line 81 in C6. The author wrote that option 2 of D-PRE-02 adds three names to line 81, and also that line 81 is about another log line. Both cannot be true together. C6 now has one row for each place where the implementation can write the values.
7. A precedent that the author did not name. `apps/web/src/runtime.ts:334-358` already writes the fixed code of an error to the failure line, when the code is on a list of 13. It supports option 2 of D-PRE-02.
8. A settled answer that the author did not name. D-OPS-07 (settled) says that the public check has no screenshot name, and its option text names D25 (the results for each image stay private). D-PRE-03 now says how it relates: its message is about a file that the CLI cannot accept, never about a review result. Option 2 now forbids a comparison result in the message.
9. "The same public log" in D-PRE-03. The 212 lines are in the log of the job "App / Visual Capture (linux)", and the CLI prints in the job "App / Visual Submit". Both are public logs of one run. The texts now say "the capture job of the same run".
10. C4 of `closed.md` held a rename of log events and duration fields. Row 7 as accepted does not hold a rename. C4 now says so.
11. C3 of `closed.md` had no source for "one correct behavior". The source is `docs/review-guide.md:41`.
12. The form. The context of D-PRE-01 had about 1,700 characters and the consequences of its option 1 about 2,300. The largest ones of the 58 decisions of the record are 983 and 1,402. The three decisions are now inside those sizes, and the detail is in the fragments.
13. No demo. AUTHORING.md asks for a working example for each material tradeoff. Each fragment now has one `compare` demo.
14. The sketch of option 2 of D-PRE-01 did not check the length field of the header, and the measured function did. The sketch now has the line.

## Facts that the checker confirmed

Each of these is the same as the author wrote: `workflow-owned.ts:1038-1044`; `images.ts:48-57`; `screenshot-viewer.tsx:49-71` and `158`; `review-workspace.tsx:302-307` and `385-394`; `oidc.ts:150-156`, `210-212`, `300`; `baseline-promotion.ts:114` and `380`; `api/index.ts:190-205`; `api/local-comparison.ts:535` and `548`; `service/local-comparison.ts:592-593` and `627`; `png-comparison.ts:10-40`; `canvas.tsx:73`; `operations/index.ts:81-88` and `103-109`; `failure.ts:13` and `22-23`; `github.ts:23-27`, `84-87`, `91-93`; `work.ts:543-546`; `validate.ts:81-92` and `131-139`; `http.ts:175`; `bundle-submit.ts:69-71`; `visual.ts:356-357`; `README.md:15-18`; contract lines 24, 32, 48, 81, and 188; 529 lines of validators; 1,935 lines of `apps/compare`; 5 uploads at one time (`engine.ts:33`).

Read again with `gh` on 2026-10-07: ariakit/ariakit is public; 5 accounts have push access; the rule of main asks for 1 approval, a code owner review, and an approval of the last push, with the required checks Gate and Visonaut; the Submit job 112971239530 ran from 19:19:19 to 19:22:39; the capture artifacts end after 1 day. The saved capture log has 212 lines with `VISUAL_TEST_DURATION_JSON`.

## Checks that ran

1. `node check/make-draft.mjs`: each decision has the keys of the record, one recommended option, the status open, evidence ids that exist, and no long dash.
2. `node apps/lab/audit/build.mjs --check --content check/content --out check/out`: 16 sections, 61 decisions, 568 findings, 290 terms, 81 demos, 0 warnings.
3. `node apps/lab/audit/check.mjs --dir check/out`: all checks passed for both outputs, at 1440 px and at 400 px, on the final draft. An earlier run with `--shots` had one failure, a timeout of 30 s for the picture of the full page at 1440 px. The same check passed with no `--shots`.
4. `node check/shots.mjs`: each panel has its options, one "Recommended" label, no selection, and no horizontal page scroll at 400 px.

## Doubts that stay

1. The browser test did not use the review page itself, and it used files of 23 KB. A file of 2 MiB was not tested.
2. No time and no memory value is from a Worker.
3. The line counts of the options are estimates. Nobody built an option.
4. "From code reading, most failures that stop a whole step are D1 failures" comes from 4 of the 10 steps (checks, review links, promotion, review decisions).
5. Nobody tested a repair of a baseline that holds a bad file.
6. The access to the Worker log and the time that Cloudflare keeps a line are assumptions.
7. That a person with no access can read the job log of a public repository comes from the GitHub documentation. So does `RUNNER_DEBUG=1`.
8. D-PRE-02 and D-PRE-03 are small. Each has a clear recommended option. They are decisions because the record promised the maintainer a choice ("until you allow more", "need your yes") and his authorization of the implementation did not name them.
9. The place of each fragment comes from the stable copy of revision r7.
10. The final ids are open. Sections 35 and 45 use D-OPS and D-CODE: D-OPS-08, D-CODE-06, and D-CODE-07 are free in revision r7.
