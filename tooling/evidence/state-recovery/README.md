# E03 state and recovery probe

This authenticated diagnostic runs the frozen Ariviso service, work, retention, lineage, and comparison functions with native D1 and R2. It uses a separate database and private bucket. It does not change production, preview, the GitHub integration diagnostics, or the v3 recovery drill.

The canonical source tree is in `source-manifest.json` inside `frozen-harness.tar.gz`. Readable files outside the archive are selected extracts. `prepare.mjs` compares every listed source file with that Git tree before it writes the manifest. `build.mjs` records source, fixture, controller, and bundle hashes. The local runner verifies those hashes before it starts Miniflare. A matching source hash proves the code version. It does not prove that all readiness conditions passed.

## Scope and fixture boundaries

| Case                        | Assertions                                                                                                                                                                                                                          | Injected boundary                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Atomic whole-item command   | A concurrent target change refuses the whole command; all production table row hashes stay equal; exact replay returns the saved result; Undo restores both prior verdicts                                                          | A second real service command commits immediately before the first native D1 batch |
| Current and stale Undo      | Stale D22 Undo and D26 rejection refuse after a later promotion; current D22 Undo restores the predecessor and revokes reference eligibility                                                                                        | Synthetic maintainers, complete runs, and logical time                             |
| Mixed history and rollback  | Automatic history refuses whole-item rejection; history approval creates no command; current/rollback snapshots resist retirement; D26 rollback preserves the automatic decision; Undo creates a new promotion                      | Native GC claim immediately before the rollback batch; synthetic maintainers       |
| Exact acceptance and status | The dependent comparison points to the specific source decision; source rejection invalidates acceptance and queued success; old delivery calls no sender; source Undo restores eligibility; unrelated identical pixels need review | Synthetic verified lineage; recorded sender callback                               |
| Removal and restoration     | Promoted automatic removal stays protected; exact restoration points to the original decision; changed restoration needs review                                                                                                     | Synthetic trusted full plans and lineage                                           |
| Retained-byte races         | Promotion-first and rollback-first pins block GC; an expired promotion lease remains a pin; GC-first blocks new promotion/rollback references; stale deletion tokens cannot settle; native R2 deletion is verified                  | Synthetic retained-run rows and explicit logical clocks                            |
| Delayed status              | Stale success, duplicate send, delayed response after lease expiry, ambiguous transport settlement, and post-credential freshness                                                                                                   | Native D1 state; mocked sender and explicit Promise barriers                       |

The capture fixture stores three valid 1×1 PNGs in native R2. Each comparison verifies the stored byte hash, then supplies the known fixture RGBA value to the exact comparison algorithm. This does not test PNG decoding. Promotion copies the actual native R2 bytes, reads them again, verifies the digest, then records the copy.

Trusted run metadata, maintainer identities, and lineage are fixtures. This probe does not prove OAuth, OIDC, App webhooks, GitHub failed-job inheritance, or the Ariakit capture matrix. The normal status scenarios use a recorded sender. They do not prove outbound App requests. A separate custom-check transport probe, when run, must identify its diagnostic sender and genuine HTTP receipts separately.

Full table snapshots cover every `ariviso_*`, `work_*`, and `operations_*` table. Each snapshot sorts complete serialized rows and records their SHA-256 hash and count. These snapshots prove that refused commands and replay left the stored row content equal. Query metrics change when the snapshots run.

D1 `calls` and `attemptedStatements` include attempted operations. The other D1 counters sum only metadata from successful returned results. Failed batches do not return their internal metadata. Probe receipt writes and schema setup are outside these counters. These are not total billable usage. R2 counters cover explicit fixture puts, gets, and deletes; they omit HEAD and control-plane calls.

## Local replay

Use Python 3 and the workspace's installed, pinned Node 24.18.0 and Miniflare dependencies. The wrapper needs no Git object, build, credential, or network request:

```sh
python3 tooling/evidence/state-recovery/prepare-replay.py --workspace "$PWD"
```

