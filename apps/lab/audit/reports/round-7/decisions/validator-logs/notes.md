# Notes: items 1 and 8 (validator and log contents)

Date: 2026-10-07. Worktree: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. This part wrote only below `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/validator-logs`. `git status --short` at the end shows the same two entries as at the start (` M pnpm-lock.yaml`, `?? apps/lab/`).

Skills that this part loaded: `ariakit-general-workflow` and `ariakit-general-markdown`. `git remote -v` gives `https://github.com/ariakit/visonaut.git`.

## Files of this folder

| File                                                        | Content                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `decisions.json`                                            | 3 open decisions: D-PRE-01, D-PRE-02, D-PRE-03                                                               |
| `fragments/D-PRE-01.html`, `D-PRE-02.html`, `D-PRE-03.html` | One section fragment for each decision. The comment at its start names the section file and the place.       |
| `closed.md`                                                 | 6 things that are not decisions                                                                              |
| `scripts/`                                                  | Each script that this part ran                                                                               |
| `scripts/measure-byte-checks.json`                          | The raw result of the byte check measurement                                                                 |
| `evidence/`                                                 | 2 public job logs of ariakit/ariakit, run 37671649487                                                        |
| `check/content`                                             | A draft content folder: the stable copy of revision r7, the 3 decisions, and the 3 fragments in their places |

## Commands

Each command ran from the worktree root. No command wrote below the worktree.

1. `git -C <worktree> remote -v`
2. `node scripts/show-decisions.mjs` and `node scripts/show-decisions.mjs D-OPS-04 D-CODE-02 D-OPS-01 D-CODE-01 D-AUTH-04` (reads `content/decisions.json`)
3. `node scripts/show-findings.mjs --keys`, with finding ids, `--exists <ids>`, and `--grep <pattern>` (reads `content/findings.json`)
4. `node scripts/show-settled.mjs D-WORK-04 D-WORK-06`
5. `node scripts/measure-byte-checks.mjs` (imports `packages/compare/src/image.ts` and `pngjs` of `packages/cli`; writes `scripts/measure-byte-checks.json`)
6. `sh scripts/count-compare.sh` (counts tracked lines of `apps/compare`)
7. `node scripts/make-draft.mjs` (makes `check/content`, and checks the form of the 3 decisions)
8. `node apps/lab/audit/build.mjs --check --content <this folder>/check/content --out <this folder>/check/out`. Result: `content 16 sections, 61 decisions, 568 findings, 290 terms, 78 demos`, `checked 0 warning(s). No file was written (--check).`
9. `grep` and `wc -l` reads of the files in the list below.
10. Read-only `gh` commands, all GET:
    - `gh api repos/ariakit/ariakit/rules/branches/main`
    - `gh api repos/ariakit/ariakit/contents/.github/workflows/app.yml --jq .sha`
    - `gh api "repos/ariakit/ariakit/collaborators?permission=push&per_page=100" --jq length`
    - `gh api repos/ariakit/ariakit --jq '{visibility, private}'`
    - `gh run list -R ariakit/ariakit --workflow ci.yml --limit 8`
    - `gh run view 37671649487 -R ariakit/ariakit --json jobs`
    - `gh api --allow-escape-sequences repos/ariakit/ariakit/actions/jobs/112971239530/logs` and the same for job `112966055554`
    - `gh api repos/ariakit/ariakit/actions/jobs/112971239530`

No request went to `https://visonaut.com`. No server was started or stopped. No Git or GitHub write was made.

## Facts that I verified, with their source

### Item 1: the validator

