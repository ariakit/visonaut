# Operations integration

Apply all numbered web D1 migrations in order. Preserve applied migrations as history. The live service uses one D1 database, IMAGES, QUARANTINE, and the existing queues. The web Worker owns comparison recovery; the compare Worker consumes work and publishes a status wakeup.

Use named messages on OPERATIONS. A review or completed comparison sends `status`. Trusted Submit sends `ingest`. Cron sends `recovery`. A bounded maintenance step sends a continuation for its own family. A status wakeup runs checks, review links, and promotion without scanning closed history or retention.

```ts
await operationsQueue.send({ kind: "status", comparisonId });
await operationsQueue.send({ kind: "maintenance", family: "history" });
```

D1 identities, conditional writes, leases, and immutable R2 keys control repeat delivery. Set each budget field from measured deployment limits. `maximumObjectBytes` bounds one image or metadata page. `maximumMetadataBytes` bounds total manual-export metadata. `maximumExportEntries` bounds the exported payload. These limits are separate from database-capacity admission.

## Baselines and closed history

New accepted snapshots point to immutable source originals. Promotion reads and hashes each distinct original once per bounded page. It writes no protected image copy. Before promotion starts, D1 pins the snapshot's run and every inherited image owner. A missing or corrupt original blocks promotion. Promotion closes the review at the promotion time. The final GitHub check remains passed. A promoted review is read-only. A correction requires a new complete main capture.

Each new run owns its verified approval. A copied approval records its source decision ID, actor, and exact tuple. Verification still requires the allowed lineage and the exact reference, candidate, rendering identity, policy, engine, and codec. A later edit to the source decision does not revoke a downstream copy. Migration `0024` converts valid active links and clears invalid active links. It preserves closed links as historical evidence.

Rendering identity excludes comparison policy and engine. The converter verifies the original stored profile digest before saving its rendering digest. Required old tuples retain their original JSON beside the converted tuple. Comparison policy, engine, and codec remain in the acceptance tuple; conversion does not change the selected policy.

Closed runs keep their identity, status, all actor decisions, exact tuples, explicit approval eligibility, and a compact audit summary in D1. At the existing 30-day boundary, the history step creates or converts this summary before the byte collector can claim the run. Before this boundary, a non-promoted closed run can create a read-only comparison from its retained native D1 captures. The operation does not rehydrate old archives. At expiry, the read path serves a terminal summary. It does not rehydrate captures, recompute historical comparisons, or replay archived commands. Owner pins still block byte deletion. A baseline can retain originals after its detailed review has closed.

## Conversion before deployment

Drain or cancel old workflow attempts before switching to the combined Submit path. Release their obsolete `workflow-rerun:` retention pins only after those attempts are terminal. Do not discard an unfinished attempt merely because its old writer was removed.

Required old protected snapshots must pass `convertSourceBaselines`. It installs pins for live owners, verifies an existing source original or restores it from the protected copy, and verifies destination readback. An already deleted source owner can become live only with a one-use verified baseline-conversion receipt. The receipt, source pins, and snapshot switch settle in one transaction. A run being deleted cannot be restored. Normal byte resurrection remains prohibited. Old protected objects are not deleted by this conversion.

Old ready history archives must pass `summarizeClosedRuns`. The converter verifies each archive page and saves resumable progress. It joins saved metadata and decisions only after all pages pass. Row counts, the source revision, decision evidence, and foreign keys must agree before the compact reader is enabled. An incomplete or corrupt conversion retains its source evidence and reports attention. Candidate cursors let later valid records proceed.

Check these counts after conversion and before removing the remaining conversion helpers. Require zero required protected snapshots, zero unconverted expired closed records, and no unresolved conversion failures. Run the checks in both environments. A nonzero count is a cutover gate, not permission to delete the source.

