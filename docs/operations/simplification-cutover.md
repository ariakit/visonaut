# Simplification cutover

This sequence separates checked source from external changes. Do not deploy before the linked evidence gates pass. Keep the [read-only resource inventory](simplification-inventory.json) and [implementation status](../simplification-implementation.md) beside each dated receipt.

1. Verify the current main source and integration workflow pins. Drain old active attempts before requiring new trusted Plan reports; missing reports must stay closed. Release obsolete workflow retention pins only after their attempts are terminal.
2. Preserve the private legacy backup metadata export receipts and verify any still-required original bytes. Rehearse the [native database recovery procedure](../../apps/web/src/operations/README.md#native-database-recovery) with separately authorized diagnostic D1/R2 resources: save a bookmark, restore a known diagnostic record, apply current migrations, fence old sessions/work/deliveries, page through image verification, check foreign keys, and verify new capture/export before reactivation. The passing local SQLite rewind proves the application procedure; it does not prove a hosted Time Travel restore. Do not rehearse against production.
3. Prove isolated standard Wrangler deployment and read back bindings, routes, consumers, cron, and observability. Both comparison Container applications had one live instance during the implementation inventory. Prove no active use before deleting their Durable Object classes or Container resources. The deployment guard requires the live backend to be `worker` and a zero-active-request receipt for its exact namespace observed within one hour.
4. Follow [conversion before deployment](../../apps/web/src/operations/README.md#conversion-before-deployment) for the coordinated target. Run `convertSourceBaselines` before releasing protected sources; verify owner pins, original bytes, destination readback, and source pointer settlement. Run `summarizeClosedRuns` over the original archives plus saved comparison supplement archives for both native and archived originals; preserve every selected result, actor decision, exact tuple, and approval eligibility before detail expiry. Require zero required protected snapshots, zero unconverted expired closed records, no unresolved conversion failures, and a clean `PRAGMA foreign_key_check` in both environments. A nonzero count blocks retirement. Incomplete or corrupt conversion must keep source evidence; do not infer readiness from a local test. Enable the permanent D1 reader and byte collection only after the corresponding readiness proof.
5. In the dedicated EU Infisical deployment project, review root key names, identity grants, and exact GitHub OIDC claims. Retain the reviewed project role without broadening grants. Move only the two deployment keys to `/`, and verify one deployment before deleting folder entries. The fixed project, identity, environment, and explicit key names remain enforced in source; missing root keys fail before any deployment.
6. Deploy preview fixtures and reject every auth or API write. Execute the existing preview session retirement SQL against the verified preview D1 target, verify zero sessions and denial of prior cookies, then remove preview App credential names. Preview rollback must not restore old sessions.
7. Prepare production's signed receiver and upstream delivery recovery. Change the App URL to `/v1/webhooks`, verify real signed ping and authorization revocation, then retire the router. Preserve the old URL and Worker as rollback material until these checks pass.
8. Publish and install the compatible public capture packages through the manual Changesets workflow. Apply the capture/Plan portion of the [prepared Ariakit patch](ariakit-consumer.patch), package lockfile, released package digest, small trusted visual workflow pin, and caller job pins while retaining Gate's existing polling. Verify visual, no-visual, missing/failed Plan, cancellation, expired artifacts, partial reruns, and repeated-attempt App checks. Activate and read back the App-specific required rule beside Gate before applying the polling-removal hunk. The full prepared patch already removes polling; do not apply that hunk before the rule is active. Alternatively, block merges during one controlled rule-and-workflow cutover and verify the rule and both checks before resuming merges.
9. Run package registry preflight, content smoke checks, source readiness checks, and provenance verification for every manual release.

GitHub App webhook mutation, production migrations, deployment, required rules, secret moves, resource retirement, hosted restore drills, and npm publication need separate external authorization and one external owner. These steps cannot be replaced by a local build result. Worker code rollback does not revert database or resource changes. Record the source, exact environment/resources, date, outcome, and readback evidence after each step.

## One-time conversion runner

Use the standalone [runner](../../apps/web/tooling/simplification-cutover/run.mjs) before deployment. Run it from the repository root with the pinned Node 24.18.0 and pnpm 12.5.1. It bundles only its selected conversion imports with the web workspace's existing Vite dependency. It does not load the web Vite configuration or environment files. The default action is local inspection against empty ephemeral D1/R2 state. This default is not a remote readiness check.

```sh
pnpm exec node apps/web/tooling/simplification-cutover/run.mjs --help
pnpm exec node apps/web/tooling/simplification-cutover/run.mjs
pnpm exec node apps/web/tooling/simplification-cutover/run.mjs inspect \
  --local --environment preview --persist-path /absolute/path/to/.wrangler/state/v3
```

Inspection reads the applied migration names and table columns before it runs readiness SQL. An absent `0024_core_simplification.sql` record, missing table, or missing required column produces `schemaReady:false`, `gatesReady:false`, and null readiness counts. It cannot turn unknown counts into zero. Apply the pending numbered migrations as a separate authorized step against the same checked target. The 2026-09-29 inventory has production through `0023` and preview through `0022`; both targets require the new schema before conversion.

Remote inspection requires an explicit action, environment, D1 UUID, and IMAGES bucket. The account is fixed to the checked inventory account. The temporary private Wrangler config contains only DB and IMAGES with each binding set to `remote:true`; it contains no preview ID overrides, routes, consumers, cron, Containers, secrets, quarantine, or service bindings. Local data persistence and environment files are disabled for remote use. The runner disposes the binding session and removes its temporary config.

```sh
pnpm exec node apps/web/tooling/simplification-cutover/run.mjs inspect \
  --remote --environment preview \
  --database-id 395b539c-c423-4ce4-887c-a5792792a63b \
  --images-bucket visonaut-preview-images
pnpm exec node apps/web/tooling/simplification-cutover/run.mjs inspect \
  --remote --environment production \
  --database-id 15fcd402-dccb-4359-a1ce-280ff67ca596 \
  --images-bucket visonaut-production-images
```

Remote application inspection does not change application data. Wrangler session setup uploads an ephemeral edge-preview proxy and can register a `workers.dev` subdomain if the account has none. Session setup is a provider write and requires separate authorization and credentials that permit the binding session as well as D1/R2 access. Do not assume a D1 read token can start this session. Keep Wrangler diagnostic logs private and outside Git; the report does not contain session credentials or its temporary hostname.

Before remote session setup, read back the selected comparator Worker's current production and preview-base runtime metadata. Production uses `visonaut-compare`; preview uses `visonaut-preview-compare`. Require no secrets and no plain variables except `VISONAUT_CODEC_BACKEND=worker` and `VISONAUT_COMPARISON_DEAD_LETTER_QUEUE` with the matching environment's queue name. The stock Wrangler proxy inherits `plain_text`, `json`, `secret_text`, and `secret_key` bindings and can expose arbitrary inherited names, so unknown or unexpected metadata blocks setup. Local mode keeps a random isolated name. This check does not expand the credential's existing Worker-name scope.

Before conversion, the external owner must coordinate the selected target's HTTP writers, cron, queue consumers, and old workflow attempts. Keep ordinary recovery and retention offline until the selected gates and byte readback pass. `VISONAUT_LAUNCH_ENABLED=false` does not fence writes. The runner cannot establish or verify this fence. `--acknowledge-write-fence` records the operator's acknowledgement; it is not fence evidence.

```sh
pnpm exec node apps/web/tooling/simplification-cutover/run.mjs convert \
  --remote --environment preview \
  --database-id 395b539c-c423-4ce4-887c-a5792792a63b \
  --images-bucket visonaut-preview-images \
  --acknowledge-write-fence
pnpm exec node apps/web/tooling/simplification-cutover/run.mjs convert \
  --remote --environment production \
  --database-id 15fcd402-dccb-4359-a1ce-280ff67ca596 \
  --images-bucket visonaut-production-images \
  --acknowledge-write-fence
```

Conversion calls only `convertSourceBaselines` and `summarizeClosedRuns`. Each turn selects baseline conversion while required protected snapshots remain, then closed history. A turn uses one candidate and two objects, with the existing 16 MiB object bound and 12-minute error backoff. One turn is the default; `--max-turns 2` through `--max-turns 10` sets a finite cap. Attention or no progress stops the loop. Repeat bounded calls from saved progress after inspecting the report. Do not clear cursors or resolve events manually to force readiness. The runner makes no queue publication, GitHub request, promotion, ordinary recovery, retention, schema migration, restore, access change, or R2 deletion.

Baseline conversion writes D1 owner pins, pointers, restoration receipts, and cursors. It can copy a missing original from a protected R2 object and keeps the protected bytes. The Node adapter buffers at most one object within the configured bound; it preserves conditional upload options and the existing SHA-256 verification and destination readback. Summary completion writes permanent rows and decisions, then removes detailed native D1 state. This D1 change is destructive. An incomplete conversion keeps its source evidence and reports attention.

Exit `0` means the selected aggregate conversion gates pass. Exit `2` means they do not pass, including missing schema, a turn cap, attention, or no progress. Exit `1` means an invalid option or runtime/binding failure. Save the JSON report beside the dated target receipt. Aggregate gates do not prove the selected R2 inventory, complete rendering/profile conversion, hosted recovery, Container drain, upstream authorization checks, or the write fence. Keep those separate evidence requirements in the cutover sequence.