| Fact                                                                                                                       | Kind                        | Source                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| The only server check of image bytes is the size and the SHA-256 digest                                                    | Counted from code           | `apps/web/src/api/workflow-owned.ts:1038-1044`                                               |
| The upload calls `POST /validate` only when the mode is not local                                                          | Counted from code           | `workflow-owned.ts:1066-1089`                                                                |
| The write goes to the IMAGES bucket                                                                                        | Counted from code           | `workflow-owned.ts:1103-1106`                                                                |
| The service refuses a capture whose declared type is not `image/png`                                                       | Counted from code           | `apps/web/src/api/local-comparison.ts:535`                                                   |
| The service limits the declared size to 2.1 megapixels and 8192 pixels for each side                                       | Counted from code           | `local-comparison.ts:548`, `packages/compare/src/types.ts:9-14` and `52-63`                  |
| The service limits: 2 MiB for an image, 40,000 captures, 2 GiB for a run                                                   | Counted from code           | `apps/web/src/runtime-defaults.ts:8-14`                                                      |
| The image route answers with the stored type, `nosniff`, a sandbox policy, and `Cross-Origin-Resource-Policy: same-origin` | Counted from code           | `apps/web/src/api/images.ts:48-57`                                                           |
| The stored type is one of `image/png` and `image/webp`                                                                     | Counted from code           | `apps/web/migrations/0001_service.sql:67`                                                    |
| The CLI parses and decodes each capture before Submit                                                                      | Counted from code           | `packages/cli/src/local-comparison.ts:32-46`, `packages/cli/src/png-comparison.ts:10-40`     |
| The CLI checks the path, the size, and the digest of each file                                                             | Counted from code           | `packages/cli/src/files.ts:64-110`                                                           |
| The CLI decodes the baseline image when the digests differ                                                                 | Counted from code           | `packages/cli/src/local-comparison.ts:275-285`                                               |
| The parse checks each chunk checksum, the chunk order, the color data, and the inflated size                               | Counted from code           | `packages/compare/src/png.ts:44-206`                                                         |
| The web Worker imports only `imageLimits` and `assertDimensions` of the compare package                                    | Counted from code           | `apps/web/src/runtime.ts:2`, `apps/web/src/api/local-comparison.ts:1`                        |
| The review page decodes the image and compares its size with the stored size                                               | Counted from code           | `apps/web/src/components/screenshot-viewer.tsx:49-71`                                        |
| Approve and Reject are off while the evidence is not ready                                                                 | Counted from code           | `apps/web/src/review/review-workspace.tsx:302-307`, `386`, `391`, `1045`, `1065`, `1083`     |
| A decision for the whole screenshot tests only the shown variant                                                           | Counted from code           | `review-workspace.tsx:385-394`, `apps/web/src/review/use-evidence.ts:40-45`                  |
| The lab stage tests only that an image loaded                                                                              | Counted from code           | `apps/lab/src/explorations/kits/ariakit/stage/canvas.tsx:73`                                 |
| The file check that D-OPS-04 removes                                                                                       | Counted from code           | `packages/security/src/oidc.ts:157-206`                                                      |
| The claims that stay: repository, run, commit, job name, head repository of the pull request                               | Counted from code           | `oidc.ts:150-156`, `210-212`, `259`, `300`                                                   |
| Only a run on main promotes a baseline                                                                                     | Counted from code           | `packages/service/src/baseline-promotion.ts:114` and `380`                                   |
| A new screenshot gets an automatic approval                                                                                | Counted from code           | `packages/service/src/local-comparison.ts:592-593` and `627`                                 |
| An upload credential cannot decide                                                                                         | Counted from code           | `apps/web/src/api/index.ts:190-205`                                                          |
| 5 accounts have push access to ariakit/ariakit                                                                             | Measured today              | `gh api` collaborators, count only                                                           |
| The branch rule: 1 approval, code owner review, approval of the last push, checks Gate and Visonaut                        | Measured today              | `gh api repos/ariakit/ariakit/rules/branches/main`                                           |
| The live `app.yml` has the blob `202fd63a37199f5ac4350bd7c4e4bc44ea442216`                                                 | Measured today              | `gh api` contents                                                                            |
| The Submit job has `id-token: write` and the name "Visual Submit"                                                          | Counted from the saved copy | `apps/lab/audit/reports/round-3/ops-04/consumer/github__workflows__app.yml.txt:224-236`      |
| `apps/compare` has 1,935 tracked lines without the lock file (455 in `src`, 682 in `test`, 591 in `container`)             | Counted today               | `scripts/count-compare.sh`                                                                   |
| The validators that `validateImage` needs have 529 lines                                                                   | Counted today               | `wc -l` of `png.ts`, `webp.ts`, `binary.ts`, `image.ts`, `profile.ts`, `exif.ts`, `types.ts` |
| The run on main of 2026-10-07 uploaded 0 images                                                                            | Measured today              | `evidence/ariakit-submit-job-112971239530.log.txt:315`                                       |

The measurement of the byte checks, in Node v24.18.0 on darwin-arm64, medians of 31 rounds (15 for the pngjs decode). The raw result is `scripts/measure-byte-checks.json`.