```sql
SELECT COUNT(*) AS required_protected_snapshots
FROM visonaut_snapshots snapshot
WHERE storage_mode='protected'
  AND (reference_eligible=1 OR EXISTS (
    SELECT 1 FROM visonaut_pins WHERE snapshot_id=snapshot.id));

SELECT COUNT(*) AS unconverted_closed_records
FROM visonaut_runs run
WHERE active=0 AND closed_at<=unixepoch()*1000-2592000000
  AND NOT EXISTS (SELECT 1 FROM visonaut_closed_summaries summary
    WHERE summary.run_id=run.id AND summary.state='ready');

SELECT kind,subject_id,code FROM operations_events
WHERE resolved_at IS NULL AND kind IN ('baseline-conversion','history');
PRAGMA foreign_key_check;
```

Legacy backup inventory was read without writes on 2026-09-29. Production retained 12 completed backup metadata sets and 260 ready groups; preview retained 14 completed zero-object sets. The account inventory contained current image/quarantine buckets and unrelated buckets, with no legacy backup bucket. Private metadata exports were saved with restrictive permissions and verified SHA-256 receipts before retiring the backup and restore source. The exports do not recreate missing image objects. Keep these private receipts outside Git. Applied tables and migrations, as well as remote data, remain intact.

## Manual evidence export

`POST /api/runs/:runId/export` creates a private evidence export. `GET /api/exports/:exportId` streams it. Both require a current maintainer session and current repository authorization. Export pages use the private `exports/` prefix in IMAGES. They cannot be served through the public image-ID route.

A sealed ready comparison is required. An export includes still-retained original, reference, and derived images with available profiles, provenance, decisions, and metadata. Pages and source objects are verified before the final `complete.json` integrity marker is emitted. Exports expire after 24 hours; an active download has its one-hour lease. A truncated download has no valid completion marker. Metadata and object bounds are finite. Local fixtures do not prove hosted latency, CPU, or cost for the full capture inventory.

The reader verifies the checksum pages and every listed file. The presence of a completion filename alone is insufficient. Cleanup removes private export pages in bounded steps before releasing its own pins. It does not release unrelated baseline, review, or manual ownership.

## Native database recovery

The recovery promise is D1 recovery plus originals that still exist in R2. It does not recreate expired image bytes. Cloudflare Time Travel is automatic, restores D1 in place, and does not clone a database; paid retention is 30 days and free retention is 7 days. See [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and [Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/).

Use this runbook first with a separate diagnostic D1 database and diagnostic R2 storage. Do not point a rehearsal at production. A hosted Time Travel drill requires its own resource and restore authorization.

1. Verify the exact account, environment, D1 UUID, and R2 bindings. Stop HTTP writes, cron, and queue consumers for the target. Save its current bookmark privately.
2. Create a known record in the diagnostic target, save its bookmark, change that record, then restore the saved bookmark. Verify that the record returns. Use a fresh diagnostic database for this sequence; copying production D1 does not copy its bookmark history.
3. Keep the target offline. Apply the current numbered migrations if the rewind precedes them. Run `sanitizeRestoredDatabase` only against this isolated target. It invalidates sessions and account tokens, makes unfinished tasks terminal, and fences old GitHub deliveries. It does not replay external effects.
4. Page through `inspectRecoveryImages`, retaining each `nextAfterId` until `hasMore` is false. Record missing and corrupt originals. Required baseline images must be present and verified; expired historical evidence must show an explicit missing or expired state. Run `PRAGMA foreign_key_check`.
5. Rotate authentication and ingest capability secrets in the target. Keep checks with ambiguous prior external writes fenced until their requests are proven settled. Capture a new complete main run when the old baseline cannot be verified.
6. Verify private login, a new capture, a manual evidence export, and terminal old command links. Reactivate only the verified target. Keep the previous bookmark and the drill receipt private.

Example commands for the independently selected diagnostic database:

```sh
pnpm exec wrangler d1 time-travel info DIAGNOSTIC_DATABASE
pnpm exec wrangler d1 time-travel restore DIAGNOSTIC_DATABASE --bookmark=VERIFIED_DIAGNOSTIC_BOOKMARK
```

The local recovery test restores an actual SQLite snapshot into a separate database, proves access and work fencing, and detects missing and corrupt R2 originals. Native D1/R2 tests also cover archive conversion and image streams. These tests establish the application procedure. They do not claim a completed hosted Time Travel rewind or a tested in-place production reactivation.
