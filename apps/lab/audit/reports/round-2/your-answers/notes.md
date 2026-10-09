# Merge notes: "Your answers" and D-RES-06 (revision r2)

Work folder: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/merge/`
Date: 2026-10-06. Repository: `github.com/ariakit/visonaut`, worktree `serialized-dazzling-pixel`, commit `f83fef6`.
Skills loaded after `git remote -v`: `ariakit-general-workflow`, `ariakit-general-code-style`, `ariakit-ariakit-api-design`.

The repository was read only. `git status --short` shows the same two entries before and after (`M pnpm-lock.yaml`, `?? apps/lab/`). No request went to production.

Short names in this file:

- `CONS` = `round2/consistency/result.json` (the key is named after it, for example `CONS.conflicts C04`).
- `D1T` = `round2/d1-writes/table.json`. `D1N` = `round2/d1-writes/notes.md` (with its section number).
- `V-<lane>` = `round2/results/verify__<lane>.json`.
- `OVR` = `round2/settled-overrides.json`.
- `FB` = `round2/feedback.md`.

## 1. Files changed in `merge/content`

| File                                | Change                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sections/15-your-answers.html`     | New section, id `your-answers`, directly after the summary. 7 parts, 1 calculator demo, 1 sequence demo.                                                                                                                                                                       |
| `sections/65-resilience-a11y.html`  | New part "Queue or direct save" (`#resilience-a11y-save-path`) after the D-RES-02 panel, with a compare demo and the panel of D-RES-06. The lead no longer says "four choices need your answer". The demo cell near D-RES-05 now says "D-RES-05 decides the text of this row." |
| `decisions.json`                    | New object `D-RES-06` after `D-RES-02`: status `open`, 2 options, none recommended. The other 51 objects are equal to the record (compared as JSON).                                                                                                                           |
| `terms.json`                        | 3 new terms at the end: `decision queue`, `task row`, `direct save`.                                                                                                                                                                                                           |
| `sections/10-summary.html`          | The stat "Decisions for you: 51" is now "Decisions: 52" (46 settled, 6 open). The table "Where to start" is replaced by two paragraphs with a pointer to the new section. The three answers did not change. The section is shorter than before.                                |
| `sections/40-data-storage.html`     | Lead, the stat "Captures until the stop", and one calculator hint now name the stop of about 4,750 captures when every capture changed. Two cells of the first table and one note before the D-DATA-01 panel name the r2 form of the settled answer.                           |
| `sections/25-run-load.html`         | The gzip sentence beside D-RUN-03 no longer says "beside D-DATA-02". It says that r2 checked gzip and does not offer it, with two measured numbers.                                                                                                                            |
| `sections/35-state-checks.html`     | Two notes "Revision r2", before the panels of D-OPS-01 and D-OPS-05. See part 5 of this file.                                                                                                                                                                                  |
| `sections/60-workspace-viewer.html` | 12 places that named four lab designs, or Console, Changes feed, or Focus as current. See part 4.                                                                                                                                                                              |

`record.json`, `findings.json`, and the other 8 section files are byte-equal to the record.

## 2. Facts of `sections/15-your-answers.html`, with their source

### Part 1, "What this revision holds"

| Fact                                                                                                    | Source                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 52 decisions, 46 settled, 6 open                                                                        | Counted from `merge/content/decisions.json` after the new decision.                                                                                    |
| 4 of the 6 have a recommended option                                                                    | The same file: D-OPS-04, D-DATA-02, D-WORK-04, D-RES-05.                                                                                               |
| D-OPS-04: 3 situations, 6 options, 2 new in the panel, 8 lines in place of 44                           | `V-ops-04` (summary, checks, recommendation); `decisions.json` D-OPS-04.                                                                               |
| D-DATA-02: 5 options, 1.58 MB in place of 12.15 MB at 3,832 captures, no D1 write, about 8,000 captures | `V-data-02` (recommendation, wrongIf); `decisions.json` D-DATA-02 context.                                                                             |
| D-DATA-04: opened again by the rule about D1 writes                                                     | `decisions.json` D-DATA-04 context and rationale; `V-d1-writes` recommendation for D-DATA-04.                                                          |
| D-WORK-04: two new options, 1,251 against 2,091 rows for 246 changes                                    | `V-work-04` (summary, recommendation).                                                                                                                 |
| D-RES-05: one new option, 0 rows written, 2 rows read for each person                                   | `V-res-05` (summary, recommendation).                                                                                                                  |
| The bar counts 48 answers                                                                               | `record.json`: `incorporated` has a selection for D-DATA-04 and for D-WORK-04, which are open in the record. Seen in the browser ("48 / 52 answered"). |