| Image                                                        | Encoded bytes | SHA-256  | PNG header | `validateImage` | pngjs decode |
| ------------------------------------------------------------ | ------------- | -------- | ---------- | --------------- | ------------ |
| `packages/compare/evidence/browser/chromium.png`, 640 by 360 | 23,264        | 0.008 ms | 0.001 ms   | 1.281 ms        | 2.333 ms     |
| The same page tiled to 1248 by 1650                          | 295,311       | 0.086 ms | 0 ms       | 13.971 ms       | 29.256 ms    |
| Worst case: 1448 by 1448 with a band of noise                | 2,094,027     | 0.606 ms | 0 ms       | 61.426 ms       | 39.936 ms    |

| Bad file                                                                   | PNG header | `validateImage`             |
| -------------------------------------------------------------------------- | ---------- | --------------------------- |
| HTML text with a script                                                    | refused    | refused (`image-format`)    |
| PNG whose header declares 30,000 by 30,000, with a correct header checksum | refused    | refused (`image-too-large`) |
| PNG with 200 changed bytes in the image data                               | accepted   | refused (`png-crc`)         |
| PNG cut after 4,000 bytes                                                  | accepted   | refused (`png-truncated`)   |

A first run of the same script gave 1.667 ms, 15.745 ms, and 62.456 ms for `validateImage`. The decision text uses 1.3 ms, 14 ms, and 61 ms. The comparison lane measured 14.37 ms for the second image (`apps/lab/audit/reports/compare/report.md:409`).

The memory value of option 3 of D-PRE-01 is a calculation: `inflateBounded` keeps the inflated parts and one joined copy (`packages/compare/src/binary.ts:40-67`). For 1448 by 1448 that is 2 times 8,388,264 bytes, about 16.8 MB, and 5 times that is about 84 MB. The record has "about 85 MB" for the same calculation.

### Item 8, first half: the pass log

| Fact                                                                                                                                                 | Kind              | Source                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The pass log line has `event`, `elapsedMs`, and `promotionMs`                                                                                        | Counted from code | `apps/web/src/operations/index.ts:103-109`                                                                                                                                                                                                |
| A step failure is caught with no error name, and writes an event row with the code `step-failed`                                                     | Counted from code | `operations/index.ts:78-88`                                                                                                                                                                                                               |
| The queue handler drops the error of a failed pass                                                                                                   | Counted from code | `apps/web/src/server.ts:164-167`                                                                                                                                                                                                          |
| A failed reconcile step writes the `operation-failed` line with a fixed code                                                                         | Counted from code | `apps/web/src/runtime.ts:397-403`                                                                                                                                                                                                         |
| The `operation-failed` line has fixed fields and two optional ones, `runId` and `taskId`                                                             | Counted from code | `apps/web/src/operations/failure.ts:13-25`                                                                                                                                                                                                |
| The code comment: "Fixed fields keep credentials, request payloads, and SQL out of Worker logs."                                                     | Counted from code | `operations/failure.ts:13`                                                                                                                                                                                                                |
| Contract line 81 names the `operation-failed` log and says "No request body, token, URL, SQL, raw exception, or private label is added to that log." | Read              | `docs/current-contract.md:81`                                                                                                                                                                                                             |
| `GitHubUnavailableError` keeps the upstream status and has the code `github_unavailable`                                                             | Counted from code | `packages/security/src/github.ts:23-27`, `80-87`                                                                                                                                                                                          |
| A network error or a timeout gives the same error with no status                                                                                     | Counted from code | `github.ts:91-93` (the timeout of 15 seconds is at line 78)                                                                                                                                                                               |
| 6 error classes of the server set a fixed `name`. A seventh, `ReviewCommandError`, is in the review client.                                          | Counted from code | `packages/security/src/errors.ts:8`, `packages/service/src/history.ts:14`, `packages/service/src/database.ts:27` and `35`, `packages/protocol/src/validate.ts:27`, `packages/compare/src/types.ts:44`, `apps/web/src/review/model.ts:180` |
| D1 already stores one full error text, 4,096 characters at most                                                                                      | Counted from code | `packages/service/src/work.ts:543-546`                                                                                                                                                                                                    |
| The cron runs each 5 minutes, and the queue has 1 consumer and 5 retries                                                                             | Counted from code | `apps/web/wrangler.jsonc:103-110`                                                                                                                                                                                                         |
| The Worker log is on (`observability.enabled`), with no log push and no tail consumer in the file                                                    | Counted from code | `apps/web/wrangler.jsonc:15-20`                                                                                                                                                                                                           |
| The second auditor: "An error class name and an upstream HTTP status are not a raw exception, but the maintainer must decide."                       | Read              | `apps/lab/audit/reports/operations/verification.md:257`                                                                                                                                                                                   |

