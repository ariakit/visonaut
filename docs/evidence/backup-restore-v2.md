# E08 · Isolated backup v2 and restore

The full isolated v2 backup and restore passed on 2026-09-22. It restored and verified **71,713 objects, 2,056,543,382 bytes, and all 71,713 retained references**. The target remained inactive. Full recovery, including SQL import, object copies, digest checks, work fencing, and actual fixture-secret rotation, took **93 minutes 35.480 seconds**.

This records the frozen v2 implementation. It does not cover the later v3 grouped backup inventory, profile normalization, archive lifecycle, or historical recomparison. Those changes require separate evidence. [The JSON record](./backup-restore-v2.json) includes source and bundle hashes, Worker versions, disposable resource IDs, timestamps, measurements, and limits. The [portable frozen harness](../../apps/web/tooling/backup-v2-recorded/README.md) preserves both deployed bundles, the controller, schema, fixture generator, and compressed raw receipts.

## Workload and method

The fixture had 35,820 original keys, 35,820 protected baseline copies, and 73 private plan or manifest objects. Two related attempts produced 71,640 capture rows. Original and protected images each occupied 1,018,254,966 bytes; private documents occupied 20,033,450 bytes. There were no thumbnails or masks.

The image bytes came from 1,058 historical WebP files with 989 distinct digests, repeated across distinct capture identities. Profiles, provenance, successful shard records, comparison outcomes, and review commands were synthetic SQL data. The review fixture deliberately marked inherited identical images as changed. This tests storage and state scale; it does not prove 35,820 new browser captures, comparator accuracy, capture noise, GitHub success, or authorized ingestion.

The backup established recovery pins before one consistent D1 SQL export. No application data changed between pinning and export. The local export-only API token was never installed in the Worker. The completed backup used 287 pages of at most 250 objects, with six concurrent copies within each page. Restore used a separate empty D1 database and separate empty R2 buckets. It verified the SQL digest, imported SQL, copied and rehashed every object, sanitized restored state, and rehashed each retained reference again.

The SQL export was 275,653,334 bytes. Its SHA-256 was:

```text
81a599f48faaf0ed780938db22134b2ae007430f798a8056fe70d79b4bf4e38d
```

## Recovery result

The SQL export interval was 07:58:49.682–07:59:24.510 UTC. Simulated recovery started at 09:05:01.971 UTC; integrity checks finished at 10:38:28.822 UTC; credential rotation finished at 10:38:37.451 UTC. Checkpoint resumes preserved the original recovery start time.

| Measure                                                  | Observed result          |
| -------------------------------------------------------- | ------------------------ |
| Snapshot age at simulated failure, or RPO                | 65m37.461s–66m12.289s    |
| Complete restoration, or RTO                             | 93m35.480s               |
| Restored objects / bytes                                 | 71,713 / 2,056,543,382   |
| Retained references rehashed                             | 71,713                   |
| Preserved captures / image records / protected copies    | 71,640 / 35,820 / 35,820 |
| Preserved command records                                | 3,702                    |
| Foreign-key violations                                   | 0                        |
| Restored sessions / stored account credentials           | 0 / 0                    |
| Active runs / unfenced tasks / unfenced check deliveries | 0 / 0 / 0                |

Each of the five fenced sentinel categories started with one live record. The original records remained available where required, but restored credentials and work could not resume. The RPO interval measures the age of this snapshot at the chosen failure time; it is not a daily scheduler guarantee.

The three fixture secrets were rotated through Cloudflare: `DRILL_TOKEN`, `AUTH_SECRET`, and `INGEST_CAPABILITY_SECRET`. The former access token returned 401. A capability signed with the previous ingestion secret also returned 401 while it was still unexpired. A new capability passed. Both recorded secret digests changed. The target was not activated.

After verification, those three fixture secrets were removed from Cloudflare and their local files were deleted. Former authenticated and anonymous requests both returned 401. Existing GitHub App, OAuth client, Cloudflare account, application, and local export-only credentials were not rotated or revoked. None of those application credentials was bound to the fixture.

A tamper control changed an inventory page digest before restoration. The request failed with `Inventory checksum differs`, and the target remained empty. The initial native copy control also exposed an R2 error: hashing removed the stream's known length. The production helper was corrected to retain that length with `FixedLengthStream`; the same native control then passed. These failed controls are preserved separately from the passing result.

## Measured cost and timing

The cold backup took 65m55.380s, including export and local staging. Its measured backup steps issued 72,002 R2 puts and 215,427 R2 gets. D1 reported 1,043,075 rows read, 791,441 rows written, and 3,468 queries. These totals exclude initial pin establishment, seeding, separate inventory verification, and local staging operations. The direct controller did not add the production scheduler's continuation delay.

Remote source D1 occupied 315,023,360 bytes after import, peaked at 364,437,504 during backup, and ended at 353,005,568 after inventory cleanup. Native target SQL import reported 34,176.482 ms of SQL time, 557,671 rows read, 1,198,438 written, and 314,343,424 physical bytes. SQL duration is not the complete import wall time.

Restore copy-page receipts recorded 71,713 backup gets, 143,426 target gets, and 71,713 target puts. These counts exclude inventory-page retrieval, SQL download, and final retained-reference rehash. The 287 restore pages had p50/p95/max wall times of 16.037/18.843/20.479 seconds.

A separate page-size probe copied 1,000 objects and 29,740,090 bytes in 63.359 seconds with six workers. Five reuse pages took 384–707 ms, median 534 ms, with no original-image reads or copies. This is one cold destination sample and five reuse samples, not a cold p95 or a complete second daily backup. It did not change the full backup's 250-object page size.

A Cloudflare aggregate for a separate copy-only interval contained 24 requests and 22,788,748 microseconds of total CPU. CPU p50/p95 were 983.837/1,273.127 ms; wall p50/p95 were 25.006/27.316 seconds. This is an adaptive aggregate, not complete-run CPU or peak memory evidence.

## Review and Undo at 35,820 rows

Thirty serial pairs approved one row and then undid it while the current accepted baseline contained 35,820 changed, approved rows. These used the frozen service and single-profile synthetic fixture, without concurrent load. Wall time was measured inside the Worker around the service method; client transport and preparatory reads were excluded.

| Operation                 | p50        | p95        | Maximum    |
| ------------------------- | ---------- | ---------- | ---------- |
| Review wall time          | 1,026 ms   | 1,279 ms   | 1,296 ms   |
| Undo wall time            | 528 ms     | 624 ms     | 2,016 ms   |
| Review baseline guard SQL | 165.312 ms | 196.683 ms | 198.128 ms |
| Undo baseline guard SQL   | 167.564 ms | 198.617 ms | 218.975 ms |

Each baseline guard read 250,743 rows. Fetching the full review inventory accounted for 519/623/809 ms at p50/p95/max. D1 reported ENAM/ORD primary for the timing statements. A later health response confirmed Worker placement at IAD, with request ingress at CWB. The original 30 timing responses did not preserve placement response headers, so the before/after placement timing comparison does not establish a sole cause.

The raw compressed timing data and exact frozen Worker bundles remain in the portable harness. Current service and storage improvements need their own measurements; this report does not transfer the older performance result to changed code.
