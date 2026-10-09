# Verification of the lane "Public and internal packages"

Scope: adversarial check of `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/packages/report.md` (PKG-01 to PKG-19). The check is read-only for the repository. All scratch files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/packages/verify/`.

Method for each finding: I opened each cited file and compared the quoted code with the source. I searched for guards, callers, tests, and contract text that can make the finding wrong. I ran the cheap measurements again.

## Result in short

| ID     | Verdict          | Severity (auditor -> mine) | Main correction                                                                                                                                      |
| ------ | ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| PKG-01 | partly-confirmed | medium -> medium           | Facts are correct. The main recommendation contradicts a test and retries permanent 503 states. One citation names the wrong layer.                  |
| PKG-02 | confirmed        | medium -> medium           | The CLI reads the error body only for HTTP 503 and 409. The snippet needs that change too.                                                           |
| PKG-03 | partly-confirmed | medium -> low              | The "98% of the limit" value is from an old fixture. The recorded maximum of the current capture set is 73.7%. One alternative breaks `visualBatch`. |
| PKG-04 | partly-confirmed | medium -> low              | The mechanism is correct. With the recorded capture sizes, one decode pass is about 14 seconds on this machine, not 149 to 196 seconds.              |
| PKG-05 | confirmed        | medium -> medium           | On page load the repeated reads run in parallel. The cost is the 5 to 6 sequential round trips of `status()` itself.                                 |
| PKG-06 | confirmed        | medium -> medium           | No correction.                                                                                                                                       |
| PKG-07 | confirmed        | low -> low                 | `review.ts:774` is not a correction of `reviewStatus`. A second writer makes the same state.                                                         |
| PKG-08 | confirmed        | low -> low                 | More dead code exists: the `validation_busy` PUT path (see Missed 1).                                                                                |
| PKG-09 | confirmed        | low -> low                 | The status query needs a check for `dead` tasks, not for `queued` and `leased`. Two more readers exist in `apps/web`.                                |
| PKG-10 | partly-confirmed | medium -> medium           | The old form was the production path until 2026-10-04. The contract protects one of the listed branches.                                             |
| PKG-11 | confirmed        | low -> low                 | No correction.                                                                                                                                       |
| PKG-12 | confirmed        | low -> low                 | Do not replace the literal `"1.0"` at `hash.ts:110`. It is digest input.                                                                             |
| PKG-13 | confirmed        | medium -> medium           | No correction.                                                                                                                                       |
| PKG-14 | confirmed        | low -> low                 | Small: `rg VISONAUT_TOKEN` also finds two evidence documents.                                                                                        |
| PKG-15 | confirmed        | low -> low                 | No correction.                                                                                                                                       |
| PKG-16 | confirmed        | low -> low                 | No correction. Not measured, as the auditor says.                                                                                                    |
| PKG-17 | confirmed        | low -> low                 | The 36 round trips run in the background materialization, not in the Submit request.                                                                 |
| PKG-18 | confirmed        | low -> low                 | `readOne` and `readRows`: 8 declarations in 6 modules, not 7 in 5.                                                                                   |
| PKG-19 | partly-confirmed | low -> low                 | The recommended snippet does not remove a decode. The batch path needs the decoded pixels.                                                           |

No finding is refuted in full. Three numbers in the report are wrong or too high (PKG-03, PKG-04, PKG-18). Two recommendations are not correct as written (PKG-01, PKG-19). One alternative breaks a feature (PKG-03).

## Measurements that I ran again

```sh
# Copies of the auditor's probes, with the output path changed to verify/.
node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/packages/verify/copy-probes.mjs
pnpm exec vitest run --root <verify> --config <verify>/vitest.config.mjs \
  cli-ux limits protocol review-status status-queries decode-real
