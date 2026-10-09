## Independent check (second agent, 2026-10-06)

The checker did not see the reasoning of the first agent, only its files. Loaded skills: `ariakit-general-workflow`, `ariakit-general-code-style` (remote `https://github.com/ariakit/visonaut.git`). The repository was not changed. All files of the check are in `check/`. The first draft is kept in `check/first-draft/`.

Verdict: sound after repairs. The answer to the note ("partly") is right and does not flatter. One number that carried the recommendation was wrong, and the recommended option changed its content because of it.

### What the check confirmed

- **Bytes.** `pages.probe.ts`, `whole.probe.ts`, and `example.probe.ts` ran again (418 s). Each byte count, each page count, and each memory value is the same as in the first run (`check/results-first/` against `results/`). 592 of 657 values of `pages.json` are identical, and each different value is a time.
- **Code lines.** Each cited line was opened at commit `f83fef6`: `capture-inventory.ts:55-56`, `:181`, `:186`, `:367-368`, `:430-437`, `:530-531`; `cli/files.ts:9-11`, `:112-120`; `cli/artifact-archive.ts:7-11`, `:59-65`; `cli/bundles.ts:27`, `:126`, `:130`; `runtime-defaults.ts:7-18`; `wrangler.jsonc:39-42`; `workflow-owned.ts:181-187`, `:381`, `:538`, `:563`, `:1279`; `local-comparison.ts:45`, `:177-241`, `:488-602`, `:540`; `workflow-materialize.ts:263-420`, `:307`, `:337`; `run-admission.ts:542-565`, `:568-613`, `:644`; `promotions.ts:20`, `:304`; `recovery.ts:146-215`; `history.ts:530`, `:549-551`; `reporter.ts:237-254`; `validate.ts:114`, `:273`, `:398`; `baseline-reset/reset.ts:32`; `workflow-owned.test.ts:1398`. All are as the draft says. Submit validation has 3 calls for one run (`workflow-owned.ts:546`, `:1143`, `workflow-materialize.ts:273`).
- **Documents.** The checker downloaded the Markdown source of each Cloudflare page with `curl` (not a summary) on 2026-10-06, into `check/cf-*.md`: 128 MB "per-isolate, not per-invocation"; request body 100 MB on Free and Pro; R2 4.50 and 0.36 USD for one million and 0.015 USD for one GB-month; object 5 TiB; D1 10 GB, 1,000 queries for each invocation, 50 million rows written included and 1.00 USD for one million; Queues 128 KB and 15 minutes. GitHub: "Each job in a workflow can run for up to 6 hours of execution time."
- **Ariakit.** `gh api repos/ariakit/ariakit/contents/.github/workflows/app.yml` (GET): `timeout-minutes: 90` at line 228 and `visonaut@0.5.4` at line 252. Copy in `check/ariakit-app.yml`.
- **Arithmetic.** Each "Stops at" value of the path table was calculated again from its formula.
- **D1.** No write statement of declare, Submit, or materialization depends on the unchanged captures: `ingest_staged_images` and `visonaut_captures` get rows for uploaded images and changed captures only. `stagedCapability` (`workflow-owned.ts:250-275`) only reads, so a request for one page needs no D1 write. Pages add no row.
- **Retention.** The deletion of a run removes the prefix `runs/<id>/images/` when the run has an inventory (`operations/retention.ts:17-23`). Pages beside the index stay, as the one file stays today.

### What the check corrected

1. **The limit of step 1 (the claim that carried the recommendation).** The draft said: the readers keep their code, and a review read then holds two lists, 48 MB at 20,000 captures. Expected by the checker: more, because `readReviewInventory` builds more than the two lists. Measured (`check/review.probe.ts`, `check/review.json`): the real `completeReviewRows` on a copy of `readReviewInventory`, with both lists built from pages of 2,000 rows.

   | Captures | Two lists | With the values of `readReviewInventory` | With the review rows |
   | -------: | --------: | ---------------------------------------: | -------------------: |
   |    3,832 |    9.3 MB |                                  18.6 MB |              22.6 MB |
   |   10,000 |   24.2 MB |                                  48.6 MB |              59.3 MB |
   |   20,000 |   48.5 MB |                                  97.9 MB |             119.2 MB |
   |   40,000 |   97.1 MB |                                 195.9 MB |             238.6 MB |

   That is 5.96 KB for each capture, not 2.42 KB. The code makes `JSON.stringify(capture.metadata)` for each capture of both lists (`review-inventory.ts:23-31`) and one row with two JSON texts for each unchanged capture (`:138-163`). The review model and the response text are not in these numbers. With this reader the honest limit of step 1 is about 7,000 captures (three reads at the same time, finding WAIT-06), which is too near 5,700.

   Repair: the review read works page by page in step 1. It is the read that the settled answer of D-RUN-02 changes. The other steps keep their code.