### Part 2, "Your three rules"

| Fact                                                                | Source                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The words of the three rules                                        | `FB`, "Standing rules that the notes give".                                     |
| 49 answers checked; 40 the same or fewer; 4 more; 3 with a new form | `D1N` section 1 (39 the same, 1 fewer, 4 more, 4 with a condition, 1 one-time). |
| 17 places and 7 unsafe things                                       | `CONS.compatibility.items` (K01 to K17) and `.notSafe` (N1 to N7).              |
| No redirect for `/?view=`                                           | `OVR` D-UX-02.                                                                  |
| D-DATA-02 says that the rows are not less code                      | `V-data-02` remainingDoubts; `decisions.json` D-DATA-02 option `capture-rows`.  |

### Part 3, "D1 writes"

| Fact                                                                                                                                     | Source                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Price: 50 million rows written included, 1.00 USD for each million; 25 billion rows read, 0.001 USD; page of 2026-04-21, read 2026-10-06 | `D1N` sections 2 and 2.2; `CONS.conflicts C01` evidence.                                                                                                                 |
| 102 USD, 151.67 million rows, 95.46% from five test databases                                                                            | `D1N` section 2.5.                                                                                                                                                       |
| Local D1 with 33 migrations; each probe ran again with the same rows                                                                     | `D1N` sections 3.1 and 3.2; `V-d1-writes` checks.                                                                                                                        |
| Baseline: sign-in 14 (4 + 10); page request 0, 1 after 24 hours; 20 reads 0                                                              | `D1N` section 4.1.                                                                                                                                                       |
| Decision 27 = 22 + 5, 13 for the task row; whole screenshot 46                                                                           | `D1N` section 4.2.                                                                                                                                                       |
| Check updates 110 with 9 active runs, 11 for each                                                                                        | `D1N` section 4.3.                                                                                                                                                       |
| Submit 64, the same for 1 and 100 captures; capacity check 2 (counted); about 31 for each changed capture (estimate)                     | `D1N` section 4.4.                                                                                                                                                       |
| Scheduled pass 1, 288 each day; refused try 3; webhook receipt 4 and 6                                                                   | `D1N` sections 4.5 and 4.6.                                                                                                                                              |
| D-OPS-05: 3 for each try, 60 for 20 tries; read-only check 0; 2 fewer for each new run; alert at the next pass                           | `D1T` D-OPS-05; `D1N` section 6.1; `OVR` D-OPS-05.                                                                                                                       |
| D-OPS-01 row 8: 1 row for each pass; the snapshot time; `/api/operations` returns it; needs the D-OPS-05 form                            | `D1T` D-OPS-01 row 8; `D1N` section 6.2.                                                                                                                                 |
| D-OPS-01 row 12: 2 then 1; read of dead tasks, 2 rows read among 2,002, 0 written; needs an age limit                                    | `D1T` D-OPS-01 row 12; `D1N` section 6.2.                                                                                                                                |
| Six indexes: 28 against 27, 64 against 59; rewrites 1,203,980 to 6,581; 2,000 runs and 300 alerts                                        | `D1T` D-DATA-01 (indexes); `D1N` section 6.3 and section 9 item 2.                                                                                                       |
| Title table: 7 against 6; title in the payload: the same 6                                                                               | `D1T` D-DATA-01 (title); `CONS.checker.experiments[0]` (2 rows and 2 rows for the settle update, INSERT 4).                                                              |
| The payload example with #7746 and "Fix dialog focus"                                                                                    | `CONS.conflicts C11`.                                                                                                                                                    |
| One statement changes (`webhooks.ts:332`), two run around a restore                                                                      | `CONS.conflicts C11` and `CONS.checker.corrections[0]`. `D1T` says "5 statements": the two lanes disagree, and I used the more exact reading of the consistency checker. |
| Inventory alert: 2 then 1; read of the size in the run row                                                                               | `D1T` D-DATA-01 (alert); `D1N` section 6.3.                                                                                                                              |
| D-UX-04 title: the same store                                                                                                            | `OVR` D-UX-04.                                                                                                                                                           |
| Four answers with a condition (D-RUN-02 5 rows, D-AUTH-04 1 row, D-UX-04, D-WORK-06 46 + 13 = 59)                                        | `D1N` section 5.2; `D1T`.                                                                                                                                                |
| D-DATA-04: about 25 to 55 rows, counted from code; about 370 rows at Submit                                                              | `D1N` section 6.4; `D1T` D-DATA-04.                                                                                                                                      |
| One-time writes: 10 rows for 10 accounts, a guard gives 0; ADD COLUMN 1 row                                                              | `D1N` sections 6.5 and 2.1.                                                                                                                                              |
| D-DATA-02 baseline: 0 or 2 rows; no old run converted                                                                                    | `V-data-02` correction 5.                                                                                                                                                |
| Opportunities: 47 in place of 137; 13 or more; 1,251 against 2,091; 3 fewer and DROP INDEX 0; 2 in place of 4                            | `D1N` section 7 "Opportunities"; `CONS.conflicts C04`; `V-work-04`; `D1T` "remove two old indexes".                                                                      |
| D14 in words                                                                                                                             | `D1N` section 6.3 point 3 (`docs/current-contract.md:58`).                                                                                                               |