### Item 8, second half: names in the CI log

| Fact                                                                                      | Kind                        | Source                                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| ariakit/ariakit is public                                                                 | Measured today              | `gh api repos/ariakit/ariakit`                                                                    |
| The CLI prints its failure as `visonaut: <message>` on the error stream                   | Counted from code           | `packages/cli/src/index.ts:36-45`, `packages/cli/src/engine.ts:923-934`                           |
| The message for an image that the CLI cannot accept names no screenshot                   | Counted from code           | `packages/cli/src/png-comparison.ts:34-39`                                                        |
| The CLI reads the error body for the statuses 503 and 409 only                            | Counted from code           | `packages/cli/src/http.ts:174-183`                                                                |
| `beginSubmission` replaces each error with one sentence                                   | Counted from code           | `packages/cli/src/bundle-submit.ts:69-71`                                                         |
| The capture adapter accepts 32 megapixels                                                 | Counted from code           | `packages/playwright/src/visual.ts:357`                                                           |
| A key has only letters, digits, and `. _ / -`, 256 characters at most                     | Counted from code           | `packages/protocol/src/validate.ts:131-139`                                                       |
| A display string refuses only control characters                                          | Counted from code           | `packages/protocol/src/validate.ts:81-92`                                                         |
| The example keys `dialog/open` and `react-light`                                          | Read                        | `packages/playwright/README.md:15-18`                                                             |
| The capture job of run 37671649487 prints 212 lines with the file and the title of a test | Measured today              | `evidence/ariakit-capture-linux-112966055554.log.txt`, 212 lines with `VISUAL_TEST_DURATION_JSON` |
| The Submit job of the same run prints 2 lines of the CLI                                  | Measured today              | `evidence/ariakit-submit-job-112971239530.log.txt:315` and `317`                                  |
| That Submit job ran from 19:19:19 to 19:22:39 UTC, 3 minutes 20 seconds                   | Measured today              | `gh api repos/ariakit/ariakit/actions/jobs/112971239530`                                          |
| The capture artifacts stay 1 day                                                          | Counted from the saved copy | `github__workflows__app.yml.txt:213`                                                              |
| 1248 by 1700 is 2,121,600 pixels, above the limit of 2,100,000                            | Calculation                 | `packages/compare/src/types.ts:11`                                                                |

## Facts of the record that are wrong or not exact today

1. **Row 7 of the table of D-OPS-01, and item 8 of the list.** The record says that contract line 81 forbids a raw exception in the pass log. Line 81 is about the `operation-failed` line of a failed request ("that log"). The pass writes another line, `operations_pass` (`operations/index.ts:103-109`). The rule for the pass log is the code comment at `operations/failure.ts:13`, and the row D13 of the contract ("Keep safe fields", line 57). The sense is the same, the cited line is not exact.
2. **Contract line 81 against the code.** Line 81 lists "fixed operation, code, correlation ID, and elapsed-time fields". The code also writes `runId` and `taskId` when it has them (`operations/failure.ts:22-23`). I found no place of section 35 that names this (a search for `taskId` gave 0 lines).
3. **The rationale of D-OPS-04, the rationale of D-CODE-02, and the note "Revision r4".** They say that in a run with a replaced Submit job "nothing decodes the images". That is true for the service and for CI. It leaves out that the review page of today decodes each image that a reviewer opens, compares its size with the stored size, and keeps Approve off until then (`screenshot-viewer.tsx:49-71`, `review-workspace.tsx:302-307`). It also leaves out the two server checks of the declared values (`local-comparison.ts:535` and `548`).
4. **Item 1 of the list.** It names one remedy, "the last option of D-CODE-02". Two smaller checks exist: the PNG header (33 bytes), and the structure parse in the web Worker. The text of that option of D-CODE-02 names the parse in its last sentence only.
5. **The bullet "Failure cause" above D-CODE-01.** It asks for a yes to "capture names in a public CI log" and does not say that the capture job of the same run already prints the file and the title of each test in the same public log (measured today).
6. **`apps/lab/audit/reports/gap-trust-boundary/report.md:97`.** The row "Bytes that are not a PNG: No, the CLI decodes each capture" is true only while the Submit job runs the CLI. The record already says this in the note "Revision r4". The report file is history, so it needs no edit.