2. **What the steps of Submit hold** was not measured in the draft. Measured (`check/submit.probe.done.ts`, `check/submit.json`), with the shapes of `validateLocalSubmission` and `materializeBundle` on a complete manifest and a complete baseline list from pages:

   | Captures | Manifest | Validation, baseline list alive | Materialization |
   | -------: | -------: | ------------------------------: | --------------: |
   |    3,832 |   3.9 MB |                         10.3 MB |         10.6 MB |
   |   10,000 |  10.1 MB |                         27.3 MB |         27.8 MB |
   |   20,000 |  20.1 MB |                         54.6 MB |         55.6 MB |
   |   40,000 |  40.1 MB |                        109.1 MB |        111.0 MB |

   That is 2.78 KB for each capture. The limit "about 20,000" now has this basis: one Submit holds 56 MB there, and two at the same time in one isolate hold 111 MB. The canonical texts and the D1 statements are not in the numbers. The number is not final until a Worker measurement (decision D54).

3. **The recommended option** got a new id and a new content: `row-pages-staged` ("Pages of rows now, Submit page by page later") in place of `row-pages-simple-readers`. The id was never published, so no saved selection exists for it.

4. **A stop was missing.** The capture job of Ariakit has `timeout-minutes: 120` (`app.yml:156`). At 4.67 captures each second, one job makes about 33,600 captures, and the Linux job has 68.7% of a run: the stop is at about 48,900 captures. The table has 18 rows now, and 14 limits are at or below 100,000 captures (8 stay with page readers).

5. **A reader was missing.** `referenceImageIds` (`local-comparison.ts:59-77`, used at `:470`) keeps a set of each image ID of the baseline in the isolate and reads the complete baseline to build it. The request of the CLI for a baseline image must name the page from step 1, or a later change needs a CLI release.

6. **The D1 query limit.** The draft said that nobody knows if the subrequest limit raises the 1,000 queries. The Workers page (updated 2026-09-05) says: "Subrequests to internal services: 1,000 [Free], Matches configured limit (default 10,000) [Paid]". The D1 page (updated 2026-04-21) says 1,000. The text names both and stays an assumption.

7. **The profile search** is not stable: 15.6, 37.7, and 16.8 s for one pass at 100,000 captures in three runs (`check/quadratic-second.json`, `check/quadratic-third.json`). The stop is "180,000 to 280,000", not "280,000".

8. **Two times of the page table** came from one noisy run: 397 ms for a page of 2,000 changed records was 225 ms in the second run, and 628 ms for 5,000 was 577 ms. The table says "about 220 ms" and "about 600 ms".

9. **"3.10 USD above the included amount"** was wrong as written: 3.1 million rows are 6% of the 50 million rows that the plan includes each month. They cost 3.10 USD only when the month is above that amount.

10. **The growth estimate** (20,000 captures in 2.3 years) assumes a straight line. The text now says that one new dimension in Ariakit doubles the count in one day, and the decision asks for the plan of the maintainer.

11. **Decision D54.** The draft said "You approve that number with the option". The text now says: the option approves the path, and the number is a setting that waits for a Worker measurement.

12. **Small things.** "The service part first needs one more change of the stored form" had no basis and left. The term "capture page" said 5,000 captures in a page, and the proposal is 2,000. The row "the review model" said step 2 for the unchanged list.

13. **Length and wording.** The decision text is shorter (the consequences of the recommended option had 330 words, now 250). The row names of the path table are short, so the table is less tall. Cut: the list of the three options (the panel explains them), two rows of the page table (10,000), the D1 column of the option table, one row of the directions, and two items of the last list. The part has 78 KB against 72 KB of the first draft, because of the new memory table, the new stop, and the new reader.

### Attempts to refute the recommendation

