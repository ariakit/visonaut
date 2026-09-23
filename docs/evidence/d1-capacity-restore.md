# Isolated D1 capacity export and restore

On September 22–23, 2026, an unbound D1 fixture was exported after migration 0014 and restored into a second unbound D1 database. This is a **database-only** capacity and recovery test. It did not copy the corresponding R2 image corpus, rotate application credentials, or make the restore available to the app. It therefore does not by itself pass E07 or E08.

| Measurement                                                 |                                                             Result |
| ----------------------------------------------------------- | -----------------------------------------------------------------: |
| Source physical size after migration                        |                                                5,919,244,288 bytes |
| Exported SQL                                                |                                                3,860,404,222 bytes |
| Exported SQL SHA-256                                        | `7a3b0f96462a01699d5729e857a622ee7b1319e5ffc5575c4a4159baf4e76805` |
| Export readiness / download and hash                        |                                          125.448 / 793.230 seconds |
| Isolated indexed restore database                           |                             `76f6af6a-7a04-4d2a-ba68-ae02cd053a41` |
| Indexed restore physical size                               |                                                5,937,836,032 bytes |
| Restored rows and tables                                    |                                         9,550,015 rows / 59 tables |
| Sum of successful fragment command durations                |                                                  3,467.489 seconds |
| Second restore from schema receipt to final import          |                                              64 minutes 47 seconds |
| Full export start to final import, including failed attempt |                                   approximately 2 hours 18 minutes |

The synthetic fixture represents 774 run pairs with 3,582 captures in each complete capture inventory. It includes 60 backup records, archived detail, retained snapshots, audit and status history, and 5,572,800 image metadata rows. It is a stress fixture, not measured Ariakit traffic or a proof that future captures keep the same byte distribution. The source and restore were separate D1 databases in the existing account. Neither was bound to a live Worker.

The first restore created schema and loaded the data before indexes. A late index import returned HTTP 504; retrying the composite image index hit `SQLITE_NOMEM`. That database is not a valid restore. The second database created the 31 indexes before importing data. A 256 MB data segment then reset the D1 execution host without committing that segment. Its unchanged row count established atomic rollback. Splitting the same verified segment into nine approximately 32 MB pieces completed it. The remaining 256 MB segments passed. The final import committed the export tail and reached the expected physical size. The result shows a recoverable import procedure, not that every arbitrary 256 MB segment is safe. The [sanitized receipts](./d1-capacity-restore.json) retain fragment hashes, timings, returned D1 metrics, all table counts, and the bounded reference checks; the 3.86 GB SQL body stays outside the repository.

All 59 restored table counts match the source. A whole-database `PRAGMA foreign_key_check` exceeded D1's query CPU limit. Individual checks passed with zero violations for 58 tables; the 5,572,800-row `visonaut_images` check also exceeded that limit. Its only declared foreign key is `run_id → visonaut_runs.id`. Fifty-six bounded rowid joins covered all 5,572,800 image rows and found zero missing non-null run references. This establishes the same reference property without claiming that the oversized PRAGMA completed.

The 3.86 GB SQL snapshot exceeds the service's currently selected 2 GiB automatic-backup ceiling. Its observed export/download interval also exceeds the selected 420-second export deadline. These are real capacity failures for this stress size; a successful manual D1 import does not make the deployed automatic backup path pass. The report does not assume that a desktop download time predicts Worker-to-R2 throughput. A hosted automatic-backup test or a measured bounded redesign is required before this workload can be admitted. Cloudflare's [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) cap one database at 10 GB, so the current physical size also leaves limited growth room.

The full D1-only interval is below the proposed one-working-day restore target, but excludes R2 restoration, access checks, retention enforcement, final verification, and restart of the app. It is not a complete RTO or RPO claim. The earlier [v2 combined restore](./backup-restore-v2.md) covers real database-plus-object recovery at smaller scale; the [v3 small drill](./v3-small/README.md) and [frozen large backup](./v3-large-numeric/README.md) have separate source and workload scopes.