The calculator `demo-answers-d1` uses these numbers only: 27, 11, 64, 2, 288 (today); 28, 5 + 1, 288 (r1 as written); 50,000,000 and 1.00 USD (price). The rule "11 rows for each active run and for the baseline run" is `D1N` section 7, row 2. The start values 50 decisions and 9 active runs are inputs, not facts. 19 runs is the middle of "450 to 680 runs each month" (`D1N` section 5.4).

One inference of mine: the table gives the 3 rows for each decision to the index `work_tasks_review_queue` alone. The lane measured 3 fewer for each decision with both old indexes removed. The other index is on the webhook table, which a decision does not write.

### Part 4, "No backward compatibility"

Each table row is one item of `CONS.compatibility.items`, in the order K01 to K17, shortened. The column "Decision" is the key `lookAgain`, with one or two decisions from the key `where` when `lookAgain` is empty. The list "Where the rule is not safe" is `CONS.compatibility.notSafe` N1 to N7. The first paragraph is `CONS.compatibility.productionToday` (kind: assumption). The last paragraph is the last item of `CONS.compatibility.safe`.

### Part 5, "Your questions"

| Fact                                                                                                       | Source                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-LOAD-04: "Yes", the reason, the two pages, the date                                                      | `CONS.notes.D-LOAD-04.shortAnswer` and `.documentation`.                                                                                                                                                             |
| The one condition; 0.9 to 2.0 s and 41 to 119 ms                                                           | `CONS.notes.D-LOAD-04.needs[0]` and `.numbers`.                                                                                                                                                                      |
| The four other needs; `disableRefresh`, Better Auth 1.7.5; 0 rows                                          | `CONS.notes.D-LOAD-04.needs`; `D1T` D-LOAD-04.                                                                                                                                                                       |
| The browser test of the checker, and what is not tested                                                    | `CONS.checker.experiments[2]`; `CONS.notes.D-LOAD-04.notVerified`.                                                                                                                                                   |
| D-CODE-05: "Partly"                                                                                        | `CONS.notes.D-CODE-05.shortAnswer` ("Yes for the database and the storage ... Two parts ... are not a Wrangler feature").                                                                                            |
| The commands, Wrangler 4.136.1, the page dates                                                             | `CONS.notes.D-CODE-05.documentation`.                                                                                                                                                                                |
| The repository today, the tool, the watch points                                                           | `CONS.notes.D-CODE-05.repositoryToday`, `.whatIsNotAWranglerFeature`, `.watch`.                                                                                                                                      |
| D-CODE-04: 329 files, 99,041 words, 8.3 MB; 5 files, 12,242 words; the two tables; 368 links; 3 code paths | `CONS.notes.D-CODE-04` (`stays`, `moves`, `totals`, `linksToChange`, `codeThatReadsMovedFiles`). I added the three small files into one row (1,036 + 900 + 401 = 2,337 words) and the two design files into one row. |
| The two points that need your word; the same repository                                                    | `CONS.notes.D-CODE-04.needsTheMaintainer` and `.whatTheSameRepositoryMeans`.                                                                                                                                         |