- **"The full design now is the right step, because the maintainer wants scale."** Not supported: also the full design stops at about 28,900 captures (512 MiB of images, a setting) and has 8 limits at or below 100,000. Its extra part is a rewrite of the two steps that check the trust of a run. The suite has 3,832 captures. It becomes right when Ariakit plans more than about 20,000 captures in the next year.
- **"A smaller step exists: one request of rows, pages only in storage."** True, and the first agent named it. The request of rows holds about 20,000 captures (5.3 to 13.5 MB), the same as the limit of step 1. It saves the page requests of the CLI now and costs a second CLI release and a second pull request in Ariakit later. Standing rule 3 (simpler for the consumer first) keeps the pages in the CLI. If D-OPS-04 removes the pins, this alternative gets cheaper. It is a real judgment, and the section names it in the directions table.
- **A hidden D1 write.** None found. See "What the check confirmed".
- **A pull request from a fork.** No difference: the trusted Submit job builds the pages. The capture job still writes the file of today.
- **A run at 500,000 captures.** Step 2 holds 26 MB for one step. A large removal at one place needs more baseline pages for one page of the run, which is more reads and not more memory with a walk. Not solved by any option: the 5 h 20 min of the Submit step, 30 hours of capture time, 9.3 GB of images, and about 15 million D1 rows when every capture changed.
- **The contract.** Line 26 changes (stated). D54 is respected after correction 11.

### Standing rules and new facts against each option

| Rule                                | Keep the format                          | Pages now, Submit later                             | Pages and page readers now             |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| 1. No more D1 writes                | same                                     | same (0 or 2 row updates one time for the baseline) | same                                   |
| 2. No backward compatibility needed | not used                                 | used: old runs lose their list                      | used                                   |
| 3. Simpler, consumer first          | nothing for Ariakit, but the limit stays | one pull request                                    | the same pull request, XL service work |
| 4. Hundreds of thousands            | no                                       | format yes, steps later                             | list yes, 8 other limits stay          |
| 5. Other repositories               | no effect                                | limit can be a value of each project                | the same                               |

### Build, check, and browser

- `node apps/lab/audit/build.mjs --strict --content <lane>/content --out <lane>/out`: passed (16 sections, 52 decisions, 558 findings, 279 terms, 76 demos).
- `node apps/lab/audit/check.mjs --dir <lane>/out`: all checks passed (`check/check-final.log`).
- `check/view.mjs` in Chrome at 1440 px and 400 px: no console error, no page overflow, each demo of the part used (2 compare demos with each panel, the path calculator at 100,000 captures and 16 jobs, the sequence to its last step, the option calculator at 100,000, at 500,000 with every capture changed, and at 20,000), each Reset gives the start state. Pictures in `check/shots/`, text of each state in `check/view.json`.
- `check/outside-part.py`: the section copy is byte-identical to the record before the heading of the part and after its decision panel.
- `check/apply-patches.py` builds `content/decisions.json` and `content/terms.json` from the files of the record and the two patch files. The 51 other decisions are identical to the record.

### Limits of the check

- Nothing ran in workerd. Each memory value is live heap in Node. The audit saw 15 to 21% less for parsed objects in workerd, so the numbers are more likely high than low, but that is not measured here.
- The two new probes copy the loops of the service. Only `completeReviewRows` is the real function. The run and the baseline of the probes are the same captures.
- The design of the page requests, of the staged pages, and of the digests is still not built. The checker did not build it.
- The rows `3. Manifest file of a capture job` and `4. Archive of a capture job` still use the estimates of round 2 (2,122 bytes for each capture, 0.957 files for each capture).
- The archive reader of the CLI reads a 16-bit entry count (`artifact-archive.ts:56`), so one archive has 65,535 entries at most also with a higher constant. That is above each size of step 1 and is not in the section.

### For the coordinator

- The option ids of the patch are `keep-format-refuse-early`, `row-pages-staged` (recommended), and `row-pages-page-readers`. The id `row-pages-simple-readers` of the first result does not exist.
- `incorporated["D-DATA-02"]` needs `"selection": null` and the note of this round. The selection `paged-objects` is not a current option.
- `results/pages.json`, `results/whole.json`, and `results/example.json` are now the second run. The first run is in `check/results-first/`. `results/quadratic.json` is the first run.