Facts of the record that I checked and found correct: 5 accounts with push access. 1 approval in the branch rule. "About 2,000 lines" for the comparison Worker (1,935 counted). The lines 1038 to 1044 as the only server check of the bytes. "About 85 MB" for 5 parses at one time (my calculation gives 84 MB). The 14 ms of the parse at 2.06 megapixels.

Facts of the record that I did not check again: the deploy step of 7 s and the 2 failures in 78 deploy runs. The 27 ms for parse and decode. The 4 answers of 503 for 5 calls. The count of 3,582 captures of a run.

## Doubts

1. **No browser test.** I did not open a file that is not a PNG, or a PNG with a header of 30,000 by 30,000 pixels, in a browser. The statement that the review page shows "The image could not be loaded" comes from the code (`onError` at `screenshot-viewer.tsx:155-161`). The memory that a tab uses for the large header is not known.
2. **No Worker measurement.** Each time of the byte checks is from Node on the audit computer. The CPU time and the memory in a Worker are not measured.
3. **The line counts of the options are estimates.** Nobody built the header check, the parse call, the log fields, or the CLI messages. "About 15", "about 10", "about 20", and "about 30" lines are my reading of the code.
4. **Who can read each log.** I did not read the Cloudflare account, so the access to the Worker log and the time that Cloudflare keeps a line are assumptions. I read the job logs of ariakit/ariakit with the account of the maintainer, so the statement that each GitHub user can read them comes from the GitHub documentation and not from a test.
5. **`RUNNER_DEBUG=1`.** Option 3 of D-PRE-03 uses the debug setting of GitHub Actions. I took its behavior from the GitHub documentation and did not test it.
6. **The review design is settled and lets a decision cover images that nobody opened** (D-WORK-04, D-WORK-06). So the review page check protects only an image that a reviewer opens. D-PRE-01 says this as a limit. I did not reopen those two decisions. If the maintainer wants the review page to be the validator of last resort, that is a new question for the workspace section, and it is not in this part.
7. **The D1 error text in the fragment of D-PRE-02** shows the form of a D1 error. It is not a recorded line, and the fragment says so.
8. **The header check accepts a PNG with damaged image data.** A reader can ask if option 2 of D-PRE-01 is then worth its lines. I kept it because it is the only check with no CPU cost and no memory cost that refuses bytes that are not an image.
9. **Is D-PRE-03 too small for a decision?** The evidence points one way, and the cost of each option is small. I made it a decision because the record asked for a yes, and the authorization of the implementation does not name what a public log may hold. The coordinator can fold it into the notes of D-CODE-01 if the maintainer wants fewer panels.
10. **`check.mjs` did not run.** The draft passes `build.mjs --check`. I did not open the built page in Chrome, so the look of the three fragments at 400 px is not checked. The four tables of the fragment of D-PRE-01 are wide and scroll in their box.
11. **Sections 35 and 45 are not in the list of sections that revision r8 changes.** The places of the fragments come from the stable copy of revision r7. If r8 moves `<div data-decision="D-OPS-01">`, `<div data-decision="D-CODE-01">`, or `<div data-decision="D-CODE-02">`, the place moves with it.
12. **The two logs in `evidence/`** are public data of ariakit/ariakit. I read them as data. They hold test names and no secret that I saw (the runner masks secrets).

## Corrections by the independent check (2026-10-07)

A second agent checked these notes and the drafts. The full list is in `check/check-notes.md`. These statements of the notes above are replaced:

- Item 1 of "Facts of the record that are wrong": line 81 is about the line `operation-failed`, that is correct. But the operations report puts the cause values on that same line (`apps/lab/audit/reports/operations/report.md`, lines 333 to 341). So the citation of line 81 in row 7 is not exact, and it is not wrong.
- Item 3 of the same list says that the review page "decodes each image that a reviewer opens ... and keeps Approve off until then". Measured: the three steps of the page accept a damaged PNG in Chromium and WebKit and a cut PNG in each of 3 browsers. They refuse a text file and a false header size (`check/browser-bad-images.json`).
- Doubt 1 ("No browser test") is closed for small files. The tab did not stop for the header of 30,000 by 30,000 pixels: each of the 3 browsers reported an error.
- Doubt 10 ("`check.mjs` did not run") is closed. It ran on the corrected draft and passed.
- The table of item 8 says that D1 stores "one full error text". For a GitHub failure that text is one fixed sentence with no status number.
- A GitHub failure in the step "checks" does not stop the step. The step counts one failed item (`packages/service/src/work.ts`, lines 538 to 549).
