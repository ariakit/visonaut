# One-time diagnostic check lease repair

This local Worker inspects six legacy `Ariviso` GitHub checks and, only when explicitly requested, calls the service's canonical `settleStatus(..., outcome: "not-sent")` operation for their revision-47 leases. It does not send GitHub PATCH requests, create checks, or resolve operation events.

The [incident evidence](../../../../docs/evidence/diagnostic-check-rename-repair.md) ties the exact stored error to the archived Worker code that threw before PATCH. Deploy the corrected diagnostic web Worker first, verify its version and legacy-name behavior, then use this utility. The code requires that version to be the sole 100% Cloudflare deployment when each request runs.

Create an ignored `.dev.vars` file beside `wrangler.jsonc` with a random local authorization token of at least 32 characters and a Cloudflare token that can read the diagnostic Worker's deployments. Do not print either value or pass it as a command argument:

```dotenv
REPAIR_AUTH_TOKEN="<random local token>"
REPAIR_CLOUDFLARE_API_TOKEN="<scoped Cloudflare token>"
```

Start Wrangler from the repository root in its default local execution mode:

```sh
./node_modules/.bin/wrangler dev --config apps/web/tooling/check-rename-repair/wrangler.jsonc --ip 127.0.0.1 --port 8788
```

The config sets `remote: true` only on the diagnostic D1 binding. The Worker code runs locally, and its D1 operations reach the real diagnostic database. Do not add Wrangler's `--local` or `--remote` switch: `--local` disables remote bindings, while `--remote` uploads code to a Cloudflare preview.

In another terminal, pass the exact fixed Worker version ID. `inspect` performs all D1, GitHub, and deployment checks with no writes. Record its sanitized result before considering settlement:

```sh
node apps/web/tooling/check-rename-repair/invoke.mjs inspect <fixed-worker-version-uuid>
node apps/web/tooling/check-rename-repair/invoke.mjs settle <fixed-worker-version-uuid>
```

`settle` rereads all six rows and rechecks the 100% Worker deployment after the remote checks, rejects any changed precondition, and uses each opaque lease token only in memory for the D1 token/revision comparison. It verifies each old row becomes `obsolete` and the lease clears while `delivered_revision` remains 46. A failed comparison stops the utility. A partial result is possible if a later row changes after an earlier row settles; inspect D1 and do not rerun blindly. A second run intentionally fails because the original leases no longer match.

After settlement, let the normal diagnostic scheduler deliver the five active current intents. Confirm each remote check is named `Visonaut`, has the intended status and conclusion, and has `delivered_revision=desired_revision` in D1. The inactive run has no current intent; resolve only its old `check-delivery` event after verifying revision 47 is obsolete, the run is inactive, and no current outbox row exists. The [live repair record](../../../../docs/evidence/diagnostic-check-rename-repair.md) describes the exact guarded resolution. Remove the local `.dev.vars` file and stop Wrangler when finished.