The page has no quote of a documentation page. `CONS.checker` says that the quotes came through a tool that can shorten a page. So each documentation fact is in my words, with a link and the date.

The code sketch of the loader is mine. It shows the needs of the lane (`ssr: "data-only"`, a returned promise, one function with a server form and a browser form). Its label says "sketch, not built". `readRuns` and `DashboardLoading` are names of the sketch.

### Part 6, "Where your answer differs"

Each row is one entry of `CONS.differs`, shortened. Two rows follow the settled text of r2 where it is newer than the lane text: D-OPS-05 ("The capacity check must only read", `OVR` D-OPS-05) and D-DATA-04 ("this decision is open again", `decisions.json`).

### Part 7, "How the answers fit together"

The 17 table rows are `CONS.conflicts` C02 to C18, in that order. C01 is the part "D1 writes". Three rows have their r2 state and not the lane text:

- C04: the row points to D-RES-06.
- C08: the letters W and O are in the settled text as a proposal (`OVR` D-WORK-02).
- C11: settled on the payload (`OVR` D-DATA-01 and D-UX-04).

The sequence demo `demo-answers-order` is `CONS.packages` P0 to P8, in that order. Three changes follow r2: step 1 names the 6 open decisions (the flags C01 and C11 of P0 are settled by `OVR`); step 3 no longer holds back the indexes, the title, and the heartbeat, which have a form with no write; step 5 says "D-DATA-04 if you keep it".

The page does not print the identifiers C02 to C18 and P0 to P8. `terms.json` has the terms C02, P01, P02, and P03 for earlier decisions of the contract, so the lane names would get a wrong tooltip or look like them.

## 3. Facts of D-RES-06 (section 65 and `decisions.json`)

| Fact                                                                                                                                                                               | Source                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The question, and that it is a question and not a proposal; 2026-10-02, contract line 196, PR #190                                                                                 | `CONS.conflicts C04` (`first`); `V-consistency` recommendation "C04". I confirmed the date with `git log -1 8ebf821` (read only).                                                                                                                              |
| The page sends `queued: true`; POST `/api/comparisons/<id>/commands`; 202 with `queued` and `commandId`; a GET of `/api/commands/<command ID>/queued` after 500 ms and each 500 ms | `CONS.conflicts C04`. Confirmed in `apps/web/src/review/client.ts:305-338` and `apps/web/src/api/review.ts:799-836` and `:872-878`.                                                                                                                            |
| Queued receipt: 202 while not complete; 200 with the result and the model; 409 with the model and no reviewer field                                                                | `apps/web/src/api/review.ts:812-835`, read in this task.                                                                                                                                                                                                       |
| Direct path: 200 with the result, the reviewer, and the run status, with no model when the revisions agree; conflict 409 with the model and the reviewer of the row                | `CONS.conflicts C04` and `CONS.checker.corrections[7]`. Confirmed in `review.ts:879-904` and `:682-697`.                                                                                                                                                       |
| The page code reads the direct answer already                                                                                                                                      | `client.ts:324-337` (the loop runs only while `queued` is true), read in this task; finding REVIEW-06 ("applySavedReview already handles a receipt without a model").                                                                                          |
| Task row: 5 + 4 + 4 = 13 rows, 3 indexes, a lower limit, the later DELETE                                                                                                          | `CONS.conflicts C04` evidence; `D1N` section 4.2. The DELETE is at `apps/web/src/operations/closed-summary.ts:306-314`.                                                                                                                                        |
| 27 rows for one variant; 22 in the queued save = 8 for the task row + 14 for the decision                                                                                          | `D1N` section 4.2 (22 fixed rows and 5 for a variant).                                                                                                                                                                                                         |
| "About 14" for a direct save                                                                                                                                                       | A subtraction: 27 - 13. No probe ran the direct path. The page labels it as an estimate. Both paths call `service.review` (`review.ts:879` and `processReviewQueue` in `apps/web/src/operations/review-queue.ts`), which is why the subtraction is reasonable. |
| The answers and rows that exist only for the queue                                                                                                                                 | `CONS.conflicts C04` (`what`).                                                                                                                                                                                                                                 |
| What the queue gives; what nobody measured                                                                                                                                         | `CONS.conflicts C04` (`first`); `CONS.checker.remainingDoubts[3]`; `CONS.differs.D-RES-02.watch`.                                                                                                                                                              |
| "5 times at most"                                                                                                                                                                  | `apps/web/src/operations/review-queue.ts:62` (`maxAttempts: 5`); finding STATE-04.                                                                                                                                                                             |
| "The page sends one decision request at a time"                                                                                                                                    | `client.ts:306-323` (the `admission` chain), read in this task. Nobody tested it on the direct path.                                                                                                                                                           |
| No third option                                                                                                                                                                    | The handler has two branches (`review.ts:872` and `:879`). No lane designed a middle way, so the panel has two options.                                                                                                                                        |

