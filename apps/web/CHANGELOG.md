# @visonaut/web

## 0.2.1

### Patch Changes

- 426080e: Fixed repeated retries of historical terminal pull-request workflow receipts, including closed pull requests with an unstarted candidate.

## 0.2.0

### Minor Changes

- 19dc91b: New submissions require trusted local comparison

  **BREAKING** if a client reserves a run without `comparisonMode: "local-v1"` or requests server recomparison of a stored legacy run. Upgrade the Visonaut CLI and capture a new complete run with trusted local Submit. Previously issued upload capabilities and legacy recovery remain available during drain. Existing reviews, approvals, history, and originals retain their current rules.

  Before:

  ```ts
  const request = { ...reservation };
  ```

  After:

  ```ts
  const request = { ...reservation, comparisonMode: "local-v1" };
  ```

- 34d1165: Closed-run recomparison and export creation are retired

  **BREAKING** if you create a comparison from a closed run or create a product export. Closed runs now return `409 history_closed`, and new exports return `410 export_retired`. The export control is removed. A new comparison requires a fresh complete capture through trusted Submit.

  Before:

  ```http
  POST /api/runs/<closed-run-id>/recompare
  POST /api/runs/<run-id>/export
  ```

  After:

  ```http
  GET /api/runs/<closed-run-id>
  GET /api/exports/<existing-export-id>
  ```

  Existing history keeps its original decisions, approval identities, comparison links, and explicit expired states. Existing private export downloads retain verification, leases, expiry, cleanup, and their image pins through drain. The remaining export code is retained until verified drain permits final retirement.

