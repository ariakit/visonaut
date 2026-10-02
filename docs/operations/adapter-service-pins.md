# Ariakit adapter service pins

This is the production service configuration for issue #204 D07/W05 adapter adoption. It is a prepared change, not proof of deployment or consumer adoption. Live actions require approval of the reviewed service and consumer patches, a fresh check of their exact bytes, and the caller census below. The compatibility bridge and final private-field retirement hold in [the adapter record](adapter-comparison-defaults.md) still apply.

## Matching trust tuple

The service trusts one App workflow blob and one executor digest. Keep these values together for `ariakit/ariakit`, repository ID `104133653`, and project `ariakit`.

| Value                     | Prepared tuple                                                     | Previous tuple                                                     |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| App workflow blob B       | `3858bc67dda6d70381c3ad189f85dd6266fc7942`                         | `ec8ba1563228164856c33c94f4fa96645448c730`                         |
| Native CI workflow blob C | `3dbaca30542ae9e84bbbba3f87cc29891bdf7856`                         | `3dbaca30542ae9e84bbbba3f87cc29891bdf7856`                         |
| Adapter archive SHA256 D  | `e1194e2085c15c99eb88ae59b638aaa0462b94233bffb4676fe7a2a60075ea98` | `7e8c77bf386518619fd2a04a8b5a1509fa5a1db1c2a84827b26132672999d3a5` |

The new D is the verified registry archive for `@visonaut/playwright@0.4.1`, published by [Release run 37073141940](https://github.com/ariakit/visonaut/actions/runs/37073141940) from [Visonaut source `ea889963`](https://github.com/ariakit/visonaut/commit/ea8899631716b78979d8a0b2b35e6b546685884a). The prepared consumer App bytes change only the archive digest from the App workflow at [Ariakit base `b9a3527e`](https://github.com/ariakit/ariakit/commit/b9a3527ea35ec707e9f5afa69657cc684cf76308). Recompute B from the final raw App file with `git hash-object`; recheck C from the final raw CI file. Recheck the registry archive integrity and SHA256 against D before live actions. A Git blob hash is not a commit SHA.

The App `reusableWorkflowRef` ends in `@B`, and `reusableWorkflowSha` equals B. The consumer repository variable `VISONAUT_WORKFLOW_SOURCE_SHA` must equal B. The prepared consumer retains CLI `0.5.3`, Playwright `1.63.0`, Node `24.18.0`, and signed Submit checkout `c87988effdff42edf4934ded906aa32ee3c04b66`. Preview configuration, job names, shards, partial reruns, and Gate keep their existing behavior.

## Calls that depend on the current pins

| Call or state                                                               | Pin dependency                                                                                                                       | Cutover effect                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Begin and reserve                                                           | Current B and C authenticate the App job; reserve also checks the current B source digest.                                           | An old App job cannot start or reserve after B changes.                                                            |
| Manifest admission                                                          | Current D plus the stored run, job, attempt, and source digest.                                                                      | An old executor manifest cannot be admitted after D changes.                                                       |
| Reference reads, admitted image upload, image reuse, and shard finalization | Signed capability and stored run/job/attempt/source identities; existing expiry, retention, reference, and image checks still apply. | Existing credentials do not by themselves require B or D. They cannot bypass Submit or unfinished materialization. |
| Signed Submit, including Submit-only reruns                                 | Current B and C, current source digest/ref, job identity, and stored attempt evidence.                                               | An old staged attempt cannot submit after B changes. A repeated Submit still verifies the current source.          |
| New or unfinished materialization                                           | Current B, D, unchanged C Plan proof, final GitHub jobs, stored signed Submit, and complete manifests.                               | A submitted old attempt still needs settlement before the pin change if it needs this path.                        |
| Sealed service run recovery                                                 | Stored run and receipt, unchanged C Plan proof, and existing reference/publication checks.                                           | The sealed-run path returns before current B/D reconciliation. It does not require a global queue drain.           |
| Native Plan report with `visualRequired: false`                             | Current C and native Plan job evidence.                                                                                              | B and D do not change this source check.                                                                           |

These rules come from [workflow admission](../../apps/web/src/api/workflow-owned.ts), [OIDC verification](../../packages/security/src/oidc.ts), [Plan checks](../../apps/web/src/api/pre-run.ts), [reconciliation](../../apps/web/src/api/workflow-reconcile.ts), and [materialization](../../apps/web/src/api/workflow-materialize.ts). Current digest admission remains exact:

```ts
digest === configuration.trustedExecutorDigest;
```

## Fixed caller cohort and rollout

At the approved cutover boundary, coordinate a pause of new relevant old-source visual attempts. Save the boundary time and the exact eligible old caller cohort. Scope it to the configured repository/project and native CI workflow. Include running or queued visual-required callers that can still reach Begin or Submit, existing live old staged attempts that still need admission or materialization, and eligible partial or Submit-only reruns that can carry old captures. Inspect an unresolved Plan result before excluding its attempt. Record run ID, attempt, tested SHA, App/CI blobs, executor digest when available, GitHub job IDs/status, staged run ID, service sealing state, and its disposition.

Let each fixed cohort member complete under the previous tuple, or record an explicit terminal or replacement disposition. A terminal GitHub workflow does not by itself prove that its submitted staged run has materialized. Check that submitted live staged evidence no longer needs current B/D reconciliation. A sealed run can still need comparison or check publication; use the recovery path and its normal guards. Read the current attempt and any newer attempt before accepting a disposition.

Do not gate on every GitHub job, every database row, or every OPERATIONS queue item. Native no-visual Plan calls, unrelated jobs, retained terminal history, sealed-run publication, reviews, Undo, exports, and retention work are outside this pin-dependent cohort. Do not reopen the settled PR205 authority-transfer cohort. A saved earlier census is not proof that today's eligible attempts are settled. Recheck the fixed cohort and the admission boundary immediately before switching pins; account for any new relevant attempt before proceeding.

After both patches and the cohort disposition are approved:

1. Recheck the final service and consumer snapshots, B/C/D, and signed Submit checkout. Complete local consumer validation and review; inspect current live consumer CI for the old caller cohort. Keep live adoption held while the consumer baseline comparison or review remains unresolved.
2. Complete the fixed old cohort under the previous tuple. Preserve its signed evidence and normal recovery paths.
3. Deploy the reviewed production service source through the existing deployment workflow. Build with `CLOUDFLARE_ENV=production` and deploy its generated configuration. Read back the deployed source, full tuple, bindings, and traffic before continuing.
4. Set and read back the consumer repository variable B, then push the matching reviewed consumer change. Verify the actual workflow file blobs and archive digest again.
5. Verify a fresh complete consumer attempt through native Plan, normal captures, signed Submit, materialization, and Gate. Capture every shard under the new tuple; do not carry old-tuple captures into this attempt. Preserve the existing partial-rerun validation for later attempts under the matching tuple. Record the exact run, attempt, tested SHA, job identities, and service receipt before calling this consumer adopted.

This sequence adds no alternate digest, source exception, queue subsystem, or launch flag. Local tests, a build, and a dry run do not prove live resources, cohort settlement, or adoption.

## Rollback

Keep the reviewed previous tuple and its compatible consumer configuration/archive as one rollback set. A rollback requires fresh approval and a new census of relevant attempts under the tuple being replaced. Restore the matching service tuple, consumer source variable, and reviewed consumer configuration through the normal workflows. Verify their readbacks and a fresh complete attempt. Do not combine old B with new D, rewrite signed receipts, or assume that partial attempts from either tuple can resume under the other. Worker code rollback does not roll back stored data or connected resources.