Evidence chips of the decision: API-13, RESIL-03, RESIL-04, STATE-04, REVIEW-06, REVIEW-07 (all in `findings.json`).

## 4. Repairs in section 60 (lab designs)

The task says: you selected Ariakit folio for each page, and the other three designs left the lab.

- Lead: "the four layouts are in the lab" is now one open choice and the selected design.
- "The lab has four designs of this page": now the selected design, with its one measured value (y = 118) against the app of today (y = 408, section 70).
- Table "What the lab answers": "Review workspace, 4 designs" is now "the design Ariakit folio".
- Table "Earlier decisions that ... a lab design reopens": 5 cells. "Approve 14 seen" keeps the name Changes feed as history ("which left the lab"), because the option `seen-set` of D-WORK-04 names it.
- The two sentences about the letters that the lab designs print: Ariakit folio only.
- "Where the button goes": the table of four designs is one paragraph about Ariakit folio.
- The sentence before D-WORK-06: Ariakit folio only.

Not changed: "four designs" in the scope part, which are four D1 designs of the run approval and not lab designs.

## 5. Changes that the task list did not name

Three small notes, each with the heading "Revision r2":

- Section 35, before the D-OPS-01 panel: rows 8 and 12 have another form.
- Section 35, before the D-OPS-05 panel: the capacity check only reads.
- Section 40, before the D-DATA-01 panel, and two cells of the first table: no index, no title table, a read in place of the alert.

Reason: the fix tables and the migration sketches beside these three panels still show the forms of r1 (a heartbeat row, an alert row, `0035_pull_request_titles.sql`, `0036_scan_indexes.sql`). The settled text in the panel says another form. Without a note, the text beside a settled panel contradicts the panel. Each note points to `#your-answers-d1-forms`. The coordinator can remove them.

## 6. Checks

- `node apps/lab/audit/build.mjs --strict --content merge/content --out merge/out`: passes. 16 sections, 52 decisions, 558 findings, 273 terms, 74 demos. Each output is 1.49 MB of 16 MB.
- `node apps/lab/audit/check.mjs --dir merge/out`: "All checks passed." 148 pass lines, 0 fail lines (log: `scratch/check.log`).
- `pnpm exec oxfmt merge/content`, then `pnpm exec oxfmt --check merge/content`: "All matched files use the correct format."
- Browser (Playwright, Chrome channel, file URL, `scratch/look.mjs` and `scratch/look2.mjs`, log `scratch/look.log`, pictures in `shots/`), at 1440 px and at 400 px:
  - No console error, and no sideways page scroll (0 px). No element of the new parts is wider than the page outside a scroll box.
  - I read the screenshots of the complete new section at 1440 px, the first screens at 400 px, the D-RES-06 part at both widths, the decision panel at 400 px, the summary, and two repaired places.
  - Calculator: start values give 8,392, 8,844, and 8,354 rows each day, 250,620 rows in 30 days, 0.50%, 0.00 USD, 0.25 USD. I checked the three sums by hand. Maximum and minimum of each slider, then Reset: the start values return.
  - Sequence: Next to step 9 of 9, the button of step 5, Play (moves to step 6), Reset (step 1).
  - Compare: both tabs (27 and 14 D1 rows, "13 D1 rows fewer"), "Show all panels", Reset.
  - D-RES-06 panel: 2 options, 0 "Recommended" labels, state Open.
  - 51 anchor links of the new section, of the summary, and of the repairs: each target exists and stops below the sticky bar. One real click on the summary link.
  - 7 new external links answered HTTP 200 (`scratch/links.mjs`). The GitHub blob links use the commit and the line numbers that I read in the worktree.
