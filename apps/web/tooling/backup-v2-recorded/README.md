# Recorded E08 backup v2 harness

This directory preserves the 2026-09-22 isolated v2 recovery experiment. It does not test the later v3 grouped inventory or archive lifecycle. Use the current production backup code for those checks. The frozen Worker bundles contain only code and synthetic diagnostic identifiers. The SQL export, corpus, and credentials are not included.

`recorded-backup-worker.js.gz` is the exact bundle deployed for the complete backup. `recorded-worker.js.gz` is the later bundle used for restore and the separate page-size probe. The later bundle adds diagnostic routes and retains the same frozen backup and copy implementation. The source hashes and measured result are in `docs/evidence/backup-restore-v2.json`.

The controller is adapted only to read new resource names, local paths, and credentials from configuration. The frozen schema and fixture generator reproduce the synthetic data shape. New measurements will differ with the chosen corpus, service location, and runtime. Do not call repeated image bytes new browser captures.

## Prepare a new isolated environment

Use the repository's pinned Node and pnpm versions. From this directory, create three new D1 databases and five new R2 buckets. Give all eight resources a unique disposable prefix. Configure the bindings listed in `wrangler.example.json` and copy it to ignored `wrangler.drill.json`. Replace the zero-filled IDs, resource names, and account values. `vars.ACCOUNT_ID` must match `account_id`; `vars.SOURCE_DATABASE_ID` must match the `SOURCE_DB` ID.

Expand the frozen bundle, generate fresh fixture credentials, and deploy:

```sh
gzip -dc recorded-worker.js.gz > recorded-worker.js
node credentials.mjs
pnpm exec wrangler deploy --config wrangler.drill.json
pnpm exec wrangler secret bulk secrets-before.json --config wrangler.drill.json
```

The Worker denies access until the diagnostic credential is set. Do not add a GitHub binding, production queue, production database, or existing application bucket. The export API token must have access only to export the disposable source database. Keep it in a local file; do not add it as a Worker secret.

Generate the synthetic fixture from an available WebP screenshot corpus. The generator selects files under `__screenshots__` directories and repeats them across distinct per-run object keys. It refuses to overwrite its SQLite database.

```sh
node --experimental-transform-types generate-fixture.mjs --corpus /path/to/corpus --output /path/to/new-fixture --captures 35820
export ARIVISO_DRILL_FIXTURE=/path/to/new-fixture
export ARIVISO_DRILL_ORIGIN=https://YOUR-DISPOSABLE-WORKER.YOUR-SUBDOMAIN.workers.dev
export ARIVISO_EXPORT_TOKEN_FILE=/path/to/local-export-token
node --experimental-transform-types run-drill.mjs seed
pnpm exec wrangler d1 execute YOUR-SOURCE-DATABASE --remote --file frozen-schema/apps/web/migrations/0007_backup_inventory.sql --config wrangler.drill.json
```

`seed` imports the six initial schema migrations with the synthetic fixture. Apply only the shown v2 inventory migration afterward. Do not apply current application migrations to this frozen experiment. The source and target database roles must remain separate. `ARIVISO_DRILL_SKIP_IMPORT=1` permits resuming object seeding after a successful SQL import; use it only after inspecting the recorded import result.

## Measure and restore

Finish source writes before backup. Run these phases in order:

```sh
node --experimental-transform-types run-drill.mjs inventory
node --experimental-transform-types run-drill.mjs timing
node --experimental-transform-types run-drill.mjs backup
node --experimental-transform-types run-drill.mjs restore
node --experimental-transform-types run-drill.mjs rotate
```

Backup establishes recovery pins before a local consistent D1 export. It then stages that exact verified SQL and copies required objects. Do not mutate source application data during this sequence. Restore requires separate empty target D1 and R2 resources. It checks the SQL digest, imports SQL, copies and verifies all objects, fences restored credentials and work, rechecks retained references, and rotates only the three fixture credentials. It does not activate the target.

The controller stores results and checkpoints in ignored `results/`. A resumed restore retains its original start time. Preserve failures and incomplete records. `restore-result.json` contains RPO bounds and RTO; `rotation-result.json` proves the old access token and still-unexpired old ingestion capability were rejected. Never publish the SQL files, secret files, or rotation checkpoint.

## Remove fixture access

After verification, remove `DRILL_TOKEN`, `AUTH_SECRET`, and `INGEST_CAPABILITY_SECRET` with `wrangler secret delete NAME --config wrangler.drill.json`. Check that the former access credential is denied. Remove local credential files and the rotation checkpoint. Delete these disposable resources when the evidence is no longer needed. Preserve unrelated account, GitHub, application, and export credentials.