The wrapper verifies `frozen-harness.tar.gz`, creates a new temporary workspace, unpacks only regular files and directories, then verifies all original source, build, fixture, supplementary, and evidence hashes. It supplies the archived production sources and recorded Worker bundle. It links only the existing workspace dependency directories and copies the package manifests. It prints exact commands for the original local runners, for example:

```sh
cd /tmp/ariviso-e03-replay-EXAMPLE/tooling/evidence/state-recovery
node run-local.mjs
node --experimental-transform-types run-github-local-state.mjs
```

Use the actual path printed by the wrapper. Miniflare needs a localhost listener. The first command runs eight suites with native temporary D1/R2, including the strict GitHub HTTP mock, and checks authentication, replay refusal, and `PRAGMA foreign_key_check`. The second command runs only the separate local state/strict HTTP mock controller. Neither command uses a GitHub token or calls GitHub. New result files stay in the temporary copy; committed measured results remain unchanged. The wrapper moves only the replay copy of the old write-once controller receipt into `recorded/` before it prints the commands.

The 62-file `frozen-harness.tar.gz` preserves the original measured fixture, source archives, manifests, bundle, documentation, and results byte-for-byte. Readable files outside that archive are extracts and can be formatted independently. The archive is the canonical replay input. The original `prepare.mjs` and `build.mjs` remain historical build tooling: they require the recorded Git tree and must not be used to replay from a fresh clone.

## Hosted target and bounds

The approved target account is `b04f3af3f0f10a6b9481bc23ba974eca`.

- Worker: `ariviso-e03-state-20260922`.
- D1: `ariviso-e03-state-20260922`.
- Private R2: `ariviso-e03-state-20260922-images`.
- Worker CPU limit: 30 seconds per request.
- Each state scenario uses fewer than 1,000 native D1 statements, including fixture setup. The rollback sequence is split into two requests to keep headroom.
- Plan ceiling: 100 requests, 1 million D1 rows read, 100,000 D1 rows written, and less than 1 MiB of fixture objects. No cron, queue, or outbound notification is configured.

Only the protected fixed scenario routes can write fixture state. A prefix is single-use. An uncertain response must be recovered from its stored receipt; do not repeat it with a new prefix until the first operation is understood.

Copy `wrangler.example.json` to a private deployment config and insert only the verified new D1 ID. Set `PROBE_TOKEN` through Wrangler's protected secret input. Apply the frozen migrations and `probe-schema.sql` to this new database only. Deploy the reviewed bundle, record its version and byte hash, then run the bounded controller. Keep token values out of command arguments, logs, configuration files, and receipts.

The planning marginal-rate estimate is below USD 0.11. The planning allowance is USD 6 because shared-account R2 usage can cross one rounded Class A, Class B, or storage billing unit. This is an allowance, not an invoice or a measured hosted cost. No account plan change is authorized by this fixture. Pricing references: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), and [R2](https://developers.cloudflare.com/r2/pricing/). D1's per-request query limit is documented in [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Evidence and cleanup

Record resource IDs, deployment version, source tree, bundle hash, raw safe receipts, authenticated denial/replay results, native D1 state, and R2 inventory. Preserve the frozen bundle, source manifest, and receipts before cleanup. These records establish only the scenarios that actually passed.

Delete only the three named probe resources after the root task has preserved the evidence. Target cleanup within 24 hours. Revoke the temporary GitHub installation token after the separate custom-check probe, if used, and remove its protected local file. Cleanup must not touch the preview, production, regular diagnostics, or v3 drill resources. Keep the non-required custom GitHub check as the public transport receipt; never update existing required checks.

The completed [frozen report](../../../docs/evidence/state-recovery/README.md) records seven hosted state passes and the separate local-D1/live-GitHub transport pass. The live controller keeps the scoped installation token in local Node memory and revokes it after the run. Its use requires authorization for the exact diagnostic repository and new custom check. The earlier rejected upload path was not used.