- After the first look I repaired: the table of the nine answers was wider than its box at 1440 px (now 4 columns); decision identifiers broke at a hyphen (now one line each); a "?" term mark beside two links; the caption "Four answers and three fix rows" (it is two and five); the long unit of the compare badge.

## 7. Not checked

- Production. Each number about production is from the lanes, and the lanes read no production data.
- The direct save path: nobody ran it, in a probe or in a browser. "About 14 rows" is a subtraction.
- The documentation pages: I requested each link (HTTP 200) and did not read the pages again. The facts are those of the lane, which fetched each page two times.
- The compatibility items K02, K03, K09, K11, K12, K15, K16, and K17: the lane checker did not read their code lines, and I did not.
- The lab itself. I did not open `apps/lab` to confirm what Ariakit folio prints (W, O, B, 0, the split button). The sentences keep the facts that section 60 already had for that design.
- Sections 55 and 70, the decision text of D-UX-04 and of D-WORK-04, and one comment in section 60 still say "four designs" or name the other three lab designs. They are outside the list of the task, and a decision text must not change.
- Section 40, line "1.45 MB with gzip" in the retention part: the D-DATA-02 lane measured 1.51 MB for another file size, and it did not correct this line. I left it.
- Section 20 still has the r1 sketch of the D-LOAD-05 loader with `ssr: false`. The new section has the one loader for D-LOAD-04 and D-LOAD-05. I did not change section 20.
- The light theme, a screen reader, and a real phone.
- The published Artifact. I built and checked the local outputs only, and published nothing.

## Independent check

Date: 2026-10-06. A second agent checked the work above. Skills loaded after `git remote -v` (origin is `github.com/ariakit/visonaut`): `ariakit-general-workflow`, `ariakit-general-code-style`. The repository was read only: `git status --short` shows the same two entries (`M pnpm-lock.yaml`, `?? apps/lab/`). No request went to production.

The files of the first agent are kept in `checker/before/`. The scripts of the check are in `checker/`: each `edit-*.mjs` made one group of changes, `look.mjs`, `measure.mjs`, and `calculator.mjs` opened the page, `compare-record.mjs` compared the copy with the record, and `links.mjs` requested the external links.

Where parts 1 to 7 of this file and this section disagree, this section is correct.

### What the check confirmed

- **Scope.** `compare-record.mjs`: the 51 existing decisions are equal to the record as JSON. D-RES-06 is the only new decision, it is open, and it comes directly after D-RES-02. 46 are settled and 6 are open. `record.json`, `findings.json`, and 7 section files are byte-equal to the record. 3 terms are new, and no existing term changed.
- **Facts.** I read each number of the new section against `consistency/result.json` (conflicts, packages, compatibility, notes, differs, checker), `d1-writes/notes.md` and `table.json`, the six `verify__<lane>.json` files, and `settled-overrides.json`. The numbers agree, with the corrections below.
- **The story of D-RES-06, in the code.**
  - `apps/web/src/api/review.ts:872-878`: the queued branch (`enqueueReview`, `wakeReviewStatus`, HTTP 202).
  - `review.ts:879-904`: the direct branch (`service.review`, HTTP 200 with `reviewer` and `runStatus`, and no model when the revisions agree).
  - `review.ts:682-697`: `conflictResponse`, HTTP 409 with the model and the reviewer of the row.
  - `review.ts:799-836`: the receipt read (202, 200 with the model, 409 with no reviewer field).
  - `review.ts:641-667`: the server processes the task in `waitUntil` of the same request.
  - `apps/web/src/review/client.ts:305-338`: line 317 sends `queued: true`, the requests go one at a time, and the poll waits 500 ms.
  - `apps/web/src/operations/review-queue.ts`: `maxAttempts: 5`, and the order by `previousCommandId`.
  - `packages/service/src/work.ts:82-166`: the insert, the lease, and the completion of a task row.
  - `apps/web/src/operations/closed-summary.ts:312`: the later delete.
  - `docs/current-contract.md:196`: the quote "Admitted commands survive its closure". The commit `8ebf821` has the date 2026-10-02.
