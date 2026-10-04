# Fresh D1 cutover for baseline and delta storage

Use a fresh D1 database for this development cutover. Keep the project ID, repository ID, comparison policy, accepted baseline SHA, and baseline revision. Convert the accepted baseline to a complete R2 inventory. Copy and verify every referenced original under `baselines/import/<import ID>/images/`. Do not copy old runs, comparisons, review decisions, authentication users, or sessions.

The local tool creates one synthetic accepted main run, one ready comparison, one imported snapshot, and one promotion header. These headers identify the imported baseline. The synthetic run has a deterministic UUID, and each imported image has a deterministic SHA-256 ID, so existing run and image routes can address them. They do not claim that an old review command occurred. The imported run is a read-only baseline header in history. It has no reconstructed pixel comparison, approval commands, or old review rows. Profiles and full baseline capture facts stay in R2. D1 contains one image row per distinct imported original and one retention pin for their owner. It also records the current baseline item and variant identities in main identity history. These facts keep a changed restoration subject to review after an item is removed. It contains no imported capture rows, snapshot membership rows, past removed identities, or old review history.

The tool writes only to the target database and target image bucket. It has no delete, reset, deploy, or database retirement operation. Its HTTP handler accepts only authenticated requests to `127.0.0.1` or `localhost` without an `Origin` header. Do not deploy this tool or expose it through a tunnel.

## Prepare the replacement

1. Stop trusted submissions. Wait for active old promotion tasks to finish. Hold old scheduled and queued mutation work during the export and binding switch. This prevents a new accepted baseline between the final verification and deployment.
2. Create a new D1 database in the same account. Record its UUID and the old database UUID. Retain the old database and its Worker configuration for rollback. Use the existing image bucket or an explicit replacement bucket. Keep a record of both bucket names.
3. Install the declared workspace dependencies with `pnpm install --frozen-lockfile`. Create the tool configuration from explicit resource identifiers, from the repository root:

```sh
pnpm exec node apps/web/tooling/baseline-reset/configure.mjs \
  --source-id OLD_D1_UUID --source-name OLD_D1_NAME \
  --target-id NEW_D1_UUID --target-name NEW_D1_NAME \
  --source-images SOURCE_IMAGE_BUCKET --target-images TARGET_IMAGE_BUCKET \
  --source-quarantine SOURCE_QUARANTINE_BUCKET --target-quarantine TARGET_QUARANTINE_BUCKET \
  --project ariakit
```

This creates ignored `apps/web/tooling/baseline-reset/wrangler.local.json`. Review both D1 and R2 bindings before use. Source and target D1 UUIDs must differ. The generator sets the identity variables from those same binding UUIDs. Each resource has `remote: true`; these commands access real resources even though the Worker runs locally. The optional quarantine bindings are read-only in this tool. Provide both bucket names or omit both if cleanup measurement is outside this cutover.

4. Apply all migrations from this PR to the replacement database only:

```sh
pnpm exec wrangler d1 migrations apply TARGET_DB --remote \
  --config apps/web/tooling/baseline-reset/wrangler.local.json
```

5. Create a local access token in the ignored `.dev.vars` file. Keep the token outside source control:

