# Disposable native queue recovery probe

This probe uses real Cloudflare Queues and D1 with the repository's production lease, reconciliation, finalization, and alert helpers. Use only new disposable resources. It has no R2 or GitHub binding and sends no external notification. Its work results and empty-inventory finalization are synthetic test controls.

The recorded 2026-09-22 result is in `docs/evidence/queue-recovery.md`. `recorded-worker.js.gz` preserves the exact native Worker bundle for that result; decompression yields the bundle SHA-256 listed in the evidence JSON. It contains source code and diagnostic identifiers, with no credential values. It is a historical artifact, not the default deploy entry point. `worker.mjs` uses the current repository helpers so the control can be repeated after later changes.

## Prepare new resources

Use the repository's pinned Node and pnpm versions. From this directory, run `pnpm exec wrangler whoami` to check the selected account. Create a new D1 database, a work queue, and a dead-letter queue. For example, replace `YOUR-UNIQUE-PREFIX` in these commands:

```sh
pnpm exec wrangler d1 create YOUR-UNIQUE-PREFIX-db
pnpm exec wrangler queues create YOUR-UNIQUE-PREFIX-work
pnpm exec wrangler queues create YOUR-UNIQUE-PREFIX-dead
```

Copy `wrangler.example.json` to the ignored `wrangler.json`. Replace its zero-filled account and D1 IDs. Set its Worker and D1 names, queue names, and `DEAD_LETTER_QUEUE_NAME`. Check that every binding names a disposable resource. The work consumer must use the same dead-letter queue named by that variable. Keep the shown retry configuration for comparison with the recorded control.

Apply all repository migrations, then the two diagnostic log tables:

```sh
pnpm exec wrangler d1 migrations apply YOUR-UNIQUE-PREFIX-db --remote --config wrangler.json
pnpm exec wrangler d1 execute YOUR-UNIQUE-PREFIX-db --remote --file probe-schema.sql --config wrangler.json
node credentials.mjs
pnpm exec wrangler deploy --config wrangler.json
pnpm exec wrangler secret bulk .probe-secrets.json --config wrangler.json
```

`credentials.mjs` creates two local files with mode 0600 and refuses to overwrite them. It does not print the credential. The Worker rejects access until the secret is configured. Do not commit either file. The preparation route refuses a database that already has a project.

## Run and inspect

Set the origin to the new disposable Worker, then run the controller:

```sh
VISONAUT_PROBE_ORIGIN=https://YOUR-UNIQUE-PREFIX.YOUR-SUBDOMAIN.workers.dev node run.mjs
```

The controller checks unauthenticated denial, durable work after a failed publication, a real expired lease, duplicate delivery, three-attempt work failure, native dead-letter delivery, private alerts, stale completion rejection, and explicit replacement recovery. It stops on a failed assertion. The publisher outage is injected before `Queue.send`, so the disposable Worker releases only that known-unsent receipt before retrying. A real ambiguous send retains its receipt for the Queue retention window plus in-flight delivery time. The generic work results do not prove image or GitHub correctness.

Inspect `results/events.jsonl` and `results/result.json`. Keep failed attempts as evidence. To rerun the full controller, create a fresh empty database and new resource names rather than deleting an existing project. The one-second queue delays are test parameters, not the production retry policy.

## Close access

After evidence is saved, remove only this fixture's access secret and local credential files:

```sh
pnpm exec wrangler secret delete PROBE_TOKEN --config wrangler.json
```

Verify the endpoint returns 503 while unconfigured. Delete `.probe-token` and `.probe-secrets.json` locally. Delete the disposable Worker, queues, and D1 database when their evidence is no longer needed. Do not revoke or change existing application, GitHub, or export credentials.