- **The calculator.** The formulas use 27, 11, 64, and 1 row for each pass (measured), 2 rows of the capacity check and 1 row of the six indexes (counted from the code), and the documented price. The start values give 8,392, 8,844, and 8,354 rows each day. With 1 active run they give 3,992, 4,444, and 3,954. I calculated each by hand. The title starts with "Estimate", and the limits say that the result is not a recording.
- **Links.** 244 anchor links of the changed parts have a target, at both widths. 10 external links answered HTTP 200 (`links.mjs`). Line 872 of `review.ts` and line 317 of `client.ts` are the cited lines at commit `f83fef6`.

### Corrections of facts

| Where                                         | The first text                                                                | The problem                                                                                                                                           | The text now                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Section 15, table of open decisions, D-RES-05 | "One option is new"                                                           | r1 had `nobody`, `numeric-id`, `login`. r2 has `nobody`, `you-or-another`, `stored-name`, `login-at-sign-in`.                                         | "3 of its 4 options are new."                                                                                    |
| Section 15, lead; section 10                  | "5 that your notes keep open"                                                 | D-DATA-04 has no note. The rule about D1 writes opens it.                                                                                             | "5 that your notes or your rule about D1 writes keep open"                                                       |
| Section 15, D-DATA-02; section 25             | "One row for each capture"                                                    | Beside the rule about D1 writes, a reader takes "row" as a D1 row. `d1-writes/notes.md` 5.4 says that a D1 row for each capture would break the rule. | "one short row for each capture in the one R2 file ... These are not D1 rows."                                   |
| Section 15, D-OPS-04                          | "no later workflow edit needs a service change"                               | The lane says that the consumer does nothing for a later edit. It does not say "service change".                                                      | "a later edit of an Ariakit workflow file needs no pin cutover"                                                  |
| Section 15, opportunities, direct save        | "13 or more fewer for each decision", with the label Measured                 | The 13 rows of the task row are measured. Nobody ran a direct save.                                                                                   | The label is on the 13 rows only. The state column says "Nobody measured a direct save."                         |
| Section 15, opportunities, old index          | "3 fewer for each queued decision" for `work_tasks_review_queue` alone        | The lane measured 24 against 27 with both old indexes removed.                                                                                        | "24 in place of 27 for a decision, with both old indexes removed". The other index stays for the title lookup.   |
| Section 15, baseline, refused reserve call    | 3 rows                                                                        | The checker of the consistency lane got 4 rows for the first refusal and 3 for each later one.                                                        | 3, and "A second measurement got 4 rows for the first refusal."                                                  |
| Section 15, the nine answers, D-LOAD-04       | "It removes a gap of 199 to 303 ms", with the label Measured                  | The gap is measured. Nobody built the loader.                                                                                                         | The label is on the gap of today only.                                                                           |
| Section 15, limits of the calculator          | No word on the wait of D-OPS-05 or on check updates with six indexes          | The output "as r1 wrote them" leaves out the refused tries (3 rows each). Nobody measured a check update with the six indexes.                        | Both are in the limits.                                                                                          |
| Section 15, D-DATA-04                         | The release for old runs was only in a table row                              | I removed that row, because it repeated the paragraph above.                                                                                          | One sentence in the paragraph: "At the start, each run that is already past the 30 days needs one such release." |
| Section 35, text below the stats              | "6 more questions are your choice."                                           | 5 of the 6 are settled in r2.                                                                                                                         | "Of the 6 other questions, 5 are settled as you selected. One is open in revision r2: D-OPS-04."                 |
| Section 65, demo of D-RES-06, step 2          | "A scheduled pass each 5 minutes does the same work."                         | No lane file says this. The code says that the task stays for the operations consumer (`review.ts:655-657`).                                          | "If that fails, the operations queue processes the task later."                                                  |
| D-RES-06, option `keep-queue`                 | "so the reviewer has that protection and does not know it"                    | It reads as an argument against the answer to D-RES-02, which is settled.                                                                             | "The server continues after a close, as today, and with your answer to D-RES-02 the page does not say so."       |
| D-RES-06, context                             | 7 sentences. The reason for no recommendation was there and in the rationale. | A context is short, and the reason belongs to the rationale.                                                                                          | 5 sentences.                                                                                                     |