# Test Files 6 passed (6), Tests 10 passed (10), Duration 7.53s
```

- `diff` of my outputs with the auditor's outputs: `cli-ux`, `limits`, `protocol`, `review-status`, `status-queries` are identical.
- `decode-real` (three real 640x360 screenshots): 4.20, 7.38, 6.00 ms for `decodePng`. The auditor has 3.88, 4.87, 5.10 ms. Same order.
- `rg -U --count-matches 'SecurityError\(\s*"[a-z_]+",\s*503'` on the six server files: 2 + 3 + 14 + 27 + 1 + 8 = 55. The ten codes and their counts agree with M9.
- `pnpm exec tsc6 --noEmit` in `packages/protocol`: exit 0. With the scratch configuration that includes `test`: `test/protocol.test.ts:247:5 - error TS2532: Object is possibly 'undefined'.`, exit 2. Agrees with M11.
- The published tarballs in the auditor's `npm/` directory: `rg -c -i "copyright|permission (is hereby|to use)|ISC License|MIT License" cli/package/dist/chunk-GQDTTYT4.js` has no match (exit 1). The four dead strings are each found one time. Agrees with M8.

New probes (my files):

- `verify/decode-entropy.probe.ts` -> `verify/decode-entropy.out.txt`. `decodePng` time for the same size with different noise.
- `verify/manifest-size.mjs`. Size of a synthetic manifest, compact and with 2-space indentation.

Platform facts that I checked:

- D1 `batch()`: "Sends multiple SQL statements inside a single call to the database. This can have a huge performance impact as it reduces latency from network round trips to D1." and "Batched statements are SQL transactions." Source: https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 limits: maximum bound parameters per query 100, maximum string or row size 2,000,000 bytes, maximum SQL statement length 100,000 bytes, queries per Worker invocation 1000 (paid). Source: https://developers.cloudflare.com/d1/platform/limits/

## PKG-01 · The CLI stops on answers that the server marks as temporary

- Verdict: partly-confirmed. Severity: medium.
- Proof that the facts are correct:
  - `packages/cli/src/http.ts:201-214`: the retry needs `retryUnavailable`, method `GET` or `PUT` or the reuse `POST`, status 503, a valid `Retry-After`, and code `validation_busy` or `service_unavailable`.
  - `rg -n retryUnavailable packages/cli/src`: four call sites only (`engine.ts:547`, `617`, `746`, `local-comparison.ts:280`).
  - `http.ts:225-233`: one message for each network error, no second attempt. `githubToken` calls `request()` with no retry flag (`http.ts:261`).
  - Server: `apps/web/src/api/index.ts:42` and `82` add `Retry-After: 1` to each 503.
  - Waiting states exist: `apps/web/src/api/pre-run-checks.ts:473-475` (`"Check creation is in progress."`, with a 120-second lease at line 465), `pre-run-candidates.ts:73-86` (`merge_not_ready`), `pre-run.ts:138-139` (`check_pending`). `beginStaged` and `reportVisualPlan` reach them through `ensureSignedAttemptCheck`.
  - Request count for an unchanged Submit: 4 OIDC + 23 service + 9 GitHub. I counted the same from the code. In local mode `declareStaged` returns upload tickets only for `uploadImages(manifest)` (`workflow-owned.ts:547-548`), so an unchanged Submit has no reuse request and no `PUT`.
  - Probe M1 again: `begin` with a 503 stub makes 2 `fetch` calls and returns exit 4.
- Corrections:
  1. The policy is deliberate and fixed by more tests than the report names. `packages/cli/test/retry.test.ts:99`:
     ```ts
     it("does not retry a semantic failure disguised as a 503", async () => {
       const fetch = vi.fn(async () => busy("plan_too_large"));
     ```
     The main recommendation ("retry each 503 answer that has `Retry-After`") is the opposite of this test.
  2. The server uses 503 with `Retry-After: 1` for states that do not end in seconds. Example: `apps/web/src/capacity.ts:109-113` throws `capacity_exceeded` with 503, and the message says that a maintainer must act. Other examples are `workflow_configuration` (5 sites) and `workflow_identity` (6 sites). A rule "retry each 503" repeats these requests up to 5 times. Each `begin` attempt on the server also calls GitHub (`createGitHubClient`, `verifyWorkflowJob`).
  3. The replay proof names the wrong layer. `POST /v1/runs` calls `reserveStaged` -> `reserveVerifiedStagedRun` (`apps/web/src/api/workflow-owned.ts:327-474`), not `reserveRun` in `packages/service`. `service.reserveRun` and `service.commitShard` have one production caller each, in `apps/web/src/api/workflow-materialize.ts:721`, `734`, and `409` (background materialization). The conclusion is still correct for the HTTP layer: the staged insert uses `ON CONFLICT ... DO NOTHING`, the CLI already replays reserve in `renewReservation` (`engine.ts:416-429`), `begin` runs two times when a workflow uses `visonaut begin` and then `submit` (`bundle-submit.ts:89`), and `submitStaged` returns the stored receipt for the same job (`workflow-owned.ts:1248-1261`).
  4. The `validation_busy` site in the count of 55 is in a branch that new reservations cannot reach (see Missed 1).
- Feasible form of the recommendation: an allow-list of waiting codes for `begin` and `plan` (the "Minimal" alternative), or the server change (409 for permanent states, 503 only for states that end without a person). Network errors need a separate decision, because `retry.test.ts:128` fixes "no retry".
- Not verified: how often a 503 or a connection reset fails a real job. The auditor says the same.

## PKG-02 · The CLI hides the cause of most failures

- Verdict: confirmed. Severity: medium.
- Proof:
  - `http.ts:221-223`, `bundle-submit.ts:69-71`, `index.ts:37-38`, `files.ts:50-57`, `png-comparison.ts:34-39`: each catch replaces the error with a fixed sentence.
  - `bundle-submit.ts:69` is a bare `catch`. It also replaces `"GitHub OIDC is unavailable. Run this command in a job with id-token: write."` (`http.ts:244-247`), which is a useful `CliError`.
  - `captureJobNames` throws a `ProtocolError`, not a `CliError` (`packages/protocol/src/workflow-jobs.ts:17-20`), so a wrong template becomes `"The verified capture submission failed."` with exit 1.
  - `packages/cli/README.md` gives exit 4 as "authentication or trust failure".
  - Probe M1 again: identical output.
- Corrections:
  1. The CLI reads the response body only for status 503 and 409 (`http.ts:175-183`). For 400, 404, 413, and 422 it cancels the body. The recommended snippet uses `error?.code`, so it prints nothing for those statuses unless line 175 also changes. Example: a rejected receipt returns 400 `invalid_manifest` (`apps/web/src/api/index.ts:46-53`), and the CLI prints only `HTTP 400`.
  2. The general messages are a security rule in the code, not an accident. `http.ts:179`: `// An invalid error body must not replace the safe status message.` `http.ts:229`: `// Network errors can include URLs and credentials. Never print them.` `retry.test.ts:71-79` checks that the output does not contain the error body. `packages/protocol/README.md:34` calls the message "a private diagnostic message" and the code "stable". The recommendation (print only `code` and `reference` with a strict format) agrees with these rules. Printing `error.message` from the server does not.
  3. For local validation errors, the `ProtocolError` messages contain values from the candidate manifest, for example `Duplicate test identity ${test.id}` (`validate.ts:299`). The Submit job is the trusted job. Today the `string` validator rejects control characters (`validate.ts:81-92`) and each line starts with `visonaut: `, so a value cannot start a GitHub workflow command. Keep both properties if the messages become visible.

## PKG-03 · Image and capture limits differ in six places

- Verdict: partly-confirmed. Severity: low.
- Proof that the table is correct: I checked each cell. `packages/playwright/src/visual.ts:352`, `356`, `399`; `packages/cli/src/artifact-archive.ts:7-11`; `packages/cli/src/files.ts:9-11`; `packages/compare/src/types.ts:9-14`; `packages/protocol/src/validate.ts:114`, `348-350`; `apps/web/src/runtime-defaults.ts:7-18`. Probe M3 again: identical output. The adapter README states no size limit.
- Correction 1 (headroom). The "98.1%" value and the "33 pixels" impact use `packages/compare/evidence/hosted-largest-fixture.json`. `packages/compare/evidence/hosted-resource-evidence.md:19` says that this is "the largest existing Ariakit WebP fixture", from the old grouped screenshots. The repository has a recorded measurement of the current split capture set. `docs/evidence/ariakit-capture-measurement/README.md:39`:

  > A full pass contained 307 tests and 3,582 split captures. Pass 1 had 62,898,893 encoded bytes: mean 17,559.71, p95 41,137, maximum 210,157 bytes per capture. Its 510,234,282 pixels gave a mean of 142,443.96 and maximum of 1,547,520 pixels per capture.

  So the recorded maximum is 1,547,520 / 2,100,000 = 73.7% of the pixel limit, and 210,157 / 2,097,152 = 10.0% of the byte limit. The report says that the size distribution is unknown. It is recorded in the repository. The record is from an earlier consumer commit, so the current maximum can differ.

- Correction 2 (the "Minimal" alternative breaks batch capture). `visual.ts:352-357` is `readScreenshot`. `visualBatch` uses it for one full-page source screenshot and then crops each item (`visual.ts:187-262`, `387-403`). A 2.1 million pixel limit in `readScreenshot` rejects the source screenshot of a long page. The item limit belongs in `cropScreenshot` and `attachCapture`. Today the cropped item has only the 20 MiB check (`visual.ts:399`) and no pixel check.
  ```ts
  // Wrong place: this is also the full-page source of visualBatch.
  const pixels = bytes.readUInt32BE(16) * bytes.readUInt32BE(20);
  if (pixels > 32_000_000) { ... }
  ```
- Correction 3. `packages/cli/README.md:25` states the Submit limits ("2 MiB per encoded image, 2.1 million pixels, and 8192 pixels per dimension"). The limits are documented for the CLI. They are not enforced or documented at capture time.
- Why low: the nearest measured image is at 74% of the limit, the failure affects one pull request, and the limits are in the CLI README. The bad part is the late failure with a message that does not name the capture (PKG-02).
- The nearest limits for growth are different ones (see Missed 3): 5,000 archive entries for each shard (about 2 times the `linux` shard), the 8 MiB manifest limit, and 10,000 profile records.

## PKG-04 · Submit decodes each candidate PNG two times

- Verdict: partly-confirmed. Severity: low.
- Proof of the mechanism:
  - `packages/cli/src/local-comparison.ts:44` (first decode) and `239` (second decode). The equality branch is at `260-274`, after the decode.
  - `packages/compare/src/png.ts:200` inflates all IDAT data. `packages/cli/src/png-comparison.ts:25` decodes again with `PNG.sync.read`.
  - The six read-and-hash passes exist at the cited lines.
  - The recommended code is correct. `validateLocalImages` already proved that the decoded size equals `capture.image` (`png-comparison.ts:26-32`), so `capture.image.width * capture.image.height` can replace `candidate.width * candidate.height` for a new capture.
- Correction (impact). The M2 images are not like real captures. My probe shows two cost parts, about 12 ms for each million pixels and about 40 ms for each MiB of encoded data:
  ```text
  640x360   noiseRows= 0 encoded=   3 KiB decodePng=  4.31 ms
  640x360   noiseRows=30 encoded= 253 KiB decodePng= 13.25 ms
  1248x1650 noiseRows= 0 encoded=  12 KiB decodePng= 24.24 ms
  1248x1650 noiseRows=15 encoded= 387 KiB decodePng= 37.01 ms
  1248x1650 noiseRows=30 encoded= 706 KiB decodePng= 51.08 ms
  ```
  The recorded Ariakit pass has 510 million pixels and 60 MiB in total, with a mean of 142,444 pixels and 17.6 KiB for each capture (see PKG-03). Arithmetic from my probe: 510 x 12 ms + 60 x 40 ms + 3,582 x about 1.5 ms of fixed cost = about 14 seconds for one decode pass on this machine. That agrees with the low end of the report (14 to 18 seconds). The high end (149 to 196 seconds) does not apply to the recorded sizes. The CI runner time is not measured.
- Why low: the change saves one pass, about 14 seconds here, in a job that also downloads artifacts and makes 36 requests. The effort is small, so the change is still reasonable.

## PKG-05 · `Service.status()` makes 5 to 6 sequential round trips

- Verdict: confirmed. Severity: medium.
- Proof:
  - `packages/service/src/run-status.ts:26-80`: `service.run` (27), `service.comparison` (45), dead-task query (48-52), counts (56-60), `service.project` (61), promotion (62-68). Each is one `await`.
  - Probe M5 again: identical output (5 round trips, 6 with a promotion pointer).
  - `apps/web/src/api/review.ts:104-130` (`reviewPollState`): `projectRun`, `service.comparison`, then `service.status`. That is 7 to 8 sequential round trips, and the run and the comparison are read two times.
  - The app does not use the D1 Sessions API (`rg withSession apps packages` has no match), so a batch does not change the read path.
- Corrections:
  1. On the review page load the reads are not sequential with `status()`. `review.ts:276-307` runs `service.project`, `service.status`, and `service.comparison` in one `Promise.all`. The repeated reads add D1 queries, but not waiting time. The waiting time of this step is the `status()` chain. So the gain is in the batch inside `status()`, not in "use the rows that the caller has". For `reviewPollState` both gains apply.
  2. The recommended batch has no query for the `failed` branch (`run-status.ts:36-42` reads `visonaut_audit`). Add it to the batch or keep one more read for failed runs.
  3. The batch is correct for D1 (one call, statements run in sequence, see the two URLs above).

## PKG-06 · The comparison identities accept one value

- Verdict: confirmed. Severity: medium.
- Proof:
  - `packages/protocol/src/validate.ts:404-405` and `types.ts:130-131`.
  - Each stored run inventory keeps the full manifest with the receipt (`apps/web/src/api/workflow-materialize.ts:377-386`, `manifest,`). Each read validates it: `apps/web/src/capture-inventory.ts:553` calls `expandInventory` (line 369, `parseManifest`) and `validatedInventory` -> `assertInventory` (line 193, `parseManifest`). `parseManifest` calls `validateLocalComparison` (`validate.ts:354`).
  - The review page reads the inventory for each run with `inventory_key` (`apps/web/src/api/review.ts:364`).
  - `rg "pngjs-7|playwright-pixelmatch"`: the constants, three test literals, and one fixture. No test compares the constant with the installed version. `renovate.json` has one rule, for Playwright.
  - Probe M6 again: `pngjs-7.0.1` and `playwright-pixelmatch-1.64.0` are rejected.
- Contract: `docs/current-contract.md:48` (D03) requires "immutable old engine/codec identity, and stored approval tuples". A list of accepted values for reading agrees with that rule.
- Addition: the service writes the current constants into the approval tuples at import time (`packages/service/src/local-comparison.ts:474-475`, `'${LOCAL_COMPARISON_ENGINE}'`), not the values from the stored receipt. The sealed-run recovery (`workflow-materialize.ts:516-537`) can import an old receipt after a constant change.

## PKG-07 · A run that expired before completion gets the label "superseded"

- Verdict: confirmed. Severity: low.
- Proof: `packages/service/src/review-status.ts:77-78` (the `active` test is first), `packages/service/src/run-retirement.ts:111`, `apps/web/src/api/dashboard.ts:100-125` (`state: summary.status`), `apps/web/src/routes/index.tsx:138`. Probe M7 again: identical output.
- Corrections:
  1. `apps/web/src/api/review.ts:774` does not correct `reviewStatus`. It is the pull-request state endpoint, and it reads `visonaut_runs.state` directly. Only `apps/web/src/api/ingest.ts:38-40` corrects the result.
  2. The review page has the same wrong value: `review.ts:572` returns `status.status`.
  3. A second writer makes inactive failed runs: `apps/web/src/operations/recovery.ts:51` (`SET active=0,state=CASE WHEN state='accepted' THEN state ELSE 'failed' END`).
- The fix is safe for the callers that I checked. Each of them handles `failed` and `superseded` in the same branch: `review.ts:145`, `431`, `610`, `routes/index.tsx:420`, `operations/review-links.ts:115`. In `prepareStatusIntent` an expired run then fails the `statusRunEligibleSql` assertion (`run-status.ts:109-113`) in place of the explicit check at line 95. Both are a `ConflictError`.

## PKG-08 · The published CLI contains removed commands

- Verdict: confirmed. Severity: low.
- Proof: `packages/cli/src/index.ts:12-35` passes only `status`, `begin`, and `--help` to the engine unchanged. `runWorkflowCommand` rejects each flag that is not `--shard`, `--server`, or `--no-visual` (`workflow.ts:34-40`), so `--json`, `--run`, and `--dir` cannot reach the engine from `submit`. The cited engine ranges exist. `rg transfer-key` finds only `http.ts:239`. `rg -c '\["upload"' packages/cli/test` gives 20 + 1 + 2 + 1 + 3 + 2 = 29 in six files. The four strings are in the published chunk.
- Contract: A03 in `docs/current-contract.md:157` selects "One current path; remove old entry points now". The finding agrees with it.
- Addition: the `validation_busy` handling for `PUT` is also dead with the current server (Missed 1).

## PKG-09 · `@visonaut/service` keeps queue publication code and legacy compare-task statements

- Verdict: confirmed. Severity: low.
- Proof:
  - `reconcileWork`: no caller in `apps/web/src` or `packages/*/src`. One caller in `apps/web/tooling/queue-recovery/worker.mjs:95`. That harness imports the live source, so a removal breaks it. The harness also keeps `recorded-worker.js.gz`.
  - `reportComparisonPublication` (`packages/service/src/comparison-publication.ts:9-30`) loops over two lists. The only production call passes two empty lists (`apps/web/src/operations/index.ts:45`). It is a no-op there.
  - `enqueueWorkStatement` has one production caller with `kind: "review"` and the ID `review:${commandId}` (`apps/web/src/operations/review-queue.ts:20-22`, `58-64`). A comparison row ID cannot be equal to that ID, so the join `row.id = task.id` can match only old `compare` tasks.
  - The three statements exist at the cited lines.
  - `git log -L24,26:packages/service/src/work.ts`: commit `5712036`, 2026-09-30.
- Corrections:
  1. For `run-status.ts:48-52` the condition is `task.state = 'dead'`. A production check for `queued` and `leased` tasks does not cover it. Before removal, check for `dead` tasks that join a comparison of an active run. If one exists, the run status changes from `failed` to another value.
  2. Two more readers of old `compare` tasks exist outside the package: `apps/web/src/api/dashboard.ts:53-54` (a sub-query for each dashboard row) and `apps/web/src/operations/comparison-alerts.ts:93-104`.
- Contract: `docs/current-contract.md:32` says "legacy producers and queue handlers are removed" with an exact terminal-work proof (W08). The finding agrees with it.

## PKG-10 · The write path for runs without an inventory remains

- Verdict: partly-confirmed. Severity: medium (for the test coverage part).
- Proof that the facts are correct:
  - `apps/web/src/api/workflow-materialize.ts:387-414`: `inventory` is the stored pointer or the result of `writeCaptureInventory`. `commitShard` always gets it.
  - The branches exist: `packages/service/src/run-admission.ts:524-536`, `614-622`, `764-781`; `packages/service/src/local-comparison.ts:390-392`, `471-473`; `packages/service/src/baseline-promotion.ts:174-198`.
  - `apps/web/src/operations/test-fixtures.ts:268-297`: `commitShard` with no `inventory`, then `seedLegacyComparison`. 27 test files import this fixture. `rg -c "commitShard\(" service.test.ts` = 16, `rg -c "inventory:"` = 4.
- Corrections:
  1. The old form was the only production path until one day before the audit. `git log -S"inventory_key" -- packages/service/src/run-admission.ts` gives one commit: `6219fdf 2026-10-04 Store full inventories in R2 and changed items in D1 (#247)`. The words "legacy" and "old" hide this.
  2. `docs/current-contract.md:28` keeps a way back: "Keep the old database until a complete Submit, review, and main promotion pass against the replacement. This source change does not reset or deploy a database." The source does not show that the cutover is complete. A removal of the old write branches before that point removes the code that the old database needs.
  3. The contract protects one listed branch by name. `docs/current-contract.md:248`: "Preserve the eligibility query and receipt validation in workflow materialization; missing evidence must fail closed. This recovery is not obsolete legacy comparison work." The eligibility query (`json_extract(metadata_json,'$.localMode')='local-v1'`) and `validateLocalSubmission` are in the branch without an inventory (`workflow-materialize.ts:538-575`; the report cites `533-570`). That contract sentence is from 2026-10-02 (commit `85b60a8`), before the inventory change. A removal needs an explicit contract change.
  4. The fixture also uses the server comparison that production cannot create (`seedLegacyComparison` from `tooling/legacy-comparison-fixture.ts`). So the gap is two steps wide: the storage form and the comparison form.
- The order in the recommendation is correct: fixtures first, removal later.

## PKG-11 · The protocol README and about 230 lines of validators

- Verdict: confirmed. Severity: low.
- Proof:
  - `validate.ts:483-524`, `526-621`, `632-706`, `709-728` = 233 lines. `rg` finds no importer in `apps/` or in another `packages/*/src`.
  - `tooling/evidence/declaration-scale/worker.mjs:6-7` imports `parseTrustedPlan` and `validateShardDeclaration`, but from `./source/packages/protocol/src/index.ts`. That is a frozen copy (`frozen-source.tar.gz`), not the live package. A removal does not break it.
  - `rg` for the ten type names and `PROTOCOL_MAJOR` outside `packages/protocol`: no importer. (`UploadTicket`, `PlannedShard`, and `PlannedTest` are used inside `types.ts`.)
  - README: usage example at lines 7-12, table of 5 endpoints at lines 24-30, finalize returns `RunStatus` at line 29. The server returns `state: "staged"` with HTTP 202 (`apps/web/src/api/workflow-owned.ts:1161-1170`).
  - 11 endpoints in the CLI: I counted the same.
  - `"uploading"`: `reviewStatus` has no such value (`packages/service/src/review-status.ts:50-58`).
- Note: the types `TrustedPlan` and `VerifiedDiscoveryEvidence` are still imported by `apps/web/src/api/receipts.ts:4-5` and `workflow-reconcile.ts:7`. Keep them.

## PKG-12 · Paths, schema versions, and error shapes have more than one source

- Verdict: confirmed. Severity: low.
- Proof: I checked each item. `bundle-submit.ts:47` and `apps/web/src/api/pre-run.ts:55` (`schemaVersion: 1`); the five `"1.0"` literals; the two version patterns (probe M6 again: `"1.00"` is rejected by the protocol and accepted by the CLI); `rg "TRANSPORT\."` finds six of eight entries in use, not `reference` and not `submit`; `engine.ts:186-187` and `apps/web/src/api/index.ts:174`; the three shard-key rules; `index.ts:46-66`; `index.ts:216-218`. `rg -c "new IncompleteError\("` in `packages/service/src` sums to 49. A status request for an unknown run goes `runStatus` -> `service.status` -> `service.run` -> `IncompleteError` (`service.ts:92-98`) -> HTTP 409.
- Correction: do not replace the literal at `packages/protocol/src/hash.ts:110` with `SCHEMA_VERSION`.
  ```ts
  return digestJson({ schemaVersion: "1.0", source: "workflow", reusableWorkflowSha });
  ```
  This value is input to the `planDigest` of each manifest and each staged run. If it follows `SCHEMA_VERSION`, a later wire version `"1.1"` changes all digests. Give it its own named constant. The other four literals are wire fields and can use `SCHEMA_VERSION`.

## PKG-13 · The published bundle contains pngjs and pixelmatch without their license notices

- Verdict: confirmed. Severity: medium.
- Proof:
  - `packages/cli/tsup.config.ts:14`: `noExternal: ["@visonaut/protocol", "@visonaut/compare", "pixelmatch", "pngjs"]`.
  - Installed versions: `pngjs 7.0.0 MIT`, `pixelmatch 5.3.0 ISC`. Their LICENSE files start with `pngjs original work Copyright (c) 2015 Luke Page & Original Contributors` and `Copyright (c) 2019, Mapbox`. `pixelmatch/index.js` and `pngjs/lib/png.js` start with `'use strict';` and have no license comment.
  - Published `visonaut@0.5.4`: `dist/chunk-GQDTTYT4.js` is 202,387 bytes and contains the pngjs code (for example `__require("zlib")` at line 1293). It has no license string. The package `LICENSE` has only `Copyright (c) Ariakit`.
  - `.github/workflows/scripts/packages.mjs:35-37`: the allow-list is `package.json`, `README.md`, `LICENSE`, and `dist/*.js` or `dist/*.d.ts`.
- All three alternatives are feasible. The tsup configuration already has a `banner` (`tsup.config.ts:11-13`), so a notice in the banner needs no change in `files` or in the CI check.
- The adapter does not bundle third-party code. `pngjs` is a runtime dependency there (`packages/playwright/tsup.config.ts:14`).

## PKG-14 · Three READMEs state old versions or old behavior

- Verdict: confirmed. Severity: low.
- Proof: `packages/cli/README.md:3` (`0.5.3`) with `package.json:3` (`0.5.4`), also in the published tarball. `README.md:35` (`visonaut@0.5.3` and `@visonaut/playwright@0.4.0`) with `docs/current-contract.md:22` (0.5.4 and 0.5.0). `packages/cli/README.md:25` (the WebP sentence) with `artifact-archive.ts:104` (PNG names only). `local-comparison.ts:257`. `engine.ts:44`.
- Small correction: `rg VISONAUT_TOKEN` also finds `docs/evidence/public-packages/registry-release.md:25` and `cli-0.3.4-20260927.md:11`. Both use the name only. No document says how to get the token, so the conclusion is correct.

## PKG-15 · Argument errors and progress output of the CLI

- Verdict: confirmed. Severity: low.
- Proof: probe M1 again gives the same six lines. `workflow.ts:34-40` has one message for four different errors. `engine.ts:36`, `39` (two meanings of `--run`), `726-728`. No output call in `bundle-submit.ts:75-106` or in `local-comparison.ts`. `beginSubmission` is at `bundle-submit.ts:89`, before the reads at `github-artifacts.ts:69-72`, `88`, `signed-context.ts:72`, and `96-98`. `bindSubmission` writes `manifest.json` and `receipt.json` before it checks `GITHUB_OUTPUT` (`signed-context.ts:89-98`).
- Note for the review URL: the submit response has no URL (`engine.ts:317-322`). The CLI must build it from the origin and the run ID. `apps/web/src/api/ingest.ts:48` uses `${origin}/runs/${runId}`.

## PKG-16 · GitHub API calls in the CLI have no retry

- Verdict: confirmed (by code reading). Severity: low.
- Proof: `github-artifacts.ts:85-103` (30 seconds, one attempt), `signed-context.ts:35-45` (no `signal`), `artifact-archive.ts:190` and `197` (30 and 120 seconds), `200-205` (`invalid()` for each response that is not OK, exit 4), the two pagination loops, and the nested loop at `github-artifacts.ts:162` and `181-185`.
- A time-out from `AbortSignal.timeout` is not a `CliError`. It goes to `index.ts:38`. The same is true for a JSON syntax error at `github-artifacts.ts:98` and `signed-context.ts:23` and `49`.
- Not measured, as the report says.

## PKG-17 · Reference downloads are sequential, and three server write loops use small pages

- Verdict: confirmed. Severity: low.
- Proof: `packages/cli/src/local-comparison.ts:219` and `275-281`; `engine.ts:416-429`; `apps/web/src/api/workflow-owned.ts:390` and `apps/web/src/api/local-comparison.ts:448` (600 seconds); `packages/service/src/run-admission.ts:542-564` (the loop is over all captures, `offset += 100`, so 36 batches for 3,582 captures); `run-admission.ts:19` and `359-368`; `packages/service/src/local-comparison.ts:90`.
- Corrections:
  1. `commitShard` does not run in the Submit request. `submitStaged` sends `{ kind: "ingest" }` to the queue and returns 202 (`workflow-owned.ts:1279-1288`). The 36 round trips are in the materialization. They add to the time until the check completes, not to the Submit job.
  2. The page of 1,000 is safe for D1. One entry is about 70 bytes (`{"imageId":"<uuid>","outcome":"unchanged"}`), so 1,000 entries are about 70 KB in one bound value. The limits are 2 MB for a value and 100 bound parameters. All 3,582 entries (about 250 KB) also fit in one value.
  3. Four parallel comparisons change a stated rule: `local-comparison.ts:208` says `/** Only one decoded candidate/reference pair and mask is retained at a time. */`. The memory estimate of about 25 MB for each pair is correct.

## PKG-18 · Conventions differ between the packages

- Verdict: confirmed. Severity: low.
- Proof: M11 again (see above). The tsconfig files, the import suffixes, the test locations, `packages/service/package.json` (no `devDependencies`), `packages/cli/test/local-comparison.test.ts:575` (resolves `@playwright/test`, which only the root declares), eight hex encoders at the cited lines, the four identity-key copies (`packages/protocol/src/hash.ts:61-63` has the same encoding), the six type names, the two engines values, `work.ts:30`, and the two clock reads.
- Correction: `readOne` and `readRows` have 8 declarations in 6 modules: `run-admission.ts:11`, `run-status.ts:14` and `18`, `rendering-profile-conversion.ts:12`, `review-commands.ts:18`, `local-comparison.ts:17`, `baseline-promotion.ts:10` and `14`. The report says 7 in 5.

## PKG-19 · The adapter waits a fixed 100 ms and decodes two PNGs for each capture

- Verdict: partly-confirmed. Severity: low.
- Proof that the facts are correct: `visual.ts:359`, `374`, `382`; the published `reporter.js:484-485` imports `@playwright/test` and `pngjs`; `environment.ts:49` sorts with `localeCompare(right.file, "en")`, and the list goes into `fontsDigest` (`environment.ts:87`).
- Corrections:
  1. The recommended line does not remove a decode. `readScreenshot` decodes before it returns (`visual.ts:359`), so `current.pixels` exists before the comparison.
     ```ts
     const current = await readScreenshot(page, options, deadline); // decodes here
     if (previous && previous.bytes.equals(current.bytes)) return current; // too late
     ```
     To save the decode, `readScreenshot` must return bytes only, and the decode must move after the equality test.
  2. `visualBatch` needs the decoded pixels of the stable source for `cropScreenshot` (`visual.ts:239-247`). At most one decode for each batch can go away. A single `visual()` call can read the size from the PNG header and needs no decode when the bytes are equal.
  3. The 100 ms wait is for each stable screenshot, not for each capture. One `visualBatch` call waits one time for all its items. The value "358 seconds for 3,582 calls" is an upper limit. The recorded capture pass has 106 tests for 1,230 Chromium captures (`docs/evidence/ariakit-capture-measurement/README.md`), which shows many captures for each test.
  4. The wait is documented behavior. `packages/playwright/README.md:3`: "Visonaut waits for settled font faces and two consecutive equal screenshots."
  5. The ICU risk is small today. The adapter requires exactly Node `24.18.0` (`packages/playwright/package.json:57-59`), so the ICU data is fixed until that pin changes. A profile change with zero changed pixels needs no review (`docs/current-contract.md:124`).

## Missed

Items in or next to this lane that the report does not have. One line each.

1. The compare Worker has no reachable caller for new submissions, and the CLI's `validation_busy` path is dead. The only `context.comparator.fetch` call is at `apps/web/src/api/workflow-owned.ts:1067`, inside `if (capability.comparisonMode !== LOCAL_COMPARISON_MODE)`; both capability issuers set local mode (`workflow-owned.ts:383`, `apps/web/src/api/local-comparison.ts:444-447`) and reserve rejects each other mode (`workflow-owned.ts:182-187`). So no code path of a new submission calls the compare Worker (`rg comparator apps/web/src` finds this one call, the binding in `runtime.ts:263`, and the type in `api/context.ts:78`), `http.ts:7` and `198-200` plus the retry metrics in `engine.ts:621-626` and `656-658` cannot run, and `docs/current-contract.md:32` ("The private Worker validates PNG/WebP through fetch") does not describe the current path. This is mainly a finding for the infrastructure lane.
2. The repository has the real capture size distribution, and the report says that it is unknown. `docs/evidence/ariakit-capture-measurement/README.md:39` (mean 17.6 KiB and 142,444 pixels, maximum 210,157 bytes and 1,547,520 pixels). It changes the numbers in PKG-03, PKG-04, and PKG-19.
3. The limits that are nearest for growth are not the pixel limit. With one profile record for each batch clip (`visual.ts:165-176` and `225-238` put `clip` into `captureOptions`), `profiles` is limited to 10,000 (`packages/protocol/src/validate.ts:273`, `apps/web/src/capture-inventory.ts:186`) while the server allows 40,000 captures. A synthetic combined manifest with 3,582 captures and 3,582 profiles is 4.69 MiB compact (my `manifest-size.mjs`), and the CLI limit is 8 MiB (`packages/cli/src/files.ts:9`). The real record sizes are not measured.
4. The reporter writes the shard manifest with indentation: `packages/playwright/src/reporter.ts:254` (`JSON.stringify(manifest, null, 2)`). In the same synthetic test the `linux` shard manifest is 3.22 MiB compact and 4.62 MiB with indentation. Both count against the 8 MiB limits in `artifact-archive.ts:10` and `files.ts:9`.
5. `bindSubmission` builds a GitHub API URL with `GH_TOKEN` from `manifest.run.repository` (`packages/cli/src/signed-context.ts:36`), and no CLI step compares that value with `GITHUB_REPOSITORY` (`github-artifacts.ts:245-250` checks run, attempt, commit, and shard only). The host is always `api.github.com`, and the server rejects a wrong repository later (`workflow-owned.ts:506`), so this is hardening, not a leak.
6. `MAX_VALIDATION_BUSY_PUT_ATTEMPTS = 25` cannot be reached inside the shared 30-second deadline. The server always sends `Retry-After: 1`, and `retryDelay` adds 0 to 250 ms (`http.ts:97-110`, `135-143`). This only matters if item 1 is changed so that the path runs again.
7. The published adapter pins `engines.node` to exactly `24.18.0` (`packages/playwright/package.json:57-59`). The report lists it only as a difference from the CLI range. For a public package it gives an engine warning, or an error with strict engines, on each other Node patch version.
8. `visonaut_images.validated` is a constant: `apps/web/migrations/0001_service.sql:73` has `DEFAULT 1 CHECK (validated = 1)`. The `image.validated=1` tests in `packages/service/src/run-admission.ts:553` and `588` are always true, so they do not prove a decode (see item 1).