```sh
pnpm exec node --input-type=module -e '
  import { randomBytes } from "node:crypto";
  import { writeFileSync } from "node:fs";
  writeFileSync("apps/web/tooling/baseline-reset/.dev.vars",
    `RESET_TOKEN=${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
'
```

6. Start the local tool. Do not add `--remote`, `--local`, or `--tunnel`: the tool must execute locally with its explicit remote bindings enabled.

```sh
pnpm exec wrangler dev \
  --config apps/web/tooling/baseline-reset/wrangler.local.json \
  --ip 127.0.0.1 --port 8790
```

Cloudflare documents [remote bindings](https://developers.cloudflare.com/workers/local-development/#remote-bindings) and [D1 migration commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/#d1-migrations-apply). Wrangler 4.136.1 supports the configuration and flags used here. The tool uses the application compatibility date, `2026-09-22`, so the declared local runtime can start it.

## Export, copy, and activate

Use a second terminal. Load the local token without printing it:

```sh
export RESET_TOKEN="$(pnpm exec node --input-type=module -e '
  import { readFileSync } from "node:fs";
  process.stdout.write(readFileSync("apps/web/tooling/baseline-reset/.dev.vars", "utf8").trim().slice("RESET_TOKEN=".length));
')"
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $RESET_TOKEN" http://127.0.0.1:8790/source
```

Save the returned `snapshotId`, `baselineRevision`, and `testedSha`. Send those exact values to `/prepare`, for example:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $RESET_TOKEN" -H 'Content-Type: application/json' \
  --data '{"snapshotId":"SOURCE_SNAPSHOT_ID","baselineRevision":7,"testedSha":"FULL_ACCEPTED_SHA"}' \
  http://127.0.0.1:8790/prepare
```

Save the returned `importId`, inventory pointer, capture count, image count, and page count. The import ID binds the two database UUIDs, project ID, and exact source snapshot, revision, and SHA. Repeating `/prepare` with those same values resumes that import. A different source baseline requires a new import and a fresh target database.

The tool accepts up to 10,000 captures. It validates the complete inventory, profile digests, representative image facts, and dense source membership. It then creates ineligible target baseline headers and a pin for the imported image owner. The project baseline pointer stays empty at this stage, and fresh-run admission stays disabled until activation.

Call `/copy` once for every page, from `0` through `pages - 1`. Each request handles at most 25 distinct originals. For example:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $RESET_TOKEN" -H 'Content-Type: application/json' \
  --data '{"importId":"IMPORT_ID","page":0}' http://127.0.0.1:8790/copy
```

Each step checks source size and SHA-256, makes a protected copy, reads that copy back, and checks its size and SHA-256. It registers the corresponding target image rows and writes an immutable completion receipt. Repeat a failed page with the same arguments. The step checks existing bytes and image rows before recording completion. Originals must be at most 20 MiB each. Import plan and inventory reads are bounded at 16 MiB.

After every copy page completes, activate the target baseline:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $RESET_TOKEN" -H 'Content-Type: application/json' \
  --data '{"importId":"IMPORT_ID"}' http://127.0.0.1:8790/activate
```

Activation checks that the source baseline is still current, reads every completion receipt, and verifies the target image count. It seeds only the verified inventory's current item and variant identities into main identity history. Each idempotent D1 batch handles at most 25 identities and 32 KiB of UTF-8 identity JSON, then checks every identity in that page. The final batch checks the complete identity count and rejects extra facts before it marks the inventory verified, makes the snapshot eligible, and sets the project pointer. No other runs can enter the target during this process. A failed identity or activation batch leaves the pointer empty and fresh-run admission disabled; repeat activation to resume. Repeating a completed activation is safe.

The copied image owner is pinned with reason `baseline`. Its retention prefix ends in `/images/`, so later image retirement does not delete the immutable `/inventory/` evidence. Old cleanup has no reference to the new `baselines/import/` prefix. Do not manually delete that prefix while any retained baseline or run uses its images.

## Verify and switch the binding

Keep the old database. Save the import result outside source control. Inspect the target with read-only commands, using the explicit tool configuration:

```sh
pnpm exec wrangler d1 execute TARGET_DB --remote \
  --config apps/web/tooling/baseline-reset/wrangler.local.json \
  --command "SELECT id,repository_id,baseline_revision,snapshot_id FROM visonaut_projects; SELECT id,tested_sha,state,reference_eligible,inventory_verified,capture_count FROM visonaut_snapshots; SELECT count(*) AS original_count FROM visonaut_images WHERE role='original'; SELECT lineage_key,count(*) AS identity_count FROM visonaut_identity_history GROUP BY lineage_key; PRAGMA foreign_key_check;"
```

Confirm the expected project and repository IDs, preserved revision and accepted SHA, verified and eligible imported snapshot, expected distinct original count, main identity count equal to the full baseline capture count, and an empty foreign-key check. Confirm that all copy pages completed. Do not infer completion from the baseline header alone.

Update the application production `DB` binding to the new UUID. If a replacement image bucket is used, update `IMAGES` to that bucket. Preserve all existing Worker variables, GitHub configuration, capability and authentication secrets, quarantine bucket, comparator, queue, and domain settings. These values are not part of the export. Build and deploy the application with the repository's existing deployment procedure. Keep admission held until this deployment is ready to use the imported baseline.

Re-enable trusted submissions and operations for the replacement. Run one complete trusted submit against the imported baseline. Confirm that reference pages contain the full expected inventory and inherited originals can be read. Review one real change, then run and accept a main comparison so it promotes a new baseline. Confirm the new baseline pointer, image availability, and retention pins after promotion. Record the submit, review, and promotion results before ending the cutover.

## Measure and select legacy R2 cleanup

Keep all old objects during the replacement submit, review, and main promotion checks. Cleanup starts only after those checks pass and the operator ends the rollback hold. Stop the old writer, scheduled jobs, queue consumer, and any old leased mutation work before selection. Hold replacement writes while recording the keep list and deleting approved legacy keys so the reference set cannot change during selection.

Record object counts and bytes before cleanup, for every relevant image and quarantine prefix. The local tool has a read-only metadata endpoint. It returns at most 1,000 object keys and sizes per request and never reads object bodies or changes objects:

```sh
curl --fail-with-body --silent --show-error --get \
  -H "Authorization: Bearer $RESET_TOKEN" \
  --data-urlencode 'bucket=source-images' --data-urlencode 'prefix=runs/' \
  http://127.0.0.1:8790/objects > r2-before-source-runs-page-0.json
```

Choose `source-images`, `target-images`, `source-quarantine`, or `target-quarantine`. Quarantine names require the optional bindings above. Use an empty prefix to inventory the whole bucket, or an exact owner prefix to measure a proposed cleanup group. If the buckets are shared, count each physical bucket once.

Follow `nextCursor` with `--data-urlencode 'cursor=RETURNED_CURSOR'` until `truncated` is `false`. R2 can return fewer than 1,000 objects before the final page. Save every page and sum its `count` and `bytes` for the prefix; a single page is not a complete measurement. Use non-overlapping prefixes for totals to avoid counting the same objects twice. Cloudflare documents the [R2 listing limit and continuation behavior](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2listoptions).

Build a keep list from the replacement database before selecting old objects. At minimum, inspect these read-only query results:

```sql
SELECT inventory_key FROM visonaut_runs WHERE inventory_key IS NOT NULL
UNION SELECT inventory_key FROM visonaut_snapshots WHERE inventory_key IS NOT NULL;
SELECT id,object_prefix FROM work_retained_runs WHERE byte_state!='deleted';
SELECT run_id,object_key,role FROM visonaut_images WHERE bytes_present=1;
SELECT manifest.run_id,manifest.manifest_object_key
FROM ingest_staged_manifests manifest JOIN ingest_staged_runs run ON run.id=manifest.run_id
WHERE run.retention_state='live';
SELECT image.run_id,image.object_key,image.quarantine_key
FROM ingest_staged_images image JOIN ingest_staged_runs run ON run.id=image.run_id
WHERE run.retention_state='live';
SELECT run_id,plan_object_key FROM ingest_run_provenance WHERE storage_version=1;
SELECT run_id,object_key FROM ingest_manifests WHERE storage_version=1;
```

Preserve every replacement inventory key. Read each complete inventory document and add every `captures[].image.objectKey` and `captures[].image.runId` to the keep list. Preserve each referenced image owner prefix even when it differs from the inventory's run ID. Add the imported `baselines/import/<import ID>/` namespace, all live retained owner prefixes and pins, all replacement image rows including masks and thumbnails, and all live staged manifest, original, and quarantine keys. Preserve any replacement backup, export, or recovery object. An object absent from these minimum queries is not automatically safe to delete.

For example, a promoted run can still inherit images from two earlier owners:

```js
keep = {
  inventory: "runs/new-main/inventory/digest.json",
  imageOwners: ["IMPORTED_OWNER_UUID", "earlier-changed-run", "new-main"],
};
```

Keep all three owners. Do not delete the broad `runs/` prefix after one successful promotion. Do not select objects by age alone.

Use the old database to identify positive legacy ownership. Candidate keys can come from old `visonaut_images`, old `visonaut_snapshot_images`, old `ingest_staged_images`, old `ingest_uploads`, old R2-backed manifests, and old R2-backed provenance. Candidate owner prefixes can come from old retained runs and old snapshots. Expand each candidate prefix into exact keys with `/objects`. Intersect candidates with the measured physical object list, then remove every key and prefix on the replacement keep list. Include old images, masks, manifests, and quarantine objects only when this comparison proves that no retained replacement record or inventory needs them. Leave unknown ownership untouched.

Save an operator-reviewed deletion list with the exact bucket, key, byte size, owning old record, and evidence that no replacement reference uses it. Record count and bytes per selected prefix. Keep that list and the old database until selection is complete. Remove only these approved exact keys in bounded batches through the existing R2 operator tools. For one approved key, Wrangler supports:

```sh
pnpm exec wrangler r2 object delete 'SOURCE_IMAGE_BUCKET/runs/OLD_UNUSED_RUN/APPROVED_OBJECT_KEY' --remote
```

The baseline reset tool has no delete endpoint. Repeat the complete metadata measurements after cleanup. Confirm that removed counts and bytes match the approved list and that inherited originals, masks, staged evidence, and every replacement inventory remain available. Restore replacement submissions and operations only after these checks pass.

## Roll back or retire

If any replacement submit, review, or promotion fails, hold replacement writes and restore the old `DB` and `IMAGES` bindings and old compatible Worker version. Restore old scheduled and queued work only after those bindings are active. Worker rollback alone does not restore database bindings or data. New review decisions created in the replacement are not copied back to the old database.

Retire the old database only after a complete replacement submit, review, and baseline promotion passes, the operator accepts the results, and the legacy object selection record is saved. Remove stale local tool configuration and token files. Stop the local tool. Check that old retention cleanup cannot reach imported images before retiring old resources. Database deletion and old bucket cleanup remain separate operator actions; this tool does neither.