### Changes for a reader with 10 minutes, and for a page of 400 px

- **Short version first.** One paragraph below the lead says that the first two parts are the short version and that the other parts are reference. The row of three numbers (52, 46, 6) repeated the lead and the summary, so it is gone.
- **Tables that fit 400 px.** At 400 px, the tables with 3 columns or more scrolled sideways in their box, and so did two tables with 2 columns that had a forced width. The reader saw the first column or two. Now:
  - "Decisions that need you" has 2 columns: the decision with its question, and what changed with "Recommended:".
  - "Your three rules" is 3 blocks, each with the quote and the text, in place of a table.
  - The answers that would add writes (5 columns) and the nine answers (4 columns) have 2 columns, with a label in front of each fact.
  - The compatibility table and the table "Where answers meet" have 2 columns. The decision and the topic moved into the first cell.
  - The baseline table has the label "Measured" one time on its caption, not in each of the 8 number cells.
  - The two panels of the D-RES-06 demo are numbered lists of steps, each with its answer and its D1 rows.
  - One table of the section still scrolls in its box at 400 px: "What moves" (4 columns with file names), which is folded.
- **Folded.** The table "What else the server read needs" of D-LOAD-04 and its two notes are in one folded block. The answer, the condition, and the sketch stay open.
- **Plain words.** "A lane" is "one agent of this round". "Probe" is "measurement". The index name `work_tasks_review_queue` is in the sentence above its table, because it could not wrap in a cell. The baseline table says what the capacity snapshot and the reserve call are.

### Checks of the final copy

- `node apps/lab/audit/build.mjs --strict --content merge/content --out merge/out`: passes. 16 sections, 52 decisions, 558 findings, 273 terms, 74 demos. Each output is 1.49 MB of 16 MB.
- `node apps/lab/audit/check.mjs --dir merge/out`: "All checks passed." 148 pass lines and 0 fail lines (`checker/check.log`).
- `pnpm exec oxfmt --check merge/content`: "All matched files use the correct format."
- Browser (Playwright, Chrome channel, file URL, log `checker/look.log`, pictures in `checker/shots/`), at 1440 px and at 400 px:
  - 0 px of sideways page scroll, and 0 console errors.
  - I read the pictures of the top of the section, the D1 part, the calculator, the compatibility table, the nine answers, and the D-RES-06 part.
  - Calculator: the start values, each slider at both ends, Reset.
  - Sequence: 8 times Next, then Reset.
  - Compare: the tab "Direct save", then Reset.
  - Panel of D-RES-06: 2 options, 0 selected, 0 "Recommended" labels.
  - Three real clicks on anchor links: each target stops below the sticky bar.

### For the coordinator

- **Do not copy `sections/70-design-lab.html` from this copy.** Another process changed that file in the repository at 19:33, after this copy was made at 18:56. The copy has the older text. A test build of this copy with the newer file of the repository passes `--strict` (`checker/with-repo-70/`).
- Section 15 is long: about 16,700 px at 1440 px and about 29,200 px at 400 px, with each folded block open. It is longer at 400 px than before, because the tables no longer hide columns.
- The three notes "Revision r2" of part 5 stay. I agree with them: without a note, the r1 fix tables beside the three settled panels contradict the settled text.

### Not checked

- Production, and the direct save path in a running service.
- The documentation pages: I requested each link (HTTP 200) and did not read the pages again.
- The compatibility items K02, K03, K09, K11, K12, K15, K16, and K17 against their code lines.
- The lab app, the light theme, a screen reader, a real phone, and the published Artifact.
