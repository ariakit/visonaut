# Capture limit measurement

This probe measures the memory that the capture list of a run needs in local workerd. The capture limit of a run in the [current contract](../../../../docs/current-contract.md#current-path-and-evidence-state) comes from its numbers. The probe is not a part of the service, and no test runs it.

Since #276, Submit validation, materialization, promotion, and the recovery check read the capture lists one page at a time. The probe below is the record of the limit of today, and it models the earlier code. The [heap test of Submit](#heap-test-of-submit) measures the real code.

## Heap test of Submit

[`submit-heap.test.ts`](submit-heap.test.ts) runs the real Submit validation (`stageIndex`) and the real materialization (`materializeWorkflowRun`) in local workerd, with the database and the buckets of Miniflare. The run has 4 changed captures, and a reference in pages where each capture has its own image. [`submit-worker.ts`](submit-worker.ts) stops the Submit at each read and each write of a JSON object of R2, and at each fifth D1 batch. At each stop, the test collects all garbage through the inspector of workerd and reads the live heap. The result is the largest live heap above the heap before the request.

CI runs it at the capture limit of today. A measurement gives other counts, and a file for the results:

```sh
SUBMIT_HEAP_CAPTURES=25000,50000 SUBMIT_HEAP_OUT=heap.jsonl pnpm exec vitest run apps/web/tooling/capture-limit/submit-heap.test.ts
```

The rule of the test: one Submit of a run with few changed captures holds at most 16 MiB (16,777,216 bytes) of live heap above the heap of the Worker. Two Submits at the same time then hold at most one half of the 64 MiB of [the rule](#the-rule) below. `SUBMIT_HEAP_CHANGED` gives another count of changed captures (the default is 4).

Recorded on 2026-10-16 on macOS arm64, with the same versions as the result below. A megabyte here is 1,000,000 bytes.

| Captures | Before #276 (MB) | After #276 (MB) |
| -------: | ---------------: | --------------: |
|   11,000 |             18.1 |             5.6 |
|   25,000 |             40.8 |             7.0 |
|   50,000 |             81.5 |            11.4 |

- Before, one Submit held about 1,630 bytes for each capture. After, it holds about 4.5 MB for the pages that it reads at one time, and about 150 bytes for each capture: the checks across the pages keep one short value for each capture (the digest of each row image, and a hash of the facts of each image ID).
- A stop at a hold point is a sample, and not a proven largest value. The time between two stops is short: one page, or five D1 batches.
- One run of 50,000 captures needs about 6 minutes on this computer, most of it for the setup of the fixture. So CI does not run the higher counts.
- The rule does not cover a mass change. The comparison still holds one result and one reference capture for each changed capture, and the service reads one D1 row for each. A run of 11,000 captures where each capture changed holds 40.2 MB, before and after #276 (`SUBMIT_HEAP_CHANGED=11000`): about 3,150 bytes for each changed capture more than the run with 4 changed captures. The answer to a mass change is the limit of changed captures of D-SCALE-02 (#276).

Run it from the repository root. It builds [`worker.ts`](worker.ts) with Vite, starts one new Miniflare instance for each scenario, and prints one JSON line for each scenario. One complete run has 36 scenarios and needs about 6 minutes.

```sh
pnpm --filter @visonaut/web exec node tooling/capture-limit/measure.mjs tooling/capture-limit/recorded/result.json
```

## What one Submit is in the probe

The service has no Submit of a run in pages yet. So one Submit of the probe is a model, and the model is an assumption about that later code. It has the three steps that need the complete lists while Submit validation and materialization do not work on one page at a time. Each step is real code of `apps/web/src/capture-inventory.ts` and `apps/web/src/capture-pages.ts`, against a local R2 bucket:

1. Read the complete reference with the complete validation (`readCaptureInventory`), and build a map of its captures by identity.
2. Build the pages of the run, and validate and store them (`writeCapturePages`).
3. Read the committed capture list again (`readCaptureInventory`).

The run has the form of the Ariakit suite: two variants for each item, one clip rectangle and so one complete profile for each capture, one test for four captures, and four changed captures of each 1,000.

The model does not have these parts of a Submit: the D1 statements with their JSON batches, the lists of the discovery evidence, the image checks, and the GitHub requests. Their memory is not in the numbers.

The hold points below are three samples of the real code, and not a proven largest value. The validation of a capture list (`validatedInventory`) holds more for a short time: a map of the profiles, which it builds in a loop, and then two sets and one map of all captures, which it builds in a part with no `await`. The probe records neither, so this document has no number for them.

## Hold points

A Submit stops at one hold point and stays there. The measurement starts the Submits one after the other, so that all of them are at the same point at the same time. Then it takes a heap snapshot through the inspector of workerd, which collects all garbage, and reads `Runtime.getHeapUsage`.

| Point | Where the Submit stops                                                   | What it holds there                                                                                 |
| ----- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `put` | In step 2, before the first write to R2.                                 | The reference list, the pages of the run, each encoded page, and the capture list of the run.       |
| `row` | In step 3, at the last row. The probe finds it by the capture ID digest. | The reference list, the pages of the run, each parsed stored page, and the capture list of the run. |
| `end` | After step 3.                                                            | The reference list, the pages of the run, and the capture list of the run.                          |

## Result

Recorded on 2026-10-09 with `miniflare` 5.20260921.0-alpha, `workerd` 1.20260921.1, and Node.js 24.18.0 on macOS arm64. [`recorded/result.json`](recorded/result.json) has each value in bytes, for the three hold points. A megabyte here is 1,048,576 bytes.

Of the three hold points, the point `row` holds the most. Its values:

| Captures | Submits at the same time | Live heap (MB) | Bytes for each capture and Submit | Backing stores (MB) | Seconds |
| -------: | -----------------------: | -------------: | --------------------------------: | ------------------: | ------: |
|    3,832 |                        1 |           11.7 |                             2,913 |                 0.2 |     0.6 |
|    3,832 |                        2 |           20.6 |                             2,682 |                 0.2 |     1.2 |
|    3,832 |                        5 |           47.5 |                             2,541 |                 0.2 |     3.0 |
|   10,000 |                        1 |           27.7 |                             2,795 |                 0.2 |     1.6 |
|   10,000 |                        2 |           50.9 |                             2,612 |                 0.2 |     3.1 |
|   10,000 |                        5 |          120.1 |                             2,496 |                 0.2 |     7.8 |
|   20,000 |                        1 |           53.8 |                             2,764 |                 0.2 |     3.4 |
|   20,000 |                        2 |           99.7 |                             2,585 |                 0.2 |     7.0 |
|   20,000 |                        5 |          237.1 |                             2,475 |                 0.2 |    16.2 |
|   40,000 |                        1 |          105.9 |                             2,748 |                 0.2 |     6.3 |
|   40,000 |                        2 |          197.2 |                             2,571 |                 0.2 |    12.9 |
|   40,000 |                        5 |          470.9 |                             2,463 |                 0.2 |    33.3 |

- "Bytes for each capture and Submit" is the live heap minus the live heap before the first Submit, for one Submit and one capture, as the next larger integer.
- The 12 scenarios of each point give these bytes for each capture and Submit: `row` 2,463 to 2,913, `put` 2,301 to 2,667, and `end` 2,141 to 2,483.
- The memory grows in a straight line with the captures and with the Submits. The largest value, 2,913, is from one Submit of 3,832 captures, where the fixed cost of the first Submit has the largest part.
- The record is one run of the probe. The values change a little from one run to the next.
- The live heap of the Worker is 1.0 to 1.1 MB before a Submit and 1.1 to 1.2 MB after the release. So the Submits hold all of the difference.
- The backing stores are 0.2 MB in each scenario: no byte buffer stays.
- "Seconds" is the time until the last Submit is at its hold point, on this computer. It is not a time of a hosted Worker.

## The rule

A Worker isolate has at most 128 MB of memory. The rule gives the capture lists of the Submits 64 MiB (67,108,864 bytes), about one half of it. The rule reads the 128 MB as binary megabytes, as the comment of the inventory bound in `apps/web/src/capture-inventory.ts` does ("a 128 MiB Worker"). With 64,000,000 bytes, the rule with two Submits gives 10,985 captures. The other half is for the code of the Worker, for the parts of a Submit that the model does not have, for the other requests of the same isolate (a review read holds two capture lists), and for garbage that V8 did not collect yet. The half is an assumption: the measurement does not give it. The other half is also the margin for the values that the probe does not record. The rule uses the largest recorded value, 2,913 bytes for each capture.

| Submits that are at the hold point at the same time in one isolate | Captures: 64 MiB / Submits / 2,913 bytes |
| -----------------------------------------------------------------: | ---------------------------------------: |
|                                                                  1 |                                   23,037 |
|                                                                  2 |                                   11,518 |
|                                                                  5 |                                    4,607 |

The rule counts two Submits. A Submit holds its lists for seconds, so two Submits of two pull requests in the same seconds in one isolate are a normal event. Five is the limit of active runs: all five must then be in these seconds of their materialization at the same time and in the same isolate. If that occurs and the isolate ends, the Submit jobs fail, and each of them can run again: materialization can repeat its steps. The rule with two Submits gives 11,518 captures, and the limit is the next smaller thousand: 11,000 captures.

## Scope

- The numbers are from local workerd. A hosted Worker is not measured: the contract authorizes no hosted diagnostic run. Local workerd does not apply the memory limit of 128 MB, so the probe shows no failure at the limit.
- The numbers are for the model above, and for code that reads all pages of a run into one list. When Submit validation and materialization work on one page at a time, the memory no longer grows with the run, and this limit can go.