- 767eec9: Product export endpoints are removed

  **BREAKING** if you use a product export URL. The [export endpoints](https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md#manual-evidence-export) return `404 not_found`, including existing links whose promised expiry has not passed. Endpoint retirement does not wait for export expiry, active download leases, or completed cleanup. Use retained run history to read existing evidence, or capture a new complete run for new evidence.

  Before:

  ```http
  GET /api/exports/<export-id>
  POST /api/runs/<run-id>/export
  ```

  After:

  ```http
  GET /api/runs/<run-id>
  ```

  Retained export pages and matching owner pins remain until ordinary bounded cleanup is eligible under its unchanged expiry and active-lease checks. Pins release only after private-page deletion completes. No forced expiry or deletion is required. Native recovery and ordinary image retention remain available. Recovery cannot recreate expired R2 image bytes. Preserve any specifically required private evidence. Remove `maximumExportEntries` and `maximumMetadataBytes` from custom `VISONAUT_OPERATIONS_BUDGET` overrides; the remaining limits keep their defaults.

- e9d150a: Server comparison producers and handlers are removed

  **BREAKING** if an old workflow stage requires server image comparison. After the terminal legacy cohort passes the retirement gate, the service requires a verified local Submit receipt to create a comparison. Upgrade the CLI and capture a new complete run. Existing reviews, approval tuples, history, originals, and native Submit recovery retain their current rules.

  Before:

  ```ts
  await service.createComparison({ ...comparison, maxAttempts: 5 });
  ```

  After:

  ```ts
  await service.createComparison({ ...comparison, localComparison: verifiedReceipt });
  ```

  The private image validation endpoint still supports PNG and WebP. Remove the retired `comparisonMaxAttempts` field from selected `VISONAUT_API_LIMITS` overrides before deployment. Remaining numeric bounds keep their existing values. Operators must detach the existing comparison and comparison dead-letter consumers before they deploy the fetch-only validation Worker. Queue resources and stored records remain in place. Follow the [retirement runbook](https://github.com/ariakit/visonaut/blob/main/docs/operations/retire-server-comparison.md).

### Patch Changes

- 25eb687: Updated the dashboard with a compact header, a bell that opens service alerts, a clearer run table, and colored run status badges.
- af4a132: Improved run export preparation for large project histories, with about 90% fewer history page reads and writes in an 82,556-row local benchmark.
- e382ba5: Made private page navigation faster by reducing GitHub identity and permission lookups from two calls to one on warm authorization checks, 50% fewer in the test fixture. Each request still checks current repository access.
- 306f127: Reduced R2 metadata requests for large workflow submissions while preserving checks for missing, modified, and legacy original images.
- 8d6bfd0: Delivered independent GitHub check updates with bounded parallel requests. In the four-check regression fixture, three PATCH requests overlapped, a 3× increase in concurrent status delivery over serial execution. Each check still keeps its own delivery fence when GitHub's response is uncertain.
- eb9b414: Added an informational review link to the pull request checks list so maintainers can open the matching Visonaut review from the pull request.
- ad1e71a: Added a support reference to unexpected request failures and review retry messages. The reference matches one safe server log entry.
- 779eb32: Updated the runs dashboard so narrow screens show each run's commit, creation time, attempt, and state without horizontal table scrolling. The alert count now floats at the bell's corner.
- 15fb75b: Replaced the review variant placeholders with recognizable framework and browser icons and clarified tooltips for display preferences.
- 859ad6f: Added an original-only image view, grouped image controls, flatter and rounder Sign out buttons, and item navigation that opens the first variant needing review unless the reviewer chose another. Review saves update the open page from the saved result and authoritative run status when current, refresh it after another run change, and wake check delivery after saves and Undo.
- 7185786: Reduced service database calls for a fresh Approve or Reject from seven to three, about 57% fewer calls in the local decision test. Decision saves can reuse a verified GitHub permission for up to 10 seconds and return before the status Queue wakeup completes. Live session checks and atomic decision saves remain required. Repository permission removal can take up to 10 seconds to block another decision.
- 816b329: Added direct links to review items and variants, compact visual variant labels, and a sidebar that keeps long item lists scrollable. Item navigation now uses supplied thumbnails without loading full comparison images for other items.
- 2d97f1a: Reduced image writes during Submit. In the small local D1 fixture, declaring, completing, and registering one uploaded image now writes 10 rows instead of 12, a 16.7% reduction. The count includes image and index writes and excludes transaction checks, run admission, retries, and retention.
- 3e28c71: Kept items with new variants visible in the main review list while preserving automatic acceptance and pending review counts. Ordinary accepted and unchanged items remain under Accepted.
- 4930189: Updated production trust pins for Ariakit's `@visonaut/playwright@0.4.1` captures. Deploy the matching service and consumer changes after the old visual attempts that still need admission or materialization are settled.
- 6f55c57: Updated production trust pins for Ariakit's CLI `0.5.4` and adapter `0.5.0` upgrade. Coordinate old visual and no-visual callers before deployment, then verify the matching service and workflow source pins before publishing the consumer upgrade.
- d703f27: Reduced D1 round trips for nine live-review metadata reads from nine calls to two batches, 78% fewer calls for those reads. Run pages still show the same review result.
- b51aafe: Improved Submit conversion for runs with many screenshots. In the 50-original regression fixture, image registration now uses one D1 batch instead of 50, a 50× reduction in registration batches. Every original still receives a full SHA check before registration.
- b3df20b: Blocked recompare for active pull requests captured under an older comparison policy. The review page now asks maintainers to refresh the pull request against main and rerun CI. Stored historical runs can still be compared again after policy changes.
- bba0c34: Bounded backup group copy pages to 100 objects, including distinct protected-snapshot keys.
- 6197ecf: Reduced image-update transactions by up to 16× for protected-baseline conversion. Each bounded group still verifies original bytes and retains protected copies until the baseline is complete.
- 4a7906c: Reduced the result JSON payload on local comparison rows by approximately 82–90% in the representative unchanged and changed results with masks, from 148/268 bytes to 26 bytes per row. Review pages, history archives, and closed summaries preserve metrics, masks, and the effective review outcome. D1 row writes and R2 image operations are unchanged.
- 369b2d5: Fixed Visonaut checks appearing on pull requests whose App job was skipped. The check now starts when the signed Submit job begins.
- 863ffc2: Store new signed upload and recovery evidence in temporary D1 pages. Keep existing R2 declarations readable, preserve image reuse and stored review masks, and retire the pages after the durable comparison handoff.
- 97f3651: Fixed approved visual reviews so their GitHub checks update before main baseline promotion finishes.
- c4980bb: Fixed pending visual checks for admitted main runs whose signed local reference became stale before a workflow or executor rollout. Reconciliation now detects the old baseline before source validation, fails the unsealed uploading run, and retains its evidence.
- a00d927: Fixed duplicate GitHub checks that stayed pending when GitHub regenerated an equivalent pull request merge, including after the pull request was squash merged. The unused check now closes with a neutral result and links to the completed Visonaut run.
- 991fe4e: Fixed run exports that failed when the database contained images from other runs.
- 078d4d2: Fixed visual checks that stayed pending when a trusted main Submit receipt used an old baseline. Unsealed uploading runs now fail without releasing their retained evidence, so a new trusted Submit attempt can use the current reference.
- 938707a: Reduced the wait to promote large baselines by copying and verifying protected images concurrently within each bounded pass.
- 863c4b3: Fixed native database recovery to keep old captures, checks, and webhooks inactive and reject workflow identities issued before restoration. New captures require a fresh Plan and check generation, while accepted history remains available.
- e92facd: Reduced approval lookup time by over 99% in a local SQLite workload with 3,646 changed rows and 36,460 saved decisions. Exact approval and lineage requirements remain unchanged.
- 1d119b1: Kept a signed pull request visual check valid when main advances during capture and GitHub still reports the tested merge or an equivalent tree as current.
- 80af2f1: Linked Visonaut GitHub checks directly to their review page so reviewers can open the run from a pull request.
- 9e71ee5: Staged unchanged screenshots with bounded parallel image reuse. In the two-original regression fixture, both source reads and both target writes overlapped, doubling in-flight R2 operations in each phase. Available sources are verified before any target write starts; missing sources still fall back to upload.
- 57c1919: Verified staged originals in bounded parallel batches during Submit conversion. In the five-original regression fixture, four R2 reads overlapped, a 4× increase over one-at-a-time verification. Each original still receives a full digest check before its image is registered.
- 79f919e: Indexed pending webhook lookups. In a local 35,302-delivery fixture with no pending work, 500 repeated lookups were 99.9% faster than the unindexed query.
- 896fd8a: Fixed duplicate Visonaut verdicts for new pull request attempts by using one head check with a direct review link. Existing merge checks keep their required verdicts. Signed Submit completion now requests ingestion, and saved review decisions start their durable task without waiting for the shared operations consumer.
- 41fc1e6: Fixed pull request reviews to keep their signed reference when main advances. Reference reads, trusted Submit, review decisions, Undo, and the required GitHub check now remain valid for the same pull request head and attempt. The required check is also published on the pull request head, so GitHub can still find it after rebuilding the merge commit. New pull request heads and attempts still replace older runs.
- dfc8397: Linked pull-request checks to their Visonaut review page, including a pending page before capture is ready.
- 44a116e: Fixed signed visual submission when GitHub still reports a workflow attempt as queued after its submission job starts.
- d3daf44: Raised the production and preview admission limit from two to five active upload or comparison runs, allowing more signed Submit jobs to start while earlier runs remain active.
- bfbd356: Stopped retrying verified historical main and closed pull-request workflow deliveries while preserving completed App checks and valid signed submissions.
- d3332f0: Recovered exhausted comparison Queue deliveries promptly when their dead-letter receipt matches the current run. Repeated transport failures now leave a visible failed comparison instead of retrying without a limit.
- 3f86d41: Fixed visual reviews that could remain pending if comparison creation failed after uploads completed. Submitted runs now retry comparison creation automatically, and retry alerts remain visible until a comparison exists.
- 722048f: Reduced redundant D1 writes. Repeating identical profile storage performs 100% fewer row writes in the two-profile local regression fixture, from six to zero. Successful transaction checks and unchanged background cursors also avoid row writes, and status acknowledgements preserve earlier delivery times.
- 204f320: Fixed visual submission, lineage, and check lifecycle when GitHub regenerates a pull request merge commit with the same parents and file contents.
- 1b9435f: Fixed baseline promotion and rollback so invalidated pull request comparisons stop using active comparison capacity. Reconciliation now frees their stale Queue slots so other reviews can proceed while those pull requests await recompare.
- b99e23b: Cleared stale snapshot-cleanup alerts when protected snapshots cannot retire or an earlier failure has recovered.
- e849c13: Fixed newer review evidence being lost when it arrived during a pending or failed decision save. Retries keep the original command identity and revisions, and a replacement comparison starts a separate review session.
- 7e23173: Moved private run-export metadata to the images bucket and removed the web Worker's dependency on the retired backup buckets and D1 export token.
- d5ad1cb: Stopped retrying completed webhook deliveries for closed or superseded pull requests when an earlier verified workflow attempt identifies the pull request.
- 70b77ec: Retired queued visual comparison work when its review run was superseded, so stale tasks no longer occupy queue capacity.
- a168e98: Allowed a verified capture or Submit job to retry transfer-key retrieval after a lost response.
- 776d415: Fixed the review page in dark mode and grouped accepted screenshots in a collapsible sidebar section so comparisons that need attention stay visible. Comparisons still running now show a pending state instead of an evidence error.
- 1866935: Fixed review evidence controls to explain failed comparisons and offer image retry only for loading or decode errors. The reference and new image panes now appear as each image is verified, while review actions wait for all required evidence.
- d81e885: Reduced full review-model requests by 100% across two pending comparison polls in the browser fixture. Review pages now check a small status response while comparing, pause polling when hidden, and load the complete result when the comparison finishes.
- 32c2029: Improved review navigation with bar indicators, compact variant links, and aligned image controls. Review decisions now update the screen before saving completes and restore the previous state if saving fails. Captures with no changed pixels no longer need approval solely because their capture profile changed.
- 774658f: Verified staged originals with six concurrent R2 reads during Submit conversion. In the seven-original regression fixture, six reads overlapped, a 1.5× increase over the previous four-read limit. Each original still receives a full digest check before registration.
- 124ccac: Skipped pixel comparison for validated screenshots with identical bytes and capture profiles. In the two-pair identical-image regression fixture, queued pixel tasks fell from two to zero, a 100% reduction. Changed screenshots still use the comparator.
- ee797e8: Acknowledges invalidated review comparisons without decoding their images and releases their queue admission slots.
- d91066a: Skipped pixel comparison when validated screenshots have identical bytes and their capture profiles differ only in comparison policy. In the two-pair policy-change fixture, queued pixel tasks fell from two to zero, a 100% reduction.
- 527eca3: Reduced repeated image downloads during Submit conversion. In the current-run upload and reuse test fixtures, the second download fell from one per image to zero; older images still receive full byte verification.
- a1d38a4: Fixed Visonaut checks to appear when signed Submit requests its transfer key, before it uploads images.
- c30e77d: Fixed stale dashboard reviews and service alerts to retire only after stored state proves supersession or completed delivery. Invalidated current reviews now ask for a fresh Submit. Current failures and uncertain GitHub sends keep their alerts and evidence.
- 1620814: Added a percentage-only visual comparison policy with a 0.0005 changed-pixel ratio for a controlled rollout. Matching screenshots no longer need review solely because the comparator policy changed.
- 51a3605: Trusted Ariakit's updated App workflow so pull requests can submit captures with Visonaut CLI 0.3.4.
- 97ab1d5: Stopped scheduling new SQL and image backups, while allowing an in-progress backup to finish and retained sets to expire. D1 Time Travel remains available for emergency database rollback, but it does not restore R2 images or reactivate the service safely by itself. Removed SQL backup size from run admission and cleared the old backup-age alert.
- 7e49647: Fixed ready review comparisons waiting for scheduled operations before their GitHub checks update.
- a235461: Fixed upstream webhook recovery requests in the Workers runtime.
- 8ebf821: Keep Approve and Reject available while earlier decisions save. Store review decisions in the server queue and process them in order, so acknowledged decisions can finish after the window closes. Show which decisions are still sending, preserve command identity on retry, and pause baseline promotion until queued decisions finish.
- 7893072: Fixed validation and import of local comparisons with zero changed pixels. Existing unreviewed local results are corrected without changing saved decisions or promotions. Image size changes and profile changes with different pixels still require review.
- 4c12b8d: Added safe failure reasons to webhook recovery logs without logging response data or credentials.
- c7d1185: Fixed webhook recovery to preserve 64-bit GitHub delivery IDs and reject fractional ID tokens.
- 5b0cf8d: Pinned production to the Ariakit workflow and adapter archive for Visonaut 0.4.0.
- Updated dependencies [7185786]
- Updated dependencies [4a7906c]
- Updated dependencies [863c4b3]
- Updated dependencies [126436d]
- Updated dependencies [896fd8a]
- Updated dependencies [722048f]
- Updated dependencies [32c2029]
- Updated dependencies [c30e77d]
- Updated dependencies [8ebf821]
- Updated dependencies [7893072]
  - @visonaut/service@0.0.1
  - @visonaut/security@0.0.1
