# Temporary D1 upload evidence

This phase of [issue 226](https://github.com/ariakit/visonaut/issues/226) replaces new persistent R2 manifest and plan documents with temporary D1 evidence and compact existing provenance. It preserves per-run R2 originals and masks, cross-run reuse by copy, baseline borrowing, individual approval, and all structured D1 review data. Result-field consolidation is a separate change.

## Storage and recovery

Migration `0033_d1_upload_evidence.sql` is additive. Existing staged declarations, permanent manifest pointers, and provenance pointers default to storage version 1. Their R2 readers remain. A retry keeps the original declaration version and page size. There is no backfill, old object deletion, new activation flag, or shared-object ownership change.

Version 2 stores `canonicalJson(manifest)` encoded as UTF-8 BLOB pages. The canonical digest and capture-manifest digest are kept in the header. Pages are at most 256 KiB; a default 16 MiB manifest needs at most 64 pages. The separate canonical byte check runs before any declaration write. Four-page batches bind each page twice for insert and equality proof, at most 2 MiB of content parameters. A read loads at most 1 MiB of page content. The reader validates order, exact page sizes, byte count, both digests, and declaration state before it returns a manifest. Unicode decoding occurs after byte reassembly.

Image declaration uses bounded descriptor parameters of at most 512 KiB. Image inventory reads use at most 512 rows. SQL uses parameters instead of embedding payloads; each statement is below the [D1 row, bound parameter, and SQL limits](https://developers.cloudflare.com/d1/platform/limits/) of 2,000,000 bytes, 100 parameters, and 100,000 SQL bytes. No capacity workload was used to test the configured input limit.

Each page or image batch checks the live unsubmitted run and immutable header identity. A declaration becomes complete only after exact page evidence, the signed local receipt and reference, and exact image descriptors pass validation. Database guards then freeze admitted descriptors and page content. Upload and reuse use the marker, signed run/job/reference binding, and indexed exact descriptor. They do not reconstruct the full manifest for each image. Identical completed retries check the live owner and completed state without rewriting the marker.

Finalization uses the shared versioned reader and one atomic live-owner, immutable-inventory, and completion check. Reconciliation and sealed-before-comparison recovery use the same reader. Imported manifests keep `finalized = 1`. Atomic comparison creation and `run.comparison_id` form the durable handoff. Once that comparison exists, recovery uses it even after staging retirement.

The existing staging retention window and leases control page retirement. Both candidate selection and deletion claim protect active sealed runs without a comparison. Version 2 retirement also requires a matching finalized permanent manifest. Pages are deleted before manifest parents and appear in the final emptiness assertion. The one-record cleanup test confirms that deletion resumes across steps and leaves the service-owned original intact. Pages are temporary recovery evidence; they are not a permanent second JSON copy or review source.

New permanent pointers have `storage_version = 2` and identify compact D1 records. History packs those records in its existing provenance and manifest sections and selects only version 1 pointers for R2 documents. It does not create a synthetic document copy for new records. Compact provenance includes the workflow source digest, job-set digest, caller/reusable identity, executor identity, and bundle digest list.

## Local operation evidence

[Native phase counts](native-phases.json) compare main after SQL PR #236 and index PR #237 with this phase. The baseline uses its actual schema through `0032_upload_indexes`; the new source uses migration 0033. [Source proof](source-proof.json) records the base and source digests, participant audit, and regression checks. Each case has one capture; the changed case uploads one original and one mask. Fixture setup and GitHub mock setup are excluded. The comparison record is a subset of `materialize-total` and must not be added twice.

The totals include declaration, identical declaration retry, upload or reuse, identical upload retry, finalization, identical finalization retry, materialization and comparison, review, bounded page retirement, and recovery after retirement. The partial-upload case adds an injected interruption before storage and rejection of incomplete finalization. It does not model the bill for a failed provider operation, because no such operation occurs and failed D1 batches do not return native metadata.

| One-capture fixture          | D1 writes before | D1 writes after | R2 puts before | R2 puts after | R2 body bytes put before | R2 body bytes put after |
| ---------------------------- | ---------------: | --------------: | -------------: | ------------: | -----------------------: | ----------------------: |
| New capture                  |               92 |              96 |              4 |             1 |                    6,041 |                      94 |
| Changed with mask            |              101 |             105 |              5 |             2 |                    6,966 |                     457 |
| Unchanged, borrowed image    |               81 |              85 |              3 |             0 |                    6,143 |                       0 |
| Reuse hit                    |               90 |              94 |              4 |             1 |                    6,041 |                      94 |
| Reuse miss                   |               90 |              94 |              4 |             1 |                    6,041 |                      94 |
| Interrupted upload and retry |               90 |              94 |              4 |             1 |                    6,041 |                      94 |

This phase adds four counted D1 writes in each measured lifecycle. It removes the three metadata puts in these fixtures, including the declaration retry. It makes no D1 write-saving claim. Native counts include indexes, immutable-state guards, replacement pages and markers, and page retirement. `get` counts include body bytes; `head` and `list` count calls without claiming body-byte transfers. The JSON records separate D1 reads, R2 operations, bytes, and elapsed time by phase.

These are single local observations on Miniflare, with mocked GitHub and no network latency. They are not production latency, a throughput benchmark, a capacity result, or billing totals. Review model bytes and local elapsed time are recorded for both versions. No cloud capture, remote D1/R2/queue mutation, synthetic load, or provider action occurred.

## Verification

The affected functional and history checks passed, including native migration parity and foreign key checks, changed and unchanged capture review, masks and originals, individual approval, borrowed-image protection, reuse hit and miss, signed job and reference validation, interrupted page declaration and upload, immutable replay, missing/corrupt/Unicode pages, concurrent finalization, final commit failure, sealed-before-comparison recovery, expiry, and bounded retirement. Larger inventory and capacity fixtures were excluded. The page-boundary fixture lowers the page size for one capture.

The Unicode test fails on old main because it stores version 1 R2 evidence. The sealed-retention test fails on old main because it claims an active sealed run with no comparison. The fixed source passes both. Exact saved-patch comparisons verified restoration after temporary red checks. The claim-race fixture changes the comparison between candidate selection and claim and proves that claim SQL rechecks the guard.

## Release and rollback

The API and OPERATIONS consumer run in one web Worker. Apply the additive migration and release the dual readers and new writer together in one ordinary release. The parent chat owns merge and deployment under the existing human approval. This phase does not change release configuration or private package version policy.

Rollback must retain version 2 readers and migration 0033. A forward source release can stop new version 2 declarations while keeping version 2 upload, reconciliation, sealed recovery, and history handling. Do not roll back to an R2-only Worker after a version 2 declaration exists. Do not rewrite declarations, backfill documents, or delete old objects to enable rollback.
